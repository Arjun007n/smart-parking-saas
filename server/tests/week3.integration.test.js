// The core vertical slice (plan, Day 21), end to end through the API:
// company -> location -> tariff -> entry -> ticket -> session -> exit ->
// fee -> payment -> receipt -> occupancy, collection and audit.
// Needs MongoDB (see tests/helpers.js).
process.env.PAYMENT_WEBHOOK_SECRET = "integration-webhook-secret-123456";

const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const AuditLog = require("../models/AuditLog");
const gateway = require("../integrations/payment");
const { TICKET_PATTERN } = require("../services/sessionService");

setup();

const s = {};
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000);
// Entry time is always "now", so tests move it back to create a longer stay.
const backdate = (sessionId, minutes) =>
  ParkingSession.updateOne({ _id: sessionId }, { $set: { entryTime: minutesAgo(minutes) } });

const occupied = async (locationId = s.loc._id) => {
  const res = await api("GET", `/api/locations/${locationId}`, { token: s.a.token });
  return res.body.data.occupied;
};
const enter = (vehicleNumber, extra = {}, token = s.entryToken) =>
  api("POST", "/api/parking/entry", {
    token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR", ...extra },
  });
const exit = (body, token = s.exitToken) =>
  api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, ...body } });
const pay = (body, token = s.exitToken) => api("POST", "/api/payments", { token, body });

it("setup: company, location with small capacity, tariffs and gate staff", async () => {
  s.a = await registerCompany("w3a");
  s.b = await registerCompany("w3b");

  const loc = await api("POST", "/api/locations", {
    token: s.a.token,
    body: { name: "Mall Parking", address: { line1: "MG Road" }, capacity: { car: 2, bike: 1 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const other = await api("POST", "/api/locations", {
    token: s.a.token,
    body: { name: "Airport Parking", address: { line1: "Airport Road" }, capacity: { car: 5 } },
  });
  s.loc2 = other.body.data;

  const car = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: {
      locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10,
      slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, lostTicketFee: 200,
      taxPercent: 18, taxInclusive: true,
    },
  });
  assert.equal(car.status, 201, JSON.stringify(car.body));
  const bike = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Bike", vehicleType: "BIKE", additionalPerHour: 10, lostTicketFee: 200 },
  });
  assert.equal(bike.status, 201);

  const staff = (name, email, role) =>
    api("POST", "/api/users", {
      token: s.a.token, body: { name, email, password: "Password123", role, locationIds: [s.loc._id] },
    });
  assert.equal((await staff("Entry Op", "w3-entry@example.com", "ENTRY_OPERATOR")).status, 201);
  assert.equal((await staff("Exit Op", "w3-exit@example.com", "EXIT_OPERATOR")).status, 201);
  s.entryToken = await login("w3-entry@example.com");
  s.exitToken = await login("w3-exit@example.com");
});

it("entry: creates a session and ticket, registers the vehicle, takes a space", async () => {
  const res = await enter("rj14 ab-1234", { idempotencyKey: "entry-key-0001" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.car1 = res.body.data.session;
  assert.match(s.car1.ticketNumber, TICKET_PATTERN);
  assert.equal(s.car1.vehicleNumber, "RJ14AB1234");
  assert.equal(s.car1.status, "ACTIVE");
  assert.equal(s.car1.isOpen, true);
  assert.equal(s.car1.companyId, s.a.company._id);
  assert.equal(res.body.data.availability.occupied.car, 1);
  assert.equal((await occupied()).car, 1);

  const vehicles = await api("GET", "/api/vehicles?q=RJ14AB1234", { token: s.a.token });
  assert.equal(vehicles.body.data.total, 1);
});

it("entry: a repeated request returns the same ticket and takes no extra space", async () => {
  const again = await enter("RJ14AB1234", { idempotencyKey: "entry-key-0001" });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.repeated, true);
  assert.equal(again.body.data.session.ticketNumber, s.car1.ticketNumber);
  assert.equal((await occupied()).car, 1);
});

it("entry: validations", async () => {
  // Already inside (a new request, not a repeat).
  const duplicate = await enter("RJ14AB1234");
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.message, /already inside/);

  assert.equal((await enter("!!")).status, 400);
  assert.equal((await enter("MH01AA0001", { vehicleType: "HEAVY" })).status, 400); // not accepted here
  assert.equal((await enter("MH01AA0001", { vehicleType: "TRUCK" })).status, 400);

  // Blocked vehicle.
  const blocked = await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "DL01BL0001" } });
  await api("PUT", `/api/vehicles/${blocked.body.data._id}`, {
    token: s.a.token, body: { isBlocked: true, blockedReason: "Unpaid dues" },
  });
  const refused = await enter("DL01BL0001");
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /Unpaid dues/);

  // Wrong role, wrong location, wrong company.
  assert.equal((await enter("MH01AA0001", {}, s.exitToken)).status, 403);
  assert.equal((await enter("MH01AA0001", { locationId: s.loc2._id })).status, 404);
  assert.equal((await enter("MH01AA0001", {}, s.b.token)).status, 404);
  assert.equal((await api("POST", "/api/parking/entry", { body: {} })).status, 401);

  assert.equal((await occupied()).car, 1); // none of the refused entries took a space
});

it("entry: refused when the parking is full", async () => {
  const second = await enter("RJ14CD5678");
  assert.equal(second.status, 201);
  s.car2 = second.body.data.session;
  assert.notEqual(s.car2.ticketNumber, s.car1.ticketNumber);

  const full = await enter("RJ14EF9999");
  assert.equal(full.status, 409);
  assert.match(full.body.message, /full/);
  assert.equal((await occupied()).car, 2);

  // Bikes have their own capacity.
  const bike = await enter("RJ14BK0001", { vehicleType: "BIKE" });
  assert.equal(bike.status, 201);
  s.bike = bike.body.data.session;
});

it("entries list and lookup by vehicle number or ticket", async () => {
  const all = await api("GET", `/api/parking/entries?locationId=${s.loc._id}`, { token: s.entryToken });
  assert.equal(all.status, 200);
  assert.equal(all.body.data.total, 3);

  const byPlate = await api("GET", "/api/parking/entries?q=rj14 cd", { token: s.entryToken });
  assert.deepEqual(byPlate.body.data.sessions.map((x) => x.vehicleNumber), ["RJ14CD5678"]);
  const byTicket = await api("GET", `/api/parking/entries?q=${s.car1.ticketNumber.toLowerCase()}`, { token: s.exitToken });
  assert.deepEqual(byTicket.body.data.sessions.map((x) => x._id), [s.car1._id]);

  assert.equal((await api("GET", "/api/parking/entries", { token: s.b.token })).body.data.total, 0);
  assert.equal((await api("GET", `/api/parking/sessions/${s.car1._id}`, { token: s.b.token })).status, 404);
});

it("exit within the grace period: nothing to pay, session completes, space is freed", async () => {
  const res = await exit({ ticketNumber: s.car2.ticketNumber });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.paymentRequired, false);
  assert.equal(res.body.data.session.status, "COMPLETED");
  assert.equal(res.body.data.session.isOpen, false);
  assert.equal(res.body.data.session.fee.total, 0);
  assert.equal(res.body.data.session.fee.reason, "GRACE_PERIOD");
  assert.equal((await occupied()).car, 1);

  // Duplicate exit.
  const again = await exit({ ticketNumber: s.car2.ticketNumber });
  assert.equal(again.status, 409);
  assert.match(again.body.message, /already exited/);
  assert.equal((await occupied()).car, 1);
});

it("exit: lookups that must be refused", async () => {
  assert.equal((await exit({})).status, 400);
  assert.equal((await exit({ ticketNumber: "T-260101-ZZZZZZ" })).status, 404);
  assert.equal((await exit({ vehicleNumber: "KA01NO0000" })).status, 404);
  // Ticket and vehicle number do not match.
  assert.equal((await exit({ ticketNumber: s.car1.ticketNumber, vehicleNumber: "RJ14CD5678" })).status, 409);
  // Ticket from another location.
  const wrongPlace = await api("POST", "/api/parking/exit", {
    token: s.a.token, body: { locationId: s.loc2._id, ticketNumber: s.car1.ticketNumber },
  });
  assert.equal(wrongPlace.status, 409);
  assert.match(wrongPlace.body.message, /different parking location/);
  // Wrong role, wrong company.
  assert.equal((await exit({ ticketNumber: s.car1.ticketNumber }, s.entryToken)).status, 403);
  assert.equal((await exit({ ticketNumber: s.car1.ticketNumber }, s.b.token)).status, 404);

  const still = await api("GET", `/api/parking/sessions/${s.car1._id}`, { token: s.a.token });
  assert.equal(still.body.data.status, "ACTIVE");
});

it("paid exit: fee is calculated, payment is required, then the session completes", async () => {
  // Paying before the fee was calculated is refused.
  assert.equal((await pay({ sessionId: s.car1._id, method: "CASH", amount: 40 })).status, 409);

  // Just under 90 minutes, so the rounded-up duration is exactly 90:
  // 20 for the first hour + 20 for the next started hour.
  await backdate(s.car1._id, 89.5);
  const res = await exit({ ticketNumber: s.car1.ticketNumber, vehicleNumber: "RJ14 AB 1234" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.paymentRequired, true);
  const pending = res.body.data.session;
  assert.equal(pending.status, "PAYMENT_PENDING");
  assert.equal(pending.isOpen, true);
  assert.equal(pending.durationMinutes, 90);
  assert.equal(pending.fee.total, 40);
  assert.equal(pending.fee.tax, 6.1);
  assert.equal(pending.fee.subtotal, 33.9);
  assert.equal((await occupied()).car, 1); // still inside until paid

  // Looking it up again is fine and gives the same fee.
  const requote = await exit({ vehicleNumber: "RJ14AB1234" });
  assert.equal(requote.body.data.session.fee.total, 40);

  // Payment checks.
  assert.equal((await pay({ sessionId: s.car1._id, method: "CASH", amount: 10 })).status, 409); // wrong amount
  assert.equal((await pay({ sessionId: s.car1._id, method: "CASH", amount: 40 }, s.entryToken)).status, 403);
  assert.equal((await pay({ sessionId: s.car1._id, method: "CASH", amount: 40 }, s.b.token)).status, 404);
  assert.equal((await pay({ sessionId: s.car1._id, method: "BITCOIN", amount: 40 })).status, 400);
  assert.equal((await occupied()).car, 1);

  const paid = await pay({ sessionId: s.car1._id, method: "CASH", amount: 40 });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.data.completed, true);
  assert.equal(paid.body.data.payment.status, "SUCCESS");
  assert.equal(paid.body.data.payment.amount, 40);
  assert.equal(paid.body.data.session.status, "COMPLETED");
  assert.equal(paid.body.data.session.isOpen, false);
  assert.equal((await occupied()).car, 0); // occupancy decreased

  // Duplicate payment and duplicate exit.
  assert.equal((await pay({ sessionId: s.car1._id, method: "CASH", amount: 40 })).status, 409);
  assert.equal((await exit({ ticketNumber: s.car1.ticketNumber })).status, 409);
  assert.equal((await occupied()).car, 0);

  // The same vehicle can come in again.
  const back = await enter("RJ14AB1234");
  assert.equal(back.status, 201);
  s.car1Again = back.body.data.session;
});

it("lost ticket: found by vehicle number, penalty added, closes as LOST_TICKET", async () => {
  await backdate(s.bike._id, 30);
  assert.equal((await exit({ lostTicket: true })).status, 400);
  assert.equal((await exit({ lostTicket: true, ticketNumber: s.bike.ticketNumber })).status, 400);

  const res = await exit({ lostTicket: true, vehicleNumber: "RJ14BK0001" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.session.fee.total, 210); // 10 parking + 200 penalty
  assert.equal(res.body.data.session.fee.breakdown.lostTicket, 200);

  const paid = await pay({ sessionId: s.bike._id, method: "UPI", amount: 210, transactionId: "UPI-REF-0001" });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.data.session.status, "LOST_TICKET");
  assert.equal(paid.body.data.payment.transactionId, "UPI-REF-0001");
  assert.equal((await occupied()).bike, 0);
});

it("admin corrections: cancel a wrong entry, override an exit; both need a reason", async () => {
  const path = `/api/parking/sessions/${s.car1Again._id}`;
  assert.equal((await api("POST", `${path}/cancel`, { token: s.entryToken, body: { reason: "Typed wrong number" } })).status, 403);
  assert.equal((await api("POST", `${path}/cancel`, { token: s.a.token, body: {} })).status, 400);
  assert.equal((await api("POST", `${path}/cancel`, { token: s.b.token, body: { reason: "Typed wrong number" } })).status, 404);

  const cancelled = await api("POST", `${path}/cancel`, { token: s.a.token, body: { reason: "Typed wrong number" } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "CANCELLED");
  assert.equal((await occupied()).car, 0);
  assert.equal((await api("POST", `${path}/cancel`, { token: s.a.token, body: { reason: "Typed wrong number" } })).status, 409);

  // Override: fee was quoted, an admin lets the vehicle out without payment.
  const entry = await enter("RJ14OV0001");
  const session = entry.body.data.session;
  await backdate(session._id, 90);
  await exit({ ticketNumber: session.ticketNumber });
  // A quoted session cannot be "cancelled", only overridden.
  assert.equal((await api("POST", `/api/parking/sessions/${session._id}/cancel`, { token: s.a.token, body: { reason: "Not allowed here" } })).status, 409);
  const override = await api("POST", `/api/parking/sessions/${session._id}/override`, {
    token: s.a.token, body: { reason: "Staff vehicle, approved by manager" },
  });
  assert.equal(override.status, 200, JSON.stringify(override.body));
  assert.equal(override.body.data.status, "MANUAL_OVERRIDE");
  assert.equal(override.body.data.overrideReason, "Staff vehicle, approved by manager");
  assert.equal((await occupied()).car, 0);
  // No payment can be taken for it afterwards.
  assert.equal((await pay({ sessionId: session._id, method: "CASH", amount: 40 })).status, 409);
});

it("receipt: available after exit, with company, vehicle, times, amount and payment", async () => {
  const res = await api("GET", `/api/parking/sessions/${s.car1._id}/receipt`, { token: s.exitToken });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = res.body.data;
  assert.equal(r.receiptNumber, `R-${s.car1.ticketNumber.slice(2)}`);
  assert.equal(r.reference, s.car1.ticketNumber);
  assert.equal(r.company.name, "Company w3a");
  assert.equal(r.location.name, "Mall Parking");
  assert.equal(r.vehicle.number, "RJ14AB1234");
  assert.equal(r.durationMinutes, 90);
  assert.equal(r.amount.total, 40);
  assert.equal(r.amount.tax, 6.1);
  assert.equal(r.paid, 40);
  assert.equal(r.payment.method, "CASH");
  assert.equal(r.operators.entry, "Entry Op");
  assert.equal(r.operators.exit, "Exit Op");
  assert.ok(r.entryTime && r.exitTime);

  // Free exit: a receipt with nothing paid.
  const free = await api("GET", `/api/parking/sessions/${s.car2._id}/receipt`, { token: s.exitToken });
  assert.equal(free.body.data.paid, 0);
  assert.equal(free.body.data.payment, null);

  const open = await enter("RJ14RC0001");
  s.open = open.body.data.session;
  assert.equal((await api("GET", `/api/parking/sessions/${s.open._id}/receipt`, { token: s.exitToken })).status, 409);
  assert.equal((await api("GET", `/api/parking/sessions/${s.car1._id}/receipt`, { token: s.b.token })).status, 404);
});

it("online payment: stays pending until a correctly signed webhook arrives", async () => {
  await backdate(s.open._id, 90);
  await exit({ ticketNumber: s.open.ticketNumber });
  const started = await pay({ sessionId: s.open._id, method: "GATEWAY", amount: 40 });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.data.completed, false);
  assert.equal(started.body.data.payment.status, "PENDING");
  const { transactionId } = started.body.data.payment;
  assert.equal((await occupied()).car, 1); // not released yet

  const webhook = (body, signature) =>
    api("POST", "/api/payments/webhook", { body, headers: signature === undefined ? {} : { "x-signature": signature } });
  const body = { transactionId, status: "SUCCESS", gatewayRef: "GW-123" };
  const signature = gateway.sign(Buffer.from(JSON.stringify(body)));

  assert.equal((await webhook(body)).status, 401); // unsigned
  assert.equal((await webhook(body, "0".repeat(64))).status, 401); // wrong signature
  assert.equal((await webhook({ ...body, transactionId: "ORD-OTHER" }, signature)).status, 401); // body changed
  assert.equal((await occupied()).car, 1);

  assert.equal((await webhook(body, signature)).status, 200);
  const session = await api("GET", `/api/parking/sessions/${s.open._id}`, { token: s.a.token });
  assert.equal(session.body.data.status, "COMPLETED");
  assert.equal((await occupied()).car, 0);

  // A repeated webhook changes nothing.
  assert.equal((await webhook(body, signature)).status, 200);
  assert.equal((await occupied()).car, 0);
});

it("collection, exits and payments see the completed transactions", async () => {
  const collection = await api("GET", `/api/payments/collection?locationId=${s.loc._id}`, { token: s.exitToken });
  assert.equal(collection.status, 200, JSON.stringify(collection.body));
  const c = collection.body.data;
  assert.equal(c.total.amount, 290); // 40 cash + 210 UPI + 40 online
  assert.equal(c.total.count, 3);
  assert.deepEqual(c.byMethod.map((m) => [m.key, m.amount]), [["CASH", 40], ["GATEWAY", 40], ["UPI", 210]]);
  assert.equal(c.byOperator[0].name, "Exit Op");
  assert.equal(c.byOperator[0].amount, 290);

  const exits = await api("GET", `/api/parking/exits?locationId=${s.loc._id}`, { token: s.exitToken });
  assert.equal(exits.body.data.total, 6); // grace, paid, lost ticket, cancelled, override, online
  const statuses = exits.body.data.sessions.map((x) => x.status).sort();
  assert.deepEqual(statuses, ["CANCELLED", "COMPLETED", "COMPLETED", "COMPLETED", "LOST_TICKET", "MANUAL_OVERRIDE"]);

  const payments = await api("GET", "/api/payments", { token: s.a.token });
  assert.equal(payments.body.data.total, 3);

  assert.equal((await api("GET", "/api/parking/entries", { token: s.a.token })).body.data.total, 0);
  assert.deepEqual(await occupied(), { car: 0, bike: 0, heavy: 0 });

  // Access: entry operators do not see money; other companies see nothing.
  assert.equal((await api("GET", "/api/payments/collection", { token: s.entryToken })).status, 403);
  assert.equal((await api("GET", "/api/payments/collection", { token: s.b.token })).body.data.total.amount, 0);
  assert.equal((await api("GET", "/api/payments/collection?date=2020-01-01", { token: s.a.token })).body.data.total.count, 0);
  assert.equal((await api("GET", "/api/payments/collection?date=nope", { token: s.a.token })).status, 400);
});

it("audit log has the gate activity", async () => {
  const actions = await AuditLog.distinct("action");
  for (const expected of [
    "PARKING_ENTRY", "PARKING_EXIT", "PAYMENT_RECEIVED", "ENTRY_REFUSED_BLOCKED",
    "PARKING_ENTRY_CANCELLED", "PARKING_EXIT_OVERRIDE",
  ]) {
    assert.ok(actions.includes(expected), `missing audit action ${expected}`);
  }
});
