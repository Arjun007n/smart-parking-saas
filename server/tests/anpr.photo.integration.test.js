// Reading a plate from an operator's photo (simulated provider). Needs MongoDB (see tests/helpers.js).
process.env.PHOTO_MAX_BYTES = String(100 * 1024);
process.env.RECOGNITION_RATE_LIMIT_MAX = "1000";

const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");
const AnprDetection = require("../models/AnprDetection");
const AuditLog = require("../models/AuditLog");

setup();

const s = {};
const picture = (text = "", size = 300) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(text), Buffer.alloc(size, 7), Buffer.from([0xff, 0xd9])]);
const read = (token, { loc = s.main && s.main._id, direction = "ENTRY", body, type = "image/jpeg" } = {}) =>
  bytes("POST", `/api/anpr/read?locationId=${loc}&direction=${direction}`, { token, headers: { "content-type": type }, body });
const json = (res) => JSON.parse(res.buffer.toString("utf8"));
const actions = async (company, action) => AuditLog.find({ companyId: company.company._id, action });

it("setup: a company, a second company, gate staff", async () => {
  s.a = await registerCompany("pra");
  s.b = await registerCompany("prb");
  const loc = async (token, name) => {
    const res = await api("POST", "/api/locations", { token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
  };
  s.main = await loc(s.a.token, "Main");
  s.annex = await loc(s.a.token, "Annex");
  s.other = await loc(s.b.token, "Other");
  const staff = (name, email, role, ids) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds: ids } });
  await staff("Gate", "pr-entry@example.com", "ENTRY_OPERATOR", [s.main._id]);
  await staff("Exit", "pr-exit@example.com", "EXIT_OPERATOR", [s.main._id]);
  await staff("Collector", "pr-collect@example.com", "COLLECTION_OPERATOR", [s.main._id]);
  s.entry = await login("pr-entry@example.com");
  s.exit = await login("pr-exit@example.com");
  s.collect = await login("pr-collect@example.com");
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.main._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
});

it("switched off by default: options say so and a read is refused", async () => {
  delete process.env.RECOGNITION_PROVIDER;
  const options = await api("GET", "/api/anpr/options", { token: s.entry });
  assert.equal(options.status, 200);
  assert.equal(options.body.data.photoReading, false);
  assert.equal((await read(s.entry, { body: picture("PLATE:RJ14AB0001") })).status, 503);
  assert.equal((await api("GET", "/api/anpr/options")).status, 401);
});

it("the simulated reader can be driven by a test plate for any picture", async () => {
  process.env.RECOGNITION_PROVIDER = "simulated";
  assert.equal((await api("GET", "/api/anpr/options", { token: s.entry })).body.data.simulated, true);
  const res = await bytes("POST", `/api/anpr/read?locationId=${s.main._id}&direction=ENTRY&testPlate=up16-zz-0001`, {
    token: s.entry, headers: { "content-type": "image/jpeg" }, body: picture("an ordinary picture"),
  });
  assert.equal(res.status, 200, res.buffer.toString());
  assert.equal(json(res).data.plate, "UP16-ZZ-0001".replace(/-/g, ""));
});

it("a readable photo becomes a pending suggestion", async () => {
  process.env.RECOGNITION_PROVIDER = "simulated";
  assert.equal((await api("GET", "/api/anpr/options", { token: s.entry })).body.data.photoReading, true);

  const res = await read(s.entry, { body: picture("PLATE:rj14-ab-0001 CONF:0.96") });
  assert.equal(res.status, 200, res.buffer.toString());
  const { data } = json(res);
  assert.equal(data.readable, true);
  assert.equal(data.plate, "RJ14AB0001");
  assert.deepEqual(data.reviewReasons, []);
  assert.equal(data.detection.status, "PENDING");
  assert.equal(data.detection.source, "PHOTO");
  assert.equal(data.detection.direction, "ENTRY");
  assert.equal(data.detection.hardwareId, undefined);
  s.detection = data.detection._id;

  // The same suggestion shows up in the normal list for the gate.
  const list = await api("GET", `/api/anpr?locationId=${s.main._id}`, { token: s.entry });
  assert.ok(list.body.data.some((d) => d._id === s.detection && d.source === "PHOTO"));
  const reads = await actions(s.a, "ANPR_PHOTO_READ");
  assert.ok(reads.some((r) => String(r.entityId) === String(s.detection) && r.meta.provider === "simulated" && r.meta.readable === true), "every read is audited");
});

it("reading the same plate again is one suggestion with more hits", async () => {
  const res = await read(s.entry, { body: picture("PLATE:RJ14AB0001 CONF:0.97") });
  const { data } = json(res);
  assert.equal(data.detection._id, s.detection);
  assert.equal(data.detection.hits, 2);
  assert.equal(await AnprDetection.countDocuments({ companyId: s.a.company._id, plate: "RJ14AB0001" }), 1);
  const both = await Promise.all([1, 2, 3].map(() => read(s.entry, { body: picture("PLATE:RJ14AB0002") })));
  assert.ok(both.every((r) => r.status === 200));
  assert.equal(await AnprDetection.countDocuments({ companyId: s.a.company._id, plate: "RJ14AB0002" }), 1, "simultaneous reads make one suggestion");
});

it("doubtful and unreadable photos are handled for the operator to check", async () => {
  const unsure = json(await read(s.entry, { body: picture("PLATE:KA01AA0001 CONF:0.4") })).data;
  assert.equal(unsure.plate, "KA01AA0001");
  assert.equal(unsure.detection.needsReview, true);
  assert.match(unsure.reviewReasons.join(" "), /Low confidence/);

  const before = await AnprDetection.countDocuments({ companyId: s.a.company._id });
  const none = json(await read(s.entry, { body: picture("no plate in this picture") })).data;
  assert.equal(none.readable, false);
  assert.equal(none.plate, "");
  assert.equal(none.detection, null);
  assert.match(none.reviewReasons.join(" "), /No plate could be read/);
  assert.equal(await AnprDetection.countDocuments({ companyId: s.a.company._id }), before, "an unreadable picture stores nothing");
});

it("an entry read notices a vehicle that is already inside", async () => {
  const entered = await api("POST", "/api/parking/entry", {
    token: s.entry, body: { locationId: s.main._id, vehicleNumber: "GJ05XX0005", vehicleType: "CAR" },
  });
  assert.equal(entered.status, 201, JSON.stringify(entered.body));
  const data = json(await read(s.entry, { body: picture("PLATE:GJ05XX0005 CONF:0.99") })).data;
  assert.equal(data.detection.alreadyInside, true);
  assert.match(data.reviewReasons.join(" "), /Already inside/);
});

it("using a suggestion goes through the normal entry and records the correction", async () => {
  const entered = await api("POST", "/api/parking/entry", {
    token: s.entry,
    body: { locationId: s.main._id, vehicleNumber: "RJ14AB0001", vehicleType: "CAR", detectionId: s.detection },
  });
  assert.equal(entered.status, 201, JSON.stringify(entered.body));
  const detection = await AnprDetection.findById(s.detection);
  assert.equal(detection.status, "CONFIRMED");
  assert.equal(detection.corrected, false);
  assert.equal(String(detection.sessionId), entered.body.data.session._id);

  const typo = json(await read(s.entry, { body: picture("PLATE:MH12AB7777 CONF:0.98") })).data;
  const fixed = await api("POST", "/api/parking/entry", {
    token: s.entry,
    body: { locationId: s.main._id, vehicleNumber: "MH12AB7778", vehicleType: "CAR", detectionId: typo.detection._id },
  });
  assert.equal(fixed.status, 201, JSON.stringify(fixed.body));
  const settled = await AnprDetection.findById(typo.detection._id);
  assert.equal(settled.corrected, true);
  assert.equal(settled.finalPlate, "MH12AB7778");
  const confirms = await actions(s.a, "ANPR_CONFIRM");
  assert.ok(confirms.some((c) => c.meta && c.meta.source === "PHOTO" && c.meta.usedPlate === "MH12AB7778" && c.meta.corrected === true));
});

it("an exit read finds the vehicle that is inside", async () => {
  const data = json(await read(s.exit, { direction: "EXIT", body: picture("PLATE:RJ14AB0001 CONF:0.99") })).data;
  assert.equal(data.detection.direction, "EXIT");
  assert.ok(data.detection.matchedSessionId, "the open ticket is matched");
  const miss = json(await read(s.exit, { direction: "EXIT", body: picture("PLATE:UP80ZZ0009 CONF:0.99") })).data;
  assert.match(miss.reviewReasons.join(" "), /No vehicle with this number is inside/);
});

it("access rules: direction, permission, location, company, login", async () => {
  const photo = picture("PLATE:RJ14AB5555");
  assert.equal((await read(s.entry, { direction: "EXIT", body: photo })).status, 403, "entry staff cannot read for exits");
  assert.equal((await read(s.exit, { direction: "ENTRY", body: photo })).status, 403, "exit staff cannot read for entries");
  assert.equal((await read(s.collect, { body: photo })).status, 403);
  assert.equal((await read(s.entry, { direction: "UP", body: photo })).status, 400);
  assert.equal((await read(s.entry, { loc: s.annex._id, body: photo })).status, 404, "a location the user does not work at");
  assert.equal((await read(s.entry, { loc: s.other._id, body: photo })).status, 404, "another company's location");
  assert.equal((await read(s.entry, { loc: "nope", body: photo })).status, 400);
  assert.equal((await read(undefined, { body: photo })).status, 401);
  assert.equal((await read(s.a.token, { body: photo })).status, 200, "the owner can read both ways");
  assert.equal((await api("GET", "/api/anpr", { token: s.b.token })).body.data.length, 0, "another company sees nothing");
});

it("bad pictures are refused", async () => {
  assert.equal((await read(s.entry, { body: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>") })).status, 415, "not an image, whatever it claims");
  assert.equal((await read(s.entry, { body: Buffer.alloc(0) })).status, 415);
  assert.equal((await read(s.entry, { body: picture("PLATE:RJ14AB0003"), type: "text/plain" })).status, 415, "wrong content type");
  assert.equal((await read(s.entry, { body: picture("PLATE:RJ14AB0003", 200 * 1024) })).status, 413, "too large");
});

it("a failing reading service gives a clean 502 and stores nothing", async () => {
  process.env.RECOGNITION_PROVIDER = "http";
  process.env.RECOGNITION_URL = "http://127.0.0.1:1/read";
  const original = console.error;
  console.error = () => {};
  const before = await AnprDetection.countDocuments({ companyId: s.a.company._id });
  const res = await read(s.entry, { body: picture("PLATE:RJ14AB0004") });
  console.error = original;
  assert.equal(res.status, 502);
  assert.match(json(res).message || json(res).error || "", /Type the number instead/);
  assert.equal(await AnprDetection.countDocuments({ companyId: s.a.company._id }), before);
  process.env.RECOGNITION_PROVIDER = "simulated";
});

it("readings are rate limited", async () => {
  process.env.RECOGNITION_RATE_LIMIT_MAX = "1";
  const res = await read(s.entry, { body: picture("PLATE:RJ14AB0006") });
  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
  process.env.RECOGNITION_RATE_LIMIT_MAX = "1000";
  assert.equal((await read(s.entry, { body: picture("PLATE:RJ14AB0006") })).status, 200);
});
