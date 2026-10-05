// Vehicle photos through the API: upload, access control, limits, deletion and clean-up.
// Needs MongoDB (see tests/helpers.js).
const os = require("os");
const fs = require("fs");
const path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-it-"));
process.env.PHOTO_STORAGE_DIR = dir;
process.env.PHOTO_MAX_BYTES = String(100 * 1024);

const test = require("node:test");
const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const AuditLog = require("../models/AuditLog");
const photoService = require("../services/photoService");
const storage = require("../services/photoStorage");

setup();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const s = {};
const jpeg = (size = 2000, fill = 7) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, fill), Buffer.from([0xff, 0xd9])]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 3)]);
const upload = (session, body, { token = s.entryToken, type = "image/jpeg", kind = "ENTRY" } = {}) =>
  bytes("POST", `/api/parking/sessions/${session._id}/photos${kind ? `?kind=${kind}` : ""}`, { token, headers: { "content-type": type }, body });
const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(jpg|png|webp)$/.test(f)) : []);
const asJson = (res) => JSON.parse(res.buffer.toString("utf8"));
const enter = async (loc, vehicleNumber, token = s.entryToken) => {
  const res = await api("POST", "/api/parking/entry", { token, body: { locationId: loc._id, vehicleNumber, vehicleType: "CAR" } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.session;
};

it("setup: a company with two locations, gate staff and a location admin", async () => {
  s.a = await registerCompany("pha");
  s.b = await registerCompany("phb");
  const make = async (name) => {
    const res = await api("POST", "/api/locations", { token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
  };
  s.main = await make("Main");
  s.annex = await make("Annex");
  const staff = (name, email, role, ids) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds: ids } });
  await staff("Gate", "ph-entry@example.com", "ENTRY_OPERATOR", [s.main._id]);
  await staff("Exit", "ph-exit@example.com", "EXIT_OPERATOR", [s.main._id]);
  await staff("Collector", "ph-collect@example.com", "COLLECTION_OPERATOR", [s.main._id]);
  await staff("Site", "ph-site@example.com", "LOCATION_ADMIN", [s.main._id]);
  s.entryToken = await login("ph-entry@example.com");
  s.exitToken = await login("ph-exit@example.com");
  s.collectToken = await login("ph-collect@example.com");
  s.site = await login("ph-site@example.com");
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.main._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  s.session = await enter(s.main, "RJ14PH0001");
});

it("photo: a real picture is stored, listed on the ticket, and its file name is never shown", async () => {
  const picture = jpeg(5000, 9);
  const res = await upload(s.session, picture);
  assert.equal(res.status, 201, res.buffer.toString());
  const body = asJson(res);
  assert.equal(body.data.photo.kind, "ENTRY");
  assert.equal(body.data.photo.contentType, "image/jpeg");
  assert.equal(body.data.photo.bytes, picture.length);
  assert.equal(body.data.photo.file, undefined);
  assert.ok(!res.buffer.toString().includes(".jpg"), "no file name in the answer");
  assert.equal(files().length, 1);
  s.photo = body.data.photo;

  const ticket = await api("GET", `/api/parking/sessions/${s.session._id}`, { token: s.entryToken });
  assert.equal(ticket.body.data.photos.length, 1);
  assert.equal(ticket.body.data.photos[0].file, undefined);
  assert.ok(!JSON.stringify(ticket.body).includes(".jpg"));
});

it("photo: it comes back byte for byte, as a picture only, to staff of that location", async () => {
  const got = await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/${s.photo._id}`, { token: s.exitToken });
  assert.equal(got.status, 200);
  assert.ok(got.buffer.equals(jpeg(5000, 9)));
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("content-security-policy"), /sandbox/);
  assert.match(got.headers.get("cache-control"), /private/);

  for (const token of [s.entryToken, s.collectToken, s.site, s.a.token]) {
    assert.equal((await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/${s.photo._id}`, { token })).status, 200);
  }
  assert.equal((await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/${s.photo._id}`)).status, 401, "not signed in");
  assert.equal((await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/${s.photo._id}`, { token: s.b.token })).status, 404, "another company");
  assert.equal((await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/507f1f77bcf86cd799439011`, { token: s.exitToken })).status, 404);
  assert.equal((await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/not-an-id`, { token: s.exitToken })).status, 400);
});

it("photo: staff of another location cannot see or add photos", async () => {
  const other = await enter(s.annex, "RJ14PH0002", s.a.token);
  assert.equal((await upload(other, jpeg(), { token: s.entryToken })).status, 404, "Main staff, Annex ticket");
  assert.equal((await upload(other, jpeg(), { token: s.site })).status, 404);
  assert.equal((await upload(other, jpeg(), { token: s.a.token })).status, 201, "the company admin can");
  assert.equal(files().length, 2);
  assert.equal((await upload(s.session, jpeg(), { token: s.collectToken })).status, 403, "collection staff only look");
});

it("photo: anything that is not a JPEG, PNG or WebP is refused, whatever it claims to be", async () => {
  const before = files().length;
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  const html = Buffer.from("<html><body>hello hello hello</body></html>");
  assert.equal((await upload(s.session, svg, { type: "image/png" })).status, 415, "an SVG called a PNG");
  assert.equal((await upload(s.session, html, { type: "image/jpeg" })).status, 415, "HTML called a JPEG");
  assert.equal((await upload(s.session, png, { type: "image/jpeg" })).status, 415, "a PNG called a JPEG");
  assert.equal((await upload(s.session, jpeg(), { type: "image/svg+xml" })).status, 415, "an SVG content type");
  assert.equal((await upload(s.session, jpeg(), { type: "application/octet-stream" })).status, 415, "an unlisted content type");
  assert.equal((await upload(s.session, Buffer.alloc(0))).status, 415, "empty");
  assert.equal((await upload(s.session, jpeg(), { kind: "SELFIE" })).status, 400, "unknown kind");
  assert.equal(files().length, before, "nothing was stored");
});

it("photo: a PNG is fine; too large is refused", async () => {
  const ok = await upload(s.session, png, { type: "image/png", kind: "EXIT" });
  assert.equal(ok.status, 201, ok.buffer.toString());
  assert.equal(asJson(ok).data.photo.contentType, "image/png");
  s.png = asJson(ok).data.photo;

  const big = await upload(s.session, jpeg(150 * 1024)); // limit is 100 KB in this test
  assert.equal(big.status, 413);
  const stored = await ParkingSession.findById(s.session._id);
  assert.equal(stored.photos.length, 2);
});

it("photo: a ticket holds only so many; the extra file is not left behind", async () => {
  const session = await enter(s.main, "RJ14PH0003");
  for (let i = 0; i < photoService.MAX_PHOTOS; i += 1) {
    assert.equal((await upload(session, jpeg(1000 + i))).status, 201);
  }
  const before = files().length;
  const extra = await upload(session, jpeg(3000));
  assert.equal(extra.status, 409);
  assert.equal(files().length, before, "the rejected picture was not kept on disk");
  assert.equal((await ParkingSession.findById(session._id)).photos.length, photoService.MAX_PHOTOS);

  // Several uploads at once cannot slip past the limit either.
  const racing = await enter(s.main, "RJ14PH0004");
  const results = await Promise.all(Array.from({ length: photoService.MAX_PHOTOS + 3 }, (_, i) => upload(racing, jpeg(1200 + i))));
  assert.equal(results.filter((r) => r.status === 201).length, photoService.MAX_PHOTOS);
  assert.equal((await ParkingSession.findById(racing._id)).photos.length, photoService.MAX_PHOTOS);
  assert.equal(files().filter(Boolean).length, before + photoService.MAX_PHOTOS, "no stray files from the refused ones");
});

it("receipt: lists the pictures (ids only)", async () => {
  const out = await api("POST", "/api/parking/exit", { token: s.exitToken, body: { locationId: s.main._id, ticketNumber: s.session.ticketNumber } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.data.paymentRequired, false, "inside the grace period: free");
  const receipt = await api("GET", `/api/parking/sessions/${s.session._id}/receipt`, { token: s.exitToken });
  assert.equal(receipt.body.data.photos.length, 2);
  assert.deepEqual(receipt.body.data.photos.map((p) => p.kind).sort(), ["ENTRY", "EXIT"]);
  assert.ok(receipt.body.data.photos.every((p) => p._id && !p.file));
  // A picture can still be added after the vehicle has left (the exit photo).
  assert.equal((await upload(s.session, jpeg(1500), { token: s.exitToken, kind: "EXIT" })).status, 201);
});

it("photo: only admins delete one, and it is audited and removed from disk", async () => {
  const base = `/api/parking/sessions/${s.session._id}/photos/${s.png._id}`;
  assert.equal((await api("DELETE", base, { token: s.exitToken })).status, 403);
  assert.equal((await api("DELETE", base, { token: s.b.token })).status, 404);
  const before = files().length;
  const res = await api("DELETE", base, { token: s.site });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(files().length, before - 1);
  assert.equal(res.body.data.photos.every((p) => String(p._id) !== s.png._id), true);
  assert.equal((await bytes("GET", base, { token: s.a.token })).status, 404);
  assert.equal((await api("DELETE", base, { token: s.site })).status, 404, "already gone");
  assert.equal(await AuditLog.countDocuments({ companyId: s.a.company._id, action: "PHOTO_DELETED" }), 1);
});

it("clean-up: pictures older than the retention period are deleted, newer ones and open visits are kept", async () => {
  const old = await enter(s.main, "RJ14PH0005");
  const recent = await enter(s.main, "RJ14PH0006");
  const open = await enter(s.main, "RJ14PH0007");
  for (const session of [old, recent, open]) assert.equal((await upload(session, jpeg(900))).status, 201);
  for (const session of [old, recent]) {
    assert.equal((await api("POST", "/api/parking/exit", { token: s.exitToken, body: { locationId: s.main._id, ticketNumber: session.ticketNumber } })).status, 200);
  }
  const longAgo = new Date(Date.now() - 100 * 86400000);
  // Photos' own dates are edited at the source (they are inside the session record).
  for (const session of [old, open]) {
    await ParkingSession.collection.updateOne({ _id: new (require("mongoose").Types.ObjectId)(session._id) }, { $set: { "photos.$[].takenAt": longAgo } });
  }
  const oldFile = (await ParkingSession.findById(old._id)).photos[0].file;
  assert.ok(fs.existsSync(storage.pathFor(oldFile)), "the file exists before");

  const result = await photoService.purgeExpired();
  assert.equal(result.removed, 1);
  assert.equal((await ParkingSession.findById(old._id)).photos.length, 0);
  assert.equal(fs.existsSync(storage.pathFor(oldFile)), false, "the file is gone");
  assert.equal((await ParkingSession.findById(recent._id)).photos.length, 1);
  assert.equal((await ParkingSession.findById(open._id)).photos.length, 1, "a vehicle still inside keeps its pictures");
  assert.equal((await photoService.purgeExpired()).removed, 0, "nothing left to do");
});
