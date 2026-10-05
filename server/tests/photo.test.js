const os = require("os");
const fs = require("fs");
const path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-"));
process.env.PHOTO_STORAGE_DIR = dir;

const test = require("node:test");
const assert = require("node:assert/strict");
const storage = require("../services/photoStorage");
const photoService = require("../services/photoService");
const ParkingSession = require("../models/ParkingSession");

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20)]);
const COMPANY = "507f1f77bcf86cd799439011";

test("photo type is read from the bytes, not from what the sender claims", () => {
  assert.deepEqual(storage.detectType(jpeg), { ext: "jpg", contentType: "image/jpeg" });
  assert.deepEqual(storage.detectType(png), { ext: "png", contentType: "image/png" });
  assert.deepEqual(storage.detectType(webp), { ext: "webp", contentType: "image/webp" });
  for (const bad of [
    Buffer.from("GIF89a" + "x".repeat(30)), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    Buffer.from("<html><script>alert(1)</script></html>"), Buffer.from("%PDF-1.4 ......"), Buffer.alloc(5, 0xff), Buffer.alloc(0), "text", null,
  ]) {
    assert.equal(storage.detectType(bad), null);
  }
  // RIFF but not WEBP (a WAV file, for example).
  assert.equal(storage.detectType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(20)])), null);
});

test("storage: save, open, remove; files are never overwritten and live inside the folder", async () => {
  const key = await storage.save(COMPANY, jpeg, "jpg");
  assert.match(key, storage.KEY_PATTERN);
  assert.ok(key.startsWith(`${COMPANY}/`));
  assert.ok(storage.pathFor(key).startsWith(dir));

  const opened = await storage.open(key);
  assert.equal(opened.size, jpeg.length);
  const chunks = [];
  for await (const chunk of opened.stream) chunks.push(chunk);
  assert.ok(Buffer.concat(chunks).equals(jpeg));

  const other = await storage.save(COMPANY, jpeg, "jpg");
  assert.notEqual(other, key, "every picture has its own name");

  await storage.remove(key);
  assert.equal(await storage.open(key), null);
  await storage.remove(key); // removing twice is fine
  const still = await storage.open(other);
  assert.ok(still);
  for await (const chunk of still.stream) assert.ok(chunk.length > 0); // read it to the end so nothing is left open
});

test("storage: a key that is not one of ours is never turned into a path", async () => {
  for (const bad of [
    "../../etc/passwd", `${COMPANY}/202603/../../../x.jpg`, "/etc/passwd", `${COMPANY}/202603/${"a".repeat(32)}.exe`,
    `${COMPANY.toUpperCase()}/202603/${"a".repeat(32)}.jpg`, `${COMPANY}/202603/${"a".repeat(31)}.jpg`, "", null, undefined, 42, `${COMPANY}\\202603\\${"a".repeat(32)}.jpg`,
  ]) {
    assert.equal(storage.pathFor(bad), null, String(bad));
    assert.equal(await storage.open(bad), null);
    await storage.remove(bad); // quietly does nothing
  }
});

test("a session's photo file name never reaches the client", () => {
  const session = new ParkingSession({
    companyId: COMPANY, locationId: COMPANY, ticketNumber: "T-260302-AAAAAA", vehicleNumber: "RJ14AB1234", vehicleType: "CAR",
    photos: [{ kind: "ENTRY", file: `${COMPANY}/202603/${"a".repeat(32)}.jpg`, contentType: "image/jpeg", bytes: 10 }],
  });
  const text = JSON.stringify({ data: session });
  assert.ok(!text.includes("202603/"), "no file name in the JSON");
  assert.ok(!text.includes('"file"'));
  assert.equal(JSON.parse(text).data.photos[0].kind, "ENTRY");
  assert.ok(session.photos[0].file, "still on the server-side record");
});

test("photo limits: the size limit stays in a safe range", () => {
  const saved = process.env.PHOTO_MAX_BYTES;
  try {
    delete process.env.PHOTO_MAX_BYTES;
    assert.equal(photoService.maxBytes(), 1.5 * 1024 * 1024);
    process.env.PHOTO_MAX_BYTES = "999999999999";
    assert.equal(photoService.maxBytes(), 8 * 1024 * 1024);
    process.env.PHOTO_MAX_BYTES = "10";
    assert.equal(photoService.maxBytes(), 50 * 1024);
    process.env.PHOTO_MAX_BYTES = "nonsense";
    assert.equal(photoService.maxBytes(), 1.5 * 1024 * 1024);
  } finally {
    if (saved === undefined) delete process.env.PHOTO_MAX_BYTES;
    else process.env.PHOTO_MAX_BYTES = saved;
  }
  assert.equal(photoService.retentionDays(), 90);
});
