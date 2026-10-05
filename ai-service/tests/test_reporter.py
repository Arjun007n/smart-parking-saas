import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reporter import Refused, Reporter, Unavailable, http_json  # noqa: E402

quiet = lambda *a: None  # noqa: E731


class Fake:
    """A stand-in for the server: replies from a script and remembers every request."""

    def __init__(self, replies=None):
        self.requests = []
        self.replies = list(replies or [])

    def __call__(self, method, path, body=None):
        self.requests.append((method, path, body))
        reply = self.replies.pop(0) if self.replies else "ok"
        if reply == "down":
            raise Unavailable("network down")
        if isinstance(reply, int):
            raise Refused(reply, "no")
        return 201, {}


class Reporting(unittest.TestCase):
    def make(self, fake, **kw):
        self.now = [1000.0]
        return Reporter("http://x", "hwk_k", call=fake, clock=lambda: self.now[0], log=quiet, **kw)

    def test_sends_the_standard_report_with_an_event_id(self):
        fake = Fake()
        reporter = self.make(fake)
        reporter.plate("DL01AB1234", 0.968)
        self.assertEqual(reporter.deliver_one(), "sent")
        method, path, body = fake.requests[0]
        self.assertEqual((method, path), ("POST", "/anpr"))
        self.assertEqual(body["plate"], "DL01AB1234")
        self.assertEqual(body["confidence"], 96.8)
        self.assertTrue(body["eventId"])
        self.assertRegex(body["capturedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertNotIn("direction", body)
        self.assertEqual(reporter.deliver_one(), "empty")

    def test_direction_is_sent_when_configured(self):
        fake = Fake()
        reporter = self.make(fake, )
        reporter.direction = "EXIT"
        reporter.plate("DL01AB1234", 0.9)
        reporter.deliver_one()
        self.assertEqual(fake.requests[0][2]["direction"], "EXIT")

    def test_a_plate_waits_while_the_server_is_down_and_is_sent_once_with_the_same_id(self):
        fake = Fake(["down", "down", "ok"])
        reporter = self.make(fake)
        reporter.plate("DL01AB1234", 0.9)
        self.assertEqual(reporter.deliver_one(), "later")
        self.assertEqual(reporter.deliver_one(), "later")
        self.assertEqual(reporter.deliver_one(), "sent")
        ids = {request[2]["eventId"] for request in fake.requests}
        self.assertEqual(len(ids), 1, "retries carry the same id, so the server makes one suggestion")
        self.assertEqual(reporter.delivered, 1)

    def test_order_is_kept(self):
        fake = Fake(["down"])
        reporter = self.make(fake)
        reporter.plate("AAAA1111", 0.9)
        reporter.plate("BBBB2222", 0.9)
        reporter.deliver_one()
        reporter.deliver_one()
        reporter.deliver_one()
        self.assertEqual([r[2]["plate"] for r in fake.requests], ["AAAA1111", "AAAA1111", "BBBB2222"])

    def test_old_plates_are_dropped(self):
        fake = Fake(["down"])
        reporter = self.make(fake, max_age_s=600)
        reporter.plate("DL01AB1234", 0.9)
        self.assertEqual(reporter.deliver_one(), "later")
        self.now[0] += 601
        self.assertEqual(reporter.deliver_one(), "dropped")
        self.assertEqual(reporter.dropped, 1)
        self.assertEqual(reporter.deliver_one(), "empty")

    def test_a_refusal_is_not_retried_and_a_bad_key_is_called_out(self):
        fake = Fake([400, 401])
        reporter = self.make(fake)
        reporter.plate("AAAA1111", 0.9)
        reporter.plate("BBBB2222", 0.9)
        self.assertEqual(reporter.deliver_one(), "dropped")
        self.assertEqual(reporter.fatal, "")
        self.assertEqual(reporter.deliver_one(), "dropped")
        self.assertIn("key", reporter.fatal)
        self.assertEqual(reporter.deliver_one(), "empty")

    def test_the_queue_is_limited_and_drops_the_oldest(self):
        reporter = self.make(Fake(), max_queue=3)
        for n in range(5):
            reporter.plate(f"PLATE{n}00", 0.9)
        self.assertEqual(reporter.queue.qsize(), 3)
        self.assertEqual(reporter.dropped, 2)
        self.assertEqual(list(reporter.queue.queue)[0]["body"]["plate"], "PLATE200")

    def test_events_and_heartbeat_never_raise(self):
        fake = Fake(["down", 400, "ok"])
        reporter = self.make(fake)
        self.assertFalse(reporter.event("DEVICE_ERROR", "x"))
        self.assertFalse(reporter.event("DEVICE_ERROR", "x"))
        self.assertTrue(reporter.event("DEVICE_INFO", "y", "info"))
        self.assertEqual(fake.requests[2][2], {"type": "DEVICE_INFO", "message": "y", "severity": "info"})

    def test_the_heartbeat_tells_the_server_where_the_live_picture_is(self):
        fake = Fake()
        reporter = self.make(fake)
        reporter.heartbeat()
        self.assertEqual(fake.requests[0][2], {})
        reporter.preview_url = "http://127.0.0.1:8090/stream.mjpg?token=abc"
        reporter.heartbeat()
        self.assertEqual(fake.requests[1], ("POST", "/heartbeat", {"previewUrl": "http://127.0.0.1:8090/stream.mjpg?token=abc"}))


class OverHttp(unittest.TestCase):
    """The real HTTP code against a small local server."""

    def serve(self, status, payload):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("content-length") or 0)
                seen.append({"path": self.path, "key": self.headers.get("x-device-key"), "body": json.loads(self.rfile.read(length) or b"{}")})
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}", seen

    def test_success_sends_key_and_json(self):
        base, seen = self.serve(201, {"success": True})
        status, data = http_json(base, "hwk_k", "POST", "/anpr", {"plate": "A"})
        self.assertEqual(status, 201)
        self.assertEqual(seen[0]["path"], "/api/device/anpr")
        self.assertEqual(seen[0]["key"], "hwk_k")
        self.assertEqual(seen[0]["body"], {"plate": "A"})

    def test_400_is_refused_and_500_is_unavailable(self):
        base, _ = self.serve(401, {"message": "Invalid device key"})
        with self.assertRaises(Refused) as caught:
            http_json(base, "hwk_bad", "POST", "/heartbeat", {})
        self.assertEqual(caught.exception.status, 401)
        base, _ = self.serve(503, {"message": "busy"})
        with self.assertRaises(Unavailable):
            http_json(base, "hwk_k", "POST", "/heartbeat", {})
        base, _ = self.serve(429, {"message": "slow down"})
        with self.assertRaises(Unavailable):
            http_json(base, "hwk_k", "POST", "/heartbeat", {})

    def test_nobody_listening_is_unavailable(self):
        with self.assertRaises(Unavailable):
            http_json("http://127.0.0.1:1", "hwk_k", "POST", "/heartbeat", {}, timeout=2)

    def test_the_sender_thread_delivers(self):
        base, seen = self.serve(201, {"success": True})
        reporter = Reporter(base, "hwk_k", log=quiet)
        reporter.start(heartbeat_seconds=60)
        try:
            reporter.plate("DL01AB1234", 0.95)
            for _ in range(100):
                if reporter.delivered:
                    break
                threading.Event().wait(0.05)
        finally:
            reporter.stop()
        self.assertEqual(reporter.delivered, 1)
        self.assertTrue(any(s["path"] == "/api/device/anpr" and s["body"]["plate"] == "DL01AB1234" for s in seen))
        self.assertTrue(any(s["path"] == "/api/device/heartbeat" for s in seen))


if __name__ == "__main__":
    unittest.main()
