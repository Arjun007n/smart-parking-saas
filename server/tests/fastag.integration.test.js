// FASTag charging through the API, with the simulated partner: record-only when no partner is set up,
// a real charge when one is, declines, "not confirmed yet" answers, no double charge, no refund from here.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const FastagCharge = require("../models/FastagCharge");

setup();

const s = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backdate = (sessionId, minutes) =>
  ParkingSession.updateOne({ _id: sessionId }, { $set: { entryTime: new Date(Date.now() - minutes * 60 * 1000) } });
const enter = (vehicleNumber) =>
  api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
const quote = (vehicleNumber) =>
  api("POST", "/api/parking/exit", { token: s.exitToken, body: { locationId: s.loc._id, vehicleNumber } });
const pay = (body) => api("POST", "/api/payments", { token: s.exitToken, body });
// A vehicle that has stayed 89.5 minutes: 20 + 20 = 40 (tax included).
const FEE = 40;
const park = async (plate) => {
  const entry = await enter(plate);
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const session = entry.body.data.session;
  await backdate(session._id, 89.5);
  const q = await quote(plate);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.data.session.fee.total, FEE);
  return q.body.data.session;
};

it("setup: company, location, tariff, an exit operator with an open shift", async () => {
  s.a = await registerCompany("ftg");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Tag Lot", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, taxPercent: 18, taxInclusive: true },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const staff = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Exit Op", email: "ftg-exit@example.com", password: "Password123", role: "EXIT_OPERATOR", locationIds: [s.loc._id] },
  });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  s.exitToken = await login("ftg-exit@example.com");
  const shift = await api("POST", "/api/shifts", { token: s.exitToken, body: { locationId: s.loc._id, openingCash: 0 } });
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
});

it("no partner set up: FASTag is only recorded, as before", async () => {
  delete process.env.FASTAG_PROVIDER;
  const options = await api("GET", "/api/payments/options", { token: s.exitToken });
  assert.equal(options.body.data.fastag, false);
  const session = await park("RJ14FT0001");
  const res = await pay({ sessionId: session._id, method: "FASTAG", amount: FEE });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.payment.method, "FASTAG");
  assert.equal(res.body.data.payment.fastagChargeId, undefined);
  assert.equal(await FastagCharge.countDocuments({}), 0, "nothing was charged");
});

it("partner set up: the option is offered, and recording without charging is no longer possible", async () => {
  process.env.FASTAG_PROVIDER = "simulated";
  // "Unknown" tags (ending in U) are confirmed by the pretend partner 4 seconds after the charge.
  process.env.FASTAG_SIM_DELAY_MS = "4000";
  const options = await api("GET", "/api/payments/options", { token: s.exitToken });
  assert.equal(options.body.data.fastag, true);
  assert.equal(options.body.data.fastagSimulated, true);

  s.v2 = await park("RJ14FT0002");
  assert.equal((await pay({ sessionId: s.v2._id, method: "FASTAG", amount: FEE })).status, 400, "a tag number is needed");
  assert.equal((await pay({ sessionId: s.v2._id, method: "FASTAG", amount: FEE, tagId: "ABCD0002", transactionId: "MADEUP-1" })).status, 400, "no hand-typed reference");
  assert.equal((await pay({ sessionId: s.v2._id, method: "FASTAG", amount: FEE, tagId: "!!!!" })).status, 400);
  assert.equal(await FastagCharge.countDocuments({ sessionId: s.v2._id }), 0);

  // The entry screen cannot charge a tag, so an advance "by FASTag" is refused while charging is on.
  const advance = await api("POST", "/api/parking/entry", {
    token: s.a.token,
    body: { locationId: s.loc._id, vehicleNumber: "RJ14FT0099", vehicleType: "CAR", advance: { amount: 20, method: "FASTAG" } },
  });
  assert.equal(advance.status, 400, JSON.stringify(advance.body));
});

it("a declined tag charges nothing, keeps the vehicle inside, and cash still works", async () => {
  const declined = await pay({ sessionId: s.v2._id, method: "FASTAG", amount: FEE, tagId: "ABCD000F" });
  assert.equal(declined.status, 422, JSON.stringify(declined.body));
  assert.match(declined.body.message, /not charged/);
  assert.equal(await Payment.countDocuments({ sessionId: s.v2._id }), 0);
  assert.equal((await ParkingSession.findById(s.v2._id)).isOpen, true);

  const cash = await pay({ sessionId: s.v2._id, method: "CASH", amount: FEE });
  assert.equal(cash.status, 201, JSON.stringify(cash.body));
});

it("a good tag is charged, the payment carries the partner's reference, and the vehicle leaves", async () => {
  s.v3 = await park("RJ14FT0003");
  const res = await pay({ sessionId: s.v3._id, method: "FASTAG", amount: FEE, tagId: "3416 1fa8 20" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.completed, true);
  const payment = res.body.data.payment;
  assert.equal(payment.method, "FASTAG");
  assert.equal(payment.tagId, "34161FA820");
  assert.match(payment.transactionId, /^FASTAG:SIM-/);
  assert.equal(payment.amount, FEE);
  assert.equal((await ParkingSession.findById(s.v3._id)).isOpen, false);

  const charge = await FastagCharge.findOne({ sessionId: s.v3._id });
  assert.equal(charge.status, "SUCCESS");
  assert.equal(String(charge.paymentId), String(payment._id));

  // The same request again (a lost answer, a double tap) changes nothing.
  const again = await pay({ sessionId: s.v3._id, method: "FASTAG", amount: FEE, tagId: "34161FA820" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.repeated, true);
  assert.equal(await Payment.countDocuments({ sessionId: s.v3._id, status: "SUCCESS" }), 1);
  assert.equal(await FastagCharge.countDocuments({ sessionId: s.v3._id }), 1);
});

it("'not confirmed yet' blocks other payment modes, and asking again finishes it without charging twice", async () => {
  s.v4 = await park("RJ14FT0004");
  const first = await pay({ sessionId: s.v4._id, method: "FASTAG", amount: FEE, tagId: "ABCD000U" });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.data.completed, false);
  assert.equal(first.body.data.fastag.status, "UNKNOWN");
  assert.equal((await ParkingSession.findById(s.v4._id)).isOpen, true);

  // The customer must not be charged twice: no cash while the tag might have been charged.
  const cash = await pay({ sessionId: s.v4._id, method: "CASH", amount: FEE });
  assert.equal(cash.status, 409, JSON.stringify(cash.body));
  assert.match(cash.body.message, /still being confirmed/);

  // Asking before the partner has confirmed changes nothing.
  const early = await pay({ sessionId: s.v4._id, method: "FASTAG", amount: FEE, tagId: "ABCD000U" });
  assert.equal(early.status, 202, JSON.stringify(early.body));
  await sleep(4200);
  const second = await pay({ sessionId: s.v4._id, method: "FASTAG", amount: FEE, tagId: "ABCD000U" });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.completed, true);
  assert.equal(await FastagCharge.countDocuments({ sessionId: s.v4._id }), 1, "one attempt, one charge");
  assert.equal(await Payment.countDocuments({ sessionId: s.v4._id, status: "SUCCESS" }), 1);
});

it("while a charge is unconfirmed the fee is fixed, online payment is blocked, and an admin override flags the money", async () => {
  s.v6 = await park("RJ14FT0006");
  const first = await pay({ sessionId: s.v6._id, method: "FASTAG", amount: FEE, tagId: "ABCD006U" });
  assert.equal(first.status, 202, JSON.stringify(first.body));

  // Looking the vehicle up again does not work the fee out again (the charge was for this fee).
  await backdate(s.v6._id, 300);
  const again = await quote("RJ14FT0006");
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.fastagCharge.status, "UNKNOWN");
  assert.equal(again.body.data.fastagCharge.tagId, "ABCD006U");
  assert.equal(again.body.data.session.fee.total, FEE);

  // Another tag, or an online link, would risk charging the customer twice.
  assert.equal((await pay({ sessionId: s.v6._id, method: "FASTAG", amount: FEE, tagId: "ABCD0099" })).status, 409);
  assert.equal((await pay({ sessionId: s.v6._id, method: "GATEWAY", amount: FEE })).status, 409);

  const override = await api("POST", `/api/parking/sessions/${s.v6._id}/override`, { token: s.a.token, body: { reason: "Partner is down, customer is waiting" } });
  assert.equal(override.status, 200, JSON.stringify(override.body));
  assert.match(override.body.warning, /flagged/);
  assert.equal((await FastagCharge.findOne({ sessionId: s.v6._id })).needsReview, true);
});

it("two requests at once make one charge and one payment", async () => {
  s.v5 = await park("RJ14FT0005");
  const body = { sessionId: s.v5._id, method: "FASTAG", amount: FEE, tagId: "ABCD0005" };
  const [x, y] = await Promise.all([pay(body), pay(body)]);
  for (const r of [x, y]) assert.ok([200, 201, 202].includes(r.status), JSON.stringify(r.body));
  // If the second saw the first still in flight it was told to check again: do that.
  if (x.status === 202 || y.status === 202) {
    const check = await pay(body);
    assert.ok([200, 201].includes(check.status), JSON.stringify(check.body));
  }
  assert.equal(await FastagCharge.countDocuments({ sessionId: s.v5._id }), 1);
  assert.equal(await Payment.countDocuments({ sessionId: s.v5._id, status: "SUCCESS" }), 1);
  assert.equal((await ParkingSession.findById(s.v5._id)).isOpen, false);
});

it("a charged FASTag cannot be refunded from here; a recorded one still can", async () => {
  const payment = await Payment.findOne({ sessionId: s.v3._id, status: "SUCCESS" });
  const res = await api("POST", `/api/payments/${payment._id}/refund`, { token: s.a.token, body: { reason: "Customer asked for it" } });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.message, /FASTag partner/);
  assert.equal((await Payment.findById(payment._id)).status, "SUCCESS");

  const recorded = await Payment.findOne({ method: "FASTAG", fastagChargeId: { $exists: false }, status: "SUCCESS" });
  const ok = await api("POST", `/api/payments/${recorded._id}/refund`, { token: s.a.token, body: { reason: "Recorded by mistake" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

it("charged FASTag fees count in the shift totals like any other non-cash payment", async () => {
  const current = await api("GET", "/api/shifts/current", { token: s.exitToken });
  assert.equal(current.status, 200, JSON.stringify(current.body));
  const fastag = current.body.data.totals.byMethod.find((m) => m.method === "FASTAG");
  // v3, v4 and v5 were charged 40 each (refund bookkeeping of the recorded v1 payment is covered elsewhere).
  assert.ok(fastag && fastag.amount >= 120, JSON.stringify(current.body.data.totals.byMethod));
});

it("cleanup", () => {
  delete process.env.FASTAG_PROVIDER;
  delete process.env.FASTAG_SIM_DELAY_MS;
});
