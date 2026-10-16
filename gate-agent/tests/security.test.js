// Security hardening: listener bind + secret, preview token salt + CORS, https-only serverUrl.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AnprListener } = require("../lib/anprListener");
const { ReaderListener } = require("../lib/readerListener");
const { PreviewRelay, normalize, tokenFor } = require("../lib/previewRelay");
const { checkServerUrl } = require("../lib/api");
const { isLoopback, safeEqual } = require("../lib/util");
const { loadConfig } = require("../agent");

const quiet = { info() {}, warn() {}, error() {} };
const fakeClient = () => ({ plate: async () => ({}), rfid: async () => ({}), fastag: async () => ({}) });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const camera = (options) => ({ name: "Cam", key: "hwk_x", type: "ANPR_CAMERA", driver: "listener", options });
const reader = (options) => ({ name: "Rfid", key: "hwk_x", type: "RFID_READER", driver: "listener", options });

// Starts a real listener on a free port and returns its address.
const startListener = async (listener) => {
  listener.log = quiet;
  listener.start();
  await new Promise((resolve) => listener.server.once("listening", resolve));
  return listener.server.address();
};

test("listeners: bind defaults to 127.0.0.1 and the server really listens there", async () => {
  const anpr = new AnprListener({ serverUrl: "http://localhost:5000", client: fakeClient(), device: camera({ port: 0 }) });
  assert.equal(anpr.options.bind, "127.0.0.1");
  const rfid = new ReaderListener({ serverUrl: "http://localhost:5000", client: fakeClient(), kind: "rfid", device: reader({ port: 0 }) });
  assert.equal(rfid.options.bind, "127.0.0.1");
  for (const listener of [anpr, rfid]) {
    const address = await startListener(listener);
    assert.equal(address.address, "127.0.0.1");
    listener.stop();
  }
});

test("listeners: a network-wide bind without a secret is refused with a clear message", () => {
  for (const bind of ["0.0.0.0", "192.168.1.10", "::"]) {
    assert.throws(() => new AnprListener({ serverUrl: "http://localhost:5000", client: fakeClient(), device: camera({ bind }) }), /options\.secret is not set/);
    assert.throws(
      () => new ReaderListener({ serverUrl: "http://localhost:5000", client: fakeClient(), kind: "fastag", device: reader({ bind }) }),
      /options\.secret is not set/
    );
  }
  // With a secret it is accepted; loopback needs none.
  assert.equal(new AnprListener({ serverUrl: "http://localhost:5000", client: fakeClient(), device: camera({ bind: "0.0.0.0", secret: "s" }) }).options.bind, "0.0.0.0");
  assert.equal(new AnprListener({ serverUrl: "http://localhost:5000", client: fakeClient(), device: camera({ bind: "127.0.0.1" }) }).options.bind, "127.0.0.1");
  // A reader that does not listen (tcp / serial) is not affected by bind.
  assert.doesNotThrow(() => new ReaderListener({ serverUrl: "http://localhost:5000", client: fakeClient(), kind: "rfid", device: { ...reader({ bind: "0.0.0.0" }), driver: "tcp" } }));
});

test("listeners: the secret is accepted from the x-agent-secret header and from ?secret=, a wrong one is 401", async () => {
  const anpr = new AnprListener({ serverUrl: "http://localhost:5000", client: fakeClient(), device: camera({ port: 0, secret: "s3cret-value" }) });
  const rfid = new ReaderListener({ serverUrl: "http://localhost:5000", client: fakeClient(), kind: "rfid", device: reader({ port: 0, secret: "s3cret-value", debounceMs: 0 }) });
  for (const [listener, p, body] of [[anpr, "/anpr", { plate: "MH12AB1234" }], [rfid, "/rfid", { tag: "AB12" }]]) {
    const { port } = await startListener(listener);
    const post = (query, headers = {}) =>
      fetch(`http://127.0.0.1:${port}${p}${query}`, { method: "POST", body: JSON.stringify(body), headers });
    assert.equal((await post("")).status, 401, "no secret");
    assert.equal((await post("?secret=wrong")).status, 401, "wrong query secret");
    assert.equal((await post("", { "x-agent-secret": "wrong" })).status, 401, "wrong header secret");
    assert.equal((await post("", { "x-agent-secret": "s3cret-valuX" })).status, 401, "same length, one character off");
    assert.equal((await post("", { "x-agent-secret": "s3cret-value-and-more" })).status, 401, "longer");
    assert.equal((await post("", { "x-agent-secret": "" })).status, 401, "empty header");
    assert.equal((await post("", { "x-agent-secret": "s3cret-value" })).status, 202, "header secret");
    assert.equal((await post("?secret=s3cret-value")).status, 202, "query secret (cameras that cannot set headers)");
    assert.equal((await post("?secret=wrong", { "x-agent-secret": "s3cret-value" })).status, 202, "header wins over a bad query");
    listener.stop();
  }
});

test("util: isLoopback and safeEqual", () => {
  assert.ok(isLoopback("127.0.0.1") && isLoopback("127.1.2.3") && isLoopback("localhost") && isLoopback("::1") && isLoopback("[::1]"));
  assert.ok(!isLoopback("0.0.0.0") && !isLoopback("::") && !isLoopback("192.168.1.2") && !isLoopback("127.0.0.1.evil.com"));
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd") && !safeEqual("abc", "abcd"));
});

test("preview: the token changes with the per-process salt, is stable inside one process, and is not the old fixed value", () => {
  assert.equal(tokenFor("hwk_one"), tokenFor("hwk_one"));
  assert.notEqual(tokenFor("hwk_one", "salt-a"), tokenFor("hwk_one", "salt-b"));
  assert.match(tokenFor("hwk_one", "salt-a"), /^[0-9a-f]{32}$/);
  const crypto = require("crypto");
  const oldToken = crypto.createHmac("sha256", "hwk_one").update("preview-v1").digest("hex").slice(0, 32);
  assert.notEqual(tokenFor("hwk_one"), oldToken);
  // A second agent process gets another token: simulate by loading the module afresh.
  const file = require.resolve("../lib/previewRelay");
  delete require.cache[file];
  const fresh = require("../lib/previewRelay");
  assert.notEqual(fresh.tokenFor("hwk_one"), tokenFor("hwk_one"));
});

test("preview: no CORS header by default; only a listed Origin is echoed; <img> loading needs none", async () => {
  const cam = http.createServer((req, res) => { res.writeHead(200, { "content-type": "image/jpeg" }); res.end("x"); });
  await new Promise((resolve) => cam.listen(0, "127.0.0.1", resolve));
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const device = { name: "Cam", key: "hwk_abcdef0123456789", type: "ANPR_CAMERA" };
  const relay = new PreviewRelay({
    device, options: { mode: "snapshot", url: `http://127.0.0.1:${cam.address().port}/s.jpg`, port, intervalMs: 200, previewOrigins: ["https://parking.example.com"] },
  });
  relay.log = quiet;
  relay.start();
  await wait(50);
  try {
    const get = async (origin) => {
      const controller = new AbortController();
      const res = await fetch(relay.url, { headers: origin ? { origin } : {}, signal: controller.signal });
      const headers = { allow: res.headers.get("access-control-allow-origin"), vary: res.headers.get("vary"), status: res.status };
      controller.abort();
      return headers;
    };
    assert.deepEqual(await get(""), { allow: null, vary: null, status: 200 }, "a plain <img> request: no CORS header");
    assert.equal((await get("https://evil.example")).allow, null);
    assert.equal((await get("https://parking.example.com")).allow, "https://parking.example.com");
    assert.equal((await get("https://parking.example.com")).vary, "Origin");
    const preflight = await fetch(relay.url, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    const wrong = await fetch(`${relay.url}x`, { headers: { origin: "https://evil.example" } });
    assert.equal(wrong.status, 404);
    assert.equal(wrong.headers.get("access-control-allow-origin"), null);
  } finally {
    relay.stop();
    cam.close();
  }
});

test("preview: previewOrigins is validated and defaults to none", () => {
  assert.deepEqual(normalize({ url: "http://x/a" }).previewOrigins, []);
  assert.deepEqual(normalize({ url: "http://x/a", previewOrigins: "https://A.example" }).previewOrigins, ["https://a.example"]);
  assert.throws(() => normalize({ url: "http://x/a", previewOrigins: ["https://a.example/path"] }), /previewOrigins/);
  assert.throws(() => normalize({ url: "http://x/a", previewOrigins: ["*"] }), /previewOrigins/);
});

test("serverUrl: https, localhost and private LAN addresses are accepted; plain http to the internet is refused", () => {
  for (const ok of [
    "https://parking.example.com", "https://example.com:8443/", "http://localhost:5000", "http://127.0.0.1:5000", "http://[::1]:5000",
    "http://192.168.1.20:5000", "http://10.0.0.5", "http://172.16.0.1", "http://172.31.255.1", "http://server.local:5000",
  ]) assert.doesNotThrow(() => checkServerUrl(ok, {}), ok);
  for (const bad of ["http://example.com", "http://8.8.8.8:5000", "http://172.32.0.1", "http://192.169.1.1", "http://localhost.evil.com", "ftp://localhost", "not a url", "http://x"]) {
    assert.throws(() => checkServerUrl(bad, {}), /serverUrl/, bad);
  }
  assert.throws(() => checkServerUrl("http://example.com", {}), /GATE_AGENT_ALLOW_HTTP=1/, "the message says how to override");
  assert.doesNotThrow(() => checkServerUrl("http://example.com", { GATE_AGENT_ALLOW_HTTP: "1" }));
  assert.throws(() => checkServerUrl("http://example.com", { GATE_AGENT_ALLOW_HTTP: "yes" }), /serverUrl/);
});

test("config: loadConfig refuses an insecure serverUrl with a clear error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-agent-sec-"));
  const file = path.join(dir, "c.json");
  const write = (serverUrl) => fs.writeFileSync(file, JSON.stringify({ serverUrl, devices: [{ name: "B", type: "BARRIER", key: "hwk_abcdef0124", driver: "simulated" }] }));
  write("http://parking.example.com");
  assert.throws(() => loadConfig(file), /not allowed.*https/s);
  write("https://parking.example.com");
  assert.equal(loadConfig(file).serverUrl, "https://parking.example.com");
  write("http://192.168.0.9:5000");
  assert.ok(loadConfig(file));
});
