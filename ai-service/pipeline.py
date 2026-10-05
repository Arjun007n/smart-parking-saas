"""The main loop: frame -> plate boxes -> characters -> repaired text -> voting -> server."""
from __future__ import annotations

import threading
import time

from detection.plate_detector import crop
from plate_text import repair

REPAIR_PENALTY = 0.92  # a plate that needed repairing is a little less certain
MIN_LENGTH = 6
PHOTO_MAX_SIDE = 1600  # phone pictures are large; this is plenty for a plate and much faster
STARTUP_GRACE_S = 20.0  # a camera that has shown nothing by then is reported


class Pipeline:
    def __init__(self, source, detector, ocr, voter, reporter, overlay=None, fps=5, log=print, clock=time.monotonic):
        self.source = source
        self.detector = detector
        self.ocr = ocr
        self.voter = voter
        self.reporter = reporter
        self.overlay = overlay
        self.interval = 1.0 / fps
        self.log = log
        self.clock = clock
        self.frames = 0
        self.reads = 0
        self._announced_online = None
        self._started = clock()
        # The camera loop and phone photos share the plate finder and the reader, one at a time.
        self.lock = threading.RLock()

    # ----------------------------------------------------------- one picture

    def read_frame(self, frame):
        """Finds and reads the plates in one picture. Returns a list of
        {'box', 'text', 'confidence', 'repaired'} (text is '' when nothing legible was read)."""
        found = []
        with self.lock:
            for box in self.detector.detect(frame):
                piece = crop(frame, box)
                if piece is None:
                    continue
                found.append(self._read_piece(box, piece))
        return [item for item in found if item is not None]

    def _read_piece(self, box, piece):
        try:
            result = self.ocr.read(piece)
        except Exception as error:  # noqa: BLE001 - one bad crop must not stop the camera
            self.log(f"reading a plate failed: {error}")
            return None
        text, repaired = repair(result.text)
        confidence = result.confidence * (REPAIR_PENALTY if repaired else 1.0)
        return {"box": box, "text": text if len(text) >= MIN_LENGTH else "", "confidence": confidence, "repaired": repaired}

    def read_photo(self, data):
        """Reads one picture sent as bytes (a phone photo). Returns { plate, confidence, results }:
        `plate` is the surest reading ('' when none), confidence is 0..1.
        Raises ValueError when the bytes are not a picture. When the plate finder sees no plate, the
        whole picture is read once (a close-up photo of a plate has nothing to find)."""
        import cv2
        import numpy as np

        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("This is not a picture the reader can open")
        height, width = image.shape[:2]
        longest = max(height, width)
        if longest > PHOTO_MAX_SIDE:
            scale = PHOTO_MAX_SIDE / float(longest)
            image = cv2.resize(image, (int(width * scale), int(height * scale)))
        found = [item for item in self.read_frame(image) if item["text"]]
        if not found:
            from detection.plate_detector import Box

            with self.lock:
                whole = self._read_piece(Box(0, 0, image.shape[1], image.shape[0]), image)
            found = [whole] if whole and whole["text"] else []
        found.sort(key=lambda item: item["confidence"], reverse=True)
        results = [{"plate": item["text"], "confidence": round(item["confidence"], 3)} for item in found]
        best = results[0] if results else {"plate": "", "confidence": 0}
        return {"plate": best["plate"], "confidence": best["confidence"], "results": results}

    def process(self, frame):
        """One picture through the whole chain, including voting and reporting. Returns what was found."""
        found = self.read_frame(frame)
        self.frames += 1
        shown = []
        for item in found:
            reported = False
            if item["text"]:
                self.reads += 1
                decision = self.voter.add(item["text"], item["confidence"])
                if decision:
                    self.reporter.plate(decision["plate"], decision["confidence"])
                    self.log(f"plate {decision['plate']} seen on {decision['reads']} pictures ({int(decision['confidence'] * 100)}%)")
                    reported = True
            shown.append({**item, "reported": reported})
        if self.overlay is not None:
            self.overlay.set(shown)
        return shown

    # ---------------------------------------------------------------- the loop

    def watch_camera(self):
        """Tells the server once when the picture is lost and once when it is back."""
        online = self.source.online
        if self._announced_online is None:
            if online:
                self._announced_online = True  # the first picture arrived: nothing to tell
            elif self.clock() - self._started > STARTUP_GRACE_S:
                self._announced_online = False
                self.reporter.event("DEVICE_ERROR", "Camera picture lost: no pictures are coming from the camera", "warning")
            return
        if online != self._announced_online:
            self._announced_online = online
            if online:
                self.reporter.event("DEVICE_INFO", "Camera picture is back", "info")
            else:
                self.reporter.event("DEVICE_ERROR", "Camera picture lost: no pictures are coming from the camera", "warning")

    def run(self, stop_flag):
        last = -1
        while not stop_flag.is_set():
            started = self.clock()
            self.watch_camera()
            frame, seq = self.source.read()
            if frame is not None and seq != last:
                last = seq
                try:
                    self.process(frame)
                except Exception as error:  # noqa: BLE001 - the loop must survive anything
                    self.log(f"processing a picture failed: {error}")
            wait = self.interval - (self.clock() - started)
            stop_flag.wait(max(0.01, wait))
