"""Decides when a plate has been seen reliably enough to report.

A single video frame can be blurry or half cut off, so one OCR read is not trusted. The same
plate must be read on several frames in a short time (similar readings count together, because OCR
often differs by one character from frame to frame). Then it is reported once, and not again
until the cooldown has passed (a car waiting in front of the camera is one event).
"""
from __future__ import annotations

import time
from collections import Counter

from plate_text import is_valid


def _close(a: str, b: str) -> bool:
    """Same length, at most one different character."""
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) <= 1


class PlateVoter:
    def __init__(self, window_s=3.0, min_reads=2, min_confidence=0.5, cooldown_s=30.0, clock=time.monotonic):
        self.window_s = window_s
        self.min_reads = min_reads
        self.min_confidence = min_confidence
        self.cooldown_s = cooldown_s
        self.clock = clock
        self.reads = []  # (time, text, confidence)
        self.sent = {}  # text -> time it was reported

    def _cooling(self, text, now):
        for old, at in list(self.sent.items()):
            if now - at >= self.cooldown_s:
                del self.sent[old]
            elif _close(old, text):
                return True
        return False

    def add(self, text: str, confidence: float):
        """Adds one reading. Returns {'plate', 'confidence', 'reads'} when it should be reported, else None."""
        now = self.clock()
        self.reads = [r for r in self.reads if now - r[0] <= self.window_s]
        if text:
            self.reads.append((now, text, float(confidence)))
        if not self.reads or self._cooling(text, now):
            return None

        # The readings that agree with this one (allowing one different character).
        group = [r for r in self.reads if _close(r[1], text)]
        if len(group) < self.min_reads:
            return None
        mean = sum(r[2] for r in group) / len(group)
        if mean < self.min_confidence:
            return None

        votes = Counter(r[1] for r in group)
        # Most common wording; a valid plate wins a tie.
        plate = max(votes, key=lambda t: (votes[t], is_valid(t), sum(r[2] for r in group if r[1] == t)))
        self.sent[plate] = now
        self.reads = [r for r in self.reads if not _close(r[1], plate)]
        return {"plate": plate, "confidence": round(mean, 3), "reads": len(group)}
