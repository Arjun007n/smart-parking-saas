"""Reads a webcam, an RTSP (IP camera) stream or a video file on a background thread.

Only the NEWEST frame is kept, so a slow plate reader never falls behind the live picture
(an old frame of a car that has left is worthless). If the stream drops, it reconnects by
itself and `online` says whether frames are arriving.
"""
from __future__ import annotations

import os
import threading
import time

# RTSP over TCP loses fewer pieces than UDP on ordinary networks.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


def _open(source):
    import cv2  # imported here so the rest of the service (and its tests) work without OpenCV

    capture = cv2.VideoCapture(source)
    if capture is not None and hasattr(capture, "set") and isinstance(source, int):
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return capture


class FrameSource:
    def __init__(self, source, loop_file=True, capture_factory=_open, offline_after_s=10.0, retry_min_s=1.0, retry_max_s=15.0, clock=time.monotonic, log=print):
        self.source = source
        self.is_file = isinstance(source, str) and not source.lower().startswith(("rtsp://", "rtsps://", "http://", "https://"))
        self.loop_file = loop_file
        self.capture_factory = capture_factory
        self.offline_after_s = offline_after_s
        self.retry_min_s = retry_min_s
        self.retry_max_s = retry_max_s
        self.clock = clock
        self.log = log
        self._lock = threading.Lock()
        self._frame = None
        self._seq = 0
        self._last_frame_at = None
        self._stop = threading.Event()
        self._thread = None
        self.reconnects = 0

    # ---------------------------------------------------------------- reading

    def read(self):
        """The newest frame and its number: (frame, seq). frame is None before the first one arrives."""
        with self._lock:
            return self._frame, self._seq

    @property
    def online(self) -> bool:
        with self._lock:
            return self._last_frame_at is not None and self.clock() - self._last_frame_at <= self.offline_after_s

    # ---------------------------------------------------------------- thread

    def start(self):
        if self._thread:
            return self
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _publish(self, frame):
        with self._lock:
            self._frame = frame
            self._seq += 1
            self._last_frame_at = self.clock()

    def _run(self):
        failures = 0
        while not self._stop.is_set():
            capture = None
            try:
                capture = self.capture_factory(self.source)
                if capture is None or not capture.isOpened():
                    raise RuntimeError("could not open the camera")
                if failures:
                    self.log(f"camera: connected again after {failures} attempt(s)")
                failures = 0
                while not self._stop.is_set():
                    ok, frame = capture.read()
                    if not ok or frame is None:
                        if self.is_file and self.loop_file:
                            capture.release()
                            capture = self.capture_factory(self.source)
                            if capture is None or not capture.isOpened():
                                raise RuntimeError("could not reopen the video file")
                            continue
                        raise RuntimeError("the stream stopped sending pictures")
                    self._publish(frame)
                    if self.is_file:
                        time.sleep(0.03)  # a file is read at about its own speed, not as fast as the disk allows
            except Exception as error:  # noqa: BLE001 - any failure means "try again"
                failures += 1
                self.reconnects += 1
                if failures == 1 or failures % 10 == 0:
                    self.log(f"camera: {error} (trying again)")
            finally:
                if capture is not None:
                    try:
                        capture.release()
                    except Exception:  # noqa: BLE001
                        pass
            delay = min(self.retry_max_s, self.retry_min_s * 2 ** min(failures, 5))
            self._stop.wait(delay)
