// RFID / FASTag readers and CCTV (no database): tag cleaning, snapshot commands, device types.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTag, cleanTag, isValidTag } = require("../utils/tag");
const cctv = require("../integrations/cctv");
const { HARDWARE_TYPES } = require("../models/Hardware");
const { COMMAND_TYPES } = require("../models/HardwareCommand");
const { DETECTION_SOURCES } = require("../models/AnprDetection");
const hw = require("../services/hardwareService");

test("tags: every reader style becomes the same capitals-only form", () => {
  for (const text of ["e2 00 68 06 ab", "E2:00:68:06:AB", "0xE2006806AB", " e2-00-68-06-ab ", "E2.00.68.06.AB"]) {
    assert.equal(normalizeTag(text), "E2006806AB", text);
  }
  assert.equal(normalizeTag(undefined), "");
});

test("tags: only 4 to 48 letters and digits are usable", () => {
  assert.equal(cleanTag("e2 00"), "E200");
  assert.equal(cleanTag("abc"), "");
  assert.equal(cleanTag("a".repeat(49)), "");
  assert.equal(cleanTag("tag#1234"), "");
  assert.equal(isValidTag("E2006806AB"), true);
  assert.equal(cleanTag(""), "");
});

test("cctv: a snapshot command carries the photo kind and the ticket, and expires quickly", () => {
  const spec = cctv.buildSnapshotCommand({ kind: "EXIT", sessionId: "507f1f77bcf86cd799439011" });
  assert.equal(spec.type, "CAPTURE_SNAPSHOT");
  assert.deepEqual(spec.payload, { kind: "EXIT", sessionId: "507f1f77bcf86cd799439011" });
  assert.ok(spec.ttlSeconds <= 120, "a late picture is no use");
  assert.ok(spec.maxAttempts >= 1);
  const test = cctv.buildSnapshotTest();
  assert.equal(test.type, "SNAPSHOT_TEST");
  assert.deepEqual(test.payload, {});
});

test("the new device kinds are known everywhere they must be", () => {
  for (const type of ["ANPR_CAMERA", "BARRIER", "PRINTER", "RFID_READER", "FASTAG_READER", "CCTV_CAMERA"]) {
    assert.ok(HARDWARE_TYPES.includes(type), type);
  }
  assert.ok(COMMAND_TYPES.includes("CAPTURE_SNAPSHOT") && COMMAND_TYPES.includes("SNAPSHOT_TEST"));
  assert.ok(DETECTION_SOURCES.includes("RFID") && DETECTION_SOURCES.includes("FASTAG"));
  assert.equal(typeof hw.requestSnapshot, "function");
});

test("cctv: the camera for a gate is chosen like a barrier (gate first, never a tie)", () => {
  const cams = [
    { _id: 1, isActive: true, direction: "ENTRY", gate: "Gate A" },
    { _id: 2, isActive: true, direction: "EXIT", gate: "Gate B" },
  ];
  assert.equal(hw.pickDevice(cams, { gate: "Gate A", direction: "ENTRY" })._id, 1);
  assert.equal(hw.pickDevice(cams, { gate: "Gate B", direction: "EXIT" })._id, 2);
  const twins = [{ _id: 1, isActive: true, direction: "ENTRY" }, { _id: 2, isActive: true, direction: "ENTRY" }];
  assert.equal(hw.pickDevice(twins, { direction: "ENTRY" }), null);
});
