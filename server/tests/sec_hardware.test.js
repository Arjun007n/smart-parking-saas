// Security hardening for devices and files (no database): what read-only roles see of a device, which camera /
// picture addresses are accepted, the agent address, the per-device request limit, the per-company photo cap,
// backups and the photo purge script.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";
const os = require("os");
const fs = require("fs");
const path = require("path");
const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-photos-"));
process.env.PHOTO_STORAGE_DIR = photoDir;

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const hw = require("../services/hardwareService");
const anpr = require("../integrations/anpr");
const Hardware = require("../models/Hardware");
const AnprDetection = require("../models/AnprDetection");
const storage = require("../services/photoStorage");
const photoService = require("../services/photoService");
const deviceController = require("../controllers/deviceController");
const backup = require("../scripts/backup");
const purge = require("../scripts/purgePhotos");

test.after(() => fs.rmSync(photoDir, { recursive: true, force: true }));

const camera = () => new Hardware({
  companyId: new mongoose.Types.ObjectId(), locationId: new mongoose.Types.ObjectId(), name: "Cam", type: "ANPR_CAMERA",
  keyHash: "h", keyPrefix: "hwk_aaaa", lastIp: "10.1.2.3", isActive: true,
  config: { minConfidence: 0.9, previewUrl: "http://127.0.0.1:8090/preview/abcdef0123456789?x=1" },
});

test("SP-16: camera address and last IP are shown only when the caller may manage the location", () => {
  const device = camera();
  const hidden = hw.withStatus(device);
  assert.equal(hidden.lastIp, undefined);
  assert.equal(hidden.config.previewUrl, undefined);
  assert.equal(hidden.config.minConfidence, 0.9, "other settings stay");
  assert.equal(hidden.name, "Cam");
  assert.ok(hidden.status);
  assert.equal(hw.withStatus(device, new Date(), { reveal: false }).lastIp, undefined);

  const shown = hw.withStatus(device, new Date(), { reveal: true });
  assert.equal(shown.lastIp, "10.1.2.3");
  assert.match(shown.config.previewUrl, /^http:\/\/127\.0\.0\.1:8090\/preview\//);
  assert.equal(shown.keyHash, undefined, "the key hash is never shown");
  assert.ok(device.config.previewUrl, "the stored device is not changed");
});

test("SP-17: live picture address: https anywhere, http only on the local network", () => {
  const ok = [
    "http://127.0.0.1:8090/preview/0123456789abcdef", "http://localhost:8090/preview/ab", "http://192.168.1.50/video.mjpg",
    "http://10.0.0.7:8080/x", "http://172.16.5.5/x", "http://169.254.1.1/x", "http://camera1/stream", "http://cam.local/s",
    "https://cams.example.com/live?token=abc", "http://[::1]:8090/preview/ab", "HTTP://192.168.0.2/x",
  ];
  const bad = [
    "javascript:alert(1)", "data:text/html,hi", "ftp://192.168.1.2/x", "//evil.com/x", "http://evil.example.com/x", "http://8.8.8.8/x",
    "http://172.32.0.1/x", "", "   ", "http://", "https://", `https://a.com/${"x".repeat(300)}`, undefined, null, 5, {},
  ];
  for (const url of ok) assert.equal(anpr.isSafePreviewUrl(url), true, url);
  for (const url of bad) assert.equal(anpr.isSafePreviewUrl(url), false, String(url));
});

test("SP-17: PREVIEW_ALLOW_PUBLIC_HTTP lets plain http to a public address through again", () => {
  process.env.PREVIEW_ALLOW_PUBLIC_HTTP = "true";
  try {
    assert.equal(anpr.isSafePreviewUrl("http://cams.example.com/x"), true);
    assert.equal(anpr.isSafePreviewUrl("javascript:alert(1)"), false);
  } finally {
    delete process.env.PREVIEW_ALLOW_PUBLIC_HTTP;
  }
});

test("SP-17: a detection's picture address is kept only when it is http(s)", () => {
  assert.equal(anpr.safeImageUrl("https://cam.example.com/a.jpg"), "https://cam.example.com/a.jpg");
  assert.equal(anpr.safeImageUrl("http://192.168.1.2/a.jpg"), "http://192.168.1.2/a.jpg");
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "file:///etc/passwd", "ftp://x/y", "", 7, null, undefined, "https://a b"]) {
    assert.equal(anpr.safeImageUrl(bad), undefined, String(bad));
  }
  const parsed = anpr.parseDetection({ plate: "MH12AB1234", confidence: 0.99, imageUrl: "javascript:alert(1)" });
  assert.equal(parsed.imageUrl, undefined, "the detection still counts, only the link is dropped");
  assert.equal(parsed.plate, "MH12AB1234");
  assert.equal(anpr.parseDetection({ plate: "MH12AB1234", imageUrl: "https://x.test/p.jpg" }).imageUrl, "https://x.test/p.jpg");
  // And the model refuses to store one that slipped through some other way.
  assert.equal(new AnprDetection({ imageUrl: "javascript:alert(1)" }).imageUrl, undefined);
  assert.equal(new AnprDetection({ imageUrl: "https://x.test/p.jpg" }).imageUrl, "https://x.test/p.jpg");
});

test("SP-39: the gate agent is configured with PUBLIC_API_URL; the Host header is trusted outside production only", () => {
  const url = hw.agentServerUrl;
  const prodNoUrl = url({ configured: "", host: "evil.test", protocol: "http", isProduction: true });
  assert.match(prodNoUrl.error, /PUBLIC_API_URL/);
  assert.equal(prodNoUrl.url, undefined);
  assert.deepEqual(url({ configured: "https://api.example.com/", host: "evil.test", protocol: "http", isProduction: true }), { url: "https://api.example.com" });
  assert.deepEqual(url({ configured: "http://api.example.com", host: "", protocol: "http", isProduction: true }), { url: "https://api.example.com" }, "http becomes https in production");
  assert.deepEqual(url({ configured: "http://localhost:5000", host: "", protocol: "http", isProduction: true }), { url: "http://localhost:5000" });
  assert.deepEqual(url({ configured: "http://127.0.0.1:5000", host: "", protocol: "http", isProduction: true }), { url: "http://127.0.0.1:5000" });
  // Development keeps working as before.
  assert.deepEqual(url({ configured: "", host: "192.168.1.9:5000", protocol: "http", isProduction: false }), { url: "http://192.168.1.9:5000" });
  assert.deepEqual(url({ configured: "", host: "bad host!", protocol: "http", isProduction: false }), { url: "http://localhost:5000" });
  assert.deepEqual(url({ configured: "http://192.168.1.9:5000", host: "", protocol: "http", isProduction: false }), { url: "http://192.168.1.9:5000" });
});

test("SP-47: a device may send its quota per minute, then gets 429, and the bucket refills", () => {
  let clock = 1_000_000;
  const quota = deviceController.makeQuota(120, () => clock);
  const device = { _id: "dev-1" };
  const call = (d = device) => {
    const out = { headers: {}, err: null, passed: false };
    quota({ device: d }, { set: (k, v) => { out.headers[k] = v; } }, (e) => { out.err = e || null; out.passed = !e; });
    return out;
  };
  for (let i = 0; i < 120; i += 1) assert.equal(call().passed, true, `request ${i}`);
  const refused = call();
  assert.equal(refused.passed, false);
  assert.equal(refused.err.statusCode, 429);
  assert.ok(Number(refused.headers["Retry-After"]) >= 1);
  assert.equal(call({ _id: "dev-2" }).passed, true, "another device is not affected");
  clock += 10_000; // 10 s = 20 requests
  for (let i = 0; i < 20; i += 1) assert.equal(call().passed, true);
  assert.equal(call().passed, false);
  clock += 120_000;
  assert.equal(call().passed, true);
  // A request with no device (not expected here) is not blocked by the quota itself.
  let passed = false;
  quota({}, { set() {} }, () => { passed = true; });
  assert.equal(passed, true);
});

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const COMPANY = "507f1f77bcf86cd799439011";
const OTHER = "507f1f77bcf86cd799439012";

test("SP-48: a company's photo storage is capped (413) and other companies are not affected", async () => {
  process.env.PHOTO_MAX_PER_COMPANY_MB = String(5000 / 1048576); // 5000 bytes
  photoService.clearUsageCache();
  try {
    assert.equal(photoService.companyCapBytes(), 5000);
    const k1 = await storage.save(COMPANY, jpeg, "jpg");
    const k2 = await storage.save(COMPANY, jpeg, "jpg");
    assert.equal(await storage.usageBytes(COMPANY), 4008);
    await assert.rejects(() => storage.save(COMPANY, jpeg, "jpg"), (e) => e.statusCode === 413 && /storage is full/.test(e.message));
    assert.equal(await storage.usageBytes(COMPANY), 4008, "nothing was written");
    await storage.save(OTHER, jpeg, "jpg"); // another company has its own room
    // Space freed by removing a photo is counted again once the minute-long cache is refreshed.
    await storage.remove(k1);
    photoService.clearUsageCache();
    await storage.save(COMPANY, jpeg, "jpg");
    await storage.remove(k2);
  } finally {
    delete process.env.PHOTO_MAX_PER_COMPANY_MB;
    photoService.clearUsageCache();
  }
});

test("SP-48: the default cap is 5000 MB and 0 means no limit", () => {
  delete process.env.PHOTO_MAX_PER_COMPANY_MB;
  assert.equal(photoService.companyCapBytes(), 5000 * 1024 * 1024);
  process.env.PHOTO_MAX_PER_COMPANY_MB = "0";
  assert.equal(photoService.companyCapBytes(), 0);
  delete process.env.PHOTO_MAX_PER_COMPANY_MB;
});

test("SP-48: the purge script deletes nothing unless --apply is given, and checks its options", () => {
  assert.deepEqual(purge.parseArgs([]), { days: 90, apply: false, company: undefined });
  assert.deepEqual(purge.parseArgs(["--days", "30", "--apply", "--company", COMPANY]), { days: 30, apply: true, company: COMPANY });
  assert.throws(() => purge.parseArgs(["--days", "0"]));
  assert.throws(() => purge.parseArgs(["--days", "x"]));
  assert.throws(() => purge.parseArgs(["--company", "nope"]));
  assert.throws(() => purge.parseArgs(["--delete-everything"]));
});

test("SP-23: backups skip one-time codes and drop password-reset tokens", () => {
  assert.ok(backup.SKIP_COLLECTIONS.includes("otps"));
  const user = { _id: 1, email: "a@b.c", password: "$2a$hash", passwordResetToken: "t", passwordResetExpires: new Date(), tokenVersion: 2 };
  const out = backup.scrub("users", user);
  assert.equal(out.passwordResetToken, undefined);
  assert.equal(out.passwordResetExpires, undefined);
  assert.equal(out.password, "$2a$hash", "the account itself is kept so a restore works");
  assert.equal(out.tokenVersion, 2);
  assert.ok(user.passwordResetToken, "the original is not changed");
  const other = { _id: 2, passwordResetToken: "keep" };
  assert.equal(backup.scrub("hardwares", other), other);
});

test("SP-23: the backup script creates private folders and files, and restore tolerates a missing collection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "backup.js"), "utf8");
  assert.match(source, /mode: 0o700/);
  assert.match(source, /mode: 0o600/);
  // restore.js only restores what the manifest lists, so a skipped collection is simply absent.
  const restore = fs.readFileSync(path.join(__dirname, "..", "scripts", "restore.js"), "utf8");
  assert.match(restore, /Object\.entries\(manifest\.collections\)/);
});

// ---- controllers, with the database calls replaced ----

const hardwareController = require("../controllers/hardwareController");
const subscriptions = require("../services/subscriptionService");

const fakeRes = () => {
  const res = { body: null, code: 200 };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = () => res;
  return res;
};
const asUser = (permissions, extra = {}) => ({
  user: { _id: "u1", role: "LOCATION_ADMIN", locationIds: ["507f1f77bcf86cd799439099"] },
  permissions, tenantFilter: { companyId: "c1" }, params: { id: "507f1f77bcf86cd799439055" }, query: {}, body: {}, ...extra,
});

test("SP-16: the device list hides the camera address from read-only roles, keeps it for managers", async () => {
  const original = Hardware.find;
  Hardware.find = () => ({ sort: () => ({ limit: async () => [camera()] }) });
  try {
    const viewer = fakeRes();
    await hardwareController.listDevices(asUser(["REPORT_VIEW"]), viewer);
    assert.equal(viewer.body.data[0].config.previewUrl, undefined);
    assert.equal(viewer.body.data[0].lastIp, undefined);
    assert.equal(viewer.body.data[0].name, "Cam");
    const manager = fakeRes();
    await hardwareController.listDevices(asUser(["REPORT_VIEW", "LOCATION_MANAGE"]), manager);
    assert.ok(manager.body.data[0].config.previewUrl);
    assert.equal(manager.body.data[0].lastIp, "10.1.2.3");
  } finally {
    Hardware.find = original;
  }
});

test("SP-17: a bad live picture address is refused with a clear 400 when a device is edited", async () => {
  const original = Hardware.findOne;
  Hardware.findOne = async () => camera();
  try {
    const req = asUser(["LOCATION_MANAGE"], { body: { config: { previewUrl: "http://evil.example.com/x" } } });
    await assert.rejects(() => hardwareController.updateDevice(req, fakeRes()), (e) => e.statusCode === 400 && /live picture address/.test(e.message));
    const create = asUser(["LOCATION_MANAGE"], { body: { locationId: "507f1f77bcf86cd799439099", name: "x", type: "ANPR_CAMERA", config: { previewUrl: "javascript:alert(1)" } } });
    await assert.rejects(() => hardwareController.createDevice(create, fakeRes()), (e) => e.statusCode === 400);
  } finally {
    Hardware.findOne = original;
  }
});

test("SP-20: switching a device back on is checked against the add-on limit like adding it", async () => {
  const originalFind = Hardware.findOne;
  const originalCount = Hardware.countDocuments;
  const originalAssert = subscriptions.assertAddon;
  const calls = [];
  const off = camera();
  off.isActive = false;
  off.save = async () => off;
  Hardware.findOne = async () => off;
  Hardware.countDocuments = async () => 1; // one other camera is already on
  subscriptions.assertAddon = async (companyId, locationId, key, need) => {
    calls.push({ key, need });
    if (need > 1) { const e = new Error("This location's subscription includes 1 ANPR camera."); e.statusCode = 403; throw e; }
  };
  try {
    const req = asUser(["LOCATION_MANAGE"], { body: { isActive: true } });
    await assert.rejects(() => hardwareController.updateDevice(req, fakeRes()), (e) => e.statusCode === 403);
    assert.deepEqual(calls, [{ key: "anpr", need: 2 }]);
    assert.equal(off.isActive, false, "still off");

    // Switching off, or editing a device that stays on, is not checked.
    calls.length = 0;
    const on = camera();
    on.save = async () => on;
    Hardware.findOne = async () => on;
    await hardwareController.updateDevice(asUser(["LOCATION_MANAGE"], { body: { isActive: true, name: "Renamed" } }), fakeRes());
    await hardwareController.updateDevice(asUser(["LOCATION_MANAGE"], { body: { isActive: false } }), fakeRes());
    assert.deepEqual(calls, []);

    // A device type without an add-on limit is never checked.
    const barrier = camera();
    barrier.type = "BARRIER";
    barrier.isActive = false;
    barrier.save = async () => barrier;
    Hardware.findOne = async () => barrier;
    await hardwareController.updateDevice(asUser(["LOCATION_MANAGE"], { body: { isActive: true } }), fakeRes());
    assert.deepEqual(calls, []);
  } finally {
    Hardware.findOne = originalFind;
    Hardware.countDocuments = originalCount;
    subscriptions.assertAddon = originalAssert;
  }
});

test("SP-17: a heartbeat only changes the camera address to a safe one", async () => {
  const original = Hardware.updateOne;
  const writes = [];
  Hardware.updateOne = async (...args) => { writes.push(args); };
  const beat = async (previewUrl) => {
    const device = camera();
    device.config.previewUrl = "http://127.0.0.1:8090/preview/old";
    const res = fakeRes();
    await deviceController.heartbeat({ device, body: { previewUrl } }, res);
    assert.equal(res.body.success, true, "the heartbeat itself always works");
  };
  try {
    await beat("javascript:alert(1)");
    await beat("http://evil.example.com/x");
    assert.equal(writes.length, 0);
    await beat("http://127.0.0.1:8090/preview/0123456789abcdef");
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].$set["config.previewUrl"], "http://127.0.0.1:8090/preview/0123456789abcdef");
  } finally {
    Hardware.updateOne = original;
  }
});
