# Gate hardware: ANPR cameras, UHF/RFID and FASTag readers, CCTV, boom barriers and thermal printers

This document explains how the platform talks to devices at a parking location, how to try it
without any hardware, and how to connect real devices.

The plan (section 22) treats hardware as **unreliable external infrastructure**. Everything here
follows from that: the entry, exit and payment flows never depend on a device, every command has
a deadline and is safe to repeat, and every physical action is audited.

## How the pieces fit

```
 Browser (operator)        Cloud API (server/)                    Parking location
 ──────────────────        ───────────────────                    ────────────────
 Entry / Exit pages  ───►  entry, exit, payment         ┌───────►  gate-agent  ──► barrier relay
                           │                            │          (PC / Raspberry Pi)  ──► thermal printer
                           ├─ command queue ◄───────────┘ polls
                           │  (barrier open, print)       acks
                           │
                           └─ /api/device/anpr  ◄──────────────── ANPR camera (directly, or via the agent)
```

* **The cloud never connects to the site.** The gate agent connects outward (HTTPS), so no router
  ports are opened. Cameras that can call a web address may post straight to the cloud.
* **Each device has its own key** (`hwk_...`). It is shown once when the device is added and only
  a hash is stored. Replace a key from the Hardware page if it may have leaked.
* **A camera or reader only suggests.** An operator confirms or corrects every plate. Nothing is
  opened or created automatically from a camera, UHF/RFID or FASTag reading.

## Live updates and instant commands

Two one-way streams (Server-Sent Events, plain HTTP, no extra package) replace most waiting:

* **Screens.** Every signed-in page opens `GET /api/live/stream`. The server only says *that* something
  happened (a plate was seen, a ticket was made, a payment arrived, a command finished) with ids, never
  names, plates or amounts. The page then reloads the data through the normal API, so every permission
  rule applies as before. A screen hears only about its own company and, unless the user is
  company-wide, only its own locations. The small dot above the entry and exit screens shows
  **Live** (green), **Connecting** (amber) or **Not live** (grey). When it is not live the screens
  refresh on their old timers, so nothing depends on the stream.
* **Gate agents.** The agent opens `GET /api/device/stream` with its device key. When a command is queued
  for that device (open the barrier, print a ticket, take a picture) the server sends `wake` and the
  agent asks for its commands **at once** instead of at the next poll (up to 2 s earlier, which is the
  difference you feel at a barrier). Polling continues in the background, so a lost stream only costs
  speed. A silent stream (no message for 70 s) is dropped and reopened. Set `"instantWake": false` in
  `config.json` to switch it off.

Why a stream and not a small web server on the gate PC: with a stream the agent still only connects
**outward**. A local port that the website calls (as some products do) can be triggered by any web page
the operator visits and needs a certificate story; the stream has neither problem.

Limits: the hub keeps its connections in the memory of one server process. With several server
instances behind a load balancer a message would reach only the screens connected to the same instance;
until a shared channel (for example Redis) is added, run one instance (the polling fallback still works
on the others). A reverse proxy must not buffer the streams (the server sends `X-Accel-Buffering: no`; for
other proxies turn response buffering off for `/api/live/` and `/api/device/stream`). Each user may have
6 open screens and the server 500 streams (`LIVE_MAX_STREAMS`); the oldest stream is closed first.

## Lanes

A **lane** is a gate of a location. In the location form, each gate can also have a **lane code**
(for example `L1`), a **plaza ID** and a **FASTag lane ID** (the ID your FASTag provider gave that lane).
They are labels for now: they show in the bar above the entry and exit screens so that staff and
providers talk about the same lane. Each computer **remembers its lane**: the entry screen and the exit
screen each reopen with the location and gate last used on that computer (stored in the browser only).
Devices are tied to a lane by giving them the same gate name and direction.

## Try it without hardware (about 10 minutes)

1. Start the server and the web app (`npm run dev` in `server/` and in `client/`).
2. Sign in as a company admin and open **Hardware** in the top menu. Make sure the location has
   gates (Parking Locations → your location → Details), for example `Gate A` (entry) and
   `Gate B` (exit).
3. Add three devices and copy each key when it is shown:
   * a **Boom barrier**, gate `Gate A`, used for *Entry*;
   * a **Thermal printer**, used for *Entry and exit*;
   * an **ANPR camera**, gate `Gate A`, used for *Entry*.
4. On the PC that will sit at the gate:

   ```
   cd gate-agent
   copy config.example.json config.json      (Windows)   or   cp config.example.json config.json
   ```

   Edit `config.json`: set `serverUrl` (for example `http://localhost:5000`) and paste the three
   keys. Leave every `driver` as `simulated`. Then run `node agent.js`.
5. The three devices turn **Online** on the Hardware page within a few seconds.
6. Press **Test barrier** (give a reason). The agent prints `SIMULATED BARRIER: OPEN` and the page
   shows "done ✓". Press **Test print** on the printer: a file appears in `gate-agent/printed/`.
7. Pretend the camera saw a car:

   ```
   node simulate.js plate --device "Gate 1 camera" --plate MH12AB1234 --confidence 0.93 --direction ENTRY
   ```

   (use the device name you gave it). The plate appears on the operator **Entry** page under
   "Camera suggestions". Press *Use*, correct it if needed, create the ticket. The ticket is
   "printed" into `gate-agent/printed/` and the entry barrier is "opened".
8. Do the exit and payment. The exit barrier opens (the receipt is printed only when the operator presses *Print bill*) (add a second barrier
   for `Gate B` / *Exit* to see that).
9. Stop the agent and wait two minutes: the devices turn **Offline** and a critical alert appears
   under Notifications. Entry and exit still work by hand.

## Using a real thermal printer (for example from a Windows PC)

1. Install the printer's driver and print a Windows test page.
2. Share it: *Settings → Printers & scanners → your printer → Printer properties → Sharing →
   Share this printer*, share name `POS80` (no spaces).
3. In `gate-agent/config.json`:

   ```json
   {
     "name": "Gate 1 printer",
     "key": "hwk_...",
     "type": "PRINTER",
     "driver": "file",
     "options": { "path": "\\\\localhost\\POS80" }
   }
   ```

   (In JSON each backslash is written twice. The path is `\\localhost\POS80`.)
4. On the Hardware page set the paper width (58 or 80 mm) to match the roll, then press
   **Test print**.

Other printer drivers: `tcp` (network printers on port 9100), `command` (run any command, such as
`lp -d MyPrinter -o raw {file}`), and `simulated`.

Without a gate agent you can still print on any printer from the browser: the **Receipt** page has
*Print 80 mm slip* (uses the browser's print dialog with the paper size set for an 80 mm roll).

## Connecting a real boom barrier

A barrier is opened by briefly closing a relay contact that is wired to the controller's "open"
input. Most sites use one of:

| Relay board | Gate agent driver | Typical options |
|---|---|---|
| IP relay with a web API (Shelly, ESP/NodeMCU, many Wi-Fi boards) | `http` | `onUrl` (relay on), `offUrl` (relay off after the pulse) |
| Network relay board that takes bytes on a TCP port | `tcp` | `host`, `port`, `openHex`, `offHex` |
| USB relay / serial controller | `serial` (needs `npm install serialport` in `gate-agent`) | `path`, `baudRate`, `openHex`, `offHex` |

The pulse length comes from the device's *Opening pulse* setting (default 1000 ms). Ask the barrier
installer for the "open" input and whether it wants a pulse or a held contact.

Safety notes:

* Keep the barrier's own safety loop (the sensor that stops it closing on a vehicle) wired to the
  barrier controller. The platform only asks it to *open*.
* A barrier command expires after 30 seconds. If the agent or network is down, it is never carried
  out later. The operator sees "did not respond" and opens it manually (or presses *Try the barrier
  again*, which only works for a vehicle cleared in the last 10 minutes).

## Number plates: ANPR camera or typing

The platform has no plate-reading software of its own. At each gate the number comes from an **ANPR camera**
(a camera that reads the plate itself) or from the operator typing it on the Entry or Exit screen. Both work at
the same time: a camera reading appears as a suggestion, and the operator can always type instead.

## Connecting a real ANPR camera

The platform accepts one standard format at `POST /api/device/anpr`:

```json
{ "plate": "MH12AB1234", "confidence": 0.93, "eventId": "cam-77123",
  "capturedAt": "2026-10-03T10:15:00Z", "imageUrl": "https://...", "direction": "ENTRY", "vehicleType": "car" }
```

* `confidence` may be 0–1 or 0–100. `eventId` makes a camera's retries harmless.
  `direction` is needed only when the camera is registered for both entry and exit: `ENTRY`, `EXIT`, or `AUTO` (the server decides: an open ticket of 5+ minutes means leaving, otherwise arriving).
* `vehicleType` is optional: what the camera thinks the vehicle is. Words like car, SUV, van, bike, motorcycle, scooter, truck, bus, taxi, auto, tempo and pickup are mapped to our five types (Car, Bike, Heavy, Taxi, Tempo); a word we do not know is ignored. The Entry screen then chooses the vehicle type by itself. A plate we already know (it has been in before) keeps the type we remember, whatever the camera says. If neither knows it, the **vehicle type of the lane** is used (set on the location's gate: "Vehicle type of this lane", e.g. a bike lane). With none of these, the type goes back to Car (or the lane's type) and the screen says the camera could not tell, so the operator checks it.
* Cameras that can call a web address with a custom header can post straight to the cloud with
  `x-device-key: hwk_...`.
* Most cameras cannot set headers or post to the internet. Use the gate agent as a bridge: give
  the camera device `"driver": "listener"` and point the camera's HTTP notification at
  `http://<agent-pc>:8081/anpr`. The agent translates the payload and forwards it, keeping events
  for up to 5 minutes if the internet is down.
* To support a specific brand, add a translator to `gate-agent/lib/translators.js` (it returns the
  standard format above). Brands that post XML or multipart pictures need the translator to parse
  that body first; that is the only code that differs between brands.

What the server does with a reading:

* **Confidence bar** (per camera, default 85 %). Below it, or with no plate read, the suggestion
  is marked *Check this plate*.
* **Duplicate suppression.** The same plate seen again at the same gate within 2 minutes is one
  suggestion with a "seen N×" count. A camera repeating an `eventId` changes nothing.
* **Context checks.** Entry: already inside, or blocked, is flagged. Exit: the matching ticket is
  shown, or "no vehicle with this number is inside".
* **Audit.** What the camera read, its confidence and photo address are kept; when an operator uses
  a suggestion with a corrected plate, the audit log records both versions.
* Suggestions nobody uses disappear after 15 minutes.

## UHF / RFID reader (pass tags)

A UHF reader at the gate reads the tag stuck on a pass holder's windscreen. The platform turns
that into a **suggestion** exactly like a camera plate: it shows on the Entry or Exit screen with a
"Pass tag" label and the pass number; the operator taps *Use*.

1. **Give the vehicle its tag.** Open the pass (Passes page), find the vehicle and tap *Add tag*.
   Type the tag number as printed or shown by the reader. Capitals, spaces, `:`, `-` and a leading
   `0x` are ignored; 4 to 48 letters and digits remain. One tag belongs to one vehicle in the company.
2. **Register the reader** on the Hardware page: type *UHF / RFID reader*, the gate and the direction.
   Copy its key into the gate agent's `config.json`.
3. **Run the listener.** The agent opens a small web address for the reader
   (`driver: "listener"`, port 8082, path `/rfid`), or connects to a reader that sends one tag per
   line over TCP (`"driver": "tcp"`) or a serial port (`"driver": "serial"`, needs `serialport`).
   The same tag within 5 seconds (`debounceMs`) is sent once.
4. The server looks the tag up. **Known tag, valid pass:** suggestion with the vehicle number.
   **Pass suspended, expired or not valid at this location:** the suggestion is marked *Check this
   plate* with the reason. **Unknown tag:** nothing to suggest; a log line (`UNKNOWN_TAG`) is added
   to the device's events so staff can see strangers.

Readers that speak a binary frame protocol need a small piece in front that turns each read into
one line of text (the tag number). Brands differ only there.

## FASTag reader

A FASTag reader gives the platform the vehicle number linked to the FASTag. It becomes a suggestion
labelled "FASTag". On the Exit screen the payment mode starts as *FASTag*.

**Charging:** by default FASTag is a record only: nothing is charged to the tag, and the operator
collects the money by the usual means (or marks it FASTag when the toll plaza's own system took it).
With a FASTag partner set up (`FASTAG_PROVIDER`, see `docs/fastag.md`) the exit screen charges the
tag the reader gave. A real partner needs an acquirer / NETC agreement.
The reader must send the vehicle number (`plate`); a read without one is marked *Check this plate*.
Use `driver: "listener"` (port 8083, path `/fastag`) or `tcp` / `serial` like the RFID reader.

## CCTV camera (entry and exit photos)

A CCTV camera takes a picture of the vehicle when an entry or exit is created and keeps it with
the ticket. It does this by a command like the barrier: the server queues `CAPTURE_SNAPSHOT`, the
gate agent fetches one still image from the camera and uploads it to `POST /api/device/snapshots`.
The camera's address and password stay on the gate PC; the cloud never connects to the camera.

* Register a *CCTV camera* on the Hardware page (gate and direction as for other devices).
* In `config.json` pick how the agent gets the picture:
  `http` (a snapshot web address, optional username/password), `file` (a folder or file another
  program keeps current, with `maxAgeSeconds`), `command` (any program that writes the picture to
  `{file}`, for example `ffmpeg` on an RTSP stream; put a program path with spaces in double quotes,
  e.g. `"C:/Program Files/ffmpeg/bin/ffmpeg.exe" -y -i rtsp://... -frames:v 1 {file}`; in `config.json` write each quote as `\"`, and use `/` in paths) or `simulated` (a tiny test picture).
* Pictures are JPEG, PNG or WebP, checked by their first bytes, and no larger than the server's
  picture limit. At most 6 pictures per ticket; a repeated upload of the same command changes nothing.
* A failed snapshot never stops an entry, an exit or a payment. The Hardware page has
  *Test snapshot* to check the camera without a vehicle.

## Try the new readers without hardware

Keep each `driver` as `simulated`, run `node agent.js`, then in another window:

```
node simulate.js tag    --device "Gate 1 RFID" --tag E2801160600002054C2D1234
node simulate.js fastag --device "Gate 1 FASTag" --plate MH12AB1234 --tagId 34161FA820328EE0
```

CCTV with `simulated` answers every snapshot command with a small test picture, so you can see the
whole path (command, upload, photo on the ticket).

## Device API (called by devices, key in `x-device-key`)

| Method and path | Purpose |
|---|---|
| `POST /api/device/heartbeat` | "I am alive." Any call counts as alive, so a polling agent needs no extra heartbeat. |
| `GET /api/device/commands` | Take the next commands (at most 5). Each must be confirmed. |
| `GET /api/device/stream` | Instant wake-up (event stream): `ready`, then `wake` whenever a command is waiting. Optional; polling still works without it. |
| `POST /api/device/commands/:id/ack` | `{ "ok": true }` or `{ "ok": false, "error": "..." }`. Repeating is harmless. |
| `POST /api/device/events` | Report `DEVICE_ERROR` / `DEVICE_INFO` (paper out, relay not answering). |
| `POST /api/device/anpr` | Cameras: report a plate (see above). |
| `POST /api/device/rfid` | UHF readers: `{ tag, eventId?, capturedAt?, direction? }`. Unknown tag answers `{ known: false }` (HTTP 200). |
| `POST /api/device/fastag` | FASTag readers: `{ plate, tagId?, confidence?, eventId?, capturedAt?, direction? }`. |
| `POST /api/device/snapshots?commandId=` | CCTV cameras: body is the picture itself (`image/jpeg`, `image/png`, `image/webp`). |

Admin and operator endpoints are in `docs/api.md` (`/api/hardware`, `/api/anpr`, and
`POST /api/parking/sessions/:id/barrier` and `/print`).

## Command rules (why it is safe)

* A command has a **deadline**: barrier 30 s, ticket 5 min, receipt 10 min. Later, it is dropped.
* **Retries:** a command taken but not confirmed is offered again after its timeout, up to 3 times
  for a barrier and 2 for a printer (printing twice is annoying). A device reporting failure gets
  the same retries.
* **No double actions.** The gate agent remembers commands it already carried out and confirms them
  again instead of lifting the barrier or printing a second time.
* **Idempotent requests.** One barrier-open per session and direction while it is still live or once
  it worked; automatic prints once per session. If every earlier barrier request failed or timed out,
  *retry* queues a new one (several taps at the same moment still make one), at most 3 retries in total.
  A person pressing *Print again* gets a new copy; double-tapping while one is waiting is one slip.
  A command handed out as often as allowed and never confirmed is marked failed (and never blocks a reprint).
  A success reported late is still accepted: the action really happened.
* **No guessing between devices.** If two devices fit a gate equally well (for example two entry
  barriers with no gate name), none is used and the operator is told to act by hand. Give each device
  its own gate name. A device cannot be placed at a gate of the wrong kind (an entry-only device at an exit gate).
* **A late online payment never lifts a barrier.** If the gateway confirms a payment more than 15 minutes
  after it was started, the barrier is not opened (the audit entry says so).
* **The barrier only follows a legitimate clearance:** a new entry, a paid or free exit, or an admin
  release (with a recorded reason). The retry button is limited to the last 10 minutes and to the
  operator's own kind of gate.
* **Audit:** device registered/changed/key replaced, manual barrier or print-test command (with
  reason), barrier opened/closed (as `device:<name>`), plate suggestion confirmed/dismissed.
* **Monitoring:** a device that stays silent longer than its limit (default 2 minutes) is marked
  Offline with one alert per outage (critical for barrier and camera). Cameras that only speak when
  they see a car can be set to *not monitored*, or the agent's heartbeat keeps them alive.

## Getting the gate agent onto the gate PC

Dashboard > Hardware > **Download gate agent (.zip)**. Unzip it on the gate PC (Node.js 20 or newer must be installed), paste each
device key into `config.json` (this server's address is already there) and set each device's `driver`, then double-click
`start-agent.bat` (Windows) or run `sh start-agent.sh`. The start file restarts the agent if it stops. To start it with the PC,
put a shortcut to `start-agent.bat` in the Startup folder (`shell:startup`). It is a zip, not a Windows installer program.
If the server is deployed without the `gate-agent` folder, the page says so; copy the folder from the project instead.
The same download is in the **Download** menu of the operator bar, for gate staff (the zip never holds a device key).

### The live camera picture (Entry and Exit screens)

The screens are served over https, and a browser refuses a picture from a plain `http://192.168.x.x/...` camera address on such a
page (and most cameras give RTSP, which no browser can show). So the agent serves the picture itself, on the gate PC, at
`http://127.0.0.1:<port>/preview/<secret>`: a browser does allow `127.0.0.1` on an https page. Add a `preview` block to the ANPR
camera in `config.json` (`mode` `mjpeg` or `snapshot`, the camera's `url`, optional `username` and `password`, optional `port`,
default 8090; see `gate-agent/README.md`). The agent tells the cloud the address in its heartbeat, so nobody pastes it on the Hardware
page, and the screens show the picture where it was a black box. The camera's address and password stay in `config.json`.

* The secret in the address comes from the device key and stays the same across restarts. At most 4 screens watch at once.
* The picture shows on the PC the agent runs on. Showing it on another PC needs a LAN address, which browsers do not allow on an
  https site; run the operator screen on the gate PC.
* Not yet tried against a real camera and browser: the code and tests use a stand-in camera. If a browser blocks the picture, the panel
  says "The camera picture is not available" and offers **Try again**; open the browser's console for the reason.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Device stays "Never connected" | Wrong or placeholder key in `config.json`; agent not running; `serverUrl` wrong. The agent prints the reason. |
| "did not respond" after payment | Agent offline, or the relay address is wrong. Check the agent window; use *Test barrier* on the Hardware page. |
| Test print says "not completed in time" | Agent not running, or the printer share name is wrong. |
| Every plate says "Low confidence" | Raise the camera angle/lighting, or lower the camera's *Minimum confidence* after checking accuracy. |
| "Could not reach the gate devices" on the screen | The server hit an error while queuing the barrier or slip. Lift the barrier by hand and check the server log. |
| Barrier/printer "not set up for this gate" although it exists | Two devices fit equally well. Give each its own gate name. |
| Tag read but no suggestion | Tag not added to the pass vehicle, or the reader is registered for another gate or direction. Look at the reader's events for `UNKNOWN_TAG`. |
| Photo missing on a ticket | CCTV agent offline or the snapshot address wrong. Use *Test snapshot* on the Hardware page. |
| Live picture panel says "not available" | The agent is not running on this PC, the camera has no `preview` block in `config.json`, or the camera's stream address is wrong (open it in a browser tab on the gate PC to test). |
| Suggestions never appear | Camera registered for the wrong gate/direction, or the Entry page has a different location selected. |

## Not built yet (by design)

* Automatic entry or exit from a camera without an operator (needs measured accuracy first).
* Storing the camera photos (only the address is kept; use the camera's or your own storage).
* Charging a FASTag (NETC / bank integration). The FASTag reader only records.
* Opening a gate automatically from a pass tag. A tag read is a suggestion the operator confirms.
* LED display boards and handheld terminals (plan phase 3).
* Real-hardware testing: UHF, FASTag and CCTV support has been tested with the built-in simulator and
  automated tests only. Expect to adjust the reader translator or the camera address for your brand.
* Live updates across several server instances (needs a shared channel such as Redis); see *Live updates and instant commands*.
