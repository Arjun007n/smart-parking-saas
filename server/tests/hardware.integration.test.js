// API tests for hardware: device registry, device keys, ANPR suggestions,
// barrier and printer commands, offline tracking, tenant isolation. Needs MongoDB.
const mongoose = require("mongoose");
const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");
const hardware = require("../services/hardwareService");
const Hardware = require("../models/Hardware");
const HardwareCommand = require("../models/HardwareCommand");
const HardwareEvent = require("../models/HardwareEvent");
const AnprDetection = require("../models/AnprDetection");
const Notification = require("../models/Notification");
const ParkingSession = require("../models/ParkingSession");
const Company = require("../models/Company");
const Vehicle = require("../models/Vehicle");

setup();

const s = { keys: {}, ids: {} };

const asDevice = (name) => ({ headers: { "x-device-key": s.keys[name] } });
const device = (name, method, path, body) => api(method, `/api/device${path}`, { ...asDevice(name), body });

const addDevice = async (name, body, token = s.a.token) => {
  const res = await api("POST", "/api/hardware", { token, body: { locationId: s.loc._id, name, ...body } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.keys[name] = res.body.data.deviceKey;
  s.ids[name] = res.body.data.device._id;
  return res.body.data;
};

const auditActions = async (token, action) => {
  const res = await api("GET", `/api/audit-logs?action=${action}`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.logs;
};

// Drains and acknowledges a device's pending commands.
const takeCommands = async (name) => (await device(name, "GET", "/commands")).body.data.commands;
// Takes everything waiting for a device (each poll hands out at most 5).
const drain = async (name) => {
  const all = [];
  for (let i = 0; i < 10; i += 1) {
    const batch = await takeCommands(name);
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
};
const oid = (id) => new mongoose.Types.ObjectId(id);

it("setup: two companies, a location with gates and a tariff, staff", async () => {
  s.a = await registerCompany("hwa");
  s.b = await registerCompany("hwb");

  const loc = await api("POST", "/api/locations", {
    token: s.a.token,
    body: {
      name: "Main", address: { line1: "MG Road" }, capacity: { car: 10 },
      gates: [{ name: "Gate A", type: "ENTRY" }, { name: "Gate B", type: "EXIT" }],
    },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const other = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Other", address: { line1: "Ring Road" }, capacity: { car: 5 } },
  });
  s.other = other.body.data;

  for (const location of [s.loc, s.other]) {
    const tariff = await api("POST", "/api/tariffs", {
      token: s.a.token, body: { locationId: location._id, name: "Flat", vehicleType: "CAR", additionalPerHour: 20 },
    });
    assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  }

  const staff = (name, email, role, locationIds) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds } });
  await staff("Gate", "hw-gate@example.com", "ENTRY_OPERATOR", [s.loc._id]);
  await staff("Exit", "hw-exit@example.com", "EXIT_OPERATOR", [s.loc._id]);
  await staff("Site", "hw-site@example.com", "LOCATION_ADMIN", [s.loc._id]);
  await staff("Elsewhere", "hw-else@example.com", "LOCATION_ADMIN", [s.other._id]);
  s.gate = await login("hw-gate@example.com");
  s.exit = await login("hw-exit@example.com");
  s.site = await login("hw-site@example.com");
  s.else = await login("hw-else@example.com");
});

it("devices: an admin registers them and sees each key exactly once", async () => {
  const camera = await addDevice("cam-in", { type: "ANPR_CAMERA", direction: "ENTRY", gate: "Gate A", vendor: "Acme", config: { minConfidence: 0.8 } });
  assert.match(camera.deviceKey, /^hwk_[0-9a-f]{48}$/);
  assert.equal(camera.device.status, "NEVER_SEEN");
  assert.equal(camera.device.keyHash, undefined);
  assert.equal(camera.device.config.minConfidence, 0.8);

  await addDevice("cam-out", { type: "ANPR_CAMERA", direction: "EXIT", gate: "Gate B" });
  await addDevice("cam-any", { type: "ANPR_CAMERA", direction: "BOTH" });
  await addDevice("bar-in", { type: "BARRIER", direction: "ENTRY", gate: "Gate A", config: { pulseMs: 1500 } });
  await addDevice("bar-out", { type: "BARRIER", direction: "EXIT", gate: "Gate B" });
  await addDevice("printer", { type: "PRINTER", direction: "BOTH", config: { paperWidthMm: 58 } });

  const list = await api("GET", `/api/hardware?locationId=${s.loc._id}`, { token: s.a.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 6);
  const text = JSON.stringify(list.body);
  for (const key of Object.values(s.keys)) assert.equal(text.includes(key), false, "keys are never listed");
  assert.equal(text.includes("keyHash"), false);

  const printers = await api("GET", `/api/hardware?type=PRINTER`, { token: s.a.token });
  assert.equal(printers.body.data.length, 1);
  assert.equal((await api("GET", "/api/hardware?type=LASER", { token: s.a.token })).status, 400);
});

it("devices: validation and permissions", async () => {
  const body = { locationId: s.loc._id, name: "Another", type: "BARRIER" };
  assert.equal((await api("POST", "/api/hardware", { token: s.gate, body })).status, 403, "operators cannot add devices");
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, name: "bar-in" } })).status, 409, "same name twice");
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, gate: "Gate Z" } })).status, 400, "unknown gate");
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, type: "LASER" } })).status, 400);
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, config: { paperWidthMm: 70 } } })).status, 400);
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, config: { minConfidence: 5 } } })).status, 400);
  // A location admin of another location cannot add a device here, and cannot see ours.
  assert.equal((await api("POST", "/api/hardware", { token: s.else, body })).status, 404);
  assert.equal((await api("GET", `/api/hardware/${s.ids["bar-in"]}`, { token: s.else })).status, 404);
  // The admin of this location can.
  assert.equal((await api("GET", `/api/hardware/${s.ids["bar-in"]}`, { token: s.site })).status, 200);
  // Fields the client may not set are ignored.
  const extra = await api("POST", "/api/hardware", {
    token: s.a.token,
    body: { ...body, name: "extra", isOnline: true, keyHash: "x", companyId: s.b.company._id },
  });
  assert.equal(extra.status, 201);
  assert.equal(extra.body.data.device.isOnline, false);
  assert.equal(String(extra.body.data.device.companyId), String(s.a.company._id));
});

it("device keys: required, checked, and a heartbeat makes the device ONLINE", async () => {
  assert.equal((await api("POST", "/api/device/heartbeat")).status, 401);
  assert.equal((await api("POST", "/api/device/heartbeat", { headers: { "x-device-key": "hwk_nonsense" } })).status, 401);
  // A user token is not a device key.
  assert.equal((await api("POST", "/api/device/heartbeat", { token: s.a.token })).status, 401);

  const beat = await device("bar-in", "POST", "/heartbeat", {});
  assert.equal(beat.status, 200);
  assert.equal(beat.body.data.device.name, "bar-in");
  assert.ok(beat.body.data.pollMs > 0);

  const fresh = await api("GET", `/api/hardware/${s.ids["bar-in"]}`, { token: s.a.token });
  assert.equal(fresh.body.data.device.status, "ONLINE");
  assert.ok(fresh.body.data.events.some((e) => e.type === "ONLINE"));

  // The Authorization form works too.
  const alt = await api("POST", "/api/device/heartbeat", { headers: { authorization: `Device ${s.keys["bar-out"]}` } });
  assert.equal(alt.status, 200);
  for (const name of ["cam-in", "cam-out", "cam-any", "printer"]) await device(name, "POST", "/heartbeat", {});
});

it("ANPR: a clear plate becomes one suggestion, repeats only add hits", async () => {
  const first = await device("cam-in", "POST", "/anpr", { plate: "mh12 ab 1234", confidence: 93, eventId: "evt-1", imageUrl: "https://cams.example.com/1.jpg" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.plate, "MH12AB1234");
  assert.equal(first.body.data.needsReview, false);
  assert.equal(first.body.data.duplicate, false);
  s.detection = first.body.data.id;

  // Camera retry with the same event id, and the same plate seen again.
  const retry = await device("cam-in", "POST", "/anpr", { plate: "MH12AB1234", confidence: 0.99, eventId: "evt-1" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.duplicate, true);
  assert.equal(retry.body.data.id, s.detection);

  const again = await device("cam-in", "POST", "/anpr", { plate: "MH12-AB-1234", confidence: 0.97 });
  assert.equal(again.body.data.duplicate, true);
  assert.equal(again.body.data.hits, 2);

  assert.equal(await AnprDetection.countDocuments({ hardwareId: s.ids["cam-in"], plate: "MH12AB1234" }), 1);
  const stored = await AnprDetection.findById(s.detection);
  assert.equal(stored.plateRaw, "mh12 ab 1234", "the original text is kept for audit");
  assert.equal(stored.imageUrl, "https://cams.example.com/1.jpg");
  assert.equal(stored.confidence, 0.97, "the best confidence is kept");
});

it("ANPR: the vehicle type comes from the camera, and a plate we already know keeps its own type", async () => {
  const bus = await device("cam-in", "POST", "/anpr", { plate: "GJ05CD4321", confidence: 0.95, vehicleType: "Bus" });
  assert.equal(bus.status, 201, JSON.stringify(bus.body));
  assert.equal(bus.body.data.vehicleType, "HEAVY");
  const stored = await AnprDetection.findById(bus.body.data.id);
  assert.equal(stored.vehicleType, "HEAVY");
  assert.equal(stored.vehicleTypeFrom, "CAMERA");

  // A plate seen before is the vehicle we remember, whatever the camera guesses today.
  await Vehicle.create({ companyId: s.a.company._id, plateNumber: "UP32EF5678", type: "TEMPO" });
  const known = await device("cam-in", "POST", "/anpr", { plate: "UP32EF5678", confidence: 0.95, vehicleType: "car" });
  assert.equal(known.body.data.vehicleType, "TEMPO");
  assert.equal((await AnprDetection.findById(known.body.data.id)).vehicleTypeFrom, "HISTORY");

  // A word the platform does not know is ignored; the plate is still a normal suggestion.
  const odd = await device("cam-in", "POST", "/anpr", { plate: "TN09GH1111", confidence: 0.95, vehicleType: "hovercraft" });
  assert.equal(odd.status, 201);
  assert.equal(odd.body.data.vehicleType, undefined);

  // The operator's list carries the type so the entry screen can choose it.
  const list = await api("GET", `/api/anpr?locationId=${s.loc._id}&direction=ENTRY`, { token: s.a.token });
  assert.equal(list.body.data.find((d) => d.plate === "GJ05CD4321").vehicleType, "HEAVY");
});

it("ANPR: a lane with a vehicle type of its own gives that type when nothing else knows it", async () => {
  const setLane = (vehicleType) => api("PUT", `/api/locations/${s.loc._id}`, {
    token: s.a.token,
    body: { gates: [{ name: "Gate A", type: "ENTRY", ...(vehicleType ? { vehicleType } : {}) }, { name: "Gate B", type: "EXIT" }] },
  });
  assert.equal((await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { gates: [{ name: "Gate A", type: "ENTRY", vehicleType: "SPACESHIP" }] } })).status, 400);
  const saved = await setLane("BIKE");
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.gates.find((g) => g.name === "Gate A").vehicleType, "BIKE");

  const lane = await device("cam-in", "POST", "/anpr", { plate: "KL07LA1234", confidence: 0.95 });
  assert.equal(lane.body.data.vehicleType, "BIKE");
  assert.equal((await AnprDetection.findById(lane.body.data.id)).vehicleTypeFrom, "LANE");

  // What the camera sees beats the lane's setting.
  const seen = await device("cam-in", "POST", "/anpr", { plate: "KL07LB5678", confidence: 0.95, vehicleType: "truck" });
  assert.equal(seen.body.data.vehicleType, "HEAVY");
  assert.equal((await AnprDetection.findById(seen.body.data.id)).vehicleTypeFrom, "CAMERA");

  // Taking the type off the lane puts things back.
  assert.equal((await setLane(null)).status, 200);
  const none = await device("cam-in", "POST", "/anpr", { plate: "KL07LC9999", confidence: 0.95 });
  assert.equal(none.body.data.vehicleType, undefined);
});

it("ANPR: parallel reports of the same new plate make exactly one suggestion", async () => {
  const results = await Promise.all(
    Array.from({ length: 6 }, () => device("cam-in", "POST", "/anpr", { plate: "KA01AA0001", confidence: 0.95 }))
  );
  assert.ok(results.every((r) => [200, 201].includes(r.status)), JSON.stringify(results.map((r) => r.body)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(await AnprDetection.countDocuments({ plate: "KA01AA0001" }), 1);
  assert.equal((await AnprDetection.findOne({ plate: "KA01AA0001" })).hits, 6);
});

it("ANPR: low confidence, unreadable plates and odd text need a human", async () => {
  const low = await device("cam-in", "POST", "/anpr", { plate: "DL09ZZ9999", confidence: 0.5 });
  assert.equal(low.body.data.needsReview, true);
  assert.match(low.body.data.reviewReasons[0], /Low confidence \(50%, needs 80%\)/, "uses this camera's own bar");

  // Sent the other way: a "??" and a missing plate both come out as an empty plate, so on the same
  // gate they would count as the same car waiting (checked at the end of this test).
  const odd = await device("cam-any", "POST", "/anpr", { plate: "??", confidence: 0.99, direction: "EXIT" });
  assert.equal(odd.body.data.needsReview, true);
  assert.match(odd.body.data.reviewReasons.join(" "), /does not look like a number plate/);

  const unread = await device("cam-in", "POST", "/anpr", { confidence: 0.9 });
  assert.equal(unread.body.data.plate, "");
  assert.equal(unread.body.data.needsReview, true);
  assert.match(unread.body.data.reviewReasons.join(" "), /No plate could be read/);
  assert.equal((await device("cam-in", "POST", "/anpr", { plate: "", confidence: 0.9 })).body.data.duplicate, true, "a car waiting at the gate is one unread detection");
});

it("ANPR: rules about who may report and in which direction", async () => {
  assert.equal((await device("bar-in", "POST", "/anpr", { plate: "MH12AB5555", confidence: 0.9 })).status, 403, "only cameras report plates");
  assert.equal((await device("cam-any", "POST", "/anpr", { plate: "MH12AB5555", confidence: 0.9 })).status, 400, "a both-way camera must say which way");
  const both = await device("cam-any", "POST", "/anpr", { plate: "MH12AB5555", confidence: 0.9, direction: "EXIT" });
  assert.equal(both.status, 201);
  // AUTO: the both-way camera lets the server decide; nobody with this plate is inside, so it is an arrival.
  const auto = await device("cam-any", "POST", "/anpr", { plate: "MH12AB7777", confidence: 0.9, direction: "AUTO" });
  assert.equal(auto.status, 201, JSON.stringify(auto.body));
  assert.equal(auto.body.data.direction, "ENTRY");
  assert.equal((await device("cam-in", "POST", "/anpr", { plate: "MH12AB5555", confidence: 0.9, direction: "EXIT" })).status, 400, "entry camera cannot report exits");
  // Bad input is rejected, not stored.
  assert.equal((await device("cam-in", "POST", "/anpr", { plate: "MH12AB1111", confidence: "high" })).status, 400);
  assert.equal((await device("cam-in", "POST", "/anpr", { plate: "MH12AB1111", imageUrl: "javascript:alert(1)" })).status, 400);
});

it("ANPR: operators see suggestions for their own locations only", async () => {
  const mine = await api("GET", `/api/anpr?locationId=${s.loc._id}`, { token: s.gate });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.some((d) => d.plate === "MH12AB1234"));
  assert.ok(mine.body.data.every((d) => String(d.locationId) === String(s.loc._id)));

  assert.equal((await api("GET", "/api/anpr", { token: s.b.token })).body.data.length, 0, "another company sees nothing");
  assert.equal((await api("GET", "/api/anpr", { token: s.else })).body.data.length, 0, "another location sees nothing");
  assert.equal((await api("GET", "/api/anpr?status=WHATEVER", { token: s.gate })).status, 400);
  assert.equal((await api("GET", "/api/anpr?direction=UP", { token: s.gate })).status, 400);
  assert.equal((await api("GET", "/api/anpr")).status, 401);
});

it("ANPR: dismissing a wrong reading keeps a record, and cannot be repeated", async () => {
  const wrong = await device("cam-in", "POST", "/anpr", { plate: "GJ05XX0005", confidence: 0.99 });
  const id = wrong.body.data.id;
  assert.equal((await api("POST", `/api/anpr/${id}/dismiss`, { token: s.b.token })).status, 404);
  const done = await api("POST", `/api/anpr/${id}/dismiss`, { token: s.gate });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, "DISMISSED");
  assert.equal((await api("POST", `/api/anpr/${id}/dismiss`, { token: s.gate })).status, 409);
  assert.ok((await auditActions(s.a.token, "ANPR_DISMISS")).length >= 1);
  // The same plate seen after dismissal is a new suggestion.
  const later = await device("cam-in", "POST", "/anpr", { plate: "GJ05XX0005", confidence: 0.99 });
  assert.equal(later.body.data.duplicate, false);
});

it("entry: using a suggestion (with a correction) settles it and queues the barrier and ticket", async () => {
  // The camera read ...1234 but the operator sees the plate is ...1235.
  const entry = await api("POST", "/api/parking/entry", {
    token: s.gate,
    body: { locationId: s.loc._id, vehicleNumber: "MH12AB1235", vehicleType: "CAR", gate: "Gate A", detectionId: s.detection, idempotencyKey: "anpr-entry-0001" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  s.session = entry.body.data.session;

  const detection = await AnprDetection.findById(s.detection);
  assert.equal(detection.status, "CONFIRMED");
  assert.equal(detection.corrected, true);
  assert.equal(detection.finalPlate, "MH12AB1235");
  assert.equal(String(detection.sessionId), String(s.session._id));

  const log = (await auditActions(s.a.token, "ANPR_CONFIRM"))[0];
  assert.equal(log.meta.usedPlate, "MH12AB1235");
  assert.equal(log.meta.cameraRead, "mh12 ab 1234");
  assert.equal(log.meta.corrected, true);

  const hw = entry.body.data.hardware;
  assert.equal(hw.barrier.deviceName, "bar-in");
  assert.equal(hw.barrier.status, "PENDING");
  assert.equal(hw.print.deviceName, "printer", "the ticket is printed by itself when the camera made the entry");
  assert.equal(hw.print.status, "PENDING");
  s.entryBarrier = hw.barrier.commandId;

  // Once settled, it is gone from the queue.
  const queue = await api("GET", `/api/anpr?locationId=${s.loc._id}`, { token: s.gate });
  assert.equal(queue.body.data.some((d) => d._id === s.detection), false);
});

it("entry: an entry without a camera, barrier or printer still works", async () => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.else, body: { locationId: s.other._id, vehicleNumber: "UP16CC0001", vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.deepEqual(entry.body.data.hardware, { barrier: null, print: null, problem: false });
});

it("barrier: the entry barrier gets the command, once, and confirms it", async () => {
  // The exit barrier has nothing to do.
  assert.deepEqual(await takeCommands("bar-out"), []);

  const commands = await takeCommands("bar-in");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "BARRIER_OPEN");
  assert.equal(commands[0].payload.action, "OPEN");
  assert.equal(commands[0].payload.pulseMs, 1500, "the device's own pulse length");
  assert.equal(commands[0].attempt, 1);
  assert.equal(commands[0].id, s.entryBarrier);

  // Asking again straight away does not hand it out a second time.
  assert.deepEqual(await takeCommands("bar-in"), []);

  // Another company's device, and another device of ours, cannot confirm it.
  const foreign = await addDevice("foreign-barrier", { type: "BARRIER" }, s.b.token).catch(() => null);
  assert.equal(foreign, null, "company B has no such location");
  assert.equal((await device("bar-out", "POST", `/commands/${s.entryBarrier}/ack`, { ok: true })).status, 404);
  assert.equal((await device("printer", "POST", `/commands/${s.entryBarrier}/ack`, { ok: true })).status, 404);

  const ack = await device("bar-in", "POST", `/commands/${s.entryBarrier}/ack`, { ok: true });
  assert.equal(ack.status, 200);
  assert.equal(ack.body.data.status, "ACKED");
  assert.equal(ack.body.data.repeated, false);

  // Confirming twice is harmless.
  const twice = await device("bar-in", "POST", `/commands/${s.entryBarrier}/ack`, { ok: true });
  assert.equal(twice.body.data.repeated, true);

  const opened = await auditActions(s.a.token, "BARRIER_OPENED");
  assert.equal(opened.length, 1, "a barrier moving is audited once");
  assert.equal(opened[0].actorEmail, "device:bar-in");
  assert.equal(String(opened[0].meta.sessionId), String(s.session._id));

  // Operators can follow the command on screen.
  const follow = await api("GET", `/api/hardware/commands/${s.entryBarrier}`, { token: s.gate });
  assert.equal(follow.body.data.status, "ACKED");
  assert.equal(follow.body.data.deviceName, "bar-in");
  assert.equal((await api("GET", `/api/hardware/commands/${s.entryBarrier}`, { token: s.b.token })).status, 404);
});

it("printer: the ticket arrives as printer bytes with the ticket number", async () => {
  const commands = await drain("printer");
  const ticket = commands.find((c) => c.type === "PRINT_TICKET");
  assert.ok(ticket, JSON.stringify(commands));
  assert.equal(ticket.payload.format, "escpos");
  const bytes = Buffer.from(ticket.payload.dataBase64, "base64");
  assert.equal(bytes[0], 0x1b);
  assert.ok(bytes.toString("latin1").includes(s.session.ticketNumber));
  assert.match(ticket.payload.text, /MH12AB1235/);
  assert.ok(ticket.payload.text.split("\n").every((line) => line.length <= 32), "58 mm paper");
  assert.equal((await device("printer", "POST", `/commands/${ticket.id}/ack`, { ok: true })).status, 200);
});

it("barrier: a failure is retried, then reported; the reason is recorded", async () => {
  const made = await api("POST", `/api/hardware/${s.ids["bar-out"]}/commands`, {
    token: s.a.token, body: { type: "BARRIER_OPEN", reason: "Testing retries" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.data.id;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const [command] = await takeCommands("bar-out");
    assert.equal(command.id, id);
    assert.equal(command.attempt, attempt);
    const ack = await device("bar-out", "POST", `/commands/${id}/ack`, { ok: false, error: "relay not answering" });
    assert.equal(ack.status, 200);
    assert.equal(ack.body.data.status, attempt < 3 ? "PENDING" : "FAILED");
    // Skip the short wait before the next try.
    await HardwareCommand.updateOne({ _id: id }, { $set: { availableAt: new Date(0) } });
  }
  assert.deepEqual(await takeCommands("bar-out"), [], "no attempts left");

  const stored = await HardwareCommand.findById(id);
  assert.equal(stored.status, "FAILED");
  assert.equal(stored.error, "relay not answering");
  assert.equal(await HardwareEvent.countDocuments({ hardwareId: s.ids["bar-out"], type: "COMMAND_FAILED" }), 1);
  // Failures do not produce a "barrier opened" audit entry.
  assert.equal((await auditActions(s.a.token, "BARRIER_OPENED")).length, 1);
});

it("barrier: a command that was handed out but not confirmed is offered again after its timeout", async () => {
  const made = await api("POST", `/api/hardware/${s.ids["bar-out"]}/commands`, {
    token: s.a.token, body: { type: "BARRIER_OPEN", reason: "Testing lost confirmation" },
  });
  const id = made.body.data.id;
  assert.equal((await takeCommands("bar-out")).length, 1);
  assert.equal((await takeCommands("bar-out")).length, 0, "not yet");
  await HardwareCommand.updateOne({ _id: id }, { $set: { availableAt: new Date(Date.now() - 1000) } });
  const again = await takeCommands("bar-out");
  assert.equal(again.length, 1);
  assert.equal(again[0].attempt, 2);
  await device("bar-out", "POST", `/commands/${id}/ack`, { ok: true });
});

it("barrier: an old command is never carried out, and is marked expired", async () => {
  const made = await api("POST", `/api/hardware/${s.ids["bar-out"]}/commands`, {
    token: s.a.token, body: { type: "BARRIER_OPEN", reason: "Testing expiry" },
  });
  const id = made.body.data.id;
  await HardwareCommand.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(await takeCommands("bar-out"), [], "too late to be useful");

  const result = await hardware.sweep();
  assert.ok(result.expired >= 1);
  assert.equal((await HardwareCommand.findById(id)).status, "EXPIRED");
  assert.equal(await HardwareEvent.countDocuments({ hardwareId: s.ids["bar-out"], type: "COMMAND_EXPIRED" }), 1);
});

it("exit: pay at the counter, the exit barrier opens and the receipt is queued", async () => {
  const exit = await api("POST", "/api/parking/exit", {
    token: s.exit, body: { locationId: s.loc._id, ticketNumber: s.session.ticketNumber, gate: "Gate B" },
  });
  assert.equal(exit.status, 200, JSON.stringify(exit.body));
  assert.equal(exit.body.data.paymentRequired, true);
  assert.equal(exit.body.data.hardware, undefined, "nothing opens before it is paid");
  const fee = exit.body.data.session.fee.total;

  const paid = await api("POST", "/api/payments", {
    token: s.exit, body: { sessionId: s.session._id, method: "CASH", amount: fee },
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  const hw = paid.body.data.hardware;
  assert.equal(hw.barrier.deviceName, "bar-out");
  assert.equal(hw.print, null, "the receipt is not printed by itself at exit");
  s.exitBarrier = hw.barrier.commandId;

  const [open] = (await takeCommands("bar-out")).filter((c) => c.type === "BARRIER_OPEN");
  assert.equal(open.id, s.exitBarrier);
  await device("bar-out", "POST", `/commands/${open.id}/ack`, { ok: true });

  const slips = await drain("printer");
  assert.equal(slips.find((c) => c.type === "PRINT_RECEIPT"), undefined, "nothing is sent to the printer until the operator asks");
});

it("exit: asking for the barrier again returns the same command; only for a vehicle just cleared", async () => {
  const again = await api("POST", `/api/parking/sessions/${s.session._id}/barrier`, { token: s.exit });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.data.commandId, s.exitBarrier, "already opened: the same command, nothing new");
  assert.equal(again.body.data.status, "ACKED");
  assert.equal(await HardwareCommand.countDocuments({ sessionId: s.session._id, type: "BARRIER_OPEN" }), 2, "one for entry, one for exit");

  // An entry operator may not release an exit.
  assert.equal((await api("POST", `/api/parking/sessions/${s.session._id}/barrier`, { token: s.gate })).status, 403);
  // Another company cannot.
  assert.equal((await api("POST", `/api/parking/sessions/${s.session._id}/barrier`, { token: s.b.token })).status, 404);

  // Not for an exit that happened long ago.
  // (Measured from when the session was closed, not from the exit time.)
  await ParkingSession.updateOne(
    { _id: s.session._id }, { $set: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } }, { timestamps: false }
  );
  assert.equal((await api("POST", `/api/parking/sessions/${s.session._id}/barrier`, { token: s.exit })).status, 409);
});

it("barrier: it can never be used for a vehicle still waiting to pay", async () => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.gate, body: { locationId: s.loc._id, vehicleNumber: "RJ14XY0001", vehicleType: "CAR", gate: "Gate A" },
  });
  const session = entry.body.data.session;
  await api("POST", "/api/parking/exit", { token: s.exit, body: { locationId: s.loc._id, ticketNumber: session.ticketNumber, gate: "Gate B" } });
  const attempt = await api("POST", `/api/parking/sessions/${session._id}/barrier`, { token: s.exit });
  assert.equal(attempt.status, 409, "payment is still pending");
  assert.equal(await HardwareCommand.countDocuments({ sessionId: session._id, type: "BARRIER_OPEN", hardwareId: s.ids["bar-out"] }), 0);
  s.unpaid = session;
});

it("exit: an admin releasing a vehicle opens the barrier but prints no receipt", async () => {
  const released = await api("POST", `/api/parking/sessions/${s.unpaid._id}/override`, {
    token: s.site, body: { reason: "Customer dispute settled by manager" },
  });
  assert.equal(released.status, 200, JSON.stringify(released.body));
  assert.equal(released.body.hardware.barrier.deviceName, "bar-out");
  assert.equal(released.body.hardware.print, null);
});

it("printer: reprint the ticket or receipt on demand", async () => {
  const receipt = await api("POST", `/api/parking/sessions/${s.session._id}/print`, { token: s.exit });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
  assert.equal((await HardwareCommand.findById(receipt.body.data.commandId)).type, "PRINT_RECEIPT");
  // The first slip is printed only when the operator asks for it.
  const slip = await HardwareCommand.findById(receipt.body.data.commandId);
  assert.match(slip.payload.text, /TOTAL\s+Rs\./);
  // A double tap while that copy is still waiting is one slip.
  const dup = await api("POST", `/api/parking/sessions/${s.session._id}/print`, { token: s.exit });
  assert.equal(dup.body.data.commandId, receipt.body.data.commandId);

  const open = await api("POST", "/api/parking/entry", {
    token: s.gate, body: { locationId: s.loc._id, vehicleNumber: "HR26DK0002", vehicleType: "CAR", gate: "Gate A" },
  });
  const ticket = await api("POST", `/api/parking/sessions/${open.body.data.session._id}/print`, { token: s.gate });
  assert.equal((await HardwareCommand.findById(ticket.body.data.commandId)).type, "PRINT_TICKET");

  // No printer at the other location.
  const elsewhere = await api("POST", "/api/parking/entry", {
    token: s.else, body: { locationId: s.other._id, vehicleNumber: "UP16CC0002", vehicleType: "CAR" },
  });
  assert.equal((await api("POST", `/api/parking/sessions/${elsewhere.body.data.session._id}/print`, { token: s.else })).status, 404);
});

it("exit camera: a plate of a vehicle that is inside is matched to its ticket", async () => {
  const seen = await device("cam-out", "POST", "/anpr", { plate: "HR26DK0002", confidence: 0.97 });
  assert.equal(seen.status, 201);
  assert.equal(seen.body.data.needsReview, false);
  const stored = await AnprDetection.findById(seen.body.data.id);
  assert.ok(stored.matchedSessionId);
  assert.match(stored.matchedTicketNumber, /^T-\d{6}-/);

  const stranger = await device("cam-out", "POST", "/anpr", { plate: "HR26DK0099", confidence: 0.97 });
  assert.equal(stranger.body.data.needsReview, true);
  assert.match(stranger.body.data.reviewReasons[0], /No vehicle with this number is inside/);

  // Looking the vehicle up for exit settles the suggestion.
  const exit = await api("POST", "/api/parking/exit", {
    token: s.exit, body: { locationId: s.loc._id, vehicleNumber: "HR26DK0002", detectionId: seen.body.data.id },
  });
  assert.equal(exit.status, 200, JSON.stringify(exit.body));
  assert.equal((await AnprDetection.findById(seen.body.data.id)).status, "CONFIRMED");
});

it("entry camera: vehicles already inside or blocked are flagged for the operator", async () => {
  const inside = await device("cam-in", "POST", "/anpr", { plate: "HR26DK0002", confidence: 0.99 });
  assert.equal(inside.body.data.needsReview, true);
  assert.match(inside.body.data.reviewReasons.join(" "), /Already inside \(ticket T-/);

  const vehicle = await api("POST", "/api/vehicles", {
    token: s.a.token, body: { plateNumber: "BR01BL0001", type: "CAR" },
  });
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));
  const block = await api("PUT", `/api/vehicles/${vehicle.body.data._id}`, {
    token: s.a.token, body: { isBlocked: true, blockedReason: "Unpaid fines" },
  });
  assert.equal(block.status, 200, JSON.stringify(block.body));
  const blocked = await device("cam-in", "POST", "/anpr", { plate: "BR01BL0001", confidence: 0.99 });
  assert.equal(blocked.body.data.needsReview, true);
  assert.match(blocked.body.data.reviewReasons.join(" "), /blocked: Unpaid fines/);
});

it("admin commands: reason required, only for the right device, always audited", async () => {
  const path = `/api/hardware/${s.ids["bar-in"]}/commands`;
  assert.equal((await api("POST", path, { token: s.gate, body: { type: "BARRIER_OPEN", reason: "Operator trying" } })).status, 403);
  assert.equal((await api("POST", path, { token: s.a.token, body: { type: "BARRIER_OPEN" } })).status, 400);
  assert.equal((await api("POST", path, { token: s.a.token, body: { type: "BARRIER_OPEN", reason: "no" } })).status, 400);
  assert.equal((await api("POST", path, { token: s.a.token, body: { type: "PRINT_TEST", reason: "Wrong device kind" } })).status, 400);
  assert.equal((await api("POST", path, { token: s.b.token, body: { type: "BARRIER_OPEN", reason: "Other company" } })).status, 404);

  const ok = await api("POST", path, { token: s.site, body: { type: "BARRIER_OPEN", reason: "Ambulance needs to pass" } });
  assert.equal(ok.status, 201);
  const logs = await auditActions(s.a.token, "HARDWARE_COMMAND");
  assert.ok(logs.some((l) => l.meta.reason === "Ambulance needs to pass" && String(l.actorEmail).includes("hw-site")));
  await takeCommands("bar-in");

  const test = await api("POST", `/api/hardware/${s.ids.printer}/commands`, { token: s.a.token, body: { type: "PRINT_TEST", reason: "Check paper" } });
  assert.equal(test.status, 201);
  const slip = (await drain("printer")).find((c) => c.type === "PRINT_TEST");
  assert.ok(slip);
  assert.match(slip.payload.text, /PRINTER TEST/);
});

it("monitoring: a silent device goes OFFLINE with one alert, and recovers when it speaks", async () => {
  const id = s.ids["bar-in"];
  await Hardware.updateOne({ _id: id }, { $set: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000), isOnline: true } });
  const view = await api("GET", `/api/hardware/${id}`, { token: s.a.token });
  assert.equal(view.body.data.device.status, "OFFLINE", "status is right even before the sweep");

  // Everything else has just spoken, so only the silent one can go offline.
  for (const name of Object.keys(s.keys)) if (name !== "bar-in") await device(name, "POST", "/heartbeat", {});
  const first = await hardware.sweep();
  assert.ok(first.offline >= 1);
  await hardware.sweep(); // a second sweep must not raise a second alert for the same outage
  assert.equal(await Notification.countDocuments({ type: "HARDWARE_OFFLINE", "data.hardwareId": oid(id) }), 1);
  const alert = await Notification.findOne({ type: "HARDWARE_OFFLINE", "data.hardwareId": oid(id) });
  assert.equal(alert.severity, "critical");
  assert.equal(String(alert.locationId), String(s.loc._id));
  assert.equal(await HardwareEvent.countDocuments({ hardwareId: id, type: "OFFLINE" }), 1);

  const alerts = await api("GET", "/api/notifications", { token: s.a.token });
  assert.ok(alerts.body.data.notifications.some((n) => n.type === "HARDWARE_OFFLINE"));

  const before = await HardwareEvent.countDocuments({ hardwareId: id, type: "ONLINE" });
  await device("bar-in", "POST", "/heartbeat", {});
  assert.equal(await HardwareEvent.countDocuments({ hardwareId: id, type: "ONLINE" }), before + 1);
  assert.equal((await api("GET", `/api/hardware/${id}`, { token: s.a.token })).body.data.device.status, "ONLINE");
});

it("monitoring: unmonitored devices are never reported offline; stale suggestions expire", async () => {
  const id = s.ids["cam-any"];
  await api("PUT", `/api/hardware/${id}`, { token: s.a.token, body: { monitorOnline: false } });
  await Hardware.updateOne({ _id: id }, { $set: { lastSeenAt: new Date(Date.now() - 60 * 60 * 1000), isOnline: true } });
  await hardware.sweep();
  assert.equal(await Notification.countDocuments({ "data.hardwareId": oid(id) }), 0);

  const stale = await device("cam-in", "POST", "/anpr", { plate: "MP09ST0001", confidence: 0.99 });
  await AnprDetection.updateOne({ _id: stale.body.data.id }, { $set: { lastSeenAt: new Date(Date.now() - 20 * 60 * 1000) } });
  const result = await hardware.sweep();
  assert.ok(result.detectionsExpired >= 1);
  assert.equal((await AnprDetection.findById(stale.body.data.id)).status, "EXPIRED");
});

it("keys: rotating stops the old key at once; switching a device off does too", async () => {
  const id = s.ids["cam-out"];
  const old = s.keys["cam-out"];
  assert.equal((await api("POST", `/api/hardware/${id}/rotate-key`, { token: s.gate })).status, 403);
  assert.equal((await api("POST", `/api/hardware/${id}/rotate-key`, { token: s.b.token })).status, 404);

  const rotated = await api("POST", `/api/hardware/${id}/rotate-key`, { token: s.a.token });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.data.deviceKey, old);
  assert.equal((await api("POST", "/api/device/heartbeat", { headers: { "x-device-key": old } })).status, 401);
  s.keys["cam-out"] = rotated.body.data.deviceKey;
  assert.equal((await device("cam-out", "POST", "/heartbeat", {})).status, 200);
  assert.ok((await auditActions(s.a.token, "HARDWARE_KEY_ROTATE")).length >= 1);

  const off = await api("PUT", `/api/hardware/${id}`, { token: s.a.token, body: { isActive: false } });
  assert.equal(off.body.data.status, "DISABLED");
  assert.equal((await device("cam-out", "POST", "/heartbeat", {})).status, 401);
  const on = await api("PUT", `/api/hardware/${id}`, { token: s.a.token, body: { isActive: true } });
  assert.equal(on.status, 200);
  assert.equal((await device("cam-out", "POST", "/heartbeat", {})).status, 200);
});

it("devices: edits are validated and audited; events can be read", async () => {
  const id = s.ids.printer;
  assert.equal((await api("PUT", `/api/hardware/${id}`, { token: s.gate, body: { name: "Hacked" } })).status, 403);
  assert.equal((await api("PUT", `/api/hardware/${id}`, { token: s.a.token, body: { gate: "Nowhere" } })).status, 400);
  assert.equal((await api("PUT", `/api/hardware/${id}`, { token: s.a.token, body: { name: "bar-in" } })).status, 409);
  assert.equal((await api("PUT", `/api/hardware/${id}`, { token: s.a.token, body: { config: { paperWidthMm: 80, printQr: true } } })).status, 200);

  const fresh = (await api("GET", `/api/hardware/${id}`, { token: s.a.token })).body.data.device;
  assert.equal(fresh.config.paperWidthMm, 80);
  assert.equal(fresh.config.printQr, true);
  assert.ok((await auditActions(s.a.token, "HARDWARE_UPDATE")).length >= 1);

  const events = await api("GET", `/api/hardware/${s.ids["bar-in"]}/events`, { token: s.site });
  assert.equal(events.status, 200);
  assert.ok(events.body.data.some((e) => e.type === "OFFLINE"));
  assert.equal((await api("GET", `/api/hardware/${s.ids["bar-in"]}/events`, { token: s.else })).status, 404);

  const reported = await device("printer", "POST", "/events", { type: "DEVICE_ERROR", message: "Paper out" });
  assert.equal(reported.status, 201);
  assert.equal((await device("printer", "POST", "/events", { type: "OTHER", message: "x" })).status, 400);
  assert.ok((await HardwareEvent.findOne({ hardwareId: id, type: "DEVICE_ERROR" })).message.includes("Paper out"));
});

it("tenant isolation: company B sees and touches nothing of company A's hardware", async () => {
  const id = s.ids["bar-in"];
  assert.deepEqual((await api("GET", "/api/hardware", { token: s.b.token })).body.data, []);
  for (const [method, path, body] of [
    ["GET", `/api/hardware/${id}`],
    ["PUT", `/api/hardware/${id}`, { name: "mine now" }],
    ["POST", `/api/hardware/${id}/rotate-key`],
    ["GET", `/api/hardware/${id}/events`],
    ["POST", `/api/hardware/${id}/commands`, { type: "BARRIER_OPEN", reason: "Not my barrier" }],
    ["GET", `/api/hardware/commands/${s.entryBarrier}`],
    ["POST", `/api/parking/sessions/${s.session._id}/print`],
  ]) {
    const res = await api(method, path, { token: s.b.token, body });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  // Even a super-user header trick from a normal user is ignored.
  const sneaky = await api("GET", "/api/hardware", { token: s.b.token, headers: { "x-company-id": s.a.company._id } });
  assert.deepEqual(sneaky.body.data, []);
  // A device key opens nothing outside its own company's data.
  const polled = await device("bar-in", "GET", "/commands");
  assert.equal(polled.status, 200);
  assert.ok(polled.body.data.commands.every((c) => c.type.startsWith("BARRIER_")));
});

it("routes: device and hardware endpoints refuse anonymous callers", async () => {
  for (const [method, path] of [
    ["GET", "/api/hardware"], ["POST", "/api/hardware"], ["GET", `/api/hardware/${s.ids["bar-in"]}`],
    ["GET", "/api/anpr"], ["GET", "/api/device/commands"], ["POST", "/api/device/anpr"],
  ]) {
    assert.equal((await api(method, path)).status, 401, `${method} ${path}`);
  }
});

// ------------------------------------------- review follow-ups (hardening)

it("barrier: retries are de-duplicated, numbered and capped", async () => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.gate, body: { locationId: s.loc._id, vehicleNumber: "GJ01RT0001", vehicleType: "CAR", gate: "Gate A" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const session = await ParkingSession.findById(entry.body.data.session._id);
  const open = { session, direction: "ENTRY", gate: "Gate A" };
  const all = () => HardwareCommand.find({ sessionId: session._id, type: "BARRIER_OPEN" }).sort({ createdAt: 1 });
  const failWaiting = () =>
    HardwareCommand.updateMany(
      { sessionId: session._id, type: "BARRIER_OPEN", status: { $in: ["PENDING", "SENT"] } },
      { $set: { status: "FAILED", completedAt: new Date() } }
    );

  const first = await all();
  assert.equal(first.length, 1);
  const same = await hardware.requestBarrierOpen(open);
  assert.equal(String(same.command._id), String(first[0]._id), "still waiting: the same command");
  assert.equal(same.repeated, true);

  await failWaiting();
  const taps = await Promise.all([1, 2, 3, 4].map(() => hardware.requestBarrierOpen(open)));
  assert.equal(new Set(taps.map((t) => String(t.command._id))).size, 1, "four taps at once make one retry");
  assert.notEqual(String(taps[0].command._id), String(first[0]._id));
  assert.equal((await all()).length, 2);

  for (let i = 0; i < 6; i += 1) {
    await failWaiting();
    await hardware.requestBarrierOpen(open);
  }
  assert.equal((await all()).length, 4, "the first request plus three retries, then it stops asking");
  await failWaiting();
  const spent = await HardwareCommand.countDocuments({ sessionId: session._id, type: "BARRIER_OPEN", status: { $in: ["PENDING", "SENT"] } });
  assert.equal(spent, 0);
});

it("commands: a late success is recorded, a spent command fails and never blocks a reprint", async () => {
  // Success reported while the command waits to be handed out again.
  const made = await api("POST", `/api/hardware/${s.ids["bar-out"]}/commands`, {
    token: s.a.token, body: { type: "BARRIER_OPEN", reason: "Testing a late confirmation" },
  });
  const id = made.body.data.id;
  // Earlier tests may have left other commands waiting for this device: look for ours.
  const handed = await takeCommands("bar-out");
  assert.ok(handed.some((c) => String(c.id) === String(id)), "the new command is handed out");
  assert.equal((await device("bar-out", "POST", `/commands/${id}/ack`, { ok: false, error: "blip" })).body.data.status, "PENDING");
  assert.equal((await device("bar-out", "POST", `/commands/${id}/ack`, { ok: true })).body.data.status, "ACKED");

  // A slip handed out as often as allowed and never confirmed.
  const waiting = await HardwareCommand.findOne({
    hardwareId: s.ids.printer, sessionId: s.session._id, type: "PRINT_RECEIPT", status: { $in: ["PENDING", "SENT"] },
  });
  assert.ok(waiting, "the reprint from the earlier test is still waiting");
  await HardwareCommand.updateOne(
    { _id: waiting._id },
    { $set: { status: "SENT", attempts: waiting.maxAttempts, sentAt: new Date(), availableAt: new Date(Date.now() - 1000) } }
  );
  const again = await api("POST", `/api/parking/sessions/${s.session._id}/print`, { token: s.exit });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.notEqual(String(again.body.data.commandId), String(waiting._id), "a spent command does not count as waiting");

  const swept = await hardware.sweep();
  assert.ok(swept.failed >= 1);
  const stored = await HardwareCommand.findById(waiting._id);
  assert.equal(stored.status, "FAILED");
  assert.ok(await HardwareEvent.findOne({ hardwareId: s.ids.printer, type: "COMMAND_FAILED", "data.commandId": waiting._id }));
  await HardwareCommand.updateOne({ _id: again.body.data.commandId }, { $set: { status: "ACKED" } });
});

it("devices: a device cannot be placed at a gate of the wrong kind", async () => {
  const body = { locationId: s.loc._id, name: "wrong-way", type: "BARRIER" };
  // Gate A is an entry gate, Gate B an exit gate.
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, direction: "EXIT", gate: "Gate A" } })).status, 400);
  assert.equal((await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, direction: "ENTRY", gate: "Gate B" } })).status, 400);
  const fine = await api("POST", "/api/hardware", { token: s.a.token, body: { ...body, direction: "BOTH", gate: "Gate B" } });
  assert.equal(fine.status, 201, "a both-ways device may sit anywhere");
  const move = await api("PUT", `/api/hardware/${fine.body.data.device._id}`, { token: s.a.token, body: { direction: "ENTRY" } });
  assert.equal(move.status, 400, "changing direction is checked against its gate too");
  await api("PUT", `/api/hardware/${fine.body.data.device._id}`, { token: s.a.token, body: { isActive: false } });
});

it("device keys: a suspended company's devices are refused", async () => {
  await Company.updateOne({ _id: s.a.company._id }, { $set: { isActive: false } });
  try {
    assert.equal((await device("bar-in", "POST", "/heartbeat", {})).status, 403);
  } finally {
    await Company.updateOne({ _id: s.a.company._id }, { $set: { isActive: true } });
  }
  assert.equal((await device("bar-in", "POST", "/heartbeat", {})).status, 200);
  const { subscriptionStatus } = await Company.findById(s.a.company._id).select("subscriptionStatus");
  await Company.updateOne({ _id: s.a.company._id }, { $set: { subscriptionStatus: "SUSPENDED" } });
  try {
    assert.equal((await device("bar-in", "POST", "/heartbeat", {})).status, 403);
  } finally {
    await Company.updateOne({ _id: s.a.company._id }, { $set: { subscriptionStatus } });
  }
  assert.equal((await device("bar-in", "POST", "/heartbeat", {})).status, 200);
});

it("ambiguity: two barriers that cannot be told apart are not guessed between", async () => {
  const make = (name) =>
    api("POST", "/api/hardware", { token: s.a.token, body: { locationId: s.other._id, name, type: "BARRIER", direction: "ENTRY" } });
  assert.equal((await make("twin-1")).status, 201);
  const twin2 = await make("twin-2");
  assert.equal(twin2.status, 201);

  const entry = await api("POST", "/api/parking/entry", {
    token: s.else, body: { locationId: s.other._id, vehicleNumber: "KA05AM0001", vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const sessionId = entry.body.data.session._id;
  assert.equal(entry.body.data.hardware.barrier, null, "no guess");
  assert.equal(await HardwareCommand.countDocuments({ sessionId, type: "BARRIER_OPEN" }), 0);
  assert.equal((await api("POST", `/api/parking/sessions/${sessionId}/barrier`, { token: s.else, body: {} })).status, 404);

  // Giving one of them its own gate settles it, and the operator can name that gate.
  const named = await api("PUT", `/api/hardware/${twin2.body.data.device._id}`, { token: s.a.token, body: { gate: "North" } });
  assert.equal(named.status, 200, JSON.stringify(named.body));
  const picked = await api("POST", `/api/parking/sessions/${sessionId}/barrier`, { token: s.else, body: { gate: "North" } });
  assert.equal(picked.status, 201, JSON.stringify(picked.body));
  assert.equal(picked.body.data.deviceName, "twin-2");
});

it("open barrier by hand: permission, scope, one command per double tap, audit record", async () => {
  const body = { locationId: s.loc._id, direction: "ENTRY" };
  const first = await api("POST", "/api/parking/barrier", { token: s.gate, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.deviceName, "bar-in");
  const again = await api("POST", "/api/parking/barrier", { token: s.gate, body });
  assert.equal(again.status, 201);
  assert.equal(again.body.data.commandId, first.body.data.commandId, "a quick second tap is the same command");
  const queued = await HardwareCommand.find({ hardwareId: s.ids["bar-in"], reason: /^Opened by hand/ });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, "BARRIER_OPEN");

  const withReason = await api("POST", "/api/parking/barrier", { token: s.exit, body: { locationId: s.loc._id, direction: "EXIT", reason: "Delivery van" } });
  assert.equal(withReason.status, 201, JSON.stringify(withReason.body));
  assert.equal(withReason.body.data.deviceName, "bar-out");

  assert.equal((await api("POST", "/api/parking/barrier", { token: s.gate, body: { locationId: s.loc._id, direction: "EXIT" } })).status, 403, "an entry operator cannot lift the exit barrier");
  assert.equal((await api("POST", "/api/parking/barrier", { token: s.else, body })).status, 404, "another company's location is not visible");
  assert.equal((await api("POST", "/api/parking/barrier", { token: s.gate, body: { locationId: s.loc._id, direction: "SIDEWAYS" } })).status, 400);
  assert.equal((await api("POST", "/api/parking/barrier", { body })).status, 401);

  const logs = await auditActions(s.a.token, "BARRIER_MANUAL_OPEN");
  assert.ok(logs.length >= 2, "both lifts are recorded");
});

it("open barrier by hand: no single barrier means a clear answer, and the rate limit stops floods", async () => {
  const none = await api("POST", "/api/parking/barrier", { token: s.else, body: { locationId: s.other._id, direction: "EXIT" } });
  assert.equal(none.status, 404, "no exit barrier at that location");
  const { manualLiftAllowed } = require("../controllers/parkingController");
  const user = "rate-test-user";
  const results = Array.from({ length: 8 }, (_, i) => manualLiftAllowed(user, 1_000_000 + i));
  assert.deepEqual(results, [true, true, true, true, true, true, false, false]);
  assert.equal(manualLiftAllowed(user, 1_000_000 + 61_000), true, "a minute later it works again");
});

it("re-entry: a ticket is swapped for a new one at any age; double tap is one new ticket", async () => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.gate, body: { locationId: s.loc._id, vehicleNumber: "MH12RE0001", vehicleType: "CAR", gate: "Gate A" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const old = entry.body.data.session;
  const occupiedBefore = (await api("GET", `/api/locations/${s.loc._id}`, { token: s.a.token })).body.data.occupied.car;

  const again = await api("POST", `/api/parking/sessions/${old._id}/re-entry`, { token: s.gate, body: {} });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const fresh = again.body.data.session;
  assert.notEqual(fresh._id, old._id);
  assert.notEqual(fresh.ticketNumber, old.ticketNumber);
  assert.equal(fresh.vehicleNumber, "MH12RE0001");
  assert.equal(fresh.entryGate, "Gate A", "the gate is kept");
  const oldNow = await ParkingSession.findById(old._id);
  assert.equal(oldNow.status, "CANCELLED");
  assert.match(oldNow.overrideReason, /Re-entry/);
  const occupiedAfter = (await api("GET", `/api/locations/${s.loc._id}`, { token: s.a.token })).body.data.occupied.car;
  assert.equal(occupiedAfter, occupiedBefore, "one space is still used, not two");
  assert.ok((await auditActions(s.a.token, "PARKING_ENTRY_CANCELLED")).some((l) => l.meta && l.meta.reEntry));

  // The same tap again (double click / retry) returns the new ticket, it does not make a third.
  const twice = await api("POST", `/api/parking/sessions/${old._id}/re-entry`, { token: s.gate, body: {} });
  assert.equal(twice.status, 200, JSON.stringify(twice.body));
  assert.equal(twice.body.data.session._id, fresh._id);
  assert.equal(await ParkingSession.countDocuments({ vehicleNumber: "MH12RE0001", isOpen: true }), 1);

  // An exit operator cannot enter vehicles.
  const closed = await api("POST", `/api/parking/sessions/${fresh._id}/re-entry`, { token: s.exit, body: {} });
  assert.equal(closed.status, 403, "an exit operator cannot enter vehicles");

  // No age window: an operator can replace a ticket that is 40 minutes old.
  await ParkingSession.updateOne({ _id: fresh._id }, { $set: { entryTime: new Date(Date.now() - 40 * 60000) } });
  const late = await api("POST", `/api/parking/sessions/${fresh._id}/re-entry`, { token: s.gate, body: {} });
  assert.equal(late.status, 201, JSON.stringify(late.body));
  const byAdmin = await api("POST", `/api/parking/sessions/${late.body.data.session._id}/re-entry`, { token: s.site, body: { vehicleType: "CAR" } });
  assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body));
  assert.equal(byAdmin.body.data.session.vehicleNumber, "MH12RE0001");

  // Another location's staff cannot touch it.
  assert.equal((await api("POST", `/api/parking/sessions/${byAdmin.body.data.session._id}/re-entry`, { token: s.else, body: {} })).status, 404);
});

it("re-entry: refused for a blocked vehicle and for an exited vehicle; an advance is given back", async () => {
  const make = async (plate, extra = {}) => {
    const res = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: plate, vehicleType: "CAR", ...extra } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.session;
  };

  const withAdvance = await make("MH12RE0002", { advance: { amount: 50, method: "CASH" } });
  const withAdvanceAgain = await api("POST", `/api/parking/sessions/${withAdvance._id}/re-entry`, { token: s.a.token, body: {} });
  assert.equal(withAdvanceAgain.status, 201, JSON.stringify(withAdvanceAgain.body));
  assert.equal((await ParkingSession.findById(withAdvance._id)).status, "CANCELLED", "the old ticket is cancelled and its advance given back");

  const blockedSession = await make("MH12RE0003");
  const vehicle = await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "MH12RE0003", type: "CAR" } });
  assert.ok([200, 201, 409].includes(vehicle.status));
  const known = await require("../models/Vehicle").findOneAndUpdate({ plateNumber: "MH12RE0003" }, { $set: { isBlocked: true, blockedReason: "Test" } });
  assert.ok(known);
  const refusedBlocked = await api("POST", `/api/parking/sessions/${blockedSession._id}/re-entry`, { token: s.a.token, body: {} });
  assert.equal(refusedBlocked.status, 403, JSON.stringify(refusedBlocked.body));
  assert.equal((await ParkingSession.findById(blockedSession._id)).status, "ACTIVE");

  const gone = await make("MH12RE0004");
  await ParkingSession.updateOne({ _id: gone._id }, { $set: { status: "COMPLETED", isOpen: false } });
  assert.equal((await api("POST", `/api/parking/sessions/${gone._id}/re-entry`, { token: s.a.token, body: {} })).status, 409);
});

it("the gate agent download is also open to gate staff (the operator Download menu)", async () => {
  for (const token of [s.gate, s.exit]) {
    const info = await api("GET", "/api/hardware/agent-package/info", { token });
    assert.equal(info.status, 200, JSON.stringify(info.body));
    if (!info.body.data.available) continue;
    const file = await bytes("GET", "/api/hardware/agent-package", { token });
    assert.equal(file.status, 200);
    assert.equal(file.buffer.subarray(0, 2).toString("latin1"), "PK");
  }
});

it("the gate agent download is for admins who manage locations, and is a zip", async () => {
  const company = await registerCompany("agentzip");
  const info = await api("GET", "/api/hardware/agent-package/info", { token: company.token });
  assert.equal(info.status, 200, JSON.stringify(info.body));
  assert.equal(typeof info.body.data.available, "boolean");
  assert.equal((await api("GET", "/api/hardware/agent-package/info")).status, 401);
  if (!info.body.data.available) return;
  const file = await bytes("GET", "/api/hardware/agent-package", { token: company.token });
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-type"), /application\/zip/);
  assert.match(file.headers.get("content-disposition"), /gate-agent\.zip/);
  assert.equal(file.buffer.subarray(0, 2).toString("latin1"), "PK");
  assert.equal((await bytes("GET", "/api/hardware/agent-package")).status, 401);
});
