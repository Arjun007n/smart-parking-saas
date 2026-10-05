// Monthly passes through the API: selling, renewing, free exit on a valid
// pass, suspension, scoping, and the money in collection and shift totals.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Pass = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const Notification = require("../models/Notification");
const passService = require("../services/passService");

setup();

const s = {};
const backdate = (id, minutes) =>
  ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - minutes * 60000) } });
const enter = (vehicleNumber, token = s.entryToken) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
const exit = (body, token = s.exitToken) =>
  api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, ...body } });
const sell = (body, token = s.a.token) =>
  api("POST", "/api/passes", {
    token,
    body: {
      locationId: s.loc._id, vehicleType: "CAR", holderName: "Asha Rao", months: 1, amount: 1000, method: "CASH", ...body,
    },
  });

it("setup: a company with two locations, a tariff, staff and a location admin", async () => {
  s.a = await registerCompany("pa");
  s.b = await registerCompany("pb");
  const make = async (name) => {
    const res = await api("POST", "/api/locations", {
      token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const tariff = await api("POST", "/api/tariffs", {
      token: s.a.token,
      body: { locationId: res.body.data._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
    });
    assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
    return res.body.data;
  };
  s.loc = await make("Main");
  s.loc2 = await make("Annex");

  const staff = (name, email, role, locationIds) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds } });
  await staff("Gate", "pa-entry@example.com", "ENTRY_OPERATOR", [s.loc._id]);
  await staff("Exit", "pa-exit@example.com", "EXIT_OPERATOR", [s.loc._id]);
  await staff("Site", "pa-site@example.com", "LOCATION_ADMIN", [s.loc._id]);
  await staff("AnnexAdmin", "pa-annex@example.com", "LOCATION_ADMIN", [s.loc2._id]);
  s.entryToken = await login("pa-entry@example.com");
  s.exitToken = await login("pa-exit@example.com");
  s.site = await login("pa-site@example.com");
  s.annex = await login("pa-annex@example.com");
});

it("passes: selling one needs a valid vehicle, period and payment", async () => {
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001" }, s.entryToken)).status, 403, "operators cannot sell passes");
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", months: 0 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", months: 37 })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", amount: 0 })).status, 400, "0 must be complimentary");
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", method: "COMPLIMENTARY" })).status, 400, "complimentary has no amount");
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", transactionId: "UPI-123456" })).status, 400, "cash has no reference");
  assert.equal((await sell({ vehicleNumber: "ab" })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", startDate: "2026-02-31" })).status, 400);
  assert.equal((await sell({ vehicleNumber: "RJ14PA0001", locationId: s.loc._id }, s.b.token)).status, 404, "another company");
  assert.equal(await Pass.countDocuments({ companyId: s.a.company._id }), 0, "nothing was created by the failed attempts");

  const res = await sell({ vehicleNumber: "rj14 pa-0001", phone: "9999999999" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.pass = res.body.data.pass;
  assert.match(s.pass.passNumber, passService.PASS_PATTERN);
  assert.equal(s.pass.vehicleNumber, "RJ14PA0001");
  assert.equal(s.pass.state, "ACTIVE");
  assert.deepEqual(s.pass.locationIds, [], "company admin: all locations");
  assert.equal(res.body.data.payment.amount, 1000);
  assert.equal(res.body.data.payment.kind, "NEW");
  assert.equal(await PassPayment.countDocuments({ passId: s.pass._id }), 1);

  const again = await sell({ vehicleNumber: "RJ14PA0001" });
  assert.equal(again.status, 409, "one current pass per vehicle");
  assert.match(again.body.message, /Renew that pass/);
  assert.equal(await PassPayment.countDocuments({ companyId: s.a.company._id }), 1, "no second payment");
});

it("passes: a free pass is marked complimentary and is not money", async () => {
  const res = await sell({ vehicleNumber: "RJ14FREE01", amount: 0, method: "COMPLIMENTARY", holderName: "Security staff" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.payment.method, "COMPLIMENTARY");
  s.freePass = res.body.data.pass;
});

it("passes: gate staff can look a vehicle up; the answer is about this location", async () => {
  const hit = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14PA0001&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(hit.status, 200, JSON.stringify(hit.body));
  assert.equal(hit.body.data.pass.state, "ACTIVE");
  assert.equal(hit.body.data.pass.validHere, true);
  const miss = await api("GET", `/api/passes/lookup?vehicleNumber=ZZ99ZZ9999&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(miss.body.data.pass, null);
  // An operator of Main cannot ask about Annex, and another company sees nothing.
  assert.equal((await api("GET", `/api/passes/lookup?vehicleNumber=RJ14PA0001&locationId=${s.loc2._id}`, { token: s.entryToken })).status, 404);
  assert.equal((await api("GET", `/api/passes/lookup?vehicleNumber=RJ14PA0001&locationId=${s.loc._id}`, { token: s.b.token })).status, 404);
  assert.equal((await api("GET", "/api/passes/lookup?vehicleNumber=RJ14PA0001")).status, 401);
  // A scanned pass card: look up by pass number.
  const byNumber = await api("GET", `/api/passes/lookup?passNumber=${hit.body.data.pass.passNumber}&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(byNumber.body.data.pass.vehicleNumber, "RJ14PA0001");
  const noSuchNumber = await api("GET", `/api/passes/lookup?passNumber=P-260101-AAAAAA&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(noSuchNumber.body.data.pass, null);
  assert.equal((await api("GET", `/api/passes/lookup?passNumber=${hit.body.data.pass.passNumber}&locationId=${s.loc._id}`, { token: s.b.token })).status, 404);
});

it("exit: a vehicle with a valid pass leaves free, as a pass exit, even after a long stay", async () => {
  const entry = await enter("RJ14PA0001");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal(entry.body.data.pass.validHere, true, "the entry screen can show the pass holder");
  assert.equal(String(entry.body.data.session.passId), String(s.pass._id));

  await backdate(entry.body.data.session._id, 600);
  const out = await exit({ ticketNumber: entry.body.data.session.ticketNumber });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.data.paymentRequired, false);
  assert.equal(out.body.data.session.status, "PASS_EXIT");
  assert.equal(out.body.data.session.fee.reason, "PASS");
  assert.equal(out.body.data.session.fee.total, 0);
  assert.equal(out.body.data.pass.passNumber, s.pass.passNumber);
  assert.equal(out.body.data.session.isOpen, false);

  const receipt = await api("GET", `/api/parking/sessions/${entry.body.data.session._id}/receipt`, { token: s.exitToken });
  assert.equal(receipt.body.data.pass.passNumber, s.pass.passNumber);
  assert.equal(receipt.body.data.paid, 0);
});

it("exit: a lost ticket costs a pass holder nothing", async () => {
  const entry = await enter("RJ14FREE01");
  await backdate(entry.body.data.session._id, 120);
  const out = await exit({ vehicleNumber: "RJ14FREE01", lostTicket: true });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.data.paymentRequired, false);
  assert.equal(out.body.data.session.status, "PASS_EXIT");
});

it("exit: vehicles without a pass still pay the tariff", async () => {
  const entry = await enter("RJ14NO0001");
  assert.equal(entry.body.data.pass, null);
  await backdate(entry.body.data.session._id, 90);
  const out = await exit({ ticketNumber: entry.body.data.session.ticketNumber });
  assert.equal(out.body.data.paymentRequired, true);
  assert.ok(out.body.data.session.fee.total > 0);
  assert.equal(out.body.data.pass, null);
  s.unpaid = out.body.data.session;
});

it("passes: suspending stops the free exit at once, resuming restores it", async () => {
  const suspend = await api("POST", `/api/passes/${s.pass._id}/suspend`, { token: s.a.token, body: { reason: "Holder asked to pause" } });
  assert.equal(suspend.status, 200, JSON.stringify(suspend.body));
  assert.equal(suspend.body.data.state, "SUSPENDED");
  assert.equal((await api("POST", `/api/passes/${s.pass._id}/suspend`, { token: s.a.token, body: { reason: "Again please" } })).status, 409);

  const entry = await enter("RJ14PA0001");
  assert.equal(entry.body.data.pass.state, "SUSPENDED", "the operator is told why the pass does not apply");
  assert.equal(entry.body.data.pass.validHere, false);
  assert.equal(entry.body.data.session.passId, undefined);
  await backdate(entry.body.data.session._id, 90);
  const out = await exit({ ticketNumber: entry.body.data.session.ticketNumber });
  assert.equal(out.body.data.paymentRequired, true);
  assert.equal(out.body.data.pass.state, "SUSPENDED");

  // Resuming and looking up again: the quoted fee is replaced by the pass (PAYMENT_PENDING -> PASS_EXIT).
  assert.equal((await api("POST", `/api/passes/${s.pass._id}/resume`, { token: s.a.token })).status, 200);
  const again = await exit({ ticketNumber: entry.body.data.session.ticketNumber });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.paymentRequired, false);
  assert.equal(again.body.data.session.status, "PASS_EXIT");
});

it("passes: an expired pass does not apply, and renewing restarts it from today without a free gap", async () => {
  const sold = await sell({ vehicleNumber: "RJ14EXP001", holderName: "Old Pass" });
  const pass = sold.body.data.pass;
  const longAgo = new Date(Date.now() - 40 * 86400000);
  await Pass.updateOne({ _id: pass._id }, { $set: { startDate: new Date(longAgo.getTime() - 30 * 86400000), endDate: longAgo } });

  const lookup = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14EXP001&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(lookup.body.data.pass.state, "EXPIRED");
  assert.equal(lookup.body.data.pass.validHere, false);

  const renew = await api("POST", `/api/passes/${pass._id}/renew`, {
    token: s.a.token, body: { locationId: s.loc._id, months: 2, amount: 1800, method: "UPI", transactionId: "UPI-RENEW-1" },
  });
  assert.equal(renew.status, 201, JSON.stringify(renew.body));
  assert.equal(renew.body.data.pass.state, "ACTIVE");
  assert.equal(renew.body.data.pass.renewals, 1);
  assert.equal(renew.body.data.payment.kind, "RENEWAL");
  assert.ok(new Date(renew.body.data.pass.startDate) > longAgo, "the dead period is not given away");
  assert.equal((await api("POST", `/api/passes/${pass._id}/renew`, {
    token: s.a.token, body: { locationId: s.loc._id, months: 1, amount: 900, method: "UPI", transactionId: "UPI-RENEW-1" },
  })).status, 409, "a payment reference can be used once");
  assert.equal((await Pass.findById(pass._id)).renewals, 1, "the failed renewal was rolled back");

  // Renewing while it still runs extends from its end.
  const before = new Date(renew.body.data.pass.endDate);
  const early = await api("POST", `/api/passes/${pass._id}/renew`, {
    token: s.a.token, body: { locationId: s.loc._id, months: 1, amount: 900, method: "CASH" },
  });
  assert.equal(early.status, 201);
  assert.ok(new Date(early.body.data.pass.endDate) > before);
  assert.equal(early.body.data.pass.renewals, 2);
  assert.equal(new Date(early.body.data.pass.startDate).getTime(), new Date(renew.body.data.pass.startDate).getTime(), "continuing keeps its start");
});

it("passes: cancelling ends it for good; the vehicle can then get a new pass", async () => {
  const sold = await sell({ vehicleNumber: "RJ14CAN001" });
  const id = sold.body.data.pass._id;
  assert.equal((await api("POST", `/api/passes/${id}/cancel`, { token: s.a.token, body: { reason: "no" } })).status, 400, "reason needed");
  assert.equal((await api("POST", `/api/passes/${id}/cancel`, { token: s.a.token, body: { reason: "Holder left the building" } })).status, 200);
  assert.equal((await api("POST", `/api/passes/${id}/renew`, {
    token: s.a.token, body: { locationId: s.loc._id, months: 1, amount: 1, method: "CASH" },
  })).status, 409, "a cancelled pass cannot be renewed");
  assert.equal((await api("POST", `/api/passes/${id}/resume`, { token: s.a.token })).status, 409);
  const fresh = await sell({ vehicleNumber: "RJ14CAN001" });
  assert.equal(fresh.status, 201, "a cancelled pass does not block a new one");
  assert.notEqual(fresh.body.data.pass.passNumber, sold.body.data.pass.passNumber);
});

it("passes: a location admin only handles passes of their own locations", async () => {
  assert.equal((await sell({ vehicleNumber: "RJ14LOC001" }, s.site)).status, 400, "must name a location");
  assert.equal((await sell({ vehicleNumber: "RJ14LOC001", locationIds: [s.loc2._id] }, s.site)).status, 403, "not their location");
  const mine = await sell({ vehicleNumber: "RJ14LOC001", locationIds: [s.loc._id] }, s.site);
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  s.sitePass = mine.body.data.pass;

  const list = await api("GET", "/api/passes", { token: s.site });
  assert.equal(list.status, 200);
  const numbers = list.body.data.passes.map((p) => p.vehicleNumber);
  assert.deepEqual(numbers, ["RJ14LOC001"], "company-wide passes are not theirs to see");
  assert.equal((await api("GET", `/api/passes/${s.pass._id}`, { token: s.site })).status, 404);
  assert.equal((await api("POST", `/api/passes/${s.pass._id}/cancel`, { token: s.site, body: { reason: "Should not work" } })).status, 404);
  assert.equal((await api("GET", `/api/passes/${s.sitePass._id}`, { token: s.annex })).status, 404, "another location's admin");
  assert.equal((await api("GET", `/api/passes/${s.sitePass._id}`, { token: s.b.token })).status, 404, "another company");

  // A pass for one location is not valid at the other.
  const lookup = await api("GET", `/api/passes/lookup?vehicleNumber=RJ14LOC001&locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(lookup.body.data.pass.validHere, true);
  const stored = await Pass.findById(s.sitePass._id);
  assert.equal(passService.isValidAt(stored, s.loc2._id), false);
});

it("passes: the list searches and filters by state", async () => {
  const all = await api("GET", "/api/passes", { token: s.a.token });
  assert.equal(all.status, 200);
  assert.ok(all.body.data.total >= 5);
  const byPlate = await api("GET", "/api/passes?q=rj14 pa", { token: s.a.token });
  assert.deepEqual(byPlate.body.data.passes.map((p) => p.vehicleNumber), ["RJ14PA0001"]);
  const byName = await api("GET", "/api/passes?q=security", { token: s.a.token });
  assert.deepEqual(byName.body.data.passes.map((p) => p.vehicleNumber), ["RJ14FREE01"]);
  const expiring = await api("GET", "/api/passes?state=EXPIRING", { token: s.a.token });
  assert.equal(expiring.status, 200);
  const cancelled = await api("GET", "/api/passes?state=CANCELLED", { token: s.a.token });
  assert.ok(cancelled.body.data.passes.every((p) => p.state === "CANCELLED"));
  assert.equal((await api("GET", "/api/passes?state=BOGUS", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/passes", { token: s.entryToken })).status, 403);
});

it("passes: pass money is in the daily collection, revenue report and operator report", async () => {
  const collection = await api("GET", "/api/payments/collection", { token: s.a.token });
  assert.equal(collection.status, 200, JSON.stringify(collection.body));
  const d = collection.body.data;
  assert.ok(d.passes.amount >= 1000 + 1800 + 900 + 1000, "all sales of the day");
  assert.equal(d.total.amount, d.passes.amount, "no parking payment was taken in this file");
  const byMethod = Object.fromEntries(d.byMethod.map((m) => [m.key, m.amount]));
  assert.ok(byMethod.CASH >= 1000 && byMethod.UPI >= 1800);
  assert.equal(byMethod.COMPLIMENTARY, undefined, "free passes are not money");

  const revenue = await api("GET", "/api/reports/revenue", { token: s.a.token });
  assert.equal(revenue.status, 200, JSON.stringify(revenue.body));
  const today = revenue.body.data.rows[0];
  assert.equal(today.collected, d.total.amount);
  assert.equal(today.passes, d.passes.amount);

  const operators = await api("GET", "/api/reports/operators", { token: s.a.token });
  const rows = operators.body.data.rows;
  const admin = rows.find((r) => r.operator.startsWith("Admin"));
  const site = rows.find((r) => r.operator === "Site");
  assert.equal(admin.collected + site.collected, d.total.amount, "every pass sale is credited to whoever took the money");
  assert.equal(site.collected, 1000);
});

it("shifts: cash taken for a pass is in the drawer the collecting person has open", async () => {
  // The location admin opens a shift, sells a cash pass and a UPI renewal, then the totals show both.
  const open = await api("POST", "/api/shifts", { token: s.site, body: { locationId: s.loc._id, openingCash: 100 } });
  assert.equal(open.status, 201, JSON.stringify(open.body));
  const sold = await sell({ vehicleNumber: "RJ14SHF001", amount: 500, locationIds: [s.loc._id] }, s.site);
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  const renewed = await api("POST", `/api/passes/${s.sitePass._id}/renew`, {
    token: s.site, body: { locationId: s.loc._id, months: 1, amount: 700, method: "UPI", transactionId: "UPI-SHIFT-9" },
  });
  assert.equal(renewed.status, 201, JSON.stringify(renewed.body));

  const current = await api("GET", "/api/shifts/current", { token: s.site });
  const t = current.body.data.totals;
  assert.equal(t.cashCollected, 500);
  assert.equal(t.expectedCash, 600, "100 opening + 500 cash; UPI is not in the drawer");
  assert.equal(t.collected, 1200);
  assert.equal(t.passes.amount, 1200);
  const methods = Object.fromEntries(t.byMethod.map((m) => [m.method, m.amount]));
  assert.deepEqual(methods, { CASH: 500, UPI: 700 });
  const close = await api("POST", `/api/shifts/${current.body.data._id}/close`, { token: s.site, body: { closingCash: 600 } });
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.data.difference, 0);
});

it("alerts: passes ending within a week raise one alert each, once", async () => {
  const sold = await sell({ vehicleNumber: "RJ14SOON01" });
  await Pass.updateOne({ _id: sold.body.data.pass._id }, { $set: { endDate: new Date(Date.now() + 2.5 * 86400000) } });
  const first = await passService.checkPassExpiry();
  assert.ok(first >= 1);
  assert.equal(await passService.checkPassExpiry(), 0, "the same alert is not raised twice");
  const alert = await Notification.findOne({ type: "PASS_EXPIRY", "data.vehicleNumber": "RJ14SOON01" });
  assert.ok(alert);
  assert.match(alert.title, /ends in 3 days/);
});

it("audit: selling, renewing, suspending and cancelling are recorded", async () => {
  const logs = await api("GET", "/api/audit-logs", { token: s.a.token });
  assert.equal(logs.status, 200);
  const actions = new Set(logs.body.data.actions);
  for (const action of ["PASS_CREATE", "PASS_RENEW", "PASS_SUSPEND", "PASS_RESUME", "PASS_CANCEL"]) {
    assert.ok(actions.has(action), `${action} should be audited`);
  }
});
