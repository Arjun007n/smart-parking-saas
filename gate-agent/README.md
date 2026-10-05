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

Barrier pulses are logged; printed slips are saved in `./printed/`. Full guide, driver options and
troubleshooting: `docs/hardware.md`.

`npm test` runs the agent's own tests (no network or database needed).
