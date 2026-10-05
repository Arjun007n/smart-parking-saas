// Advance payments taken at entry, end to end: entry -> exit (fee less advance)
// -> receipt -> shift / collection totals, and cancelling an entry.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const advances = require("../services/advanceService");

setup();

const s = {};
const backdate = (sessionId, minutes) =>
  ParkingSession.updateOne({ _id: sessionId }, { $set: { entryTime: new Date(Date.now() - minutes * 60 * 1000) } });
const occupied = async () => (await api("GET", `/api/locations/${s.loc._id}`, { token: s.a.token })).body.data.occupied.car;
const enter = (vehicleNumber, extra = {}, token = s.a.token) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR", ...extra } });
const exit = (body, token = s.a.token) => api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, ...body } });
const pay = (body, token = s.a.token) => api("POST", "/api/payments", { token, body });
const advanceRow = (sessionId) => Payment.findOne({ sessionId, kind: "ADVANCE" });

// 89.5 minutes is a 90 minute stay: 20 + 20 = 40 (see tests/week3.integration.test.js).
const FEE = 40;
const STAY = 89.5;

it("setup: company, location, tariff, an entry operator and an open shift", async () => {
  s.a = await registerCompany("adv");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Advance Lot", address: { line1: "MG Road" }, capacity: { car: 10 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: {
      locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10,
      slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, lostTicketFee: 200, taxPercent: 18, taxInclusive: true,
    },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const staff = await api("POST", "/api/users", {
    token: s.a.token,
    body: { name: "Entry Op", email: "adv-entry@example.com", password: "Password123", role: "ENTRY_OPERATOR", locationIds: [s.loc._id] },
  });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  s.entryToken = await login("adv-entry@example.com");
  const shift = await api("POST", "/api/shifts", { token: s.a.token, body: { locationId: s.loc._id, openingCash: 0 } });
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
  s.shift = shift.body.data;
});

it("entry: a bad advance is refused and leaves no ticket behind", async () => {
  // The entry operator cannot take money.
  const noRight = await enter("RJ14AD0001", { advance: { amount: 50, method: "CASH" } }, s.entryToken);
  assert.equal(noRight.status, 403, JSON.stringify(noRight.body));
  assert.equal((await enter("RJ14AD0001", { advance: { amount: -5 } })).status, 400);
  assert.equal((await enter("RJ14AD0001", { advance: { amount: 50, method: "GATEWAY" } })).status, 400);
  assert.equal((await enter("RJ14AD0001", { advance: { amount: 50, method: "BITCOIN" } })).status, 400);
  assert.equal((await enter("RJ14AD0001", { advance: { amount: 999999 } })).status, 400);
  assert.equal(await occupied(), 0);
  assert.equal(await ParkingSession.countDocuments({ vehicleNumber: "RJ14AD0001" }), 0);
  // The entry operator can still make an ordinary entry, and 0 means "no advance".
  const plain = await enter("RJ14AD0001", {}, s.entryToken);
  assert.equal(plain.status, 201, JSON.stringify(plain.body));
  assert.equal(plain.body.data.session.advance, undefined);
  await api("POST", `/api/parking/sessions/${plain.body.data.session._id}/cancel`, { token: s.a.token, body: { reason: "Test cleanup" } });
  const zero = await enter("RJ14AD0002", { advance: { amount: 0 } });
  assert.equal(zero.status, 201);
  assert.equal(zero.body.data.session.advance, undefined);
  assert.equal(await Payment.countDocuments({ sessionId: zero.body.data.session._id }), 0);
  await api("POST", `/api/parking/sessions/${zero.body.data.session._id}/cancel`, { token: s.a.token, body: { reason: "Test cleanup" } });
  assert.equal(await occupied(), 0);
});

it("entry: an advance is recorded as money taken, in the operator's open shift", async () => {
  const res = await enter("RJ14AD0003", { advance: { amount: 100, method: "CASH" }, idempotencyKey: "advance-key-0003" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.v1 = res.body.data.session;
  assert.equal(s.v1.advance.amount, 100);
  assert.equal(s.v1.advance.method, "CASH");
  const row = await advanceRow(s.v1._id);
  assert.equal(row.amount, 100);
  assert.equal(row.status, "SUCCESS");
  assert.equal(String(row.shiftId), s.shift._id);
  assert.equal(String(s.v1.advance.paymentId), String(row._id));

  // Sending the same request again returns the same ticket and takes no second advance.
  const again = await enter("RJ14AD0003", { advance: { amount: 100, method: "CASH" }, idempotencyKey: "advance-key-0003" });
  assert.equal(again.body.data.repeated, true);
  assert.equal(await Payment.countDocuments({ sessionId: s.v1._id }), 1);

  const current = await api("GET", "/api/shifts/current", { token: s.a.token });
  assert.equal(current.body.data.totals.cashCollected, 100);
  assert.equal(current.body.data.totals.expectedCash, 100);
});

it("entry: a payment reference can be used once, and a refused reference leaves no ticket", async () => {
  const first = await enter("RJ14AD0004", { advance: { amount: 30, method: "UPI", transactionId: "UPI-ADV-1" } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  s.v4 = first.body.data.session;
  const before = await occupied();
  const second = await enter("RJ14AD0005", { advance: { amount: 30, method: "UPI", transactionId: "UPI-ADV-1" } });
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(await ParkingSession.countDocuments({ vehicleNumber: "RJ14AD0005" }), 0);
  assert.equal(await occupied(), before);
});

it("advance less than the fee: the customer pays only what is left", async () => {
  const entry = await enter("RJ14AD0006", { advance: { amount: 15, method: "CASH" } });
  s.v2 = entry.body.data.session;
  await backdate(s.v2._id, STAY);
  const quote = await exit({ ticketNumber: s.v2.ticketNumber });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.data.paymentRequired, true);
  const pending = quote.body.data.session;
  assert.equal(pending.fee.total, FEE);
  assert.equal(pending.fee.advanceApplied, 15);
  assert.equal(pending.fee.due, 25);
  assert.deepEqual(quote.body.data.advance, { taken: 15, applied: 15, refund: 0, method: "CASH" });

  // The old full amount is no longer accepted; the amount left is.
  assert.equal((await pay({ sessionId: s.v2._id, method: "CASH", amount: FEE })).status, 409);
  const paid = await pay({ sessionId: s.v2._id, method: "CASH", amount: 25 });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.data.payment.amount, 25);
  assert.equal(paid.body.data.payment.kind, "FEE");
  assert.equal(paid.body.data.session.status, "COMPLETED");
  assert.equal(await occupied(), 2); // v1 and v4 are still inside

  const receipt = await api("GET", `/api/parking/sessions/${s.v2._id}/receipt`, { token: s.a.token });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  const r = receipt.body.data;
  assert.equal(r.amount.total, FEE);
  assert.equal(r.amount.due, 25);
  assert.equal(r.paid, FEE, "advance 15 + 25 at the counter");
  assert.deepEqual(r.advance, { amount: 15, method: "CASH", applied: 15, refunded: 0 });
  assert.equal(r.payment.method, "CASH");
});

it("advance more than the fee: no payment is needed and the extra is given back", async () => {
  const entry = await enter("RJ14AD0008", { advance: { amount: 100, method: "CASH" } });
  s.v3 = entry.body.data.session;
  await backdate(s.v3._id, STAY);
  const res = await exit({ vehicleNumber: "RJ14AD0008" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.paymentRequired, false);
  assert.deepEqual(res.body.data.advance, { taken: 100, applied: FEE, refund: 60, method: "CASH" });
  const closed = res.body.data.session;
  assert.equal(closed.status, "COMPLETED");
  assert.equal(closed.isOpen, false);
  assert.equal(closed.fee.due, 0);
  assert.equal(closed.fee.advanceRefunded, 60);
  assert.equal(String(closed.paymentId), String(s.v3.advance.paymentId));

  const row = await advanceRow(s.v3._id);
  assert.equal(row.status, "REFUNDED");
  assert.equal(row.amount, 100, "the amount stays as it was taken");
  assert.equal(row.refund.amount, 60);
  assert.equal(row.tax, 6.1, "the tax of the fee it paid");
  assert.equal(String(row.refund.shiftId), s.shift._id);
  assert.equal(await Payment.countDocuments({ sessionId: s.v3._id }), 1, "no second payment was made");

  const receipt = await api("GET", `/api/parking/sessions/${s.v3._id}/receipt`, { token: s.a.token });
  assert.equal(receipt.body.data.paid, FEE);
  assert.deepEqual(receipt.body.data.advance, { amount: 100, method: "CASH", applied: FEE, refunded: 60 });
  assert.equal(receipt.body.data.amount.due, 0);
  assert.equal(await occupied(), 2);

  // Looking it up again cannot give the money back twice.
  assert.equal((await exit({ vehicleNumber: "RJ14AD0008" })).status, 404);
  assert.equal((await advanceRow(s.v3._id)).refund.amount, 60);
});

it("an advance that exactly covers the fee gives nothing back", async () => {
  const entry = await enter("RJ14AD0009", { advance: { amount: FEE, method: "CARD", transactionId: "CARD-ADV-9" } });
  const session = entry.body.data.session;
  await backdate(session._id, STAY);
  const res = await exit({ vehicleNumber: "RJ14AD0009" });
  assert.equal(res.body.data.paymentRequired, false);
  assert.equal(res.body.data.advance.refund, 0);
  const row = await advanceRow(session._id);
  assert.equal(row.status, "SUCCESS");
  assert.equal(row.tax, 6.1);
});

it("a free exit gives the whole advance back", async () => {
  const entry = await enter("RJ14AD0010", { advance: { amount: 25, method: "UPI", transactionId: "UPI-ADV-10" } });
  const session = entry.body.data.session;
  const res = await exit({ vehicleNumber: "RJ14AD0010" }); // inside the 10 minute grace period
  assert.equal(res.body.data.paymentRequired, false);
  assert.deepEqual(res.body.data.advance, { taken: 25, applied: 0, refund: 25, method: "UPI" });
  const row = await advanceRow(session._id);
  assert.equal(row.status, "REFUNDED");
  assert.equal(row.refund.amount, 25);
});

it("cancelling an entry gives the advance back in full", async () => {
  const path = `/api/parking/sessions/${s.v1._id}/cancel`;
  const cancelled = await api("POST", path, { token: s.a.token, body: { reason: "Typed wrong number" } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "CANCELLED");
  assert.equal(cancelled.body.advanceRefunded, 100);
  const row = await advanceRow(s.v1._id);
  assert.equal(row.status, "REFUNDED");
  assert.equal(row.refund.amount, 100);
  assert.equal(await occupied(), 1);
  // A second cancel is refused and the money is not given back again.
  assert.equal((await api("POST", path, { token: s.a.token, body: { reason: "Typed wrong number" } })).status, 409);
  assert.equal(await Payment.countDocuments({ sessionId: s.v1._id, status: "REFUNDED" }), 1);
});

it("an advance cannot be refunded by hand while the vehicle is inside", async () => {
  const row = await advanceRow(s.v4._id);
  const refund = await api("POST", `/api/payments/${row._id}/refund`, { token: s.a.token, body: { reason: "Customer asked" } });
  assert.equal(refund.status, 409, JSON.stringify(refund.body));
  assert.equal((await advanceRow(s.v4._id)).status, "SUCCESS");
  // Cancelling the entry is the way (here with UPI: the money goes back by UPI, not from the drawer).
  const cancelled = await api("POST", `/api/parking/sessions/${s.v4._id}/cancel`, { token: s.a.token, body: { reason: "Customer left" } });
  assert.equal(cancelled.body.advanceRefunded, 30);
  assert.equal(await occupied(), 0);
});

it("an admin override keeps the advance (nothing is given back)", async () => {
  const entry = await enter("RJ14AD0007", { advance: { amount: 20, method: "CASH" } });
  const session = entry.body.data.session;
  await backdate(session._id, STAY);
  const quote = await exit({ ticketNumber: session.ticketNumber });
  assert.equal(quote.body.data.session.fee.due, 20);
  const override = await api("POST", `/api/parking/sessions/${session._id}/override`, {
    token: s.a.token, body: { reason: "Staff vehicle, approved by manager" },
  });
  assert.equal(override.status, 200, JSON.stringify(override.body));
  assert.equal((await advanceRow(session._id)).status, "SUCCESS");
});

it("shift and collection totals count every advance, fee payment and refund once", async () => {
  // Cash taken: 100 (cancelled later) + 15 + 25 + 100 + 40 (card is not cash, see below) ...
  // Cash: v1 100, v2 15+25, v3 100, override 20 = 260. Given back in cash: v3 60, v1 100 = 160.
  const current = await api("GET", "/api/shifts/current", { token: s.a.token });
  const t = current.body.data.totals;
  assert.equal(t.cashCollected, 260);
  assert.equal(t.cashRefunded, 160);
  assert.equal(t.expectedCash, 100);
  const methods = Object.fromEntries(t.byMethod.map((m) => [m.method, m.amount]));
  assert.deepEqual(methods, { CASH: 260, UPI: 55, CARD: 40 });

  const collection = await api("GET", `/api/payments/collection?locationId=${s.loc._id}`, { token: s.a.token });
  const c = collection.body.data;
  assert.equal(c.total.amount, 355, "everything taken: 260 cash + 55 UPI + 40 card");
  assert.equal(c.refunded.amount, 60 + 100 + 30 + 25);
  assert.equal(c.net, 355 - 215);
  // Tax of the three fees that were paid (two from advances alone or with a payment).
  assert.equal(c.total.tax, 18.3);
});

it("migration: the old one-success-per-session index is replaced", async () => {
  // The old index cannot be built over sessions that have both an advance and a fee payment.
  await Payment.deleteMany({});
  await Payment.collection.createIndex(
    { sessionId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "SUCCESS" }, name: "one_success_per_session" }
  );
  assert.equal(await advances.migrateIndexes(), true);
  const names = (await Payment.collection.indexes()).map((i) => i.name);
  assert.ok(!names.includes("one_success_per_session"));
  assert.ok(names.includes("one_success_per_session_kind"));
  assert.equal(await advances.migrateIndexes(), false, "running it again changes nothing");
});
