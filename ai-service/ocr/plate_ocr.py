"""Reads the characters on a cropped number plate."""
from __future__ import annotations

from dataclasses import dataclass

ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
TARGET_HEIGHT = 96  # small crops are enlarged: OCR engines read big characters better


@dataclass
class OcrResult:
    text: str
    confidence: float  # 0..1


def preprocess(crop):
    """Grey, enlarged and contrast-boosted. Returns an image the OCR reads more reliably than the raw crop."""
    import cv2

    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    height, width = grey.shape[:2]
    if height < TARGET_HEIGHT:
        scale = TARGET_HEIGHT / float(height)
        grey = cv2.resize(grey, (max(1, int(width * scale)), TARGET_HEIGHT), interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
    return clahe.apply(grey)


def join_lines(pieces):
    """Puts OCR pieces in reading order. Two-line plates (bikes) have the top row first.

    `pieces` are (box, text, confidence) where box is four corner points. Returns OcrResult.
    """
    items = []
    for box, text, conf in pieces:
        text = "".join(ch for ch in str(text).upper() if ch in ALLOWED)
        if not text:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append({"text": text, "conf": float(conf), "x": min(xs), "y": (min(ys) + max(ys)) / 2.0, "h": max(ys) - min(ys)})
    if not items:
        return OcrResult("", 0.0)

    # Pieces whose vertical centres are within half a character height are one line.
    items.sort(key=lambda i: i["y"])
    lines = []
    for item in items:
        if lines and abs(item["y"] - lines[-1][-1]["y"]) <= max(1.0, 0.5 * item["h"]):
            lines[-1].append(item)
        else:
            lines.append([item])
    ordered = [i for line in lines for i in sorted(line, key=lambda i: i["x"])]

    text = "".join(i["text"] for i in ordered)
    total = sum(len(i["text"]) for i in ordered)
    confidence = sum(i["conf"] * len(i["text"]) for i in ordered) / total  # longer pieces count more
    return OcrResult(text, round(confidence, 3))


class EasyOcrReader:
    def __init__(self, languages=("en",), gpu=False):
        import easyocr  # imported here: it pulls in PyTorch

        # The first run downloads the reading models (about 100 MB) and keeps them.
        self.reader = easyocr.Reader(list(languages), gpu=gpu, verbose=False)

    def read(self, crop) -> OcrResult:
        image = preprocess(crop)
        pieces = self.reader.readtext(image, allowlist=ALLOWED, detail=1, paragraph=False)
        return join_lines(pieces)


def build(settings: dict):
    return EasyOcrReader(settings["languages"], settings["gpu"])
