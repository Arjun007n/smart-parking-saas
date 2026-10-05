# AI service

Reads number plates from a webcam, an RTSP IP camera or a video file (YOLOv9 ONNX plate finder + EasyOCR)
and reports them to the Smart Parking server as an ANPR camera. Full guide: `../docs/ai-service.md`.

```
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json      # fill in serverUrl, deviceKey, source
python main.py --check
python main.py
```

Tests (no models, camera or database needed): `python -m unittest discover -s tests -t .`
