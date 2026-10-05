"""Finds number plates in a video frame. Returns boxes; reading the characters is the OCR's job."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Box:
    x1: int
    y1: int
    x2: int
    y2: int
    score: float = 1.0

    @property
    def area(self) -> int:
        return max(0, self.x2 - self.x1) * max(0, self.y2 - self.y1)


def clip(box: Box, width: int, height: int) -> Box:
    return Box(max(0, int(box.x1)), max(0, int(box.y1)), min(width, int(box.x2)), min(height, int(box.y2)), box.score)


def crop(frame, box: Box, pad: float = 0.08):
    """The part of the frame inside the box, with a little margin (OCR needs the plate's edges)."""
    height, width = frame.shape[:2]
    grow_x = int((box.x2 - box.x1) * pad)
    grow_y = int((box.y2 - box.y1) * pad)
    b = clip(Box(box.x1 - grow_x, box.y1 - grow_y, box.x2 + grow_x, box.y2 + grow_y, box.score), width, height)
    if b.x2 - b.x1 < 8 or b.y2 - b.y1 < 4:
        return None
    return frame[b.y1:b.y2, b.x1:b.x2]


class YoloPlateDetector:
    """A YOLO model trained on number plates (a .pt file). Uses the `ultralytics` package."""

    def __init__(self, weights: str, confidence: float = 0.4, device: str = "cpu", max_plates: int = 2):
        from ultralytics import YOLO  # imported here: it pulls in PyTorch, which is slow to load

        self.model = YOLO(weights)
        self.confidence = confidence
        self.device = device
        self.max_plates = max_plates

    def detect(self, frame):
        results = self.model.predict(frame, conf=self.confidence, device=self.device, verbose=False, imgsz=640)
        boxes = []
        for result in results:
            if result.boxes is None:
                continue
            xyxy = result.boxes.xyxy.cpu().numpy()
            scores = result.boxes.conf.cpu().numpy()
            for (x1, y1, x2, y2), score in zip(xyxy, scores):
                boxes.append(Box(int(x1), int(y1), int(x2), int(y2), float(score)))
        boxes.sort(key=lambda b: b.score * b.area, reverse=True)  # big and sure first
        return boxes[: self.max_plates]


ONNX_MODELS = (
    "yolo-v9-t-640-license-plate-end2end",
    "yolo-v9-s-608-license-plate-end2end",
    "yolo-v9-t-512-license-plate-end2end",
    "yolo-v9-t-416-license-plate-end2end",
    "yolo-v9-t-384-license-plate-end2end",
    "yolo-v9-t-256-license-plate-end2end",
)


class OnnxPlateDetector:
    """A YOLOv9 plate finder from the open-image-models package (MIT licence, runs on ONNX Runtime, no PyTorch).

    The package downloads the chosen model file itself the first time it is used and keeps it for later runs.
    Smaller numbers in the model name are faster and a little less accurate.
    """

    def __init__(self, model: str = ONNX_MODELS[0], confidence: float = 0.4, max_plates: int = 2):
        from open_image_models import create_detector  # imported here: it loads ONNX Runtime and fetches the model

        self.detector = create_detector(model)
        self.confidence = confidence
        self.max_plates = max_plates

    def detect(self, frame):
        boxes = []
        for found in self.detector.predict(frame):
            score = float(found.confidence)
            if score < self.confidence:
                continue
            b = found.bounding_box
            boxes.append(Box(int(b.x1), int(b.y1), int(b.x2), int(b.y2), score))
        boxes.sort(key=lambda b: b.score * b.area, reverse=True)  # big and sure first
        return boxes[: self.max_plates]


class FullFrameDetector:
    """No plate finder: the whole picture is read. For trying the reader with a close-up of a plate."""

    def detect(self, frame):
        height, width = frame.shape[:2]
        return [Box(0, 0, width, height, 1.0)]


def build(settings: dict):
    if settings["kind"] == "fullframe":
        return FullFrameDetector()
    if settings["kind"] == "onnx":
        return OnnxPlateDetector(settings["model"], settings["confidence"], settings["maxPlates"])
    return YoloPlateDetector(settings["weights"], settings["confidence"], settings["device"], settings["maxPlates"])
