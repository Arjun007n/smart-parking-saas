// Lanes: unique names, the on/off switch, renames, removal of a lane that is in use, and the Lanes list
// (search and paging). Needs MongoDB.
const { setup, it, api, registerCompany, assert } = require("./helpers");

setup();

const s = {};
const put = (body) => api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body });
const lanes = (query = "") => api("GET", `/api/locations/${s.loc._id}/lanes${query}`, { token: s.a.token });
const enter = (vehicleNumber, gate) =>
  api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR", ...(gate ? { gate } : {}) } });

it("setup: a company, a location with two lanes, a car tariff", async () => {
  s.a = await registerCompany("ln");
  const made = await api("POST", "/api/locations", {
    token: s.a.token,
    body: { name: "Mall", address: { line1: "Main Road" }, capacity: { car: 20 }, gates: [{ name: "In 1", type: "ENTRY", cameraSerial: "CAM-001" }, { name: "Out 1", type: "EXIT" }] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.loc = made.body.data;
  assert.equal(s.loc.gates[0].isActive, true, "a new lane is on");
  assert.equal(s.loc.gates[0].cameraSerial, "CAM-001");
  const tariff = await api("POST", "/api/tariffs", { token: s.a.token, body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", additionalPerHour: 10 } });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
});

it("two lanes cannot share a name, capital letters included", async () => {
  const same = await put({ gates: [{ name: "In 1" }, { name: "in 1" }] });
  assert.equal(same.status, 400);
  assert.match(same.body.message, /in 1/i, "the message names the repeated lane");
  const created = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Dup", address: { line1: "x" }, gates: [{ name: "A" }, { name: "a" }] },
  });
  assert.equal(created.status, 400);
});

it("the switch turns a lane off: no entry through it, and the other lane still works", async () => {
  const lane = s.loc.gates[0];
  assert.equal((await api("PATCH", `/api/locations/${s.loc._id}/lanes/${lane._id}/status`, { token: s.a.token, body: { isActive: "no" } })).status, 400);
  assert.equal((await api("PATCH", `/api/locations/${s.loc._id}/lanes/${s.loc._id}/status`, { token: s.a.token, body: { isActive: false } })).status, 404, "not a lane of this location");
  const off = await api("PATCH", `/api/locations/${s.loc._id}/lanes/${lane._id}/status`, { token: s.a.token, body: { isActive: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.data.isActive, false);

  const refused = await enter("MP09LN0001", "In 1");
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.message, /switched off/);

  // Saving the form again does not turn the lane back on.
  const saved = await put({ gates: [{ _id: lane._id, name: "In 1", type: "ENTRY" }, { name: "Out 1", type: "EXIT" }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.gates[0].isActive, false);

  const on = await api("PATCH", `/api/locations/${s.loc._id}/lanes/${lane._id}/status`, { token: s.a.token, body: { isActive: true } });
  assert.equal(on.body.data.isActive, true);
  assert.equal((await enter("MP09LN0001", "In 1")).status, 201);
});

it("a lane that operators or devices use cannot be removed; a rename follows them", async () => {
  const device = await api("POST", "/api/hardware", { token: s.a.token, body: { locationId: s.loc._id, name: "cam-in", type: "ANPR_CAMERA", direction: "ENTRY", gate: "In 1" } });
  assert.equal(device.status, 201, JSON.stringify(device.body));

  const refused = await put({ gates: [{ name: "Out 1", type: "EXIT" }] });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.message, /In 1/);
  assert.match(refused.body.message, /1 device/);

  const lane = (await api("GET", `/api/locations/${s.loc._id}`, { token: s.a.token })).body.data.gates.find((g) => g.name === "In 1");
  const renamed = await put({ gates: [{ _id: lane._id, name: "North in", type: "ENTRY" }, { name: "Out 1", type: "EXIT" }] });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.data.gates[0].name, "North in");
  const moved = await api("GET", `/api/hardware/${device.body.data.device._id}`, { token: s.a.token });
  assert.equal(moved.body.data.device.gate, "North in", "the camera follows the renamed lane");

  // A lane nobody uses can be removed.
  const removed = await put({ gates: [{ _id: lane._id, name: "North in", type: "ENTRY" }] });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.data.gates.length, 1);
});

it("the lane list: devices, search and paging", async () => {
  const names = ["Bay A", "Bay B", "Bay C", "Bay D", "Bay E"];
  const current = (await api("GET", `/api/locations/${s.loc._id}`, { token: s.a.token })).body.data.gates;
  const keep = current.map((g) => ({ _id: g._id, name: g.name, type: g.type }));
  assert.equal((await put({ gates: [...keep, ...names.map((name) => ({ name, type: "BOTH", laneCode: `L-${name.slice(-1)}` }))] })).status, 200);

  const all = await lanes();
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.data.total, 6);
  const north = all.body.data.rows.find((r) => r.name === "North in");
  assert.equal(north.devices.length, 1);
  assert.equal(north.devices[0].name, "cam-in");

  const page = await lanes("?limit=4&page=2");
  assert.equal(page.body.data.rows.length, 2);
  assert.equal(page.body.data.pages, 2);
  assert.equal(page.body.data.rows[0].sn, 5, "the serial number follows the lane, not the page");

  const found = await lanes("?q=l-c");
  assert.deepEqual(found.body.data.rows.map((r) => r.name), ["Bay C"], "search by lane code");
  assert.equal((await lanes("?q=cam-in")).body.data.rows[0].name, "North in", "search by device name");
  assert.equal((await lanes("?q=nothing-like-this")).body.data.total, 0);
  assert.equal((await api("GET", `/api/locations/${s.loc._id}/lanes`)).status, 401);
});
