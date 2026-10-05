import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

from detection.plate_detector import Box  # noqa: E402
from ocr.plate_ocr import OcrResult  # noqa: E402
from pipeline import Pipeline  # noqa: E402
from preview import Overlay  # noqa: E402
from voting import PlateVoter  # noqa: E402

quiet = lambda *a: None  # noqa: E731
FRAME = np.zeros((120, 200, 3), dtype=np.uint8)


class ScriptedDetector:
    def __init__(self, boxes=None):
        self.boxes = boxes if boxes is not None else [Box(20, 40, 120, 70, 0.9)]
        self.calls = 0

    def detect(self, frame):
        self.calls += 1
        return list(self.boxes)


class ScriptedOcr:
    def __init__(self, reads):
        self.reads = list(reads)

    def read(self, crop):
        item = self.reads.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class Sink:
    def __init__(self):
        self.plates = []
        self.events = []

    def plate(self, plate, confidence):
        self.plates.append((plate, confidence))

    def event(self, kind, message, severity="warning"):
        self.events.append((kind, severity))


def make(reads, boxes=None, **voting):
    sink = Sink()
    pipeline = Pipeline(
        None, ScriptedDetector(boxes), ScriptedOcr(reads),
        PlateVoter(**{"min_reads": 2, "cooldown_s": 30, **voting}), sink, overlay=Overlay(), log=quiet,
    )
    return pipeline, sink


class Chain(unittest.TestCase):
    def test_plate_seen_on_two_pictures_is_reported_once(self):
        pipeline, sink = make([OcrResult("DL01AB1234", 0.9)] * 5)
        for _ in range(5):
            pipeline.process(FRAME)
        self.assertEqual(len(sink.plates), 1)
        self.assertEqual(sink.plates[0][0], "DL01AB1234")

    def test_ocr_mistakes_are_repaired_before_voting(self):
        pipeline, sink = make([OcrResult("DLO1AB1234", 0.9), OcrResult("DL01AB1234", 0.9)])
        pipeline.process(FRAME)
        pipeline.process(FRAME)
        self.assertEqual(sink.plates[0][0], "DL01AB1234")
        # one of the two needed repair, so its confidence was lowered a little
        self.assertLess(sink.plates[0][1], 0.9)

    def test_unreadable_or_too_short_text_is_ignored(self):
        pipeline, sink = make([OcrResult("", 0.0), OcrResult("AB1", 0.9), OcrResult("AB1", 0.9)])
        for _ in range(3):
            pipeline.process(FRAME)
        self.assertEqual(sink.plates, [])

    def test_a_failing_reader_does_not_stop_the_chain(self):
        pipeline, sink = make([RuntimeError("model crashed"), OcrResult("MH12AB1234", 0.9), OcrResult("MH12AB1234", 0.9)])
        for _ in range(3):
            pipeline.process(FRAME)
        self.assertEqual([p[0] for p in sink.plates], ["MH12AB1234"])

    def test_no_plate_found_clears_the_overlay_and_reports_nothing(self):
        pipeline, sink = make([], boxes=[])
        self.assertEqual(pipeline.process(FRAME), [])
        self.assertEqual(pipeline.overlay.get(), [])
        self.assertEqual(sink.plates, [])

    def test_overlay_shows_what_was_read_and_marks_the_reported_one(self):
        pipeline, sink = make([OcrResult("DL01AB1234", 0.9)] * 2)
        pipeline.process(FRAME)
        first = pipeline.overlay.get()[0]
        self.assertEqual(first["text"], "DL01AB1234")
        self.assertFalse(first["reported"])
        pipeline.process(FRAME)
        self.assertTrue(pipeline.overlay.get()[0]["reported"])

    def test_two_plates_in_one_picture_are_both_read(self):
        boxes = [Box(0, 0, 80, 30, 0.9), Box(100, 60, 190, 90, 0.8)]
        pipeline, sink = make([OcrResult("DL01AB1234", 0.9), OcrResult("UP16CD5678", 0.9)] * 2, boxes=boxes)
        pipeline.process(FRAME)
        pipeline.process(FRAME)
        self.assertEqual(sorted(p[0] for p in sink.plates), ["DL01AB1234", "UP16CD5678"])

    def test_a_box_too_small_to_crop_is_skipped(self):
        pipeline, sink = make([], boxes=[Box(5, 5, 6, 6, 0.9)])
        self.assertEqual(pipeline.process(FRAME), [])


class FakeSource:
    def __init__(self, online):
        self.online = online
        self.seq = 0

    def read(self):
        return (FRAME if self.seq else None), self.seq  # no picture until the first one arrives


class CameraWatch(unittest.TestCase):
    def make(self, online):
        now = [0.0]
        source = FakeSource(online)
        sink = Sink()
        pipeline = Pipeline(source, ScriptedDetector([]), ScriptedOcr([]), PlateVoter(), sink, log=quiet, clock=lambda: now[0])
        return pipeline, source, sink, now

    def test_loss_and_return_are_each_told_once(self):
        pipeline, source, sink, _ = self.make(True)
        pipeline.watch_camera()
        pipeline.watch_camera()
        self.assertEqual(sink.events, [], "a working camera at start says nothing")
        source.online = False
        pipeline.watch_camera()
        pipeline.watch_camera()
        source.online = True
        pipeline.watch_camera()
        self.assertEqual(sink.events, [("DEVICE_ERROR", "warning"), ("DEVICE_INFO", "info")])

    def test_a_camera_that_never_opens_is_reported_after_the_grace_period(self):
        pipeline, source, sink, now = self.make(False)
        pipeline.watch_camera()
        self.assertEqual(sink.events, [])
        now[0] = 25
        pipeline.watch_camera()
        pipeline.watch_camera()
        self.assertEqual(sink.events, [("DEVICE_ERROR", "warning")])
        source.online = True
        pipeline.watch_camera()
        self.assertEqual(sink.events[-1], ("DEVICE_INFO", "info"))


class Loop(unittest.TestCase):
    def test_run_processes_each_new_frame_once_and_stops(self):
        source = FakeSource(True)
        reads = [OcrResult("DL01AB1234", 0.9)] * 20
        sink = Sink()
        detector = ScriptedDetector()
        pipeline = Pipeline(source, detector, ScriptedOcr(reads), PlateVoter(min_reads=2), sink, fps=30, log=quiet)
        stop = threading.Event()
        thread = threading.Thread(target=pipeline.run, args=(stop,))
        thread.start()
        try:
            for seq in (1, 2, 3):
                source.seq = seq
                stop.wait(0.15)
        finally:
            stop.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(detector.calls, 3, "one pass per new picture, never the same picture twice")
        self.assertEqual(len(sink.plates), 1)

    def test_run_survives_an_error_inside_a_picture(self):
        class Broken(ScriptedDetector):
            def detect(self, frame):
                raise RuntimeError("bad frame")

        source = FakeSource(True)
        source.seq = 1
        pipeline = Pipeline(source, Broken(), ScriptedOcr([]), PlateVoter(), Sink(), fps=30, log=quiet)
        stop = threading.Event()
        thread = threading.Thread(target=pipeline.run, args=(stop,))
        thread.start()
        stop.wait(0.2)
        self.assertTrue(thread.is_alive())
        stop.set()
        thread.join(3)


if __name__ == "__main__":
    unittest.main()


class PhotoReading(unittest.TestCase):
    """A phone photo sent as bytes (POST /read of the AI service)."""

    @staticmethod
    def jpeg(width=200, height=120):
        import cv2

        ok, buffer = cv2.imencode(".jpg", np.zeros((height, width, 3), dtype=np.uint8))
        return buffer.tobytes()

    def make(self, boxes, reads):
        return Pipeline(None, ScriptedDetector(boxes), ScriptedOcr(reads), PlateVoter(), Sink(), log=quiet)

    def test_answers_the_surest_plate(self):
        pipeline = self.make([Box(10, 10, 100, 40), Box(10, 50, 100, 80)], [OcrResult("MH12AB1234", 0.6), OcrResult("DL01CD5678", 0.9)])
        answer = pipeline.read_photo(self.jpeg())
        self.assertEqual(answer["plate"], "DL01CD5678")
        self.assertEqual(answer["confidence"], 0.9)
        self.assertEqual([r["plate"] for r in answer["results"]], ["DL01CD5678", "MH12AB1234"])

    def test_reads_the_whole_picture_when_no_plate_is_found(self):
        pipeline = self.make([], [OcrResult("KA01AB1234", 0.8)])
        self.assertEqual(pipeline.read_photo(self.jpeg())["plate"], "KA01AB1234")

    def test_nothing_readable_gives_an_empty_answer(self):
        pipeline = self.make([], [OcrResult("???", 0.3)])
        self.assertEqual(pipeline.read_photo(self.jpeg()), {"plate": "", "confidence": 0, "results": []})

    def test_bytes_that_are_not_a_picture_are_refused(self):
        with self.assertRaises(ValueError):
            self.make([], []).read_photo(b"not a picture")

    def test_a_big_photo_is_made_smaller_first(self):
        seen = []

        class Spy(ScriptedDetector):
            def detect(self, frame):
                seen.append(frame.shape[:2])
                return []

        pipeline = Pipeline(None, Spy(), ScriptedOcr([OcrResult("MH12AB1234", 0.9)]), PlateVoter(), Sink(), log=quiet)
        pipeline.read_photo(self.jpeg(3200, 2400))
        self.assertEqual(max(seen[0]), 1600)
