"""Talks to the Smart Parking server as ONE device (the ANPR camera registered on the Hardware page).

Sending happens on its own thread, so a slow or unreachable server never stops the video.
Plates that could not be delivered wait and are tried again; after ten minutes the car is gone
and the plate is dropped. Every plate has its own id, so a retry can never make a second suggestion.
"""
from __future__ import annotations

import json
import queue
import threading
import time
import urllib.error
import urllib.request
import uuid

VERSION = "ai-service/1.0.0"
MAX_AGE_S = 600
RETRYABLE = {408, 425, 429}


class Unavailable(Exception):
    """The server could not be reached or had an internal problem: try again later."""


class Refused(Exception):
    """The server answered no (wrong key, bad data): trying again cannot help."""

    def __init__(self, status, message):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def http_json(base, key, method, path, body=None, timeout=8):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/api/device{path}", data=data, method=method,
        headers={"content-type": "application/json", "x-device-key": key, "x-agent-version": VERSION},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read() or b"{}")
        except ValueError:
            payload = {}
        message = payload.get("message") or error.reason
        if error.code >= 500 or error.code in RETRYABLE:
            raise Unavailable(f"HTTP {error.code}: {message}") from error
        raise Refused(error.code, message) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise Unavailable(str(getattr(error, "reason", error))) from error


class Reporter:
    def __init__(self, server_url, key, direction="", call=None, max_queue=200, max_age_s=MAX_AGE_S, clock=time.time, log=print):
        self.preview_url = ""  # told to the server with each heartbeat, so nobody has to paste it
        self.call = call or (lambda method, path, body=None: http_json(server_url, key, method, path, body))
        self.direction = direction
        self.max_age_s = max_age_s
        self.clock = clock
        self.log = log
        self.queue = queue.Queue(maxsize=max_queue)
        self.stop_flag = threading.Event()
        self.threads = []
        self.delivered = 0
        self.dropped = 0
        self.fatal = ""  # set when the server refuses our key, shown by --check and in the log

    # ------------------------------------------------------------- plates

    def plate(self, plate, confidence, captured_at=None):
        """Queues one plate (confidence 0..1). Never blocks."""
        item = {
            "id": uuid.uuid4().hex,
            "at": self.clock(),
            "body": {
                "plate": plate,
                "confidence": round(float(confidence) * 100, 1),
                "eventId": None,
                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(captured_at or self.clock())),
                **({"direction": self.direction} if self.direction else {}),
            },
        }
        item["body"]["eventId"] = item["id"]
        try:
            self.queue.put_nowait(item)
        except queue.Full:
            try:
                self.queue.get_nowait()  # the oldest is the least useful
                self.dropped += 1
            except queue.Empty:
                pass
            self.queue.put_nowait(item)
        return item

    def deliver_one(self):
        """Tries the oldest waiting plate. Returns 'sent', 'dropped', 'later' or 'empty'."""
        try:
            item = self.queue.queue[0]
        except IndexError:
            return "empty"
        if self.clock() - item["at"] > self.max_age_s:
            self.queue.get_nowait()
            self.dropped += 1
            self.log(f"plate {item['body']['plate']}: dropped, it could not be delivered for {int(self.max_age_s / 60)} minutes")
            return "dropped"
        try:
            self.call("POST", "/anpr", item["body"])
        except Unavailable as error:
            self.log(f"server not reachable ({error}); will keep trying")
            return "later"
        except Refused as error:
            self.queue.get_nowait()
            self.dropped += 1
            if error.status in (401, 403):
                self.fatal = "The server refused the camera key. Check deviceKey in config.json (the key may have been replaced)."
                self.log(self.fatal)
            else:
                self.log(f"plate {item['body']['plate']}: refused by the server ({error})")
            return "dropped"
        self.queue.get_nowait()
        self.delivered += 1
        self.fatal = ""
        self.log(f"reported {item['body']['plate']} ({item['body']['confidence']}%)")
        return "sent"

    # ------------------------------------------------------------ other calls

    def heartbeat(self):
        body = {"previewUrl": self.preview_url} if self.preview_url else {}
        return self.call("POST", "/heartbeat", body)

    def event(self, kind, message, severity="warning"):
        """Best effort: a lost note about the camera is not worth queueing."""
        try:
            self.call("POST", "/events", {"type": kind, "message": message[:300], "severity": severity})
            return True
        except (Unavailable, Refused):
            return False

    # ---------------------------------------------------------------- threads

    def _send_loop(self):
        wait = 1.0
        while not self.stop_flag.is_set():
            result = self.deliver_one()
            if result == "empty":
                self.stop_flag.wait(0.2)
                wait = 1.0
            elif result == "later":
                self.stop_flag.wait(wait)
                wait = min(30.0, wait * 2)
            else:
                wait = 1.0

    def _beat_loop(self, every):
        while not self.stop_flag.is_set():
            try:
                self.heartbeat()
            except (Unavailable, Refused) as error:
                self.log(f"heartbeat failed: {error}")
            self.stop_flag.wait(every)

    def start(self, heartbeat_seconds=15):
        for target, args, name in ((self._send_loop, (), "sender"), (self._beat_loop, (heartbeat_seconds,), "heartbeat")):
            thread = threading.Thread(target=target, args=args, name=name, daemon=True)
            thread.start()
            self.threads.append(thread)
        return self

    def stop(self):
        self.stop_flag.set()
        for thread in self.threads:
            thread.join(timeout=3)
