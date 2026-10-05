import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402

GOOD = {"serverUrl": "http://localhost:5000/", "deviceKey": "hwk_abcdef0123456789", "detector": {"kind": "fullframe"}}


class Config(unittest.TestCase):
    def parse(self, **changes):
        raw = {**GOOD, **changes}
        with tempfile.TemporaryDirectory() as folder:
            return config.parse(raw, folder)

    def test_defaults_and_cleanup(self):
        c = self.parse()
        self.assertEqual(c["serverUrl"], "http://localhost:5000")
        self.assertEqual(c["source"], 0)
        self.assertEqual(c["processFps"], 5)
        self.assertEqual(c["ocr"]["kind"], "easyocr")
        self.assertTrue(c["preview"]["address"].startswith("http://127.0.0.1:8090/stream.mjpg?token="))

    def test_source_forms(self):
        self.assertEqual(self.parse(source="1")["source"], 1)
        self.assertEqual(self.parse(source="rtsp://u:p@10.0.0.5:554/s")["source"], "rtsp://u:p@10.0.0.5:554/s")
        self.assertEqual(self.parse(source="video.mp4")["source"], "video.mp4")
        with self.assertRaises(config.ConfigError):
            self.parse(source="")
        with self.assertRaises(config.ConfigError):
            self.parse(source=True)

    def test_missing_or_placeholder_key_is_explained(self):
        for key in ["", "abc", "hwk_PASTE_THE_KEY_SHOWN"]:
            with self.assertRaises(config.ConfigError) as caught:
                self.parse(deviceKey=key)
            self.assertIn("deviceKey", str(caught.exception))

    def test_server_address_must_be_http(self):
        with self.assertRaises(config.ConfigError):
            self.parse(serverUrl="localhost:5000")

    def test_yolo_needs_the_model_file_and_says_where_to_put_it(self):
        with self.assertRaises(config.ConfigError) as caught:
            self.parse(detector={"kind": "yolo", "weights": "models/none.pt"})
        self.assertIn("plate", str(caught.exception).lower())
        with tempfile.TemporaryDirectory() as folder:
            os.makedirs(os.path.join(folder, "models"))
            open(os.path.join(folder, "models", "plate.pt"), "wb").close()
            c = config.parse({**GOOD, "detector": {"kind": "yolo"}}, folder)
            self.assertTrue(c["detector"]["weights"].endswith("plate.pt"))

    def test_onnx_is_the_default_and_needs_no_file_but_a_known_model(self):
        c = config.parse({k: v for k, v in GOOD.items() if k != "detector"}, ".")
        self.assertEqual(c["detector"]["kind"], "onnx")
        self.assertEqual(c["detector"]["model"], "yolo-v9-t-640-license-plate-end2end")
        with self.assertRaises(config.ConfigError) as caught:
            self.parse(detector={"kind": "onnx", "model": "yolo-v9-x-1-license-plate-end2end"})
        self.assertIn("detector.model", str(caught.exception))
        self.parse(detector={"kind": "onnx", "model": "yolo-v9-t-384-license-plate-end2end"})

    def test_numbers_are_range_checked(self):
        for bad in [{"processFps": 0}, {"processFps": 99}, {"voting": {"minReads": 0}}, {"detector": {"kind": "fullframe", "confidence": 5}}, {"preview": {"port": 80}}]:
            with self.assertRaises(config.ConfigError, msg=str(bad)):
                self.parse(**bad)

    def test_direction_and_unknown_kinds(self):
        self.assertEqual(self.parse(direction="ENTRY")["direction"], "ENTRY")
        self.assertEqual(self.parse(direction="AUTO")["direction"], "AUTO")
        with self.assertRaises(config.ConfigError):
            self.parse(direction="SIDEWAYS")
        with self.assertRaises(config.ConfigError):
            self.parse(detector={"kind": "magic"})
        with self.assertRaises(config.ConfigError):
            self.parse(ocr={"kind": "magic"})

    def test_preview_token_is_kept_between_runs(self):
        with tempfile.TemporaryDirectory() as folder:
            one = config.parse(GOOD, folder)["preview"]["token"]
            two = config.parse(GOOD, folder)["preview"]["token"]
            self.assertEqual(one, two)
            self.assertGreaterEqual(len(one), 16)

    def test_public_url_is_used_in_the_address(self):
        c = self.parse(preview={"publicUrl": "http://192.168.1.20:8090/", "host": "0.0.0.0"})
        self.assertTrue(c["preview"]["address"].startswith("http://192.168.1.20:8090/stream.mjpg?token="))

    def test_load_reports_a_missing_or_broken_file(self):
        with self.assertRaises(config.ConfigError):
            config.load("/nonexistent/config.json")
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "c.json")
            with open(path, "w") as handle:
                handle.write("{ not json")
            with self.assertRaises(config.ConfigError):
                config.load(path)


if __name__ == "__main__":
    unittest.main()
