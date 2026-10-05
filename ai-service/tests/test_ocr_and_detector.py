import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from detection import plate_detector  # noqa: E402
from detection.plate_detector import Box, FullFrameDetector, OnnxPlateDetector, clip, crop  # noqa: E402
from ocr.plate_ocr import join_lines  # noqa: E402

try:
    import cv2
    import numpy as np
except ImportError:  # the pure parts are still tested
    cv2 = np = None


def piece(x, y, text, conf, w=60, h=20):
    return ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text, conf)


class JoinLines(unittest.TestCase):
    def test_one_line_is_read_left_to_right(self):
        result = join_lines([piece(120, 10, "1234", 0.9), piece(0, 12, "DL01", 0.8), piece(60, 11, "AB", 0.7)])
        self.assertEqual(result.text, "DL01AB1234")

    def test_two_line_plate_reads_the_top_row_first(self):
        result = join_lines([piece(0, 60, "1234", 0.9), piece(0, 10, "MH12AB", 0.9)])
        self.assertEqual(result.text, "MH12AB1234")

    def test_noise_characters_are_removed_and_confidence_is_weighted_by_length(self):
        result = join_lines([piece(0, 10, "dl 01-", 1.0), piece(70, 10, "ab|1234", 0.5)])
        self.assertEqual(result.text, "DL01AB1234")
        self.assertAlmostEqual(result.confidence, (1.0 * 4 + 0.5 * 6) / 10, places=3)

    def test_nothing_read(self):
        self.assertEqual(join_lines([]).text, "")
        self.assertEqual(join_lines([piece(0, 0, "---", 0.9)]).confidence, 0.0)


class Boxes(unittest.TestCase):
    def test_clip_keeps_a_box_inside_the_picture(self):
        b = clip(Box(-10, -5, 700, 500, 0.9), 640, 480)
        self.assertEqual((b.x1, b.y1, b.x2, b.y2), (0, 0, 640, 480))

    @unittest.skipIf(np is None, "numpy not installed")
    def test_crop_adds_a_margin_and_stays_inside(self):
        frame = np.zeros((100, 200, 3), dtype=np.uint8)
        piece_ = crop(frame, Box(50, 40, 150, 60), pad=0.1)
        self.assertEqual(piece_.shape[:2], (24, 120))
        edge = crop(frame, Box(190, 90, 260, 140), pad=0.1)
        self.assertEqual(edge.shape[:2], (15, 17), "cut off at the picture's edge, not beyond")

    @unittest.skipIf(np is None, "numpy not installed")
    def test_a_tiny_box_gives_nothing(self):
        frame = np.zeros((100, 200, 3), dtype=np.uint8)
        self.assertIsNone(crop(frame, Box(10, 10, 12, 11)))

    @unittest.skipIf(np is None, "numpy not installed")
    def test_full_frame_detector_covers_everything(self):
        frame = np.zeros((48, 64, 3), dtype=np.uint8)
        (box,) = FullFrameDetector().detect(frame)
        self.assertEqual((box.x2, box.y2), (64, 48))


class FakeFound:
    def __init__(self, confidence, x1, y1, x2, y2):
        self.confidence = confidence
        self.bounding_box = type("BB", (), {"x1": x1, "y1": y1, "x2": x2, "y2": y2})()


class OnnxDetector(unittest.TestCase):
    """The open-image-models package is replaced by a fake: no model file is needed or fetched."""

    def setUp(self):
        self.asked = []
        found = [FakeFound(0.30, 0, 0, 500, 500), FakeFound(0.90, 10, 10, 110, 50), FakeFound(0.80, 200, 200, 400, 300), FakeFound(0.70, 5, 5, 25, 15)]

        class Detector:
            def predict(inner, frame):  # noqa: N805
                return found

        module = type(sys)("open_image_models")
        module.create_detector = lambda name: (self.asked.append(name), Detector())[1]
        self.saved = sys.modules.get("open_image_models")
        sys.modules["open_image_models"] = module

    def tearDown(self):
        if self.saved is None:
            sys.modules.pop("open_image_models", None)
        else:
            sys.modules["open_image_models"] = self.saved

    def test_asks_for_the_chosen_model_and_keeps_the_sure_big_boxes(self):
        detector = OnnxPlateDetector("yolo-v9-t-384-license-plate-end2end", confidence=0.5, max_plates=2)
        self.assertEqual(self.asked, ["yolo-v9-t-384-license-plate-end2end"])
        boxes = detector.detect(object())
        self.assertEqual(len(boxes), 2)
        self.assertEqual((boxes[0].x1, boxes[0].y1, boxes[0].x2, boxes[0].y2), (200, 200, 400, 300))  # 0.80 x big beats 0.90 x small
        self.assertTrue(all(b.score >= 0.5 for b in boxes), "the 0.30 detection is dropped")

    def test_build_uses_the_settings(self):
        detector = plate_detector.build({"kind": "onnx", "model": "yolo-v9-t-640-license-plate-end2end", "confidence": 0.75, "maxPlates": 5})
        self.assertIsInstance(detector, OnnxPlateDetector)
        self.assertEqual([b.score for b in detector.detect(object())], [0.8, 0.9])


@unittest.skipIf(cv2 is None, "OpenCV not installed")
class Preprocess(unittest.TestCase):
    def test_small_crops_are_enlarged_and_grey(self):
        from ocr.plate_ocr import TARGET_HEIGHT, preprocess

        crop_ = np.full((30, 120, 3), 200, dtype=np.uint8)
        cv2.putText(crop_, "DL01", (5, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        out = preprocess(crop_)
        self.assertEqual(out.ndim, 2)
        self.assertEqual(out.shape[0], TARGET_HEIGHT)
        self.assertEqual(out.shape[1], 120 * TARGET_HEIGHT // 30)

    def test_big_crops_are_not_shrunk(self):
        from ocr.plate_ocr import preprocess

        out = preprocess(np.full((200, 400, 3), 120, dtype=np.uint8))
        self.assertEqual(out.shape, (200, 400))


if __name__ == "__main__":
    unittest.main()
