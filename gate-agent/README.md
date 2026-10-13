# Gate agent

Runs at the parking location (a PC or Raspberry Pi) and connects the barrier, the thermal printer,
the ANPR camera, UHF/RFID and FASTag readers and CCTV cameras to the cloud API. It only makes **outgoing** connections.

Needs Node.js 20 or newer. No packages to install (the serial barrier driver needs `serialport`).

```
copy config.example.json config.json     # then paste the device keys from the Hardware page
node agent.js
```

Try without hardware: keep every `driver` as `simulated`, run the agent, then

```
node simulate.js plate --device "Gate 1 camera" --plate MH12AB1234 --confidence 0.93 --direction ENTRY
```

Readers and CCTV work the same way:

```
node simulate.js tag    --device "Gate 1 RFID" --tag E2801160600002054C2D1234
node simulate.js fastag --device "Gate 1 FASTag" --plate MH12AB1234
```

CCTV drivers: `simulated`, `http` (snapshot address), `file`, `command` (for example ffmpeg).
Readers: `listener` (HTTP ports 8082 `/rfid`, 8083 `/fastag`), `tcp`, `serial`, `simulated`.

**Instant commands.** Barrier, printer and CCTV devices also keep one outgoing event stream open to the server, which wakes
them the moment a command is queued (no waiting for the next poll). Polling stays on as a fallback. Turn it off with
`"instantWake": false` in `config.json`. Nothing listens on a port on this PC.

**Live camera picture on the Entry and Exit screens.** The screens are served over https, and a browser will not show a
picture from a plain `http://192.168.x.x/...` address on such a page. So the agent can serve the picture itself, on the gate PC,
and tell the cloud where it is (in the heartbeat; nobody pastes an address). Add a `preview` block to the ANPR camera in `config.json`:

```
{
  "name": "Gate 1 camera", "key": "hwk_...", "type": "ANPR_CAMERA", "driver": "listener",
  "preview": {
    "mode": "mjpeg",                              // "mjpeg" = the camera's video stream, "snapshot" = a still picture address
    "url": "http://192.168.1.64/video.mjpg",      // the camera's own address (http or https)
    "username": "admin", "password": "...",       // optional, sent as Basic authentication, never sent to the cloud
    "port": 8090                                  // optional; the picture is served on 127.0.0.1:8090 (this PC only)
  }
}
```

* `mode: "snapshot"` suits cameras that only give one still picture per request (for example
  `http://192.168.1.64/ISAPI/Streaming/channels/101/picture`); the agent fetches it every `intervalMs` (default 500) and
  sends it on as a video stream.
* An RTSP-only camera has no address a browser can use. Most also have an MJPEG or snapshot address (look in the camera's
  web page); otherwise let `ffmpeg` turn the stream into MJPEG and give that address.
* The picture is served on `127.0.0.1` by default, so it shows on the **same PC the agent runs on** (the usual gate PC). To
  show it on another PC of the same network set `"bind": "<this PC's LAN address>"`; that browser then needs the site to
  be allowed to load pictures from a local address, which browsers only grant for `127.0.0.1`/`localhost` on an https site.
* The web address of the picture carries a secret made from the device key, at most 4 screens watch at once, and nothing is
  fetched from any address except the one in `config.json`.

Barrier pulses are logged; printed slips are saved in `./printed/`. Full guide, driver options and
troubleshooting: `docs/hardware.md`.

`npm test` runs the agent's own tests (no network or database needed).
