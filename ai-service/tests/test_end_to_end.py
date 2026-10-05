"""Everything except the two neural networks: a real video file, the real camera reader, voting,
the real HTTP reporter against a small fake server, and the real live-picture server."""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = np = None

from camera.rtsp_stream import FrameSource  # noqa: E402
from detection.plate_detector import FullFrameDetector  # noqa: E402
from ocr.plate_ocr import OcrResult  # noqa: E402
from pipeline import Pipeline  # noqa: E402
from preview import Feeder, FrameHolder, Overlay, make_server  # noqa: E402
from reporter import Reporter  # noqa: E402
from voting import PlateVoter  # noqa: E402

quiet = lambda *a: None  # noqa: E731


class StubOcr:
    """Reads 'DL01AB1234' with a slightly different spelling now and then, like a real engine."""

    def __init__(self):
        self.n = 0

    def read(self, crop):
        self.n += 1
        text = "DLO1AB1234" if self.n % 4 == 0 else "DL01AB1234"
        return OcrResult(text, 0.93)


def write_video(path, frames=40):
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 25.0, (320, 180))
    if not writer.isOpened():
        return False
    for i in range(frames):
        frame = np.full((180, 320, 3), 60, dtype=np.uint8)
        cv2.rectangle(frame, (80, 70), (240, 120), (230, 230, 230), -1)
        cv2.putText(frame, "DL01AB1234", (88, 105), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        writer.write(frame)
    writer.release()
    return True


@unittest.skipIf(cv2 is None, "OpenCV not installed")
class EndToEnd(unittest.TestCase):
    def test_video_to_server(self):
        received = []

        class FakeServer(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):  # noqa: N802
                body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                received.append((self.path, self.headers.get("x-device-key"), body))
                data = b'{"success":true,"data":{}}'
                self.send_response(201)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        api = HTTPServer(("127.0.0.1", 0), FakeServer)
        threading.Thread(target=api.serve_forever, daemon=True).start()
        self.addCleanup(api.server_close)
        self.addCleanup(api.shutdown)

        with tempfile.TemporaryDirectory() as folder:
            video = os.path.join(folder, "gate.avi")
            if not write_video(video):
                self.skipTest("this OpenCV build cannot write test videos")

            source = FrameSource(video, loop_file=True, log=quiet).start()
            overlay, holder = Overlay(), FrameHolder()
            feeder = Feeder(source, overlay, holder, fps=20)
            feeder.start()
            preview = make_server("127.0.0.1", 0, "tok-end-to-end-0123456789", holder, feeder)
            threading.Thread(target=preview.serve_forever, daemon=True).start()

            reporter = Reporter(f"http://127.0.0.1:{api.server_address[1]}", "hwk_endtoend", direction="ENTRY", log=quiet)
            reporter.start(heartbeat_seconds=60)
            pipeline = Pipeline(
                source, FullFrameDetector(), StubOcr(), PlateVoter(min_reads=2, cooldown_s=60), reporter, overlay, fps=20, log=quiet
            )
            stop = threading.Event()
            runner = threading.Thread(target=pipeline.run, args=(stop,))
            runner.start()
            try:
                deadline = time.time() + 15
                while time.time() < deadline and not any(p == "/api/device/anpr" for p, _, _ in received):
                    time.sleep(0.05)
                time.sleep(1.0)  # keep running: the same car must not be reported again

                with urllib.request.urlopen(f"http://127.0.0.1:{preview.server_address[1]}/stream.mjpg?token=tok-end-to-end-0123456789".replace("stream.mjpg", "snapshot.jpg"), timeout=5) as response:
                    picture = response.read()
            finally:
                stop.set()
                runner.join(5)
                reporter.stop()
                feeder.stop()
                source.stop()
                preview.shutdown()
                preview.server_close()

        plates = [r for r in received if r[0] == "/api/device/anpr"]
        self.assertEqual(len(plates), 1, "one car in front of the camera is one report")
        path, key, body = plates[0]
        self.assertEqual(key, "hwk_endtoend")
        self.assertEqual(body["plate"], "DL01AB1234")
        self.assertEqual(body["direction"], "ENTRY")
        self.assertGreater(body["confidence"], 80)
        self.assertTrue(body["eventId"])
        self.assertTrue(any(r[0] == "/api/device/heartbeat" for r in received))

        decoded = cv2.imdecode(np.frombuffer(picture, dtype=np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(decoded.shape[:2], (180, 320))


if __name__ == "__main__":
    unittest.main()
