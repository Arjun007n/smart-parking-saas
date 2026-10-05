"""Reads config.json, fills in defaults and refuses anything that would fail later in a confusing way."""
from __future__ import annotations

import json
import os
import re
import secrets

from detection.plate_detector import ONNX_MODELS

DEFAULTS = {
    "serverUrl": "",
    "deviceKey": "",
    # 0 = first webcam, "rtsp://user:pass@192.168.1.100:554/stream" = IP camera, or a video file path
    "source": 0,
    # Only for a camera registered for both directions: ENTRY, EXIT, or AUTO (the server decides: a plate that has
    # been inside for a while is leaving, any other plate is arriving). Leave empty for a one-way camera.
    "direction": "",
    "processFps": 5,
    "heartbeatSeconds": 15,
    "detector": {
        "kind": "onnx", "model": "yolo-v9-t-640-license-plate-end2end",
        "weights": "models/plate.pt", "device": "cpu", "confidence": 0.4, "maxPlates": 2,
    },
    "ocr": {"kind": "easyocr", "languages": ["en"], "gpu": False},
    "voting": {"windowSeconds": 3.0, "minReads": 2, "minConfidence": 0.5, "cooldownSeconds": 30.0},
    "preview": {"enabled": True, "host": "127.0.0.1", "port": 8090, "publicUrl": ""},
    "loopFile": True,
}

DETECTORS = ("onnx", "yolo", "fullframe")
OCRS = ("easyocr",)


class ConfigError(Exception):
    pass


def _merge(base, extra):
    out = dict(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def _number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ConfigError(f"{name} must be a number from {low} to {high}")
    return value


def _token(directory):
    """A secret that stays the same between runs, so the address saved on the Hardware page keeps working."""
    path = os.path.join(directory, ".preview_token")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            token = handle.read().strip()
        if len(token) >= 16:
            return token
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(token)
    except OSError:
        pass  # still works for this run
    return token


def parse(raw: dict, directory: str = ".") -> dict:
    config = _merge(DEFAULTS, raw)
    if not re.match(r"^https?://\S+$", str(config["serverUrl"])):
        raise ConfigError("serverUrl must be the address of your Smart Parking server, e.g. http://localhost:5000")
    key = str(config["deviceKey"])
    if not key.startswith("hwk_") or "PASTE" in key:
        raise ConfigError("deviceKey is missing. Add an ANPR camera on the Hardware page and paste the key shown when it was added.")
    config["serverUrl"] = config["serverUrl"].rstrip("/")

    source = config["source"]
    if isinstance(source, str) and source.strip().isdigit():
        source = int(source.strip())
    if isinstance(source, bool) or not isinstance(source, (int, str)) or source == "":
        raise ConfigError("source must be 0 (webcam), an rtsp:// address or a video file")
    config["source"] = source

    if config["direction"] not in ("", "ENTRY", "EXIT", "AUTO"):
        raise ConfigError("direction must be ENTRY, EXIT, AUTO or empty")
    _number(config["processFps"], "processFps", 1, 30)
    _number(config["heartbeatSeconds"], "heartbeatSeconds", 5, 300)

    detector = config["detector"]
    if detector["kind"] not in DETECTORS:
        raise ConfigError(f"detector.kind must be one of: {', '.join(DETECTORS)}")
    _number(detector["confidence"], "detector.confidence", 0.05, 0.99)
    _number(detector["maxPlates"], "detector.maxPlates", 1, 5)
    if detector["kind"] == "onnx" and detector["model"] not in ONNX_MODELS:
        raise ConfigError(f"detector.model must be one of: {', '.join(ONNX_MODELS)}")
    if detector["kind"] == "yolo":
        weights = detector["weights"]
        if not os.path.isabs(weights):
            weights = os.path.join(directory, weights)
        if not os.path.isfile(weights):
            raise ConfigError(
                f"The plate detection model was not found at {weights}. Put a YOLO number-plate model there "
                "(see README.md, 'The plate model'), or set detector.kind to \"fullframe\" to try the reader without one."
            )
        detector["weights"] = weights

    if config["ocr"]["kind"] not in OCRS:
        raise ConfigError(f"ocr.kind must be one of: {', '.join(OCRS)}")

    voting = config["voting"]
    _number(voting["windowSeconds"], "voting.windowSeconds", 0.5, 30)
    _number(voting["minReads"], "voting.minReads", 1, 10)
    _number(voting["minConfidence"], "voting.minConfidence", 0.05, 1)
    _number(voting["cooldownSeconds"], "voting.cooldownSeconds", 0, 3600)

    preview = config["preview"]
    _number(preview["port"], "preview.port", 1024, 65535)
    if preview["enabled"]:
        preview["token"] = _token(directory)
        shown = preview["publicUrl"] or f"http://{'127.0.0.1' if preview['host'] in ('0.0.0.0', '') else preview['host']}:{int(preview['port'])}"
        preview["address"] = f"{shown.rstrip('/')}/stream.mjpg?token={preview['token']}"
    return config


def load(path: str) -> dict:
    full = os.path.abspath(path)
    if not os.path.isfile(full):
        raise ConfigError(f"Config file not found: {full}\nCopy config.example.json to config.json and fill it in.")
    try:
        with open(full, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except json.JSONDecodeError as error:
        raise ConfigError(f"{full} is not valid JSON: {error}") from error
    return parse(raw, os.path.dirname(full))
