#!/usr/bin/env python3
"""Smart Parking AI service: reads number plates from a camera and reports them to the server.

    python main.py                       run with config.json
    python main.py --check               test the setup (camera, models, server) and exit
    python main.py --image car.jpg       read one picture and print what was found
    python main.py path/to/config.json   use another config file
"""
from __future__ import annotations

import argparse
import sys
import threading
import time

import config as configuration
from camera.rtsp_stream import FrameSource
from preview import Feeder, FrameHolder, Overlay, draw, encode, make_server
from reporter import Refused, Reporter, Unavailable
from voting import PlateVoter


def say(message):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)


def build_models(settings):
    from detection import plate_detector
    from ocr import plate_ocr

    say("loading the plate finder and the reader (the first start downloads the reading models)...")
    try:
        return plate_detector.build(settings["detector"]), plate_ocr.build(settings["ocr"])
    except ImportError as error:
        raise RuntimeError(
            f"a Python package is missing ({error}). Install everything with:  pip install -r requirements.txt"
        ) from error


def build_reporter(settings):
    return Reporter(settings["serverUrl"], settings["deviceKey"], settings["direction"], log=say)


def check(settings):
    """Tests each part and says what is wrong. Returns True when everything works."""
    good = True

    def result(name, ok, detail=""):
        nonlocal good
        good = good and ok
        print(f"  [{'ok' if ok else 'FAILED'}] {name}{': ' + detail if detail else ''}")

    print("Checking the setup...")
    try:
        build_models(settings)
        result("plate finder and reader", True)
    except Exception as error:  # noqa: BLE001
        result("plate finder and reader", False, str(error))

    source = FrameSource(settings["source"], settings["loopFile"], log=say).start()
    deadline = time.time() + 12
    frame = None
    while time.time() < deadline and frame is None:
        frame, _ = source.read()
        time.sleep(0.2)
    source.stop()
    if frame is None:
        result("camera", False, f"no picture from {settings['source']!r} within 12 seconds")
    else:
        result("camera", True, f"{frame.shape[1]}x{frame.shape[0]} picture")

    try:
        build_reporter(settings).heartbeat()
        result("server and camera key", True, "the server answered and knows this camera")
    except Refused as error:
        result("server and camera key", False, f"{error}. Check deviceKey in config.json.")
    except Unavailable as error:
        result("server", False, f"could not reach {settings['serverUrl']} ({error})")
    return good


def read_image(settings, path, save=None):
    import cv2

    image = cv2.imread(path)
    if image is None:
        print(f"Could not open {path} as a picture")
        return False
    try:
        detector, ocr = build_models(settings)
    except RuntimeError as error:
        print(error)
        return False
    from pipeline import Pipeline

    pipeline = Pipeline(None, detector, ocr, PlateVoter(), None, log=say)
    found = pipeline.read_frame(image)
    if not found:
        print("No plate was found in this picture.")
    for item in found:
        note = " (repaired)" if item["repaired"] else ""
        print(f"plate: {item['text'] or '(not readable)'}  confidence: {item['confidence'] * 100:.1f}%{note}")
    if save:
        cv2.imwrite(save, draw(image, [{**i, "reported": False} for i in found]))
        print(f"picture with the boxes saved to {save}")
    return True


def run(settings):
    """Runs until Ctrl+C. Returns 1 when it could not start."""
    from pipeline import Pipeline

    try:
        detector, ocr = build_models(settings)
    except RuntimeError as error:
        print(error)
        return 1
    voting = settings["voting"]
    voter = PlateVoter(voting["windowSeconds"], int(voting["minReads"]), voting["minConfidence"], voting["cooldownSeconds"])
    reporter = build_reporter(settings)
    source = FrameSource(settings["source"], settings["loopFile"], log=say).start()
    overlay = Overlay()

    pipeline = Pipeline(source, detector, ocr, voter, reporter, overlay, settings["processFps"], log=say)
    server = feeder = None
    preview = settings["preview"]
    if preview["enabled"]:
        holder = FrameHolder()
        feeder = Feeder(source, overlay, holder)
        feeder.start()
        server = make_server(preview["host"], int(preview["port"]), preview["token"], holder, feeder, reader=pipeline.read_photo)
        threading.Thread(target=server.serve_forever, name="preview", daemon=True).start()
        reporter.preview_url = preview["address"]
        say("live picture address (sent to the server by itself; nothing to paste):")
        say("  " + preview["address"])

    reporter.start(settings["heartbeatSeconds"])
    stop = threading.Event()
    say(f"running: reading plates from {settings['source']!r}, reporting to {settings['serverUrl']}. Press Ctrl+C to stop.")
    try:
        pipeline.run(stop)
    except KeyboardInterrupt:
        pass
    finally:
        say("stopping")
        stop.set()
        source.stop()
        reporter.stop()
        if feeder:
            feeder.stop()
        if server:
            server.shutdown()
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Smart Parking AI service")
    parser.add_argument("config", nargs="?", default="config.json")
    parser.add_argument("--check", action="store_true", help="test the setup and exit")
    parser.add_argument("--image", help="read one picture and print the plate")
    parser.add_argument("--save", help="with --image: save the picture with the boxes drawn")
    args = parser.parse_args(argv)
    try:
        settings = configuration.load(args.config)
    except configuration.ConfigError as error:
        print(error)
        return 1
    if args.check:
        return 0 if check(settings) else 1
    if args.image:
        return 0 if read_image(settings, args.image, args.save) else 1
    return run(settings)


if __name__ == "__main__":
    sys.exit(main())
