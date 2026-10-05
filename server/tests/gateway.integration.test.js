// Online payments through the API with the simulated gateway: starting one,
// settling it, and every awkward way the money and the records can disagree.
// Needs MongoDB (see tests/helpers.js).
process.env.PAYMENT_PROVIDER = "simulated";
process.env.PAYMENT_WEBHOOK_SECRET = "gateway-test-webhook-secret-123456";

const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const mongoose = require("mongoose");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const gateway = require("../integrations/payment");
const paymentService = require("../services/paymentService");

setup();

const s = {};
let plate = 0;
const backdate = (id, minutes) =>
  ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - minutes * 60000) } });
const occupied = async () => (await api("GET", `/api/locations/${s.loc._id}`, { token: s.a.token })).body.data.occupied.car;

// A car that has stayed 90 minutes and has been told its fee. Returns the session.
const owing = async () => {
  plate += 1;
  const entry = await api("POST", "/api/parking/entry", {
    token: s.entryToken, body: { locationId: s.loc._id, vehicleNumber: `RJ14GW${String(plate).padStart(4, "0")}`, vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  await backdate(entry.body.data.session._id, 90);
  const out = await api("POST", "/api/parking/exit", {
    token: s.exitToken, body: { locationId: s.loc._id, ticketNumber: entry.body.data.session.ticketNumber },
  });
  assert.equal(out.body.data.paymentRequired, true, JSON.stringify(out.body));
  return out.body.data.session;
};
const startOnline = (session, token = s.exitToken) =>
  api("POST", "/api/payments", { token, body: { sessionId: session._id, method: "GATEWAY", amount: session.fee.total } });
const simulate = (payment, outcome = "SUCCESS", token = s.exitToken) =>
  api("POST", `/api/payments/${payment._id}/simulate`, { token, body: { outcome } });
const sessionNow = (session) => ParkingSession.findById(session._id);
const issues = (title) => Notification.countDocuments({ companyId: s.a.company._id, type: "PAYMENT_ISSUE", title });
const audited = (action) => AuditLog.countDocuments({ companyId: s.a.company._id, action });

it("setup: a company with a tariff, gate staff and a rival company", async () => {
  s.a = await registerCompany("gwa");
  s.b = await registerCompany("gwb");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Mall", address: { line1: "MG Road" }, capacity: { car: 30 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const staff = (name, email, role) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds: [s.loc._id] } });
  await staff("Gate", "gw-entry@example.com", "ENTRY_OPERATOR");
  await staff("Exit", "gw-exit@example.com", "EXIT_OPERATOR");
  s.entryToken = await login("gw-entry@example.com");
  s.exitToken = await login("gw-exit@example.com");
  assert.ok(gateway.isGatewayConfigured());
});

it("online payment: the screen learns whether online payment is on", async () => {
  const on = await api("GET", "/api/payments/options", { token: s.exitToken });
  assert.deepEqual(on.body.data, { online: true, provider: "simulated", simulated: true, fastag: false, fastagSimulated: false });
  assert.equal((await api("GET", "/api/payments/options", { token: s.entryToken })).status, 403);
  process.env.PAYMENT_PROVIDER = "razorpay";
  try {
    assert.deepEqual((await api("GET", "/api/payments/options", { token: s.exitToken })).body.data, { online: false, provider: null, simulated: false, fastag: false, fastagSimulated: false });
  } finally {
    process.env.PAYMENT_PROVIDER = "simulated";
  }
});

it("online payment: starts pending with a pay address; asking again returns the same one", async () => {
  s.one = await owing();
  const started = await startOnline(s.one);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const p = started.body.data.payment;
  assert.equal(p.status, "PENDING");
  assert.equal(p.provider, "simulated");
  assert.equal(p.payUrl, `simulated://pay/${p.transactionId}`);
  assert.ok(new Date(p.expiresAt) > new Date());
  assert.equal(started.body.data.repeated, false);
  assert.equal(started.body.data.simulated, true);
  s.payOne = p;

  const again = await startOnline(s.one);
  assert.equal(again.status, 202);
  assert.equal(again.body.data.repeated, true);
  assert.equal(again.body.data.payment._id, p._id);
  assert.equal(await Payment.countDocuments({ sessionId: s.one._id }), 1, "one payment link per fee");
  assert.equal(await occupied(), 1, "still inside until paid");
});

it("online payment: the waiting screen can follow it; others cannot", async () => {
  const mine = await api("GET", `/api/payments/${s.payOne._id}`, { token: s.exitToken });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.data.payment.status, "PENDING");
  assert.equal(mine.body.data.completed, false);
  assert.equal(mine.body.data.hardware, null);
  assert.equal((await api("GET", `/api/payments/${s.payOne._id}`, { token: s.b.token })).status, 404, "another company");
  assert.equal((await api("GET", `/api/payments/${s.payOne._id}`, { token: s.entryToken })).status, 403, "entry staff do not see money");
  assert.equal((await api("GET", "/api/payments/not-an-id", { token: s.exitToken })).status, 400);
});

it("online payment: the customer pays; the vehicle is released and the screen sees it", async () => {
  const res = await simulate(s.payOne);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.outcome, "success");
  assert.equal(res.body.data.payment.status, "SUCCESS");
  assert.ok(res.body.data.payment.gatewayPaymentId);

  assert.equal((await sessionNow(s.one)).status, "COMPLETED");
  assert.equal(await occupied(), 0);
  const seen = await api("GET", `/api/payments/${s.payOne._id}`, { token: s.exitToken });
  assert.equal(seen.body.data.completed, true);
  assert.equal(seen.body.data.payment.status, "SUCCESS");
  assert.ok(seen.body.data.hardware, "barrier and printer summary is there (empty without devices)");

  // The gateway repeating itself changes nothing.
  const repeat = await simulate(s.payOne);
  assert.equal(repeat.body.data.outcome, "already");
  assert.equal(await Payment.countDocuments({ sessionId: s.one._id, status: "SUCCESS" }), 1);
  assert.equal(await occupied(), 0);
});

it("webhook: a correct signature settles; wrong ones and unknown orders do nothing harmful", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  const body = { transactionId: payment.transactionId, status: "SUCCESS", gatewayRef: "G-1", amount: session.fee.total };
  const signed = (b) => gateway.sign(Buffer.from(JSON.stringify(b)));
  const hook = (b, signature) =>
    api("POST", "/api/payments/webhook", { body: b, headers: signature ? { "x-signature": signature } : {} });

  assert.equal((await hook(body)).status, 401);
  assert.equal((await hook(body, "0".repeat(64))).status, 401);
  assert.equal((await sessionNow(session)).status, "PAYMENT_PENDING");
  assert.equal((await hook({ ...body, transactionId: "ORD-NOSUCHORDER" }, signed({ ...body, transactionId: "ORD-NOSUCHORDER" }))).status, 200, "unknown orders are acknowledged and ignored");
  assert.equal((await hook(body, signed(body))).status, 200);
  assert.equal((await sessionNow(session)).status, "COMPLETED");
  assert.equal((await Payment.findById(payment._id)).gatewayRef, "G-1");
});

it("online payment: the gateway took a different amount, so the vehicle is NOT released and an admin is told", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  const body = { transactionId: payment.transactionId, status: "SUCCESS", amount: session.fee.total - 5 };
  const res = await api("POST", "/api/payments/webhook", {
    body, headers: { "x-signature": gateway.sign(Buffer.from(JSON.stringify(body))) },
  });
  assert.equal(res.status, 200);
  const after = await Payment.findById(payment._id);
  assert.equal(after.status, "FAILED");
  assert.match(after.failureReason, /gateway reports/);
  assert.equal((await sessionNow(session)).status, "PAYMENT_PENDING");
  assert.equal(await issues("An online payment had the wrong amount"), 1);
  assert.equal(await audited("PAYMENT_AMOUNT_MISMATCH"), 1);

  // The operator can take the fee again.
  const retry = await startOnline(session);
  assert.equal(retry.status, 202);
  assert.notEqual(retry.body.data.payment._id, payment._id);
  assert.equal((await simulate(retry.body.data.payment)).body.data.outcome, "success");
  assert.equal((await sessionNow(session)).status, "COMPLETED");
});

it("online payment: a payment link for an old fee cannot close a session whose fee has grown since", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;

  // The vehicle stays much longer; the operator looks the ticket up again and the fee is recalculated.
  await backdate(session._id, 300);
  const again = await api("POST", "/api/parking/exit", {
    token: s.exitToken, body: { locationId: s.loc._id, ticketNumber: session.ticketNumber },
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.ok(again.body.data.session.fee.total > session.fee.total, "the fee grew");

  const body = { transactionId: payment.transactionId, status: "SUCCESS", amount: session.fee.total };
  const res = await api("POST", "/api/payments/webhook", {
    body, headers: { "x-signature": gateway.sign(Buffer.from(JSON.stringify(body))) },
  });
  assert.equal(res.status, 200);
  assert.equal((await Payment.findById(payment._id)).status, "FAILED", "the old payment does not count");
  assert.equal((await sessionNow(session)).status, "PAYMENT_PENDING", "the vehicle is not released at the old price");
  assert.equal(await issues("An online payment was for an out-of-date fee"), 1);
});

it("online payment: a failed payment alerts and leaves the vehicle to pay another way", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  const before = await Notification.countDocuments({ companyId: s.a.company._id, type: "PAYMENT_FAILED" });
  const res = await simulate(payment, "FAILED");
  assert.equal(res.body.data.outcome, "failed");
  assert.equal(res.body.data.payment.status, "FAILED");
  assert.equal(await Notification.countDocuments({ companyId: s.a.company._id, type: "PAYMENT_FAILED" }), before + 1);
  assert.equal((await sessionNow(session)).status, "PAYMENT_PENDING");

  const cash = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: session._id, method: "CASH", amount: session.fee.total },
  });
  assert.equal(cash.status, 201, JSON.stringify(cash.body));
  assert.equal((await sessionNow(session)).status, "COMPLETED");
});

it("online payment: paying online AND at the counter is caught as a double payment", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  const cash = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: session._id, method: "CASH", amount: session.fee.total },
  });
  assert.equal(cash.status, 201);
  const res = await simulate(payment);
  assert.equal(res.body.data.outcome, "duplicate");
  const after = await Payment.findById(payment._id);
  assert.equal(after.status, "FAILED");
  assert.equal(after.failureReason, paymentService.DUPLICATE_REASON);
  assert.equal(await Payment.countDocuments({ sessionId: session._id, status: "SUCCESS" }), 1);
  assert.equal(await issues("A customer paid twice"), 1);
  assert.equal(await audited("PAYMENT_DUPLICATE"), 1);
});

it("online payment: cancelled at the counter, then the customer pays it anyway: the money is not lost", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  const cancelled = await api("POST", `/api/payments/${payment._id}/cancel`, { token: s.exitToken });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.match(cancelled.body.data.failureReason, /Cancelled by Exit/);
  assert.equal((await api("POST", `/api/payments/${payment._id}/cancel`, { token: s.exitToken })).status, 409, "no longer waiting");
  assert.equal((await api("POST", `/api/payments/${payment._id}/cancel`, { token: s.entryToken })).status, 403);

  const cash = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: session._id, method: "CASH", amount: session.fee.total },
  });
  assert.equal(cash.status, 201);
  const res = await simulate(payment);
  assert.equal(res.body.data.outcome, "unmatched");
  assert.equal(await issues("Money arrived for a payment that was closed"), 1);
  assert.equal(await audited("PAYMENT_UNMATCHED"), 1);
  assert.equal(await Payment.countDocuments({ sessionId: session._id, status: "SUCCESS" }), 1);
});

it("online payment: ran out of time is closed by the sweep, but a late real payment still counts", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  // Straight to the collection: Mongoose does not let createdAt be changed.
  await Payment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(payment._id) },
    { $set: { createdAt: new Date(Date.now() - 5 * 60000), expiresAt: new Date(Date.now() - 60000) } }
  );
  const swept = await paymentService.sweepPending();
  assert.ok(swept.expired >= 1);
  const expired = await Payment.findById(payment._id);
  assert.equal(expired.status, "FAILED");
  assert.equal(expired.failureReason, paymentService.EXPIRED_REASON);
  assert.equal((await sessionNow(session)).status, "PAYMENT_PENDING");

  // Fresh payments are left alone by the sweep.
  const fresh = (await startOnline(await owing())).body.data.payment;
  await paymentService.sweepPending();
  assert.equal((await Payment.findById(fresh._id)).status, "PENDING");

  // The customer had in fact paid, just slowly.
  const late = await simulate(payment);
  assert.equal(late.body.data.outcome, "success");
  const paid = await Payment.findById(payment._id);
  assert.equal(paid.status, "SUCCESS");
  assert.equal(paid.failureReason, undefined);
  assert.equal((await sessionNow(session)).status, "COMPLETED");
});

it("online payment: paid after an admin already released the vehicle, so the payment is kept and flagged", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  const released = await api("POST", `/api/parking/sessions/${session._id}/override`, {
    token: s.a.token, body: { reason: "Barrier stuck, let him go" },
  });
  assert.equal(released.status, 200, JSON.stringify(released.body));

  const res = await simulate(payment);
  assert.equal(res.body.data.outcome, "success");
  assert.equal((await Payment.findById(payment._id)).status, "SUCCESS", "the money was really taken");
  assert.equal((await sessionNow(session)).status, "MANUAL_OVERRIDE", "the session is not changed");
  const seen = await api("GET", `/api/payments/${payment._id}`, { token: s.exitToken });
  assert.equal(seen.body.data.completed, false, "this payment did not release the vehicle");
  assert.equal(seen.body.data.hardware, null);
  assert.equal(await issues("Payment received but the vehicle was already released"), 1);
  assert.equal(await audited("PAYMENT_WITHOUT_EXIT"), 1);
});

it("online payment: a refund goes through the gateway, once", async () => {
  const refundBody = { reason: "Customer was charged twice" };
  assert.equal((await api("POST", `/api/payments/${s.payOne._id}/refund`, { token: s.exitToken, body: refundBody })).status, 403, "operators cannot refund");

  const refunded = await api("POST", `/api/payments/${s.payOne._id}/refund`, { token: s.a.token, body: refundBody });
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  assert.equal(refunded.body.data.status, "REFUNDED");
  assert.match(refunded.body.data.refund.gatewayRefundId, /^SIMREF-/);
  assert.equal(refunded.body.data.refund.gatewayPending, undefined);
  assert.equal(refunded.body.data.refund.amount, s.payOne.amount);
  assert.equal(await audited("PAYMENT_REFUNDED"), 1);

  assert.equal((await api("POST", `/api/payments/${s.payOne._id}/refund`, { token: s.a.token, body: refundBody })).status, 409);
});

it("online payment: simulating is refused when the gateway is not the simulated one", async () => {
  const session = await owing();
  const { payment } = (await startOnline(session)).body.data;
  process.env.PAYMENT_PROVIDER = "generic";
  try {
    assert.equal((await simulate(payment)).status, 409);
  } finally {
    process.env.PAYMENT_PROVIDER = "simulated";
  }
  assert.equal((await Payment.findById(payment._id)).status, "PENDING");
});

it("online payment: with no gateway set up, it is refused clearly", async () => {
  const session = await owing();
  const saved = process.env.PAYMENT_WEBHOOK_SECRET;
  process.env.PAYMENT_PROVIDER = "razorpay"; // keys are not set in this test
  try {
    const res = await startOnline(session);
    assert.equal(res.status, 503);
    assert.equal(await Payment.countDocuments({ sessionId: session._id }), 0);
  } finally {
    process.env.PAYMENT_PROVIDER = "simulated";
    process.env.PAYMENT_WEBHOOK_SECRET = saved;
  }
});
