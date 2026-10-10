// The lane system (the Parking Lane page): a lane is one vehicle going one way ("Car-Entry", "Bike-Exit") with
// its own Door/Lane No. and Reader; a lane takes one class of vehicle and has one operator; a location needs an
// entry and an exit lane for two-wheelers and for four-wheelers. Needs MongoDB.
const { setup, it, api, registerCompany, assert } = require("./helpers");
const Company = require("../models/Company");
const User = require("../models/User");

setup();

const s = {};
const gate = (vehicleType, type, extra = {}) => ({ name: `${vehicleType === "BIKE" ? "Bike" : "Car"}-${type === "ENTRY" ? "Entry" : "Exit"}`, type, lane: vehicleType === "BIKE" ? "Bike" : "Car", vehicleType, ...extra });
const defaults = () => [gate("BIKE", "ENTRY"), gate("BIKE", "EXIT"), gate("CAR", "ENTRY"), gate("CAR", "EXIT")];
const base = { address: { line1: "Main Road" }, capacity: { car: 20, bike: 20 }, vehicleTypes: ["CAR", "BIKE"] };
const makeLocation = (name, gates) => api("POST", "/api/locations", { token: s.a.token, body: { name, ...base, gates } });
const makeUser = (loginId, role, lanes) =>
  api("POST", "/api/users", { token: s.a.token, body: { name: loginId, loginId, password: "Password123", role, locationIds: [s.loc._id], ...(lanes ? { lanes } : {}) } });
const signIn = async (loginId) => (await api("POST", "/api/auth/login", { body: { companyCode: s.a.company.code, loginId, password: "Password123" } })).body.data.token;
const enter = (token, vehicleNumber, vehicleType, extra = {}) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType, ...extra } });
const leave = (token, vehicleNumber) => api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, vehicleNumber } });
const list = async (query = "") => (await api("GET", `/api/locations/${s.loc._id}/lanes${query}`, { token: s.a.token })).body.data;
const lanePath = (id = "") => `/api/locations/${s.loc._id}/lanes${id ? `/${id}` : ""}`;
const laneId = async (name) => (await list("?limit=100")).rows.find((r) => r.name === name)._id;

it("setup: a company and a location that starts with its lanes", async () => {
  s.a = await registerCompany("ls");
  await Company.updateMany({ _id: s.a.company._id }, { $set: { "plan.maxUsers": 50 } });

  // Every lane is a vehicle and a direction; a location needs entry and exit lanes for both classes.
  const missing = await makeLocation("Half", [gate("BIKE", "ENTRY"), gate("BIKE", "EXIT"), gate("CAR", "ENTRY")]);
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
  assert.match(missing.body.message, /4-wheeler exit/);
  assert.equal((await makeLocation("NoVehicle", [{ name: "G1", type: "ENTRY", lane: "x" }])).status, 400);
  assert.equal((await makeLocation("Both", [{ ...gate("BIKE", "ENTRY"), type: "BOTH" }, ...defaults().slice(1)])).status, 400, "a lane goes one way");

  const made = await makeLocation("Mall", defaults());
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.loc = made.body.data;
  assert.deepEqual(s.loc.gates.map((g) => g.name), ["Bike-Entry", "Bike-Exit", "Car-Entry", "Car-Exit"]);
  assert.deepEqual(s.loc.gates.map((g) => g.vehicleClass), ["TWO_WHEELER", "TWO_WHEELER", "FOUR_WHEELER", "FOUR_WHEELER"]);
  assert.match(s.loc.gates[0].doorNo, /^L\d+D1$/, "each lane gets its own door number");
  assert.match(s.loc.gates[3].readerNo, /^L\d+R4$/, "and its own reader");
  for (const vehicleType of ["CAR", "BIKE"]) {
    const t = await api("POST", "/api/tariffs", { token: s.a.token, body: { locationId: s.loc._id, name: vehicleType, vehicleType, additionalPerHour: 10 } });
    assert.equal(t.status, 201, JSON.stringify(t.body));
  }
});

it("Create Parking Lane: a vehicle, a direction and the lane's own numbers", async () => {
  const added = await api("POST", lanePath(), { token: s.a.token, body: { vehicleType: "CAR", type: "ENTRY", cameraSerial: "CAM-9", fastag: true, fastagLaneId: "F-1", gateNo: "G1" } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.data.name, "Car-Entry 2", "a second Car-Entry is told apart");
  assert.match(added.body.data.doorNo, /D5$/, "the next free door number");
  assert.equal(added.body.data.fastagLaneId, "F-1");
  assert.equal(added.body.data.isActive, true);

  assert.equal((await api("POST", lanePath(), { token: s.a.token, body: { vehicleType: "TAXI", type: "ENTRY" } })).status, 400, "the location does not take taxis");
  assert.equal((await api("POST", lanePath(), { token: s.a.token, body: { vehicleType: "CAR" } })).status, 400, "a direction is needed");
  assert.equal((await api("POST", lanePath(), { token: s.a.token, body: { vehicleType: "CAR", type: "BOTH" } })).status, 400);
  assert.equal((await api("POST", lanePath(), { body: { vehicleType: "CAR", type: "ENTRY" } })).status, 401);
});

it("Edit Parking Lane: numbers stay unique, FASTag details go when FASTag is NO", async () => {
  const id = await laneId("Car-Entry 2");
  const door = (await list("?limit=100")).rows.find((r) => r.name === "Bike-Entry").doorNo;
  const clash = await api("PUT", lanePath(id), { token: s.a.token, body: { doorNo: door } });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));

  const ok = await api("PUT", lanePath(id), { token: s.a.token, body: { doorNo: "MAIN-1", readerNo: "RD-1", cameraSerial: "CAM-10" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.doorNo, "MAIN-1");

  const off = await api("PUT", lanePath(id), { token: s.a.token, body: { fastag: false } });
  assert.equal(off.body.data.fastag, false);
  assert.equal(off.body.data.fastagLaneId, undefined);
  assert.equal((await api("PUT", lanePath("0".repeat(24)), { token: s.a.token, body: { fastag: true } })).status, 404);
});

it("a gate operator needs a lane; a lane has one operator; one operator can hold several lanes", async () => {
  const noLane = await makeUser("bike.op", "GATE_OPERATOR");
  assert.equal(noLane.status, 400, JSON.stringify(noLane.body));
  assert.match(noLane.body.message, /Choose the lane/);

  const bike = await makeUser("bike.op", "GATE_OPERATOR", [{ locationId: s.loc._id, gate: "Bike-Entry" }, { locationId: s.loc._id, gate: "Bike-Exit" }]);
  assert.equal(bike.status, 201, JSON.stringify(bike.body));
  assert.deepEqual(bike.body.data.lanes.map((l) => l.gate).sort(), ["Bike-Entry", "Bike-Exit"]);

  const second = await makeUser("bike.op2", "GATE_OPERATOR", [{ locationId: s.loc._id, gate: "Bike-Exit" }]);
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.match(second.body.message, /already has an operator/);

  const car = await makeUser("car.op", "GATE_OPERATOR", [{ locationId: s.loc._id, gate: "Car-Entry" }, { locationId: s.loc._id, gate: "Car-Exit" }]);
  assert.equal(car.status, 201, JSON.stringify(car.body));
  assert.equal((await makeUser("sup.one", "SUPERVISOR")).status, 201, "a supervisor needs no lane");

  s.bikeToken = await signIn("bike.op");
  s.carToken = await signIn("car.op");
  assert.equal((await api("POST", lanePath(), { token: s.carToken, body: { vehicleType: "CAR", type: "EXIT" } })).status, 403, "operators cannot add lanes");
});

it("a lane takes only its own class of vehicle, at entry and at exit", async () => {
  const carAtBike = await enter(s.bikeToken, "RJ14LS0001", "CAR");
  assert.equal(carAtBike.status, 400, JSON.stringify(carAtBike.body));
  assert.match(carAtBike.body.message, /Bike-Entry is for two-wheelers only/);
  const bikeAtCar = await enter(s.carToken, "RJ14LS0002", "BIKE");
  assert.equal(bikeAtCar.status, 400, JSON.stringify(bikeAtCar.body));
  assert.match(bikeAtCar.body.message, /four-wheelers only/);

  const bike = await enter(s.bikeToken, "RJ14LS0003", "BIKE");
  assert.equal(bike.status, 201, JSON.stringify(bike.body));
  assert.equal(bike.body.data.session.entryGate, "Bike-Entry", "the operator's own lane is used");
  const car = await enter(s.carToken, "RJ14LS0004", "CAR");
  assert.equal(car.status, 201, JSON.stringify(car.body));
  assert.equal(car.body.data.session.entryGate, "Car-Entry");

  const carAtBikeExit = await leave(s.bikeToken, "RJ14LS0004");
  assert.equal(carAtBikeExit.status, 400, JSON.stringify(carAtBikeExit.body));
  assert.match(carAtBikeExit.body.message, /two-wheelers only/);
  const bikeOut = await leave(s.bikeToken, "RJ14LS0003");
  assert.equal(bikeOut.status, 200, JSON.stringify(bikeOut.body));
  assert.equal(bikeOut.body.data.session.exitGate, "Bike-Exit");
});

it("gate staff with no lane at a lane location cannot work", async () => {
  await User.updateOne({ loginId: "car.op" }, { $set: { lanes: [] } });
  const refused = await enter(s.carToken, "RJ14LS0005", "CAR");
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.match(refused.body.message, /not assigned to a lane/);
  const carOp = (await api("GET", "/api/users", { token: s.a.token })).body.data.find((u) => u.loginId === "car.op");
  const fixed = await api("PUT", `/api/users/${carOp._id}`, { token: s.a.token, body: { lanes: [{ locationId: s.loc._id, gate: "Car-Entry" }, { locationId: s.loc._id, gate: "Car-Exit" }] } });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal((await enter(s.carToken, "RJ14LS0005", "CAR")).status, 201);
});

it("the lane list: operators, search, paging, and the Active / De-Active switch for one lane", async () => {
  const all = await list();
  assert.equal(all.total, 5);
  assert.deepEqual(all.setup.missing, []);
  const bikeEntry = all.rows.find((r) => r.name === "Bike-Entry");
  assert.deepEqual(bikeEntry.operators.map((o) => o.name), ["bike.op"]);
  assert.equal(all.rows.find((r) => r.name === "Car-Entry 2").operators.length, 0, "no operator yet");

  const page = await list("?limit=2&page=3");
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].sn, 5, "the serial number follows the lane, not the page");
  assert.deepEqual((await list("?q=bike.op")).rows.map((r) => r.name), ["Bike-Entry", "Bike-Exit"], "search by operator");
  assert.deepEqual((await list("?q=main-1")).rows.map((r) => r.name), ["Car-Entry 2"], "search by door number");
  assert.equal((await list("?q=nothing-like-this")).total, 0);

  const off = await api("PATCH", `${lanePath(bikeEntry._id)}/status`, { token: s.a.token, body: { isActive: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const refused = await enter(s.bikeToken, "RJ14LS0006", "BIKE");
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.message, /switched off/);
  // Only that lane is off: the exit lane still works.
  assert.equal((await list("?limit=100")).rows.find((r) => r.name === "Bike-Exit").isActive, true);
  await api("PATCH", `${lanePath(bikeEntry._id)}/status`, { token: s.a.token, body: { isActive: true } });
  assert.equal((await enter(s.bikeToken, "RJ14LS0006", "BIKE")).status, 201);
});

it("changing a lane keeps its operator, and never takes away the last lane of a kind", async () => {
  // The only 2-wheeler entry lane cannot become an exit lane.
  const bikeEntry = await laneId("Bike-Entry");
  const last = await api("PUT", lanePath(bikeEntry), { token: s.a.token, body: { type: "EXIT" } });
  assert.equal(last.status, 400, JSON.stringify(last.body));

  // Car-Entry 2 has a twin, so it can turn into an exit lane: its name follows, and so does its operator.
  const carOp = (await api("GET", "/api/users", { token: s.a.token })).body.data.find((u) => u.loginId === "car.op");
  await api("PUT", `/api/users/${carOp._id}`, { token: s.a.token, body: { lanes: [{ locationId: s.loc._id, gate: "Car-Entry" }, { locationId: s.loc._id, gate: "Car-Exit" }, { locationId: s.loc._id, gate: "Car-Entry 2" }] } });
  const twin = await laneId("Car-Entry 2");
  const turned = await api("PUT", lanePath(twin), { token: s.a.token, body: { type: "EXIT" } });
  assert.equal(turned.status, 200, JSON.stringify(turned.body));
  assert.equal(turned.body.data.name, "Car-Exit 2");
  const user = await User.findOne({ loginId: "car.op" });
  assert.ok(user.lanes.some((l) => l.gate === "Car-Exit 2"), "the operator follows the renamed lane");
});
