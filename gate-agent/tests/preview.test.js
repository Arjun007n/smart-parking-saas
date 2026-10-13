// The live picture the agent serves for an ANPR camera (lib/previewRelay.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { PreviewRelay, normalize, tokenFor } = require("../lib/previewRelay");
const { TINY_JPEG } = require("../lib/drivers/camera");
const { DeviceWorker } = require("../lib/worker");
const { loadConfig, build } = require("../agent");

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const freePort = async () => {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const device = { name: "Gate 1 camera", key: "hwk_abcdef0123456789", type: "ANPR_CAMERA", driver: "simulated" };

// Starts a relay in front of `cameraUrl` and returns what a test needs.
const relayFor = async (preview) => {
  const port = await freePort();
  const relay = new PreviewRelay({ device, options: { port, ...preview } });
  relay.start();
  await wait(50);
  return { relay, port, base: `http://127.0.0.1:${port}`, url: relay.url };
};

// Reads from a streaming answer until `enough(text)` or the stream ends; then stops reading.
const readSome = async (res, enough) => {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.length;
    if (enough(Buffer.concat(chunks), total)) break;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks);
};

test("token: the same for the same key, different for another key, and not the key itself", () => {
  assert.equal(tokenFor("hwk_one"), tokenFor("hwk_one"));
  assert.notEqual(tokenFor("hwk_one"), tokenFor("hwk_two"));
  assert.match(tokenFor("hwk_one"), /^[0-9a-f]{32}$/);
  assert.ok(!tokenFor("hwk_one").includes("one"));
});

test("config: defaults are filled in and bad values are explained", () => {
  const ok = normalize({ url: "http://192.168.1.64/video.mjpg" });
  assert.equal(ok.mode, "mjpeg");
  assert.equal(ok.port, 8090);
  assert.equal(ok.bind, "127.0.0.1");
  assert.equal(ok.advertiseHost, "127.0.0.1");
  assert.equal(normalize({ url: "http://x/a", bind: "192.168.1.10" }).advertiseHost, "192.168.1.10");
  assert.equal(normalize({ url: "http://x/a", bind: "0.0.0.0" }).advertiseHost, "127.0.0.1");
  assert.throws(() => normalize({}), /camera's http\(s\) address/);
  assert.throws(() => normalize({ url: "rtsp://192.168.1.64/stream" }), /http\(s\) address/);
  assert.throws(() => normalize({ url: "http://x/a", mode: "rtsp" }), /mode must be one of/);
  assert.throws(() => normalize({ url: "http://x/a", port: 80 }), /port must be/);
  assert.throws(() => normalize({ url: "http://x/a", mode: "snapshot", intervalMs: 10 }), /intervalMs/);
  assert.throws(() => normalize("nope"), /must be an object/);
});

test("snapshot mode: the camera's still picture becomes a video stream; Basic auth is sent", async () => {
  const seen = [];
  const camera = http.createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "image/jpeg" });
    res.end(TINY_JPEG);
  });
  const cameraPort = await listen(camera);
  const { relay, url } = await relayFor({ mode: "snapshot", url: `http://127.0.0.1:${cameraPort}/snap.jpg`, username: "admin", password: "secret", intervalMs: 200 });
  try {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^multipart\/x-mixed-replace; boundary=frame$/);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-allow-private-network"), "true");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await readSome(res, (buffer) => buffer.toString("latin1").split("--frame").length >= 3); // two pictures
    assert.ok(text.includes(TINY_JPEG), "the picture's own bytes are sent");
    assert.ok(text.toString("latin1").includes("Content-Type: image/jpeg"));
    assert.equal(seen[0], `Basic ${Buffer.from("admin:secret").toString("base64")}`);
    assert.ok(seen.length >= 2, "fetched again for each frame");
  } finally {
    relay.stop();
    camera.close();
  }
});

test("mjpeg mode: the camera's own stream is passed through with its content type", async () => {
  const camera = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=cam" });
    const timer = setInterval(() => res.write("--cam\r\nContent-Type: image/jpeg\r\n\r\nFRAME-DATA\r\n"), 30);
    res.on("close", () => clearInterval(timer));
  });
  const cameraPort = await listen(camera);
  const { relay, url } = await relayFor({ mode: "mjpeg", url: `http://127.0.0.1:${cameraPort}/video` });
  try {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "multipart/x-mixed-replace; boundary=cam");
    const text = (await readSome(res, (buffer) => buffer.toString().includes("FRAME-DATA"))).toString();
    assert.match(text, /--cam/);
    // Closing the screen frees the viewer's place (and the camera's stream).
    await wait(100);
    assert.equal(relay.viewers, 0);
  } finally {
    relay.stop();
    camera.close();
  }
});

test("only the right address works: wrong token, other paths and other methods are refused", async () => {
  const { relay, base, url } = await relayFor({ mode: "snapshot", url: "http://127.0.0.1:9/never" });
  try {
    assert.equal((await fetch(`${base}/preview/${"0".repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${base}/preview/`)).status, 404);
    assert.equal((await fetch(`${base}/preview`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${url}x`)).status, 404, "a longer token is not the token");
    // The browser's question before it reaches a private address is answered, with no picture.
    const ask = await fetch(url, { method: "OPTIONS" });
    assert.equal(ask.status, 204);
    assert.equal(ask.headers.get("access-control-allow-private-network"), "true");
    assert.equal(relay.viewers, 0);
  } finally {
    relay.stop();
  }
});

test("a camera that is down gives 502 (stream) or ends the stream (snapshot), and frees the viewer", async () => {
  const dead = await freePort();
  const through = await relayFor({ mode: "mjpeg", url: `http://127.0.0.1:${dead}/video` });
  const stills = await relayFor({ mode: "snapshot", url: `http://127.0.0.1:${dead}/snap`, intervalMs: 200 });
  try {
    assert.equal((await fetch(through.url)).status, 502);
    const res = await fetch(stills.url); // headers are sent first, then the stream ends after three failures
    const body = await res.arrayBuffer();
    assert.equal(body.byteLength, 0, "no picture was ever sent");
    await wait(50);
    assert.equal(through.relay.viewers, 0);
    assert.equal(stills.relay.viewers, 0);
  } finally {
    through.relay.stop();
    stills.relay.stop();
  }
});

test("a camera answering with an error status is a 502, not a broken picture", async () => {
  const camera = http.createServer((req, res) => {
    res.writeHead(401);
    res.end("no");
  });
  const cameraPort = await listen(camera);
  const { relay, url } = await relayFor({ mode: "mjpeg", url: `http://127.0.0.1:${cameraPort}/video` });
  try {
    assert.equal((await fetch(url)).status, 502);
  } finally {
    relay.stop();
    camera.close();
  }
});

test("at most four screens watch at once; the fifth is told to wait", async () => {
  const camera = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=cam" });
    const timer = setInterval(() => res.write("--cam\r\n\r\nx\r\n"), 50);
    res.on("close", () => clearInterval(timer));
  });
  const cameraPort = await listen(camera);
  const { relay, url } = await relayFor({ mode: "mjpeg", url: `http://127.0.0.1:${cameraPort}/video` });
  const open = [];
  try {
    for (let i = 0; i < 4; i += 1) {
      const controller = new AbortController();
      const res = await fetch(url, { signal: controller.signal });
      assert.equal(res.status, 200);
      open.push(controller);
    }
    const fifth = await fetch(url);
    assert.equal(fifth.status, 503);
    assert.equal(fifth.headers.get("retry-after"), "5");
    open.pop().abort();
    await wait(100);
    assert.equal((await (async () => { const c = new AbortController(); const r = await fetch(url, { signal: c.signal }); c.abort(); return r.status; })()), 200, "a free place is used again");
  } finally {
    open.forEach((controller) => controller.abort());
    relay.stop();
    camera.close();
  }
});

test("worker: the heartbeat carries the picture address of a camera, and only a camera", async () => {
  const sent = [];
  const client = { heartbeat: async (extra) => sent.push(extra), commands: async () => ({ commands: [] }), ack: async () => {} };
  const withPicture = new DeviceWorker({ serverUrl: "http://x", device, client, previewUrl: "http://127.0.0.1:8090/preview/abc" });
  await withPicture.heartbeatOnce();
  const without = new DeviceWorker({ serverUrl: "http://x", device: { ...device, name: "Other" }, client });
  await without.heartbeatOnce();
  assert.deepEqual(sent, [{ previewUrl: "http://127.0.0.1:8090/preview/abc" }, {}]);
});

test("agent: a camera with a preview block gets a relay and tells the cloud its address", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-agent-preview-"));
  const file = path.join(dir, "c.json");
  const write = (devices) => fs.writeFileSync(file, JSON.stringify({ serverUrl: "http://x", devices }));

  write([{ ...device, preview: { url: "http://192.168.1.64/video.mjpg", port: 8123 } }, { name: "B", type: "BARRIER", key: "hwk_abcdef0124", driver: "simulated" }]);
  const parts = build(loadConfig(file));
  const relay = parts.find((part) => part instanceof PreviewRelay);
  assert.ok(relay);
  assert.equal(relay.url, `http://127.0.0.1:8123/preview/${tokenFor(device.key)}`);
  const camera = parts.find((part) => part instanceof DeviceWorker && part.device.type === "ANPR_CAMERA");
  assert.equal(camera.previewUrl, relay.url);
  assert.equal(parts.find((part) => part instanceof DeviceWorker && part.device.type === "BARRIER").previewUrl, null);

  // Without a preview block nothing changes.
  write([device]);
  assert.equal(build(loadConfig(file)).filter((part) => part instanceof PreviewRelay).length, 0);

  // Mistakes are named in the message.
  write([{ name: "B", type: "BARRIER", key: "hwk_abcdef0124", driver: "simulated", preview: { url: "http://x/a" } }]);
  assert.throws(() => loadConfig(file), /"preview" is only for an ANPR_CAMERA/);
  write([{ ...device, preview: { url: "rtsp://192.168.1.64/stream" } }]);
  assert.throws(() => loadConfig(file), /http\(s\) address/);
});
