// Hardware unit tests (no database): key handling, status, device choice,
// ANPR parsing, barrier command rules, ESC/POS printing.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";
process.env.APP_UTC_OFFSET_MINUTES = "330";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const hw = require("../services/hardwareService");
const { deviceAuth } = require("../middleware/deviceAuth");
const anpr = require("../integrations/anpr");
const barrier = require("../integrations/barrier");
const printer = require("../integrations/printer");
const { EscPos, toAscii, columnsFor } = require("../integrations/printer/escpos");
const Hardware = require("../models/Hardware");
const HardwareCommand = require("../models/HardwareCommand");

const id = () => new mongoose.Types.ObjectId();

// ------------------------------------------------------------------ keys

test("device keys: random, prefixed, and only a hash is stored", () => {
  const a = hw.generateDeviceKey();
  const b = hw.generateDeviceKey();
  assert.match(a.raw, /^hwk_[0-9a-f]{48}$/);
  assert.notEqual(a.raw, b.raw);
  assert.equal(a.hash, hw.hashKey(a.raw));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.prefix, a.raw.slice(0, 12));
  assert.ok(!a.hash.includes(a.raw));
});

test("device model never shows its key hash in JSON", () => {
  const device = new Hardware({
    companyId: id(), locationId: id(), name: "Gate", type: "BARRIER", keyHash: "secret-hash", keyPrefix: "hwk_abc",
  });
  assert.equal(JSON.stringify(device).includes("secret-hash"), false);
  assert.equal(device.toJSON().keyPrefix, "hwk_abc");
});

test("device model validates type, direction and paper width", () => {
  const base = { companyId: id(), locationId: id(), name: "X", keyHash: "h", keyPrefix: "p" };
  assert.ok(new Hardware({ ...base, type: "LASER" }).validateSync().errors.type);
  assert.ok(new Hardware({ ...base, type: "BARRIER", direction: "SIDEWAYS" }).validateSync().errors.direction);
  assert.ok(new Hardware({ ...base, type: "PRINTER", config: { paperWidthMm: 70 } }).validateSync().errors["config.paperWidthMm"]);
  assert.equal(new Hardware({ ...base, type: "PRINTER", config: { paperWidthMm: 58 } }).validateSync(), undefined);
});

test("device auth: refuses a missing or wrongly shaped key before touching the database", async () => {
  const run = (headers) =>
    new Promise((resolve) => deviceAuth({ headers }, {}, (error) => resolve(error)));
  for (const headers of [{}, { "x-device-key": "abc" }, { "x-device-key": `hwk_${"a".repeat(200)}` }, { authorization: "Bearer hwk_x" }]) {
    const error = await run(headers);
    assert.equal(error.statusCode, 401);
  }
});

// ---------------------------------------------------------------- status

test("status: disabled, never seen, online, offline, unmonitored", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  const seen = (secondsAgo) => new Date(now.getTime() - secondsAgo * 1000);
  const device = (extra) => ({ isActive: true, monitorOnline: true, offlineAfterSeconds: 120, ...extra });

  assert.equal(hw.statusOf(device({ isActive: false, lastSeenAt: seen(1) }), now), "DISABLED");
  assert.equal(hw.statusOf(device({}), now), "NEVER_SEEN");
  assert.equal(hw.statusOf(device({ lastSeenAt: seen(30) }), now), "ONLINE");
  assert.equal(hw.statusOf(device({ lastSeenAt: seen(121) }), now), "OFFLINE");
  assert.equal(hw.statusOf(device({ lastSeenAt: seen(900), offlineAfterSeconds: 1200 }), now), "ONLINE");
  assert.equal(hw.statusOf(device({ lastSeenAt: seen(900), monitorOnline: false }), now), "UNMONITORED");
});

// ---------------------------------------------------------- device choice

test("pickDevice: gate match, then direction, then both; never another gate's device", () => {
  const mk = (name, gate, direction, isActive = true) => ({ name, gate, direction, isActive });
  const devices = [
    mk("generic-both", undefined, "BOTH"),
    mk("entry-any", undefined, "ENTRY"),
    mk("gate-a-entry", "A", "ENTRY"),
    mk("gate-b-exit", "B", "EXIT"),
    mk("off", "A", "ENTRY", false),
  ];
  assert.equal(hw.pickDevice(devices, { gate: "A", direction: "ENTRY" }).name, "gate-a-entry");
  assert.equal(hw.pickDevice(devices, { direction: "ENTRY" }).name, "entry-any");
  // Gate B asked for an entry: the gate-A device must not be used.
  assert.equal(hw.pickDevice(devices, { gate: "B", direction: "ENTRY" }).name, "entry-any");
  assert.equal(hw.pickDevice(devices, { gate: "B", direction: "EXIT" }).name, "gate-b-exit");
  assert.equal(hw.pickDevice(devices, { direction: "EXIT" }).name, "gate-b-exit");
  assert.equal(hw.pickDevice([mk("a", "A", "ENTRY")], { gate: "B", direction: "ENTRY" }), null);
  assert.equal(hw.pickDevice([mk("off", "A", "ENTRY", false)], { gate: "A", direction: "ENTRY" }), null);
  assert.equal(hw.pickDevice([], { direction: "EXIT" }), null);
  assert.equal(hw.pickDevice([mk("both", undefined, "BOTH")], { direction: "EXIT" }).name, "both");
});

test("pickDevice: two equally good devices are ambiguous, so none is used", () => {
  const mk = (name, gate, direction) => ({ name, gate, direction, isActive: true });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(hw.pickDevice([mk("one", undefined, "ENTRY"), mk("two", undefined, "ENTRY")], { direction: "ENTRY" }), null);
    assert.equal(hw.pickDevice([mk("one", "A", "ENTRY"), mk("two", "A", "ENTRY")], { gate: "A", direction: "ENTRY" }), null);
    // A better match still wins over a tie further down.
    const three = [mk("one", undefined, "ENTRY"), mk("two", undefined, "ENTRY"), mk("gated", "A", "ENTRY")];
    assert.equal(hw.pickDevice(three, { gate: "A", direction: "ENTRY" }).name, "gated");
    // An exact-direction device beats a both-ways one (not a tie).
    assert.equal(hw.pickDevice([mk("both", undefined, "BOTH"), mk("entry", undefined, "ENTRY")], { direction: "ENTRY" }).name, "entry");
  } finally {
    console.warn = warn;
  }
});

// ------------------------------------------------------------------ ANPR

test("anpr: confidence accepts 0-1 and 0-100", () => {
  assert.equal(anpr.normalizeConfidence(0.93), 0.93);
  assert.equal(anpr.normalizeConfidence(93), 0.93);
  assert.equal(anpr.normalizeConfidence(100), 1);
  assert.equal(anpr.normalizeConfidence(1), 1);
  assert.equal(anpr.normalizeConfidence(-5), undefined);
  assert.equal(anpr.normalizeConfidence("high"), undefined);
  assert.equal(anpr.normalizeConfidence(NaN), undefined);
});

test("anpr: a clear, confident plate needs no review", () => {
  const d = anpr.parseDetection({ plate: " mh12 ab-1234 ", confidence: 0.93 });
  assert.equal(d.plate, "MH12AB1234");
  assert.equal(d.plateRaw, "mh12 ab-1234");
  assert.deepEqual(d.reviewReasons, []);
});

test("anpr: low confidence, missing confidence, no plate and odd plates are flagged", () => {
  assert.match(anpr.parseDetection({ plate: "MH12AB1234", confidence: 0.6 }).reviewReasons[0], /Low confidence \(60%, needs 85%\)/);
  assert.match(anpr.parseDetection({ plate: "MH12AB1234" }).reviewReasons[0], /did not give a confidence/);
  const unread = anpr.parseDetection({ plate: "", confidence: 0.9 });
  assert.equal(unread.plate, "");
  assert.match(unread.reviewReasons[0], /No plate could be read/);
  assert.match(anpr.parseDetection({}).reviewReasons[0], /No plate could be read/);
  const odd = anpr.parseDetection({ plate: "AB", confidence: 0.99 });
  assert.equal(odd.plate, "");
  assert.match(odd.reviewReasons[0], /does not look like a number plate/);
});

test("anpr: a location can set its own confidence bar", () => {
  assert.deepEqual(anpr.parseDetection({ plate: "MH12AB1234", confidence: 0.7 }, { minConfidence: 0.6 }).reviewReasons, []);
  assert.equal(anpr.parseDetection({ plate: "MH12AB1234", confidence: 0.95 }, { minConfidence: 0.99 }).reviewReasons.length, 1);
});

test("anpr: duplicate key is the same inside one window and differs across plates, gates and windows", () => {
  const loc = id();
  const t = 1_800_000_000_000;
  const key = (extra = {}, now = t) => anpr.dedupeKey({ locationId: loc, direction: "ENTRY", plate: "MH12AB1234", ...extra }, now);
  assert.equal(key(), key({}, t + 1000));
  assert.notEqual(key(), key({ plate: "MH12AB9999" }));
  assert.notEqual(key(), key({ direction: "EXIT" }));
  assert.notEqual(key(), key({}, t + 10 * 60 * 1000));
  assert.match(key({ plate: "" }), /UNREAD/);
});

// --------------------------------------------------------------- barrier

test("barrier commands: short deadline, a few retries, pulse length from the device", () => {
  const open = barrier.buildBarrierCommand("BARRIER_OPEN", { config: { pulseMs: 2500 } });
  assert.equal(open.payload.action, "OPEN");
  assert.equal(open.payload.pulseMs, 2500);
  assert.ok(open.ttlSeconds <= 60, "an open command must not stay valid for long");
  assert.ok(open.maxAttempts >= 2);
  assert.equal(barrier.buildBarrierCommand("BARRIER_CLOSE", {}).payload.pulseMs, barrier.DEFAULT_PULSE_MS);
  assert.throws(() => barrier.buildBarrierCommand("PRINT_TEST", {}), /not a barrier command/);
});

test("command model: type and status are restricted", () => {
  const base = { companyId: id(), locationId: id(), hardwareId: id(), expiresAt: new Date() };
  assert.ok(new HardwareCommand({ ...base, type: "SELF_DESTRUCT" }).validateSync().errors.type);
  assert.ok(new HardwareCommand({ ...base, type: "BARRIER_OPEN", status: "MAYBE" }).validateSync().errors.status);
  const ok = new HardwareCommand({ ...base, type: "BARRIER_OPEN" });
  assert.equal(ok.validateSync(), undefined);
  assert.equal(ok.status, "PENDING");
  assert.equal(ok.attempts, 0);
});

// ---------------------------------------------------------------- ESC/POS

test("escpos: starts with reset, ends with cut, plain text is ASCII", () => {
  const p = new EscPos({ columns: 32 }).line("Hello").feed(1).cut();
  const bytes = [...p.toBuffer()];
  assert.deepEqual(bytes.slice(0, 2), [0x1b, 0x40]);
  assert.deepEqual(bytes.slice(-4), [0x1d, 0x56, 0x42, 0x00]);
  assert.equal(p.toText(), "Hello\n");
});

test("escpos: rupee sign and unprintable characters are made safe", () => {
  assert.equal(toAscii("₹20 – café “ok”"), 'Rs.20 - caf? "ok"');
  assert.equal(columnsFor(58), 32);
  assert.equal(columnsFor(80), 48);
  assert.equal(columnsFor(undefined), 48);
});

test("escpos: pair() fills the line width and never overflows it", () => {
  const p = new EscPos({ columns: 20 });
  p.pair("Total", "Rs. 20.00");
  assert.equal(p.toText().length, 20);
  assert.match(p.toText(), /^Total {6}Rs\. 20\.00$/);
  const long = new EscPos({ columns: 10 });
  long.pair("A very long label", "123456");
  assert.equal(long.toText().length <= 10, true);
});

test("escpos: wrap() breaks at words within the width", () => {
  const p = new EscPos({ columns: 12 }).wrap("Keep this ticket safe please");
  for (const line of p.toText().split("\n")) assert.ok(line.length <= 12, line);
  assert.equal(p.toText().replace(/\n/g, " "), "Keep this ticket safe please");
});

test("escpos: QR code block is complete", () => {
  const bytes = [...new EscPos().qr("T-261003-ABC234").toBuffer()];
  const asText = Buffer.from(bytes).toString("latin1");
  assert.ok(asText.includes("T-261003-ABC234"));
  assert.ok(Buffer.from(bytes).includes(Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48])), "print command present");
});

const sampleReceipt = (overrides = {}) => ({
  receiptNumber: "R-261003-ABC234",
  reference: "T-261003-ABC234",
  company: { name: "Acme Parking", gstNumber: "27ABCDE1234F1Z5" },
  location: { name: "Main Road Lot", address: { line1: "MG Road", city: "Pune" } },
  vehicle: { number: "MH12AB1234", type: "CAR" },
  ticketNumber: "T-261003-ABC234",
  entryTime: new Date("2026-10-03T04:30:00Z"),
  exitTime: new Date("2026-10-03T07:05:00Z"),
  durationMinutes: 155,
  amount: { subtotal: 50, tax: 9, total: 59, taxPercent: 18, taxInclusive: false },
  paid: 59,
  payment: { method: "UPI" },
  ...overrides,
});

test("printer: receipt shows the business, vehicle, local times, duration and money", () => {
  const { text, buffer } = printer.buildReceipt(sampleReceipt());
  assert.match(text, /Acme Parking/);
  assert.match(text, /GSTIN: 27ABCDE1234F1Z5/);
  assert.match(text, /MH12AB1234/);
  assert.match(text, /03 Oct 2026, 10:00/, "entry in local time (UTC+5:30)");
  assert.match(text, /03 Oct 2026, 12:35/);
  assert.match(text, /2h 35m/);
  assert.match(text, /Tax \(18%\)\s+Rs\. 9\.00/);
  assert.match(text, /TOTAL\s+Rs\. 59\.00/);
  assert.match(text, /UPI/);
  assert.ok(buffer.length > 100);
  assert.equal(text.split("\n").every((line) => line.length <= 48), true);
});

test("printer: 58 mm paper keeps every line within 32 characters; free exit shows zero", () => {
  const { text } = printer.buildReceipt(
    sampleReceipt({ amount: { subtotal: 0, tax: 0, total: 0, taxPercent: 0, taxInclusive: true }, paid: 0, payment: null, note: "Released by admin: gate stuck" }),
    { paperWidthMm: 58 }
  );
  assert.equal(text.split("\n").every((line) => line.length <= 32), true, text);
  assert.match(text, /TOTAL\s+Rs\. 0\.00/);
  assert.match(text, /Note: Released by admin/);
  assert.doesNotMatch(text, /Tax \(/);
});

test("printer: ticket carries the ticket number and entry time; QR only when asked", () => {
  const session = { ticketNumber: "T-261003-ABC234", vehicleNumber: "MH12AB1234", vehicleType: "CAR", entryTime: new Date("2026-10-03T04:30:00Z"), entryGate: "A" };
  const args = { company: { name: "Acme" }, location: { name: "Lot" }, session };
  const plain = printer.buildTicket(args);
  assert.match(plain.text, /T-261003-ABC234/);
  assert.match(plain.text, /03 Oct 2026, 10:00/);
  assert.doesNotMatch(plain.text, /\[QR/);
  assert.match(printer.buildTicket(args, { printQr: true }).text, /\[QR: T-261003-ABC234\]/);
});

test("printer: payload is base64 bytes plus a readable preview, with short-lived print commands", () => {
  const built = printer.buildTest({ name: "Gate printer" }, { paperWidthMm: 80 });
  const payload = printer.toPayload(built);
  assert.equal(payload.format, "escpos");
  assert.deepEqual(Buffer.from(payload.dataBase64, "base64"), built.buffer);
  assert.match(payload.text, /Gate printer/);
  assert.ok(printer.COMMAND_DEFAULTS.PRINT_TICKET.ttlSeconds >= 60);
  assert.ok(printer.COMMAND_DEFAULTS.PRINT_RECEIPT.maxAttempts <= 2, "printing twice is annoying: few retries");
});
