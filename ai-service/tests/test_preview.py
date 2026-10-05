import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from detection.plate_detector import Box  # noqa: E402
from preview import Feeder, FrameHolder, Overlay, draw, encode, make_server  # noqa: E402

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = np = None

TOKEN = "s3cret-token-value-1234"
FAKE_JPEG = b"\xff\xd8\xff\xe0fake-jpeg\xff\xd9"


def start(holder, **kw):
    server = make_server("127.0.0.1", 0, TOKEN, holder, **kw)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


class Security(unittest.TestCase):
    def setUp(self):
        self.holder = FrameHolder()
        self.server, self.base = start(self.holder)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_no_token_or_wrong_token_is_refused(self):
        self.holder.set(FAKE_JPEG)
        for path in ["/stream.mjpg", "/stream.mjpg?token=nope", "/snapshot.jpg", "/snapshot.jpg?token=" + TOKEN[:-1]]:
            status, _, _ = get(self.base + path)
            self.assertEqual(status, 403, path)

    def test_other_paths_are_not_found(self):
        self.assertEqual(get(self.base + "/?token=" + TOKEN)[0], 404)
        self.assertEqual(get(self.base + "/etc/passwd?token=" + TOKEN)[0], 404)

    def test_snapshot_with_token(self):
        self.assertEqual(get(f"{self.base}/snapshot.jpg?token={TOKEN}")[0], 503, "no picture yet")  # waits a few seconds
        self.holder.set(FAKE_JPEG)
        status, body, headers = get(f"{self.base}/snapshot.jpg?token={TOKEN}")
        self.assertEqual((status, body), (200, FAKE_JPEG))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Content-Type"], "image/jpeg")


class Streaming(unittest.TestCase):
    def test_stream_sends_multipart_frames_and_counts_viewers(self):
        holder = FrameHolder()
        feeder = Feeder.__new__(Feeder)  # only its viewers counter is used here
        feeder.viewers = 0
        server, base = start(holder, feeder=feeder, max_viewers=1)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        sock = socket.create_connection(("127.0.0.1", server.server_address[1]), timeout=3)
        sock.sendall(f"GET /stream.mjpg?token={TOKEN} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
        holder.set(FAKE_JPEG)
        data = b""
        deadline = time.time() + 3
        while FAKE_JPEG not in data and time.time() < deadline:
            data += sock.recv(4096)
        self.assertIn(b"multipart/x-mixed-replace; boundary=frame", data)
        self.assertIn(FAKE_JPEG, data)
        self.assertEqual(feeder.viewers, 1)

        # a second viewer is turned away while the first is connected (the limit protects the PC)
        status, _, _ = get(f"{base}/stream.mjpg?token={TOKEN}")
        self.assertEqual(status, 503)

        sock.close()
        holder.set(FAKE_JPEG)
        holder.set(FAKE_JPEG)
        for _ in range(50):
            if feeder.viewers == 0:
                break
            holder.set(FAKE_JPEG)
            time.sleep(0.05)
        self.assertEqual(feeder.viewers, 0, "a closed page is noticed")


class Holder(unittest.TestCase):
    def test_wait_returns_only_newer_frames(self):
        holder = FrameHolder()
        self.assertEqual(holder.wait(0, timeout=0.05), (None, 0))
        holder.set(b"a")
        self.assertEqual(holder.wait(0, timeout=0.05), (b"a", 1))
        self.assertEqual(holder.wait(1, timeout=0.05), (None, 1))

    def test_overlay_expires(self):
        now = [0.0]
        overlay = Overlay(keep_s=1.5, clock=lambda: now[0])
        overlay.set([{"box": Box(0, 0, 1, 1)}])
        self.assertEqual(len(overlay.get()), 1)
        now[0] = 2.0
        self.assertEqual(overlay.get(), [])


@unittest.skipIf(cv2 is None, "OpenCV not installed")
class Drawing(unittest.TestCase):
    def test_draw_marks_the_plate_without_changing_the_original(self):
        frame = np.zeros((120, 200, 3), dtype=np.uint8)
        out = draw(frame, [{"box": Box(20, 40, 120, 70), "text": "DL01AB1234", "confidence": 0.968, "reported": True}])
        self.assertEqual(int(frame.sum()), 0)
        self.assertGreater(int(out.sum()), 0)
        self.assertTrue(out[40, 60].any(), "box edge drawn")

    def test_encode_makes_a_jpeg_and_limits_the_width(self):
        jpeg = encode(np.zeros((1080, 1920, 3), dtype=np.uint8))
        self.assertTrue(jpeg.startswith(b"\xff\xd8"))
        decoded = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(decoded.shape[1], 960)

    def test_feeder_encodes_only_while_somebody_watches(self):
        class Source:
            def __init__(self):
                self.n = 0

            def read(self):
                self.n += 1
                return np.zeros((60, 80, 3), dtype=np.uint8), self.n

        holder = FrameHolder()
        feeder = Feeder(Source(), Overlay(), holder, fps=50)
        feeder.start()
        try:
            time.sleep(0.5)
            self.assertIsNone(holder.latest(), "nobody is watching: nothing is encoded")
            feeder.viewers = 1
            jpeg, _ = holder.wait(0, timeout=2.0)
            self.assertTrue(jpeg.startswith(b"\xff\xd8"))
        finally:
            feeder.stop()


if __name__ == "__main__":
    unittest.main()


def post(url, data, headers=None):
    request = urllib.request.Request(url, data=data, method="POST", headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class PhotoEndpoint(unittest.TestCase):
    """POST /read: the server forwards a phone photo here."""

    def setUp(self):
        import json

        self.json = json
        self.seen = []

        def reader(data):
            self.seen.append(data)
            if data == b"bad":
                raise ValueError("This is not a picture the reader can open")
            if data == b"boom":
                raise RuntimeError("model crashed")
            return {"plate": "MH12AB1234", "confidence": 0.93, "results": [{"plate": "MH12AB1234", "confidence": 0.93}]}

        self.server, self.base = start(FrameHolder(), reader=reader)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_reads_with_a_bearer_key_or_a_token(self):
        for url, headers in [(self.base + "/read", {"Authorization": f"Bearer {TOKEN}"}), (f"{self.base}/read?token={TOKEN}", {})]:
            status, body = post(url, b"picture", headers)
            self.assertEqual(status, 200)
            self.assertEqual(self.json.loads(body)["plate"], "MH12AB1234")

    def test_no_key_or_a_wrong_key_is_refused_and_nothing_is_read(self):
        self.assertEqual(post(self.base + "/read", b"x")[0], 403)
        self.assertEqual(post(self.base + "/read", b"x", {"Authorization": "Bearer nope"})[0], 403)
        self.assertEqual(self.seen, [])

    def test_bad_pictures_and_failures_answer_json(self):
        auth = {"Authorization": f"Bearer {TOKEN}"}
        status, body = post(self.base + "/read", b"bad", auth)
        self.assertEqual(status, 422)
        self.assertIn("not a picture", self.json.loads(body)["message"])
        self.assertEqual(post(self.base + "/read", b"boom", auth)[0], 500)
        self.assertEqual(post(self.base + "/read", b"", auth)[0], 400)

    def test_without_a_reader_there_is_no_such_endpoint(self):
        server, base = start(FrameHolder())
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.assertEqual(post(f"{base}/read?token={TOKEN}", b"x")[0], 404)
