// UHF / RFID readers, FASTag readers and CCTV cameras. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, bytes, registerCompany, assert } = require("./helpers");
const HardwareCommand = require("../models/HardwareCommand");
const HardwareEvent = require("../models/HardwareEvent");
const AnprDetection = require("../models/AnprDetection");
const ParkingSession = require("../models/ParkingSession");

setup();

const s = { keys: {}, ids: {} };
const asDevice = (name) => ({ headers: { "x-device-key": s.keys[name] } });
const device = (name, method, path, body) => api(method, `/api/device${path}`, { ...asDevice(name), body });
const jpeg = (size = 2000, fill = 7) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, fill), Buffer.from([0xff, 0xd9])]);
const upload = (name, commandId, body = jpeg(), type = "image/jpeg") =>
  bytes("POST", `/api/device/snapshots?commandId=${commandId}`, { headers: { "x-device-key": s.keys[name], "content-type": type }, body });
const addDevice = async (name, body) => {
  const res = await api("POST", "/api/hardware", { token: s.a.token, body: { locationId: s.loc._id, name, ...body } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.keys[name] = res.body.data.deviceKey;
  s.ids[name] = res.body.data.device._id;
};
const drain = async (name) => (await device(name, "GET", "/commands")).body.data.commands;
const enter = (plate) => api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: plate, vehicleType: "CAR", gate: "Gate A" } });
const sell = (body) =>
  api("POST", "/api/passes", {
    token: s.a.token,
    body: { locationId: s.loc._id, vehicleType: "CAR", holderName: "Asha Rao", months: 1, amount: 1000, method: "CASH", ...body },
  });

it("setup: a location with two gates, a tariff and the devices", async () => {
  s.a = await registerCompany("rdr");
  s.b = await registerCompany("rdrb");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token,
    body: { name: "Reader Lot", address: { line1: "MG Road" }, capacity: { car: 10 }, gates: [{ name: "Gate A", type: "ENTRY" }, { name: "Gate B", type: "EXIT" }] },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", { token: s.a.token, body: { locationId: s.loc._id, name: "Flat", vehicleType: "CAR", gracePeriodMinutes: 30, slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, lostTicketFee: 200 } });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));

  await addDevice("rfid-in", { type: "RFID_READER", direction: "ENTRY", gate: "Gate A" });
  await addDevice("fastag-in", { type: "FASTAG_READER", direction: "ENTRY", gate: "Gate A" });
  await addDevice("cctv-in", { type: "CCTV_CAMERA", direction: "ENTRY", gate: "Gate A" });
  await addDevice("cctv-out", { type: "CCTV_CAMERA", direction: "EXIT", gate: "Gate B" });
  await addDevice("cam-in", { type: "ANPR_CAMERA", direction: "ENTRY", gate: "Gate A" });
  const list = await api("GET", `/api/hardware?type=CCTV_CAMERA`, { token: s.a.token });
  assert.equal(list.body.data.length, 2);
});

it("a pass vehicle gets a tag; tags are unique and can be removed", async () => {
  const one = await sell({ vehicleNumber: "RJ14RF0001" });
  const two = await sell({ vehicleNumber: "RJ14RF0002", holderName: "Ravi" });
  assert.equal(one.status, 201, JSON.stringify(one.body));
  s.pass = one.body.data.pass || one.body.data;
  s.pass2 = two.body.data.pass || two.body.data;

  const set = await api("PUT", `/api/passes/${s.pass._id}/vehicles/tag`, { token: s.a.token, body: { vehicleNumber: "RJ14RF0001", tag: "e2 00 68:06-AB" } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.vehicles[0].tag, "E2006806AB");

  const clash = await api("PUT", `/api/passes/${s.pass2._id}/vehicles/tag`, { token: s.a.token, body: { vehicleNumber: "RJ14RF0002", tag: "E2006806AB" } });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  assert.equal((await api("PUT", `/api/passes/${s.pass2._id}/vehicles/tag`, { token: s.a.token, body: { vehicleNumber: "RJ14RF0002", tag: "!!" } })).status, 400);
  assert.equal((await api("PUT", `/api/passes/${s.pass2._id}/vehicles/tag`, { token: s.a.token, body: { vehicleNumber: "RJ14ZZ9999", tag: "ABCD1234" } })).status, 404);
  assert.equal((await api("PUT", `/api/passes/${s.pass2._id}/vehicles/tag`, { token: s.b.token, body: { vehicleNumber: "RJ14RF0002", tag: "ABCD1234" } })).status, 404, "another company");

  assert.equal((await api("PUT", `/api/passes/${s.pass2._id}/vehicles/tag`, { token: s.a.token, body: { vehicleNumber: "RJ14RF0002", tag: "CAFE0002" } })).status, 200);
  const cleared = await api("PUT", `/api/passes/${s.pass2._id}/vehicles/tag`, { token: s.a.token, body: { vehicleNumber: "RJ14RF0002", tag: "" } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.vehicles[0].tag, undefined);
});

it("RFID reader: a known tag becomes a suggestion for that pass vehicle", async () => {
  const read = await device("rfid-in", "POST", "/rfid", { tag: "e2:00:68:06:ab", eventId: "r-1" });
  assert.equal(read.status, 201, JSON.stringify(read.body));
  assert.equal(read.body.data.known, true);
  assert.equal(read.body.data.plate, "RJ14RF0001");
  assert.equal(read.body.data.passNumber, s.pass.passNumber);
  assert.equal(read.body.data.needsReview, false);

  const detection = await AnprDetection.findById(read.body.data.id);
  assert.equal(detection.source, "RFID");
  assert.equal(detection.tagId, "E2006806AB");
  assert.equal(detection.direction, "ENTRY");

  const again = await device("rfid-in", "POST", "/rfid", { tag: "E2006806AB", eventId: "r-1" });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.duplicate, true);

  const suggestions = await api("GET", `/api/anpr?locationId=${s.loc._id}&direction=ENTRY`, { token: s.a.token });
  assert.equal(suggestions.status, 200, JSON.stringify(suggestions.body));
  assert.ok(suggestions.body.data.some((d) => d.plate === "RJ14RF0001" && d.source === "RFID"));
});

it("RFID reader: an unknown tag is only noted; a bad tag is refused; other devices cannot use the endpoint", async () => {
  const unknown = await device("rfid-in", "POST", "/rfid", { tag: "FFFF0000" });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.data.known, false);
  assert.equal((await HardwareEvent.countDocuments({ hardwareId: s.ids["rfid-in"], type: "UNKNOWN_TAG" })), 1);
  assert.equal((await device("rfid-in", "POST", "/rfid", { tag: "x" })).status, 400);
  assert.equal((await device("cam-in", "POST", "/rfid", { tag: "E2006806AB" })).status, 403);
  assert.equal((await api("POST", "/api/device/rfid", { body: { tag: "E2006806AB" } })).status, 401);
});

it("RFID reader: a tag of an expired or suspended pass needs a check", async () => {
  const suspended = await api("POST", `/api/passes/${s.pass._id}/suspend`, { token: s.a.token, body: { reason: "Payment bounced" } });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
  await AnprDetection.deleteMany({ companyId: s.a.company._id });
  const read = await device("rfid-in", "POST", "/rfid", { tag: "E2006806AB" });
  assert.equal(read.status, 201, JSON.stringify(read.body));
  assert.equal(read.body.data.needsReview, true);
  assert.match(read.body.data.reviewReasons.join(" "), /suspended/);
  assert.equal((await api("POST", `/api/passes/${s.pass._id}/resume`, { token: s.a.token })).status, 200);
});

it("FASTag reader: the vehicle number it supplies becomes a suggestion marked as FASTag", async () => {
  const read = await device("fastag-in", "POST", "/fastag", { plate: "mh12 ab 1234", tagId: "34161fa820328ee5", eventId: "f-1" });
  assert.equal(read.status, 201, JSON.stringify(read.body));
  assert.equal(read.body.data.plate, "MH12AB1234");
  assert.equal(read.body.data.needsReview, false, "a tag read is exact, so it needs no confidence check");
  const detection = await AnprDetection.findById(read.body.data.id);
  assert.equal(detection.source, "FASTAG");
  assert.equal(detection.tagId, "34161FA820328EE5");

  const none = await device("fastag-in", "POST", "/fastag", { tagId: "34161FA820328EE5" });
  assert.equal(none.status, 201);
  assert.equal(none.body.data.needsReview, true);
  assert.equal((await device("rfid-in", "POST", "/fastag", { plate: "MH12AB1234" })).status, 403);
});

it("CCTV: an entry asks the camera at that gate for a picture, once", async () => {
  const entry = await enter("RJ14CT0001");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  s.session = entry.body.data.session;

  const commands = await drain("cctv-in");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "CAPTURE_SNAPSHOT");
  assert.equal(commands[0].payload.kind, "ENTRY");
  assert.equal(commands[0].payload.sessionId, String(s.session._id));
  s.snapCommand = commands[0];

  assert.equal((await HardwareCommand.countDocuments({ hardwareId: s.ids["cctv-in"], type: "CAPTURE_SNAPSHOT" })), 1);
  assert.equal((await HardwareCommand.countDocuments({ hardwareId: s.ids["cctv-out"] })), 0, "the exit camera is not asked at entry");
});

it("CCTV: the picture is filed under the ticket; a repeat adds nothing; bad pictures are refused", async () => {
  const bad = await upload("cctv-in", s.snapCommand.id, Buffer.from("not a picture"));
  assert.equal(bad.status, 415);
  const wrongType = await upload("cctv-in", s.snapCommand.id, jpeg(), "image/png");
  assert.equal(wrongType.status, 415);

  const first = await upload("cctv-in", s.snapCommand.id);
  assert.equal(first.status, 201, first.buffer.toString());
  const again = await upload("cctv-in", s.snapCommand.id);
  assert.equal(again.status, 200);

  const session = await ParkingSession.findById(s.session._id);
  assert.equal(session.photos.length, 1);
  assert.equal(session.photos[0].kind, "ENTRY");
  assert.equal(session.photos[0].takenByDevice, "cctv-in");
  const ack = await device("cctv-in", "POST", `/commands/${s.snapCommand.id}/ack`, { ok: true });
  assert.equal(ack.status, 200);

  const shown = await bytes("GET", `/api/parking/sessions/${s.session._id}/photos/${session.photos[0]._id}`, { token: s.a.token });
  assert.equal(shown.status, 200);
  assert.equal(shown.buffer.length, jpeg().length);
});

it("CCTV: only that camera can upload for its own command, and only a CCTV camera", async () => {
  assert.equal((await upload("cctv-out", s.snapCommand.id)).status, 404, "another camera's command");
  assert.equal((await upload("cam-in", s.snapCommand.id)).status, 403);
  assert.equal((await upload("cctv-in", "not-an-id")).status, 400);
  assert.equal((await bytes("POST", `/api/device/snapshots?commandId=${s.snapCommand.id}`, { headers: { "content-type": "image/jpeg" }, body: jpeg() })).status, 401);
});

it("CCTV: the exit camera is asked when the vehicle leaves, and an admin can test a camera", async () => {
  const out = await api("POST", "/api/parking/exit", {
    token: s.a.token, body: { locationId: s.loc._id, ticketNumber: s.session.ticketNumber, gate: "Gate B" },
  });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const commands = await drain("cctv-out");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.kind, "EXIT");

  const test = await api("POST", `/api/hardware/${s.ids["cctv-in"]}/commands`, { token: s.a.token, body: { type: "SNAPSHOT_TEST", reason: "Checking the picture" } });
  assert.equal(test.status, 201, JSON.stringify(test.body));
  const taken = await drain("cctv-in");
  assert.equal(taken[0].type, "SNAPSHOT_TEST");
  const wrong = await api("POST", `/api/hardware/${s.ids["fastag-in"]}/commands`, { token: s.a.token, body: { type: "SNAPSHOT_TEST", reason: "Checking the picture" } });
  assert.equal(wrong.status, 400);
});
