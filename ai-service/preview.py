"""The live picture for the Entry and Exit screens: an MJPEG stream with the plate boxes drawn on it.

The stream only answers when the address carries the secret token, so another website that
guesses the port cannot show the camera. By default it listens on this computer only
(127.0.0.1); use host 0.0.0.0 with publicUrl when the operator uses a different computer.
"""
from __future__ import annotations

import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BOUNDARY = "frame"
MAX_WIDTH = 960
MAX_PHOTO_BYTES = 8 * 1024 * 1024


class Overlay:
    """What was last found in the picture, kept for a moment so the box does not flicker."""

    def __init__(self, keep_s=1.5, clock=time.monotonic):
        self.keep_s = keep_s
        self.clock = clock
        self._items = []
        self._at = 0.0
        self._lock = threading.Lock()

    def set(self, items):
        """items: [{'box': Box, 'text': str, 'confidence': float, 'reported': bool}]"""
        with self._lock:
            self._items = list(items)
            self._at = self.clock()

    def get(self):
        with self._lock:
            return list(self._items) if self.clock() - self._at <= self.keep_s else []


class FrameHolder:
    """The newest JPEG, and a way for each viewer to wait for the next one."""

    def __init__(self):
        self._cond = threading.Condition()
        self._jpeg = None
        self._number = 0
        self._at = 0.0

    def set(self, jpeg: bytes):
        with self._cond:
            self._jpeg = jpeg
            self._number += 1
            self._at = time.monotonic()
            self._cond.notify_all()

    def latest(self, max_age=None):
        """The newest picture, or None (also None when it is older than max_age seconds)."""
        with self._cond:
            if self._jpeg is not None and max_age is not None and time.monotonic() - self._at > max_age:
                return None
            return self._jpeg

    def number(self):
        with self._cond:
            return self._number

    def wait(self, after: int, timeout=2.0):
        """Returns (jpeg, number) once a frame newer than `after` exists, or (None, after) on timeout."""
        with self._cond:
            if self._number <= after:
                self._cond.wait(timeout)
            if self._number <= after:
                return None, after
            return self._jpeg, self._number


def draw(frame, items):
    """The frame with a box and the reading drawn for each plate. Returns a new image."""
    import cv2

    out = frame.copy()
    for item in items:
        box = item["box"]
        colour = (80, 200, 80) if item.get("reported") else (0, 180, 255)
        cv2.rectangle(out, (box.x1, box.y1), (box.x2, box.y2), colour, 2)
        label = item.get("text") or "?"
        if item.get("confidence") is not None and item.get("text"):
            label += f"  {int(round(item['confidence'] * 100))}%"
        top = max(18, box.y1 - 6)
        cv2.putText(out, label, (box.x1, top), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(out, label, (box.x1, top), cv2.FONT_HERSHEY_SIMPLEX, 0.6, colour, 2, cv2.LINE_AA)
    return out


def encode(frame, quality=70):
    import cv2

    height, width = frame.shape[:2]
    if width > MAX_WIDTH:
        scale = MAX_WIDTH / float(width)
        frame = cv2.resize(frame, (MAX_WIDTH, int(height * scale)))
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return buffer.tobytes() if ok else None


class Feeder(threading.Thread):
    """Turns the live frames (plus the overlay) into JPEGs for the viewers, about 10 times a second."""

    def __init__(self, source, overlay, holder, fps=10):
        super().__init__(name="preview-feed", daemon=True)
        self.source, self.overlay, self.holder = source, overlay, holder
        self.interval = 1.0 / fps
        self.stop_flag = threading.Event()
        self.viewers = 0  # set by the server; nothing is encoded while nobody watches
        self.wanted_until = 0.0  # a single snapshot was asked for

    def touch(self, seconds=3.0):
        self.wanted_until = time.monotonic() + seconds

    def run(self):
        last = -1
        while not self.stop_flag.is_set():
            if self.viewers <= 0 and time.monotonic() > self.wanted_until:
                self.stop_flag.wait(0.3)
                continue
            frame, seq = self.source.read()
            if frame is not None and seq != last:
                last = seq
                jpeg = encode(draw(frame, self.overlay.get()))
                if jpeg:
                    self.holder.set(jpeg)
            self.stop_flag.wait(self.interval)

    def stop(self):
        self.stop_flag.set()


def make_server(host, port, token, holder, feeder=None, max_viewers=4, reader=None):
    state = {"viewers": 0, "lock": threading.Lock()}

    class BaseHandler(BaseHTTPRequestHandler):  # defined here to close over the token and holder
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):  # keep the console for real news
            pass

        def _allowed(self):
            query = parse_qs(urlparse(self.path).query)
            given = (query.get("token") or [""])[0]
            bearer = self.headers.get("Authorization", "")
            if not given and bearer.startswith("Bearer "):
                given = bearer[7:].strip()
            return hmac.compare_digest(given.encode(), token.encode())

        def _json(self, code, payload):
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802
            # POST /read: a picture (any common format) in the body; answers { plate, confidence, results }.
            # This is how a phone photo is read: the Smart Parking server forwards the picture here.
            if urlparse(self.path).path != "/read" or reader is None:
                return self._deny(404, "Not found")
            if not self._allowed():
                return self._deny(403, "Forbidden")
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0 or length > MAX_PHOTO_BYTES:
                return self._deny(413 if length > 0 else 400, "Send one picture of up to 8 MB")
            data = self.rfile.read(length)
            try:
                answer = reader(data)
            except ValueError as error:
                return self._json(422, {"success": False, "message": str(error)})
            except Exception as error:  # noqa: BLE001 - the answer must always be JSON
                return self._json(500, {"success": False, "message": f"could not read the picture: {error}"})
            return self._json(200, answer)

        def _deny(self, code, text):
            body = text.encode()
            self.send_response(code)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            path = urlparse(self.path).path
            if path not in ("/stream.mjpg", "/snapshot.jpg"):
                return self._deny(404, "Not found")
            if not self._allowed():
                return self._deny(403, "Forbidden")
            if path == "/snapshot.jpg":
                if feeder:
                    feeder.touch()
                jpeg = holder.latest(max_age=3.0)
                if not jpeg:
                    jpeg, _ = holder.wait(holder.number(), timeout=3.0)
                if not jpeg:
                    return self._deny(503, "No picture yet")
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(jpeg)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(jpeg)
                return None

            with state["lock"]:
                if state["viewers"] >= max_viewers:
                    return self._deny(503, "Too many viewers")
                state["viewers"] += 1
                if feeder:
                    feeder.viewers = state["viewers"]
            try:
                self.send_response(200)
                self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={BOUNDARY}")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                number = 0
                while True:
                    jpeg, number = holder.wait(number, timeout=2.0)
                    if jpeg is None:
                        continue  # still waiting for a picture; a closed connection shows up on the next write
                    self.wfile.write(f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\n\r\n".encode())
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass  # the viewer closed the page
            finally:
                with state["lock"]:
                    state["viewers"] -= 1
                    if feeder:
                        feeder.viewers = state["viewers"]
            return None

    class Server(ThreadingHTTPServer):
        daemon_threads = True

    return Server((host, port), BaseHandler)
