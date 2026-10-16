const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBarrierDriver } = require("../lib/drivers/barrier");
const { createPrinterDriver } = require("../lib/drivers/printer");
const { translate } = require("../lib/translators");
const { DeviceWorker } = require("../lib/worker");
const { AnprListener } = require("../lib/anprListener");
const { ReaderListener, translators, parseLine } = require("../lib/readerListener");
const { createCameraDriver, imageType, TINY_JPEG } = require("../lib/drivers/camera");
const { loadConfig } = require("../agent");
const { hexToBuffer } = require("../lib/util");

const quiet = { info() {}, warn() {}, error() {} };

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

test("barrier http driver: pulses on, waits, then off", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.end("ok");
  });
  const port = await listen(server);
  const driver = createBarrierDriver("http", { onUrl: `http://127.0.0.1:${port}/on`, offUrl: `http://127.0.0.1:${port}/off` }, quiet);
  const started = Date.now();
  await driver.open({ pulseMs: 120 });
  assert.deepEqual(seen, ["/on", "/off"]);
  assert.ok(Date.now() - started >= 100, "waited for the pulse");
  await assert.rejects(() => driver.close(), /closeUrl/);
  server.close();
});

test("barrier http driver: a controller error fails the command", async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 500;
    res.end();
  });
  const port = await listen(server);
  const driver = createBarrierDriver("http", { onUrl: `http://127.0.0.1:${port}/on` }, quiet);
  await assert.rejects(() => driver.open({ pulseMs: 100 }), /HTTP 500/);
  server.close();
});

test("barrier tcp driver sends the configured bytes", async () => {
  const received = [];
  const server = net.createServer((socket) => socket.on("data", (d) => received.push(d.toString("hex"))));
  const port = await listen(server);
  const driver = createBarrierDriver("tcp", { host: "127.0.0.1", port, openHex: "A0 01 01 A2", offHex: "A0 01 00 A1" }, quiet);
  await driver.open({ pulseMs: 50 });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(received, ["a00101a2", "a00100a1"]);
  server.close();
});

test("drivers: unknown names and bad hex are explained", () => {
  assert.throws(() => createBarrierDriver("magic", {}, quiet), /Unknown barrier driver/);
  assert.throws(() => createPrinterDriver("magic", {}, quiet), /Unknown printer driver/);
  assert.throws(() => hexToBuffer("xyz"), /not valid hex/);
  assert.deepEqual([...hexToBuffer("0x01, 0xff")], [1, 255]);
});

test("printer file driver writes the exact bytes; simulated saves bytes and text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-agent-"));
  const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a]);

  const file = path.join(dir, "out.bin");
  await createPrinterDriver("file", { path: file }, quiet).print(bytes);
  assert.deepEqual(fs.readFileSync(file), bytes);

  await createPrinterDriver("simulated", { dir: path.join(dir, "printed") }, quiet).print(bytes, "HELLO");
  const saved = fs.readdirSync(path.join(dir, "printed"));
  assert.equal(saved.length, 2);
  assert.ok(saved.some((n) => n.endsWith(".txt") && fs.readFileSync(path.join(dir, "printed", n), "utf8") === "HELLO"));
});

test("printer tcp driver sends bytes to port 9100 style printers", async () => {
  const chunks = [];
  const server = net.createServer((socket) => socket.on("data", (d) => chunks.push(d)));
  const port = await listen(server);
  await createPrinterDriver("tcp", { host: "127.0.0.1", port }, quiet).print(Buffer.from("hello"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(Buffer.concat(chunks).toString(), "hello");
  server.close();
});

test("translators: generic maps common field names and drops empty ones", () => {
  const out = translate("generic", { license_plate: "MH12AB1234", score: "93", id: 77, timestamp: "2026-10-03T10:00:00Z" });
  assert.equal(out.plate, "MH12AB1234");
  assert.equal(out.confidence, 93);
  assert.equal(out.eventId, "77");
  assert.equal(out.capturedAt, "2026-10-03T10:00:00.000Z");
  assert.equal("imageUrl" in out, false);
  assert.equal(translate("generic", {}).plate, "");
  assert.throws(() => translate("nobody", {}), /Unknown camera vendor/);
});

const fakeClient = (script = {}) => {
  const calls = { ack: [], heartbeat: 0, plate: [], rfid: [], fastag: [], snapshot: [] };
  return {
    calls,
    heartbeat: async () => {
      calls.heartbeat += 1;
    },
    commands: async () => ({ commands: script.commands ? script.commands() : [] }),
    ack: async (id, ok, error) => {
      if (script.ackFails && script.ackFails()) throw new Error("network down");
      calls.ack.push({ id, ok, error });
    },
    plate: async (detection) => {
      if (script.plateFails && script.plateFails()) throw new Error("network down");
      calls.plate.push(detection);
      return { duplicate: false, needsReview: false, reviewReasons: [] };
    },
    rfid: async (read) => {
      if (script.readFails && script.readFails()) throw new Error("network down");
      calls.rfid.push(read);
      return { known: true, plate: "RJ14RF0001", duplicate: false, needsReview: false, reviewReasons: [] };
    },
    fastag: async (read) => {
      if (script.readFails && script.readFails()) throw new Error("network down");
      calls.fastag.push(read);
      return { duplicate: false, plate: read.plate, needsReview: false, reviewReasons: [] };
    },
    snapshot: async (commandId, picture, contentType) => {
      if (script.snapshotFails && script.snapshotFails()) throw new Error("upload failed");
      calls.snapshot.push({ commandId, bytes: picture.length, contentType });
    },
  };
};

const barrierDevice = { name: "B", key: "hwk_x", type: "BARRIER", driver: "simulated" };

test("worker: carries out a barrier command once and confirms it", async () => {
  const opened = [];
  const client = fakeClient({ commands: () => [{ id: "c1", type: "BARRIER_OPEN", payload: { pulseMs: 500 } }] });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: barrierDevice, client });
  worker.driver = { open: async (o) => opened.push(o), close: async () => {} };

  await worker.pollOnce();
  assert.deepEqual(opened, [{ pulseMs: 500 }]);
  assert.deepEqual(client.calls.ack, [{ id: "c1", ok: true, error: undefined }]);
});

test("worker: a command the server offers again is confirmed, not repeated", async () => {
  let opens = 0;
  const client = fakeClient({ commands: () => [{ id: "c1", type: "BARRIER_OPEN", payload: {} }] });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: barrierDevice, client });
  worker.driver = { open: async () => { opens += 1; }, close: async () => {} };

  await worker.pollOnce();
  await worker.pollOnce(); // same command comes back (ack was lost)
  assert.equal(opens, 1);
  assert.equal(client.calls.ack.length, 2);
  assert.ok(client.calls.ack.every((a) => a.ok));
});

test("worker: a driver failure is reported as failed with the reason", async () => {
  const client = fakeClient({ commands: () => [{ id: "c9", type: "BARRIER_OPEN", payload: {} }] });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: barrierDevice, client });
  worker.driver = { open: async () => { throw new Error("relay board not answering"); } };
  worker.log = quiet;

  await worker.pollOnce();
  assert.deepEqual(client.calls.ack, [{ id: "c9", ok: false, error: "relay board not answering" }]);
});

test("worker: printer prints decoded bytes; unsupported formats fail clearly", async () => {
  const printed = [];
  const bytes = Buffer.from("slip");
  const client = fakeClient({
    commands: () => [
      { id: "p1", type: "PRINT_RECEIPT", payload: { format: "escpos", dataBase64: bytes.toString("base64"), text: "T" } },
      { id: "p2", type: "PRINT_RECEIPT", payload: { format: "pdf" } },
    ],
  });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: { name: "P", key: "hwk_x", type: "PRINTER", driver: "simulated" }, client });
  worker.driver = { print: async (buffer, text) => printed.push([buffer.toString(), text]) };
  worker.log = quiet;

  await worker.pollOnce();
  assert.deepEqual(printed, [["slip", "T"]]);
  assert.equal(client.calls.ack[0].ok, true);
  assert.equal(client.calls.ack[1].ok, false);
  assert.match(client.calls.ack[1].error, /Unsupported print format/);
});

test("worker: a lost confirmation is retried and does not stop the loop", async () => {
  let failures = 2;
  const client = fakeClient({
    commands: () => [{ id: "c1", type: "BARRIER_OPEN", payload: {} }],
    ackFails: () => failures-- > 0,
  });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: barrierDevice, client });
  worker.log = quiet;
  await worker.pollOnce();
  assert.equal(client.calls.ack.length, 1, "third attempt got through");
});

test("worker: cameras take no commands", async () => {
  const worker = new DeviceWorker({
    serverUrl: "http://localhost:5000", device: { name: "C", key: "hwk_x", type: "ANPR_CAMERA", driver: "listener" }, client: fakeClient(),
  });
  assert.equal(worker.driver, null);
});

test("camera listener: forwards a plate, keeps events while the server is down, then delivers them", async () => {
  let down = true;
  const client = fakeClient({ plateFails: () => down });
  const listener = new AnprListener({
    serverUrl: "http://localhost:5000", client,
    device: { name: "Cam", key: "hwk_x", type: "ANPR_CAMERA", driver: "listener", options: { port: 0, direction: "ENTRY" } },
  });
  listener.log = quiet;
  listener.server = http.createServer((req, res) => listener.handleRequest(req, res));
  const port = await listen(listener.server);

  const post = (body, p = "/anpr") =>
    fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  assert.equal((await post({ plate: "MH12AB1234", score: 0.9 })).status, 202);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(client.calls.plate.length, 0);
  assert.equal(listener.queue.length, 1, "kept for retry");

  down = false;
  await listener.flush();
  assert.equal(listener.queue.length, 0);
  assert.equal(client.calls.plate[0].plate, "MH12AB1234");
  assert.equal(client.calls.plate[0].direction, "ENTRY", "camera direction added from config");

  assert.equal((await post({}, "/other")).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/anpr`, { method: "POST", body: "not json" })).status, 400);
  listener.server.close();
});

test("camera listener: optional shared secret", async () => {
  const listener = new AnprListener({
    serverUrl: "http://localhost:5000", client: fakeClient(),
    device: { name: "Cam", key: "hwk_x", type: "ANPR_CAMERA", options: { port: 0, secret: "s3" } },
  });
  listener.log = quiet;
  listener.server = http.createServer((req, res) => listener.handleRequest(req, res));
  const port = await listen(listener.server);
  assert.equal((await fetch(`http://127.0.0.1:${port}/anpr`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/anpr?secret=s3`, { method: "POST", body: "{}" })).status, 202);
  listener.server.close();
});

test("config: placeholder keys and missing parts are refused with a clear message", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-agent-cfg-"));
  const write = (obj) => {
    const file = path.join(dir, "c.json");
    fs.writeFileSync(file, JSON.stringify(obj));
    return file;
  };
  assert.throws(() => loadConfig(path.join(dir, "missing.json")), /Config file not found/);
  assert.throws(() => loadConfig(write({ devices: [] })), /serverUrl/);
  assert.throws(() => loadConfig(write({ serverUrl: "http://localhost:5000", devices: [] })), /at least one device/);
  assert.throws(
    () => loadConfig(write({ serverUrl: "http://localhost:5000", devices: [{ name: "A", type: "BARRIER", key: "hwk_PASTE_THE_KEY" }] })),
    /no real key/
  );
  const ok = loadConfig(write({ serverUrl: "http://localhost:5000", devices: [{ name: "A", type: "BARRIER", key: "hwk_abcdef0123" }] }));
  assert.equal(ok.devices.length, 1);
});

// ------------------------------------------------ RFID / FASTag readers and CCTV

test("camera drivers: simulated gives a real JPEG; http, file and command drivers fetch a picture", async () => {
  assert.equal(imageType(TINY_JPEG), "image/jpeg");
  assert.equal(imageType(Buffer.from("hello world, not a picture")), null);
  assert.equal(imageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), "image/png");

  assert.equal((await createCameraDriver("simulated", {}, quiet).capture()).length, TINY_JPEG.length);

  let seenAuth;
  const server = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    if (req.url === "/bad") return res.end("<html>login</html>");
    if (req.url === "/down") {
      res.statusCode = 503;
      return res.end();
    }
    res.setHeader("content-type", "image/jpeg");
    res.end(TINY_JPEG);
  });
  const port = await listen(server);
  const camera = createCameraDriver("http", { url: `http://127.0.0.1:${port}/snap`, username: "admin", password: "pw" }, quiet);
  assert.equal((await camera.capture()).length, TINY_JPEG.length);
  assert.equal(seenAuth, `Basic ${Buffer.from("admin:pw").toString("base64")}`);
  await assert.rejects(() => createCameraDriver("http", { url: `http://127.0.0.1:${port}/bad` }, quiet).capture(), /did not give a JPEG/);
  await assert.rejects(() => createCameraDriver("http", { url: `http://127.0.0.1:${port}/down` }, quiet).capture(), /HTTP 503/);
  await assert.rejects(() => createCameraDriver("http", {}, quiet).capture(), /options.url/);
  server.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-agent-cam-"));
  const file = path.join(dir, "latest.jpg");
  fs.writeFileSync(file, TINY_JPEG);
  assert.equal((await createCameraDriver("file", { path: file }, quiet).capture()).length, TINY_JPEG.length);
  fs.utimesSync(file, new Date(Date.now() - 120000), new Date(Date.now() - 120000));
  await assert.rejects(() => createCameraDriver("file", { path: file }, quiet).capture(), /out of date/);

  const script = path.join(dir, "grab.js");
  fs.writeFileSync(script, "require('fs').copyFileSync(process.argv[2], process.argv[3])");
  const copy = createCameraDriver("command", { command: `"${process.execPath}" "${script}" "${file}" "{file}"` }, quiet);
  fs.utimesSync(file, new Date(), new Date());
  assert.equal((await copy.capture()).length, TINY_JPEG.length);
  assert.throws(() => createCameraDriver("telepathy", {}, quiet), /Unknown CCTV driver/);
});

test("splitCommand keeps quoted paths with spaces together", () => {
  const { splitCommand } = require("../lib/util");
  assert.deepEqual(splitCommand('"C:\\Program Files\\nodejs\\node.exe" a.js "my file.jpg" {file}'), [
    "C:\\Program Files\\nodejs\\node.exe", "a.js", "my file.jpg", "{file}",
  ]);
  assert.deepEqual(splitCommand("  ffmpeg -i   rtsp://cam/stream  "), ["ffmpeg", "-i", "rtsp://cam/stream"]);
  assert.deepEqual(splitCommand(""), []);
});

test("worker: a CCTV snapshot command takes a picture, uploads it for that command and confirms", async () => {
  const client = fakeClient({ commands: () => [{ id: "s1", type: "CAPTURE_SNAPSHOT", payload: { kind: "ENTRY", sessionId: "x" } }] });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: { name: "Cam", key: "hwk_x", type: "CCTV_CAMERA", driver: "simulated" }, client });
  worker.log = quiet;
  worker.driver = { capture: async () => TINY_JPEG };
  await worker.pollOnce();
  assert.deepEqual(client.calls.snapshot, [{ commandId: "s1", bytes: TINY_JPEG.length, contentType: "image/jpeg" }]);
  assert.deepEqual(client.calls.ack, [{ id: "s1", ok: true, error: undefined }]);
  await worker.pollOnce(); // offered again: confirmed, not uploaded twice
  assert.equal(client.calls.snapshot.length, 1);
});

test("worker: a snapshot test takes a picture but uploads nothing; failures are reported", async () => {
  const client = fakeClient({ commands: () => [{ id: "t1", type: "SNAPSHOT_TEST", payload: {} }, { id: "t2", type: "CAPTURE_SNAPSHOT", payload: {} }] });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: { name: "Cam", key: "hwk_x", type: "CCTV_CAMERA" }, client });
  worker.log = quiet;
  let n = 0;
  worker.driver = { capture: async () => { n += 1; if (n === 2) throw new Error("camera unreachable"); return TINY_JPEG; } };
  await worker.pollOnce();
  assert.equal(client.calls.snapshot.length, 0);
  assert.equal(client.calls.ack[0].ok, true);
  assert.deepEqual(client.calls.ack[1], { id: "t2", ok: false, error: "camera unreachable" });

  const bad = fakeClient({ commands: () => [{ id: "t3", type: "CAPTURE_SNAPSHOT", payload: {} }] });
  const w2 = new DeviceWorker({ serverUrl: "http://localhost:5000", device: { name: "Cam", key: "hwk_x", type: "CCTV_CAMERA" }, client: bad });
  w2.log = quiet;
  w2.driver = { capture: async () => Buffer.from("not a picture at all") };
  await w2.pollOnce();
  assert.match(bad.calls.ack[0].error, /did not give a JPEG/);
});

test("worker: readers take no commands, and a printer cannot be asked for a snapshot", async () => {
  for (const type of ["RFID_READER", "FASTAG_READER"]) {
    const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: { name: "R", key: "hwk_x", type, driver: "listener" }, client: fakeClient() });
    assert.equal(worker.driver, null);
  }
  const client = fakeClient({ commands: () => [{ id: "x1", type: "CAPTURE_SNAPSHOT", payload: {} }] });
  const worker = new DeviceWorker({ serverUrl: "http://localhost:5000", device: { name: "B", key: "hwk_x", type: "BARRIER", driver: "simulated" }, client });
  worker.log = quiet;
  await worker.pollOnce();
  assert.equal(client.calls.ack[0].ok, false);
});

test("reader messages: RFID and FASTag reads are translated; lines are understood", () => {
  assert.deepEqual(translators.rfid({ EPC: "E200 68", time: "2026-10-03T10:00:00Z", direction: "entry" }), {
    tag: "E200 68", capturedAt: "2026-10-03T10:00:00.000Z", direction: "ENTRY",
  });
  assert.throws(() => translators.rfid({}), /No tag number/);
  assert.deepEqual(translators.fastag({ vehicleNumber: "MH12AB1234", tid: "ABCD", score: "99" }), { plate: "MH12AB1234", tagId: "ABCD", confidence: 99 });
  assert.throws(() => translators.fastag({}), /No vehicle number or tag/);

  assert.deepEqual(parseLine("rfid", " E2006806AB \r"), { tag: "E2006806AB" });
  assert.deepEqual(parseLine("fastag", "34161FA8,MH12AB1234"), { tagId: "34161FA8", plate: "MH12AB1234" });
  assert.deepEqual(parseLine("fastag", "MH12AB1234"), { plate: "MH12AB1234" });
  assert.deepEqual(parseLine("rfid", '{"tag":"AB12CD34"}'), { tag: "AB12CD34" });
  assert.equal(parseLine("rfid", "   "), null);
});

test("RFID listener: forwards a tag, ignores repeats of the same tag, keeps reads while the server is down", async () => {
  let down = true;
  const client = fakeClient({ readFails: () => down });
  const listener = new ReaderListener({
    serverUrl: "http://localhost:5000", client, kind: "rfid",
    device: { name: "Rfid", key: "hwk_x", type: "RFID_READER", driver: "listener", options: { direction: "ENTRY", debounceMs: 60000 } },
  });
  listener.log = quiet;
  listener.server = http.createServer((req, res) => listener.handleRequest(req, res));
  const port = await listen(listener.server);
  const post = (body, p = "/rfid") => fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", body: JSON.stringify(body) });

  assert.equal((await post({ tag: "E2006806AB" })).status, 202);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(listener.queue.length, 1, "kept for retry");
  const repeat = await post({ tag: "e2006806ab" });
  assert.equal((await repeat.json()).repeat, true);
  assert.equal(listener.queue.length, 1, "the same tag again is ignored");

  down = false;
  await listener.flush();
  assert.equal(listener.queue.length, 0);
  assert.deepEqual(client.calls.rfid, [{ tag: "E2006806AB", direction: "ENTRY" }]);

  assert.equal((await post({})).status, 400);
  assert.equal((await post({}, "/other")).status, 404);
  listener.server.close();
});

test("FASTag listener: secret is checked; lines from a TCP reader arrive as reads", async () => {
  const client = fakeClient();
  const listener = new ReaderListener({
    serverUrl: "http://localhost:5000", client, kind: "fastag",
    device: { name: "Ft", key: "hwk_x", type: "FASTAG_READER", driver: "listener", options: { secret: "s3", debounceMs: 0 } },
  });
  listener.log = quiet;
  listener.server = http.createServer((req, res) => listener.handleRequest(req, res));
  const port = await listen(listener.server);
  assert.equal((await fetch(`http://127.0.0.1:${port}/fastag`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/fastag?secret=s3`, { method: "POST", body: JSON.stringify({ plate: "MH12AB1234" }) })).status, 202);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(client.calls.fastag[0].plate, "MH12AB1234");
  listener.server.close();

  // A reader that sends one read per line on a TCP port.
  const reads = fakeClient();
  const tcp = new ReaderListener({
    serverUrl: "http://localhost:5000", client: reads, kind: "rfid",
    device: { name: "Tcp", key: "hwk_x", type: "RFID_READER", driver: "tcp", options: { debounceMs: 0 } },
  });
  tcp.log = quiet;
  const feed = tcp.lineReader();
  feed(Buffer.from("E2006806"));
  feed(Buffer.from("AB\r\nCAFE0002\nHALF"));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(reads.calls.rfid.map((r) => r.tag), ["E2006806AB", "CAFE0002"], "the unfinished line waits for its end");
});

test("agent: readers and cameras are accepted in config.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-agent-cfg2-"));
  const file = path.join(dir, "c.json");
  fs.writeFileSync(file, JSON.stringify({
    serverUrl: "http://localhost:5000",
    devices: [
      { name: "R", type: "RFID_READER", key: "hwk_abcdef0123", driver: "simulated" },
      { name: "F", type: "FASTAG_READER", key: "hwk_abcdef0124", driver: "simulated" },
      { name: "C", type: "CCTV_CAMERA", key: "hwk_abcdef0125", driver: "simulated" },
    ],
  }));
  const { build } = require("../agent");
  const parts = build(loadConfig(file));
  assert.equal(parts.filter((p) => p instanceof ReaderListener).length, 2);
  assert.equal(parts.filter((p) => p instanceof DeviceWorker).length, 3);
});
