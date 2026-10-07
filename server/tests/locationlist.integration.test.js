// The Locations table: parking type, auto exit per vehicle type, and the file
// download of the table. Needs MongoDB.
const { setup, it, api, bytes, registerCompany, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const { closeForgottenTickets } = require("../services/operationsService");

setup();

const s = {};
const enter = (vehicleNumber, vehicleType) =>
  api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber, vehicleType } });
const backdate = (id, days) => ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - days * 86400000) } });
const put = (body) => api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body });

it("setup: a company with a location, a tariff for cars and bikes", async () => {
  s.a = await registerCompany("ll");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Airport", address: { line1: "Terminal Road" }, capacity: { car: 20, bike: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  assert.equal(s.loc.parkingType, "NORMAL", "everyday parking unless chosen");
  for (const vehicleType of ["CAR", "BIKE"]) {
    const t = await api("POST", "/api/tariffs", { token: s.a.token, body: { locationId: s.loc._id, name: vehicleType, vehicleType, additionalPerHour: 10 } });
    assert.equal(t.status, 201, JSON.stringify(t.body));
  }
});

it("parking type is saved and checked", async () => {
  assert.equal((await put({ parkingType: "SPACESHIP" })).status, 400);
  const ok = await put({ parkingType: "AIRPORT", gates: [{ name: "Gate 1", type: "ENTRY" }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.parkingType, "AIRPORT");
  assert.equal(ok.body.data.gates[0].autoCloseSeconds, undefined, "the door timer no longer exists");
});

it("auto exit rules: per vehicle type, with days and an amount", async () => {
  assert.equal((await put({ operations: { autoExitRules: [{ vehicleType: "CAR", days: 0 }] } })).status, 400);
  assert.equal((await put({ operations: { autoExitRules: [{ vehicleType: "PLANE", days: 3 }] } })).status, 400);
  const ok = await put({ operations: { autoExitRules: [{ vehicleType: "CAR", active: true, days: 2, amount: 300 }, { vehicleType: "BIKE", active: false, days: 1, amount: 50 }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.operations.autoExitRules.length, 2);
});

it("the daily job closes only the vehicle types with an active rule, once they are old enough", async () => {
  const oldCar = (await enter("MP09LL0001", "CAR")).body.data.session;
  const newCar = (await enter("MP09LL0002", "CAR")).body.data.session;
  const oldBike = (await enter("MP09LL0003", "BIKE")).body.data.session;
  await backdate(oldCar._id, 3);
  await backdate(newCar._id, 1);
  await backdate(oldBike._id, 5);
  const result = await closeForgottenTickets();
  assert.equal(result.length, 1);
  const car = await ParkingSession.findById(oldCar._id);
  assert.equal(car.isOpen, false);
  assert.equal(car.autoClosed, true);
  assert.match(car.overrideReason, /300/, "what is still owed is written on the ticket");
  assert.equal((await ParkingSession.findById(newCar._id)).isOpen, true, "not old enough yet");
  assert.equal((await ParkingSession.findById(oldBike._id)).isOpen, true, "its rule is switched off");
  s.oldBike = oldBike;
});

it("Run now applies one rule on request", async () => {
  assert.equal((await api("POST", `/api/locations/${s.loc._id}/auto-exit/run`, { token: s.a.token, body: { vehicleType: "BIKE" } })).status, 409, "switched off");
  assert.equal((await api("POST", `/api/locations/${s.loc._id}/auto-exit/run`, { token: s.a.token, body: { vehicleType: "TAXI" } })).status, 404, "no rule");
  assert.equal((await api("POST", `/api/locations/${s.loc._id}/auto-exit/run`, { token: s.a.token, body: { vehicleType: "NOPE" } })).status, 400);
  await put({ operations: { autoExitRules: [{ vehicleType: "BIKE", active: true, days: 1, amount: 0 }] } });
  const run = await api("POST", `/api/locations/${s.loc._id}/auto-exit/run`, { token: s.a.token, body: { vehicleType: "BIKE" } });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.data.closed, 1);
  assert.equal((await ParkingSession.findById(s.oldBike._id)).isOpen, false);
  assert.equal((await api("POST", `/api/locations/${s.loc._id}/auto-exit/run`, { token: s.a.token, body: { vehicleType: "BIKE" } })).body.data.closed, 0, "nothing left to close");
});

it("the table can be downloaded as Excel, CSV or PDF", async () => {
  for (const format of ["xlsx", "csv", "pdf"]) {
    const res = await bytes("GET", `/api/locations/export?format=${format}`, { token: s.a.token });
    assert.equal(res.status, 200, format);
    assert.ok(res.buffer.length > 100, format);
  }
  const csv = await bytes("GET", "/api/locations/export?format=csv", { token: s.a.token });
  const text = csv.buffer.toString("utf8");
  assert.match(text, /Airport/);
  assert.match(text, /AIRPORT/);
  assert.equal((await api("GET", "/api/locations/export?format=doc", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/locations/export")).status, 401);
});
