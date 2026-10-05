// Passes, second part: day/week/month terms, pass types, several vehicles on
// one pass, vehicle replacement and the vehicle history. Needs MongoDB.
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const Pass = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const passService = require("../services/passService");
const { localDateText } = require("../utils/time");

setup();

const s = {};
const enter = (vehicleNumber, token = s.entryToken) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
const exit = (vehicleNumber, token = s.exitToken) =>
  api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, vehicleNumber } });
const sell = (body, token = s.a.token) =>
  api("POST", "/api/passes", {
    token,
    body: { locationId: s.loc._id, vehicleType: "CAR", holderName: "Mira Shah", amount: 500, method: "CASH", ...body },
  });
const post = (path, body, token = s.a.token) => api("POST", `/api/passes${path}`, { token, body });
const days = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);

it("setup: company, location, tariff, gate staff, a second company", async () => {
  s.a = await registerCompany("pm");
  s.b = await registerCompany("pn");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Main", address: { line1: "MG Road" }, capacity: { car: 20, bike: 20 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  for (const [name, email, role] of [["Gate", "pm-entry@example.com", "ENTRY_OPERATOR"], ["Exit", "pm-exit@example.com", "EXIT_OPERATOR"]]) {
    const res = await api("POST", "/api/users", {
      token: s.a.token, body: { name, email, password: "Password123", role, locationIds: [s.loc._id] },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  s.entryToken = await login("pm-entry@example.com");
  s.exitToken = await login("pm-exit@example.com");
});

it("terms: days, weeks and months, with the old `months` still accepted", async () => {
  const today = localDateText();
  const daily = await sell({ vehicleNumber: "RJ14DAY001", unit: "DAY", count: 3 });
  assert.equal(daily.status, 201, JSON.stringify(daily.body));
  const d = daily.body.data;
  assert.equal(days(localDateText(new Date(d.pass.startDate)), localDateText(new Date(d.pass.endDate))), 3);
  assert.equal(localDateText(new Date(d.pass.startDate)), today);
  assert.equal(d.payment.periodUnit, "DAY");
  assert.equal(d.payment.periodCount, 3);

  const weekly = await sell({ vehicleNumber: "RJ14WEEK01", unit: "WEEK", count: 2, startDate: "2030-01-07" });
  assert.equal(weekly.status, 201, JSON.stringify(weekly.body));
  assert.equal(localDateText(new Date(weekly.body.data.pass.endDate)), "2030-01-21");
  assert.equal(weekly.body.data.pass.state, "UPCOMING");

  const monthly = await sell({ vehicleNumber: "RJ14MON001", months: 2, startDate: "2030-01-31" });
  assert.equal(monthly.status, 201, JSON.stringify(monthly.body));
  assert.equal(localDateText(new Date(monthly.body.data.pass.endDate)), "2030-03-31");
  assert.equal(monthly.body.data.payment.periodUnit, "MONTH");

  const dflt = await sell({ vehicleNumber: "RJ14DFLT01", startDate: "2030-01-31" });
  assert.equal(localDateText(new Date(dflt.body.data.pass.endDate)), "2030-02-28", "default is one month");
});

it("terms: wrong values are refused", async () => {
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", unit: "DAY", count: 0 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", unit: "DAY", count: 367 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", unit: "WEEK", count: 157 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", unit: "YEAR", count: 1 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", unit: "DAY", count: 2.5 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", months: 1, unit: "DAY", count: 2 })).status, 400, "not both");
  assert.equal((await sell({ vehicleNumber: "RJ14BAD001", passType: "GOLD" })).status, 400);
  assert.equal(await Pass.countDocuments({ vehicleNumber: "RJ14BAD001" }), 0);
});

it("renewing in days and weeks extends from the end of a running pass", async () => {
  const sold = await sell({ vehicleNumber: "RJ14REN001", unit: "DAY", count: 5 });
  const id = sold.body.data.pass._id;
  const end = localDateText(new Date(sold.body.data.pass.endDate));
  const renewed = await post(`/${id}/renew`, { locationId: s.loc._id, unit: "WEEK", count: 1, amount: 300, method: "UPI", transactionId: "UPI-MULTI-1" });
  assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
  assert.equal(days(end, localDateText(new Date(renewed.body.data.pass.endDate))), 7);
  assert.equal(renewed.body.data.payment.periodUnit, "WEEK");
  assert.equal((await post(`/${id}/renew`, { locationId: s.loc._id, unit: "DAY", count: 0, amount: 1, method: "CASH" })).status, 400);
  assert.equal(await PassPayment.countDocuments({ passId: id }), 2);
});

it("pass types: set when selling, changed later, and used as a list filter", async () => {
  const emp = await sell({ vehicleNumber: "RJ14EMP001", passType: "EMPLOYEE" });
  assert.equal(emp.body.data.pass.passType, "EMPLOYEE");
  const reg = await sell({ vehicleNumber: "RJ14REG001" });
  assert.equal(reg.body.data.pass.passType, "REGULAR", "REGULAR is the default");

  const changed = await api("PUT", `/api/passes/${reg.body.data.pass._id}`, { token: s.a.token, body: { passType: "VIP" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.data.passType, "VIP");
  assert.equal((await api("PUT", `/api/passes/${reg.body.data.pass._id}`, { token: s.a.token, body: { passType: "NOPE" } })).status, 400);

  const vip = await api("GET", "/api/passes?type=VIP", { token: s.a.token });
  assert.deepEqual(vip.body.data.passes.map((p) => p.vehicleNumber), ["RJ14REG001"]);
  assert.equal((await api("GET", "/api/passes?type=NOPE", { token: s.a.token })).status, 400);
});

it("several vehicles: a pass can be sold for a main vehicle plus extras", async () => {
  const res = await sell({
    vehicleNumber: "RJ14FAM001", maxVehicles: 3, extraVehicles: [{ vehicleNumber: "rj14 fam-002", vehicleType: "BIKE" }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const pass = res.body.data.pass;
  assert.deepEqual(pass.vehicles.map((v) => v.number), ["RJ14FAM001", "RJ14FAM002"]);
  assert.equal(pass.vehicles[1].type, "BIKE");
  assert.equal(pass.maxVehicles, 3);
  s.fam = pass;

  assert.equal((await sell({ vehicleNumber: "RJ14FAM003", maxVehicles: 1, extraVehicles: [{ vehicleNumber: "RJ14FAM004", vehicleType: "CAR" }] })).status, 400, "more than the limit");
  assert.equal((await sell({ vehicleNumber: "RJ14FAM003", extraVehicles: [{ vehicleNumber: "RJ14FAM003", vehicleType: "CAR" }] })).status, 400, "same plate twice");
  assert.equal((await sell({ vehicleNumber: "RJ14FAM005", extraVehicles: [{ vehicleNumber: "RJ14FAM002", vehicleType: "CAR" }] })).status, 409, "extra plate already on another pass");
  assert.equal(await Pass.countDocuments({ vehicleNumber: "RJ14FAM005" }), 0, "nothing was created by the refused sale");
  assert.equal((await sell({ vehicleNumber: "RJ14FAM002" })).status, 409, "an extra vehicle cannot also get its own pass");
});

it("several vehicles: every vehicle of the pass is let in and out free", async () => {
  for (const plate of ["RJ14FAM001", "RJ14FAM002"]) {
    const entry = await enter(plate);
    assert.equal(entry.status, 201, JSON.stringify(entry.body));
    assert.equal(entry.body.data.pass.passNumber, s.fam.passNumber);
  }
  const lookup = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14FAM002&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.data.pass.passNumber, s.fam.passNumber);
  assert.equal(lookup.body.data.pass.validHere, true);
  assert.deepEqual(lookup.body.data.pass.vehicles, ["RJ14FAM001", "RJ14FAM002"]);
  assert.deepEqual([...lookup.body.data.pass.inside].sort(), ["RJ14FAM001", "RJ14FAM002"], "both are inside");

  const out = await exit("RJ14FAM002");
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.data.paymentRequired, false);
  assert.equal(out.body.data.session.status, "PASS_EXIT");
  const after = await api("GET", `/api/passes/lookup?passNumber=${s.fam.passNumber}&locationId=${s.loc._id}`, { token: s.exitToken });
  assert.deepEqual(after.body.data.pass.inside, ["RJ14FAM001"], "a scanned pass card shows who is still inside");
});

it("vehicles: adding respects the limit, duplicates and other passes", async () => {
  const id = s.fam._id;
  const added = await post(`/${id}/vehicles`, { vehicleNumber: "RJ14FAM003", vehicleType: "CAR", reason: "Second car" });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.deepEqual(added.body.data.vehicles.map((v) => v.number), ["RJ14FAM001", "RJ14FAM002", "RJ14FAM003"]);
  assert.equal(added.body.data.vehicleChanges.at(-1).action, "ADDED");

  assert.equal((await post(`/${id}/vehicles`, { vehicleNumber: "RJ14FAM004", vehicleType: "CAR" })).status, 409, "limit of 3 reached");
  assert.equal((await post(`/${id}/vehicles`, { vehicleNumber: "RJ14FAM003", vehicleType: "CAR" })).status, 409, "already on the pass");

  // Raise the limit, then a vehicle of another pass is still refused.
  assert.equal((await api("PUT", `/api/passes/${id}`, { token: s.a.token, body: { maxVehicles: 4 } })).status, 200);
  const other = await sell({ vehicleNumber: "RJ14OTH001" });
  assert.equal(other.status, 201);
  assert.equal((await post(`/${id}/vehicles`, { vehicleNumber: "RJ14OTH001", vehicleType: "CAR" })).status, 409, "belongs to another pass");
  assert.equal((await api("PUT", `/api/passes/${id}`, { token: s.a.token, body: { maxVehicles: 2 } })).status, 400, "cannot go below the vehicles it has");

  assert.equal((await post(`/${id}/vehicles`, { vehicleNumber: "RJ14FAM004", vehicleType: "CAR" }, s.b.token)).status, 404, "another company");
  assert.equal((await post(`/${id}/vehicles`, { vehicleNumber: "RJ14FAM004", vehicleType: "CAR" }, s.entryToken)).status, 403, "operators cannot");
});

it("vehicles: removing needs a reason, not the last vehicle, and not one that is parked", async () => {
  const id = s.fam._id;
  assert.equal((await post(`/${id}/vehicles/remove`, { vehicleNumber: "RJ14FAM003" })).status, 400, "reason is required");
  assert.equal((await post(`/${id}/vehicles/remove`, { vehicleNumber: "RJ14ZZZ999", reason: "not there" })).status, 404);
  const parked = await post(`/${id}/vehicles/remove`, { vehicleNumber: "RJ14FAM001", reason: "sold the car" });
  assert.equal(parked.status, 409, "RJ14FAM001 is still inside");
  assert.match(parked.body.message, /parked/);

  const removed = await post(`/${id}/vehicles/remove`, { vehicleNumber: "RJ14FAM003", reason: "sold the car" });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(removed.body.data.vehicles.map((v) => v.number), ["RJ14FAM001", "RJ14FAM002"]);
  assert.equal(removed.body.data.vehicleChanges.at(-1).action, "REMOVED");
  const lookup = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14FAM003&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(lookup.body.data.pass, null, "the removed vehicle no longer has the pass");
  // It can now get a pass of its own.
  assert.equal((await sell({ vehicleNumber: "RJ14FAM003" })).status, 201);

  // The single-vehicle rule.
  const single = (await sell({ vehicleNumber: "RJ14ONE001" })).body.data.pass;
  const last = await post(`/${single._id}/vehicles/remove`, { vehicleNumber: "RJ14ONE001", reason: "no vehicles" });
  assert.equal(last.status, 409);
});

it("vehicles: replacing swaps the plate, keeps the position, and writes history", async () => {
  const pass = (await sell({ vehicleNumber: "RJ14REP001", maxVehicles: 2, extraVehicles: [{ vehicleNumber: "RJ14REP002", vehicleType: "CAR" }] })).body.data.pass;
  const id = pass._id;

  assert.equal((await post(`/${id}/vehicles/replace`, { from: "RJ14REP001", to: "RJ14REP003" })).status, 400, "reason is required");
  assert.equal((await post(`/${id}/vehicles/replace`, { from: "RJ14REP001", to: "RJ14REP001", reason: "same plate" })).status, 400);
  assert.equal((await post(`/${id}/vehicles/replace`, { from: "RJ14NOPE01", to: "RJ14REP003", reason: "not on pass" })).status, 404);
  assert.equal((await post(`/${id}/vehicles/replace`, { from: "RJ14REP001", to: "RJ14REP002", reason: "already here" })).status, 409);
  assert.equal((await post(`/${id}/vehicles/replace`, { from: "RJ14REP001", to: "RJ14OTH001", reason: "other pass" })).status, 409);

  const done = await post(`/${id}/vehicles/replace`, { from: "RJ14REP001", to: "RJ14REP003", vehicleType: "BIKE", reason: "New vehicle bought" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const p = done.body.data;
  assert.deepEqual(p.vehicles.map((v) => v.number), ["RJ14REP003", "RJ14REP002"], "same position");
  assert.equal(p.vehicleNumber, "RJ14REP003", "main vehicle follows the first vehicle");
  assert.equal(p.vehicleType, "BIKE");
  const change = p.vehicleChanges.at(-1);
  assert.equal(change.action, "REPLACED");
  assert.equal(change.from, "RJ14REP001");
  assert.equal(change.to, "RJ14REP003");
  assert.equal(change.reason, "New vehicle bought");

  const oldPlate = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14REP001&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(oldPlate.body.data.pass, null, "the old plate has no pass any more");
  const newPlate = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14REP003&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(newPlate.body.data.pass.passNumber, pass.passNumber);
  // The old plate is free for a new pass.
  assert.equal((await sell({ vehicleNumber: "RJ14REP001" })).status, 201);

  // A parked vehicle cannot be swapped out from under its session.
  assert.equal((await enter("RJ14REP002")).status, 201);
  const blocked = await post(`/${id}/vehicles/replace`, { from: "RJ14REP002", to: "RJ14REP004", reason: "swap plates" });
  assert.equal(blocked.status, 409);
  assert.equal((await exit("RJ14REP002")).status, 200);
  assert.equal((await post(`/${id}/vehicles/replace`, { from: "RJ14REP002", to: "RJ14REP004", reason: "swap plates" })).status, 200);
});

it("vehicles: a cancelled pass cannot be changed, and cancelling frees every vehicle", async () => {
  const pass = (await sell({ vehicleNumber: "RJ14CAN101", maxVehicles: 2, extraVehicles: [{ vehicleNumber: "RJ14CAN102", vehicleType: "CAR" }] })).body.data.pass;
  const cancel = await post(`/${pass._id}/cancel`, { reason: "Customer left" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await post(`/${pass._id}/vehicles`, { vehicleNumber: "RJ14CAN103", vehicleType: "CAR" })).status, 409);
  assert.equal((await post(`/${pass._id}/vehicles/replace`, { from: "RJ14CAN101", to: "RJ14CAN103", reason: "swap plates" })).status, 409);
  // Both plates can get new passes.
  assert.equal((await sell({ vehicleNumber: "RJ14CAN102" })).status, 201);
  assert.equal((await sell({ vehicleNumber: "RJ14CAN101" })).status, 201);
});

it("search finds a pass by any of its vehicles", async () => {
  const res = await api("GET", "/api/passes?q=RJ14FAM002", { token: s.a.token });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.passes.some((p) => p.passNumber === s.fam.passNumber));
});

it("old passes without a vehicle list still work and are filled in by the backfill", async () => {
  // Written straight to the database, the way an old version stored it.
  const sold = (await sell({ vehicleNumber: "RJ14OLD001" })).body.data.pass;
  await Pass.collection.updateOne({ passNumber: sold.passNumber }, { $unset: { vehicles: "", maxVehicles: "", passType: "" } });
  const raw = await Pass.collection.findOne({ passNumber: sold.passNumber });
  assert.equal(raw.vehicles, undefined);

  const found = await passService.findCurrentPass(raw.companyId, "RJ14OLD001");
  assert.ok(found, "found through vehicleNumber");
  const lookup = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14OLD001&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(lookup.body.data.pass.validHere, true);
  assert.deepEqual(lookup.body.data.pass.vehicles, ["RJ14OLD001"]);
  assert.equal(lookup.body.data.pass.passType, "REGULAR");

  assert.ok((await passService.backfillVehicles()) >= 1);
  const filled = await Pass.collection.findOne({ passNumber: sold.passNumber });
  assert.equal(filled.vehicles.length, 1);
  assert.equal(filled.vehicles[0].number, "RJ14OLD001");
  assert.equal(await passService.backfillVehicles(), 0, "a second run changes nothing");

  // An old pass can be given a second vehicle after raising the limit.
  const raise = await api("PUT", `/api/passes/${sold._id}`, { token: s.a.token, body: { maxVehicles: 2 } });
  assert.equal(raise.status, 200, JSON.stringify(raise.body));
  const add = await post(`/${sold._id}/vehicles`, { vehicleNumber: "RJ14OLD002", vehicleType: "CAR" });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.deepEqual(add.body.data.vehicles.map((v) => v.number), ["RJ14OLD001", "RJ14OLD002"]);
});

it("audit: vehicle changes are recorded", async () => {
  const logs = await api("GET", "/api/audit-logs", { token: s.a.token });
  const actions = new Set(logs.body.data.actions);
  for (const action of ["PASS_VEHICLE_ADD", "PASS_VEHICLE_REMOVE", "PASS_VEHICLE_REPLACE"]) {
    assert.ok(actions.has(action), `${action} should be audited`);
  }
});
