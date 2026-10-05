# AI service: reading number plates from a camera (webcam or IP/CCTV)

`ai-service/` is a small Python program that sits **beside** the website's server. It watches a camera,
finds number plates, reads the characters and tells the server. The server does everything else it
already did for camera readings: checks the vehicle (pass, blocked, already inside, booking) and shows the
plate as a **suggestion** on the Entry or Exit screen. On the Entry screen the plate also **fills the Vehicle
number box** by itself (when the box is empty), ready for the operator to check and press Create ticket; on
the Exit screen it fills the search box. On a gate that has a camera, **AUTO ENTRY** and **AUTO EXIT**
start **on** when the page opens (the switch at the top of the screen pauses them): a clearly read plate creates
the ticket, prints it and opens the barrier, or looks the vehicle up for exit and shows the fee. At exit the
barrier opens by itself when the payment is recorded (or at once when nothing is due). A vehicle that has just left
makes way for the next plate by itself; one still waiting to pay is never pushed aside. Gates without a camera
keep both switches off.

```
 IP camera (RTSP)  or  webcam  or  video file
              │
              ▼
   camera/rtsp_stream.py    newest picture only; reconnects by itself
              │
              ▼
   detection/plate_detector.py     a plate finder (ONNX YOLOv9 by default) finds the plate box
              │
              ▼
   ocr/plate_ocr.py                EasyOCR reads the characters
              │
              ▼
   plate_text.py                   repairs look-alikes (O/0, S/5 ...) by Indian plate shape
              │
              ▼
   voting.py                       the same plate on several pictures, then ONE report
              │
              ▼
   reporter.py ── POST /api/device/anpr (the camera's own key) ──►  Node.js API ──► MongoDB
                                                                        │
   preview.py ── live picture with plate boxes ──►  React: Entry / Exit screens ◄┘ (live updates)
```

It is the same door every ANPR camera uses (`docs/hardware.md`), so nothing about entry, exit,
payment or the barrier had to change.

## Set it up on the gate computer (Windows)

1. **Python.** Install Python 3.10, 3.11 or 3.12 (the safest for PyTorch on Windows; the newest
   Python may lack PyTorch builds). Tick "Add to PATH".
2. **Packages**, in the `ai-service` folder:
   ```
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   This installs PyTorch (for the character reader) and takes a while (a few GB of download).
3. **The plate model.** Set `"detector": { "kind": "onnx", "model": "yolo-v9-t-640-license-plate-end2end" }`
   (this is the default). It uses the open-image-models package: MIT licence, runs on ONNX Runtime, and
   fetches the model file by itself the first time the service starts, then keeps it. The model name can be
   any of: `yolo-v9-t-640-...` (default), `yolo-v9-s-608-...`, `-t-512-`, `-t-416-`, `-t-384-`, `-t-256-`
   (smaller number = faster on a weak computer, a little less accurate).
   * Not verified: what the model was trained on (we could not confirm it includes **Indian** plates),
     the licence of the model file itself (the package is MIT), and its real accuracy at your gate.
     Test it with `--image` on photos from your own gate before relying on it.
   * Your own `.pt` YOLO file still works with `"kind": "yolo"` (and `pip install ultralytics`). That
     package is AGPL-3.0, which matters if you sell this as a service.
   * To try the reader on a close-up picture of a plate only, use `"detector": { "kind": "fullframe" }`.
4. **Register the camera on the website.** Hardware page, add a device: type **ANPR camera**, the
   location, the gate (same name as in the location) and the direction (Entry or Exit). Copy the key
   (`hwk_...`), it is shown once.
5. **Config.** Copy `config.example.json` to `config.json` and set `serverUrl`, `deviceKey` and `source`:
   * `0` is the first webcam (best for trying things).
   * `"rtsp://user:password@192.168.1.100:554/stream"` is an IP camera. The camera's password stays in this
     file on the gate computer and is never sent to the website.
   * `"C:/videos/gate.mp4"` is a recorded video, which is useful for testing without a camera.
6. **Test the setup.**
   ```
   python main.py --check                       models, camera and server, one line each
   python main.py --image photo.jpg --save out.jpg    read one picture and see the boxes
   ```
7. **Run it:** `python main.py`. It prints a **live picture address** (with a secret token) and sends it to the
   server by itself with every heartbeat, so there is nothing to paste (you can still type one on the Hardware page,
   for example when the picture is reached through another address). Within about 10 seconds the Entry and Exit
   screens show the live camera with the plate box drawn on it, and the camera shows **Online** on the Hardware page.

## What happens to a reading

* A plate is reported only after it was read on **at least 2 pictures within 3 seconds** (`voting`), so one
  blurry frame cannot make a suggestion. Readings that differ by one character count together and the most
  common spelling wins.
* A car standing in front of the camera is **one** report; the same plate is not reported again for 30
  seconds (`cooldownSeconds`). The server also merges the same plate seen within 2 minutes.
* The confidence sent is the average of the readings, slightly lowered when a repair was needed.
  Readings below the camera's **Minimum confidence** (Hardware page, default 85 %) are marked "Check this
  plate", still fill the box for the operator to check, and are never used by AUTO ENTRY or AUTO EXIT.
* Only plates that arrive while the Entry or Exit screen is open fill the box. Plates already waiting when the
  page opens, and plates that arrive while the box is in use, are listed under "Plate suggestions" with a
  Use button. Pass-tag and FASTag readings fill the box too, but never trigger auto entry or exit.
* If the server is unreachable, plates wait and are sent when it is back (same id, so never twice). After 10
  minutes a waiting plate is dropped: the car has gone.
* If the camera picture stops, the Hardware page shows a "Camera picture lost" note, and another note when it
  is back.

## The plan's modules and what exists

| Module in the plan | Here |
|---|---|
| 1. Camera management | Add, edit and switch off cameras on the Hardware page (name, gate, direction, status, live address). Connection test: `python main.py --check` and the camera's Online/Offline status. The RTSP address itself lives in the AI service's `config.json`. |
| 2. Live monitoring | Live picture with plate boxes on Entry and Exit, camera Online/Offline. |
| 3. Plate detection | YOLO plate box, crop, OCR, confidence. A separate vehicle detector is not included: the plate model is enough to trigger a read. |
| 4. Automatic entry | On by default with a gate camera (the AUTO ENTRY switch pauses it): a plate read without a "Check this plate" warning makes the ticket, prints it and opens the barrier (vehicle type as selected, no advance). |
| 5. Automatic exit | On by default with a gate camera (the AUTO EXIT switch pauses it): finds the open ticket and shows the fee; payment is taken by the operator or online, and the barrier opens by itself once it is recorded. |
| 6. AI logs | Every reading is stored as a suggestion with plate, camera/gate, direction, confidence, time and what the operator did with it. The picture and the vehicle type are not stored. |

## One two-way camera (entry and exit with one camera)

When one camera watches the gate for both directions (for example one webcam while testing), register it on the
Hardware page with direction **Entry and exit** and **no gate name**, and put `"direction": "AUTO"` in `config.json`. The server
then decides for each plate: a plate with an open ticket here for at least 5 minutes (`AUTO_EXIT_AFTER_MINUTES`) is
leaving, so it appears on the Exit screen; any other plate is arriving, so it appears on the Entry screen. A car that has
just been given a ticket therefore does not turn into an exit while it is still in front of the camera. With
separate entry and exit cameras none of this is needed: use direction Entry or Exit and leave `direction` empty.

## One camera per gate

Register one ANPR camera for the entry gate (direction ENTRY) and one for the exit gate (direction EXIT), with the
gate name the operator selects. On that gate the Entry or Exit screen shows only the gate camera: its live picture,
and the plate it reads fills the Vehicle number (entry) or search (exit) box. The camera panel of the operator's own
computer is hidden on every screen; the link "Use this computer's camera instead" brings it back. Without a gate
camera the screen says which camera is missing (direction and gate name) instead of showing the computer's camera.

## Safety

* The live picture is a plain video stream and only answers when the address carries the secret token. By
  default it listens on this computer only (`127.0.0.1`). If the operator uses another computer, set
  `"host": "0.0.0.0"` and `"publicUrl": "http://<this computer's address>:8090"` and keep that network private.
* Only people allowed to use that gate (and managers) are told the address.
* Nothing from the camera opens a barrier by itself. A reading is a suggestion, and a barrier command is only
  queued by a normal entry or exit.

## Limits and honest notes

* **Accuracy is not proven yet.** The service was tested with scripted readers and a recorded video, not with
  real YOLO and EasyOCR models or real cameras. Run `--image` on photos from your own gate and read the
  results before trusting AUTO ENTRY.
* EasyOCR on CPU takes roughly a quarter to a second per plate, so 5 pictures a second (`processFps`) is a
  good start. A graphics card (`"device": "cuda"`, `"gpu": true`) makes it much faster.
* Night, rain, dirty or bent plates, and fancy fonts reduce accuracy. Good lighting and a camera angle
  of less than 30° matter more than the model.
* One AI service watches **one** camera. For several cameras run several copies, each with its own
  `config.json`, camera key and preview port.
* The first start downloads the EasyOCR reading models (about 100 MB) and needs internet once.
