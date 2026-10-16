# Gate agent

Runs at the parking location (a PC or Raspberry Pi) and connects the barrier, the thermal printer,
the ANPR camera, UHF/RFID and FASTag readers and CCTV cameras to the cloud API. It only makes **outgoing** connections.

Needs Node.js 20 or newer. No packages to install. Only the serial drivers need `serialport`; install it with an **exact**
version so every PC runs the same code, then keep the lock file with the agent:

```
npm install --save-exact serialport     # pins the exact version in package.json and writes package-lock.json
npm ci                                  # on every other gate PC, installs exactly what the lock file says
```

**serverUrl must be https.** The device key is sent with every call, so `serverUrl` has to start with `https://`. Plain
`http://` is accepted only for `localhost`, `127.0.0.1` and private LAN addresses (10.x, 172.16-31.x, 192.168.x, `*.local`), so
a development server keeps working. Anything else stops the agent at start with a clear message; set the environment variable
`GATE_AGENT_ALLOW_HTTP=1` only if you really must use plain http.

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

**Listeners (`"driver": "listener"`: ANPR camera port 8081 `/anpr`, RFID 8082, FASTag 8083) listen on this PC only.**
They bind to `127.0.0.1` by default, so only software on the gate PC can send events.

> **Upgrade note.** Before this change the listeners accepted events from the whole network. If your camera or reader runs
> on **another machine** (the usual case for an IP camera that pushes events), it can no longer reach the agent after you
> upgrade until you add `"bind"` and a secret to that device's `options`:
>
> ```
> "options": { "bind": "0.0.0.0", "secret": "<a long random text>" }
> ```
>
> `"bind": "0.0.0.0"` listens on every network card (or give this PC's LAN address). The agent **refuses to start** with a
> `bind` other than loopback when no `secret` is set. Make the camera send the secret in the `x-agent-secret` header; a
> camera that cannot set headers can put it in the address instead: `http://<this-pc>:8081/anpr?secret=<secret>` (works as
> before). The secret is compared in constant time. Use a firewall rule so only the camera's address can reach the port.

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
* The web address of the picture carries a secret made from the device key **and a random value picked each time the agent
  starts**. The agent sends its current address to the cloud with every heartbeat, so after a restart the screens pick up
  the new address by themselves (a screen that was open may show "Connecting to the camera" for a few seconds). At most 4
  screens watch at once, and nothing is fetched from any address except the one in `config.json`.
* The picture is shown by a plain `<img>`, which needs no CORS header, so none is sent by default. A website script that
  must read the picture itself can be allowed with `"previewOrigins": ["https://parking.example.com"]` (in the `preview`
  block, or once at the top of `config.json`); only a request whose `Origin` is in that list gets
  `access-control-allow-origin`.

Barrier pulses are logged; printed slips are saved in `./printed/`. Full guide, driver options and
troubleshooting: `docs/hardware.md`.

`npm test` runs the agent's own tests (no network or database needed).
