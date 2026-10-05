// Online booking through the API with the simulated gateway: the public page, paying, arriving,
// refunds, and every awkward way the money and the bookings can disagree. Needs MongoDB.
process.env.PAYMENT_PROVIDER = "simulated";
process.env.PAYMENT_WEBHOOK_SECRET = "gateway-test-webhook-secret-123456";
// The public route allows 10 bookings per 15 minutes per address; these tests make many.
process.env.PUBLIC_BOOKING_RATE_MAX = "1000";

const { setup, it, api, registerCompany, assert } = require("./helpers");
const Booking = require("../models/Booking");
const Notification = require("../models/Notification");
const Payment = require("../models/Payment");
const ParkingSession = require("../models/ParkingSession");
const Company = require("../models/Company");
const online = require("../services/onlineBookingService");

setup();

const s = {};
let plate = 0;
const nextPlate = () => `RJ14OB${String(++plate).padStart(4, "0")}`;
const soon = () => new Date(Date.now() + 2 * 3600000).toISOString();
const book = (body = {}, location = s.loc) =>
  api("POST", "/api/public/booking/bookings", {
    body: { locationId: location._id, vehicleNumber: nextPlate(), vehicleType: "CAR", customerName: "Asha Verma", phone: "9876543210", expectedAt: soon(), ...body },
  });
const view = (made) => api("GET", `/api/public/booking/bookings/${made.body.data.booking.id}?token=${encodeURIComponent(made.body.data.token)}`);
const pay = (made, outcome = "SUCCESS") =>
  api("POST", `/api/public/booking/bookings/${made.body.data.booking.id}/simulate?token=${encodeURIComponent(made.body.data.token)}`, { body: { outcome } });
const row = (made) => Booking.findById(made.body.data.booking.id).select("+accessHash");
const issues = (title) => Notification.countDocuments({ companyId: s.a.company._id, type: "PAYMENT_ISSUE", title });

it("setup: a location that takes online bookings, free for bikes and paid for cars", async () => {
  s.a = await registerCompany("onb");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Station", address: { line1: "MG Road", city: "Jaipur" }, capacity: { car: 20, bike: 20 }, vehicleTypes: ["CAR", "BIKE"] },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  // A trial plan allows two locations; this test needs a few.
  await Company.updateOne({ _id: s.a.company._id }, { $set: { "plan.maxLocations": 10 } });
  const off = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Closed", address: { line1: "Side Road" }, capacity: { car: 5 } } });
  assert.equal(off.status, 201, JSON.stringify(off.body));
  s.off = off.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token, body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const set = await api("PUT", `/api/locations/${s.loc._id}`, {
    token: s.a.token, body: { onlineBooking: { enabled: true, fees: { car: 60, bike: 0 }, note: "Use gate 2" } },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.onlineBooking.fees.car, 60);
  assert.equal(set.body.data.onlineBooking.fees.bike, 0);
});

it("the public list shows only locations that switched online booking on, and no internal ids", async () => {
  const res = await api("GET", "/api/public/booking/locations");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const mine = res.body.data.locations.filter((l) => [s.loc._id, s.off._id].includes(String(l.id)));
  assert.deepEqual(mine.map((l) => l.name), ["Station"]);
  assert.ok(!JSON.stringify(res.body).includes(s.a.company._id), "no company id goes out");
  assert.equal(mine[0].paymentAvailable, true);
  assert.deepEqual(mine[0].types.map((t) => [t.type, t.fee]), [["CAR", 60], ["BIKE", 0]]);
  assert.equal((await api("GET", `/api/public/booking/locations/${s.off._id}`)).status, 404);
  assert.equal((await api("GET", `/api/public/booking/locations/${s.loc._id}`)).status, 200);
});

it("a free booking is confirmed at once", async () => {
  const made = await book({ vehicleType: "BIKE" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.booking.status, "BOOKED");
  assert.equal(made.body.data.booking.amount, 0);
  assert.ok(made.body.data.token.length > 20);
});

it("a paid booking waits for payment, then is confirmed when the payment succeeds", async () => {
  const made = await book();
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.booking.status, "AWAITING_PAYMENT");
  assert.equal(made.body.data.booking.amount, 60);
  assert.equal(made.body.data.booking.payment.state, "PENDING");
  const result = await pay(made);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.outcome, "success");
  assert.equal(result.body.data.booking.status, "BOOKED");
  assert.equal(result.body.data.booking.payment.state, "PAID");
  // The same result arriving again changes nothing.
  assert.equal((await pay(made)).body.data.outcome, "already");
  assert.equal((await view(made)).body.data.booking.status, "BOOKED");
});

it("a failed payment cancels the booking and frees the plate", async () => {
  const vehicleNumber = nextPlate();
  const made = await book({ vehicleNumber });
  assert.equal((await pay(made, "FAILED")).body.data.outcome, "failed");
  assert.equal((await view(made)).body.data.booking.status, "CANCELLED");
  const again = await book({ vehicleNumber });
  assert.equal(again.status, 201, "the plate can be booked again after a failed payment");
});

it("the booking page needs the right token and says nothing about why it failed", async () => {
  const made = await book({ vehicleType: "BIKE" });
  const id = made.body.data.booking.id;
  assert.equal((await api("GET", `/api/public/booking/bookings/${id}`)).status, 404);
  assert.equal((await api("GET", `/api/public/booking/bookings/${id}?token=wrong-token-wrong-token-wrong`)).status, 404);
  assert.equal((await api("GET", `/api/public/booking/bookings/64b0000000000000000000ff?token=${made.body.data.token}`)).status, 404);
  const ok = await view(made);
  assert.equal(ok.status, 200);
  const text = JSON.stringify(ok.body);
  assert.ok(!text.includes("accessHash"));
  assert.ok(!text.includes(s.a.company._id));
});

it("a booking is refused for a closed location, a class not accepted, a past time, a vehicle already inside", async () => {
  assert.equal((await book({}, s.off)).status, 404);
  assert.equal((await book({ vehicleType: "TAXI" })).status, 400);
  assert.equal((await book({ expectedAt: new Date(Date.now() - 48 * 3600000).toISOString() })).status, 400);
  assert.equal((await book({ expectedAt: new Date(Date.now() + 90 * 86400000).toISOString() })).status, 400);
  assert.equal((await book({ customerName: undefined })).status, 400);
  assert.equal((await book({ phone: "abc" })).status, 400);
  const inside = nextPlate();
  const entry = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: inside, vehicleType: "CAR" } });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal((await book({ vehicleNumber: inside })).status, 409);
});

it("the same plate cannot have two bookings here at once", async () => {
  const vehicleNumber = nextPlate();
  assert.equal((await book({ vehicleNumber })).status, 201);
  assert.equal((await book({ vehicleNumber })).status, 409);
});

it("the fee paid online becomes the ticket's advance when the car arrives, and is taken off the exit fee", async () => {
  const vehicleNumber = nextPlate();
  const made = await book({ vehicleNumber });
  await pay(made);
  const entry = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal(entry.body.data.session.advance.amount, 60);
  assert.equal(entry.body.data.session.advance.method, "GATEWAY");
  assert.equal(entry.body.data.booking.feePaidOnline, 60);
  assert.equal((await row(made)).status, "ARRIVED");
  const payments = await Payment.find({ sessionId: entry.body.data.session._id, kind: "ADVANCE" });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 60);
  assert.equal(payments[0].method, "GATEWAY");
  // 90 minutes: fee is over the advance, so only the rest is due.
  await ParkingSession.updateOne({ _id: entry.body.data.session._id }, { $set: { entryTime: new Date(Date.now() - 150 * 60000) } });
  const out = await api("POST", "/api/parking/exit", { token: s.a.token, body: { locationId: s.loc._id, ticketNumber: entry.body.data.session.ticketNumber } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(out.body.data.session.fee.total > 60, "the fee is more than the advance");
  assert.equal(out.body.data.session.fee.due, Math.round((out.body.data.session.fee.total - 60) * 100) / 100);
});

it("an arrival does not use the fee twice", async () => {
  const vehicleNumber = nextPlate();
  const made = await book({ vehicleNumber });
  await pay(made);
  const booking = await row(made);
  const session = await ParkingSession.create({
    companyId: booking.companyId, locationId: booking.locationId, vehicleNumber, vehicleType: "CAR", ticketNumber: `T-${Date.now()}`, entryTime: new Date(), isOpen: true,
  });
  const first = await online.applyToSession({ user: { _id: s.a.user._id }, headers: {}, ip: "x" }, booking, session);
  const second = await online.applyToSession({ user: { _id: s.a.user._id }, headers: {}, ip: "x" }, await row(made), session);
  assert.equal(first.amount, 60);
  assert.equal(second, null);
  assert.equal(await Payment.countDocuments({ sessionId: session._id, kind: "ADVANCE" }), 1);
});

it("a paid booking cancelled by staff is flagged for a refund and an admin is alerted", async () => {
  const made = await book();
  await pay(made);
  const before = await issues("Refund an online booking fee");
  const cancel = await api("POST", `/api/bookings/${made.body.data.booking.id}/cancel`, { token: s.a.token, body: { reason: "Lot closed" } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await row(made)).payment.state, "REFUND_DUE");
  assert.equal(await issues("Refund an online booking fee"), before + 1);
});

it("money for a booking that already ran out of time is kept visible, not lost", async () => {
  const made = await book();
  await Booking.updateOne({ _id: made.body.data.booking.id }, { $set: { "payment.expiresAt": new Date(Date.now() - 60000) } });
  assert.equal((await view(made)).body.data.booking.status, "EXPIRED");
  // The customer pays anyway: the arrival time is still ahead, so the booking is revived.
  const late = await pay(made);
  assert.equal(late.body.data.outcome, "success");
  assert.equal(late.body.data.booking.status, "BOOKED");
});

it("a payment with the wrong amount does not confirm the booking and raises an alert", async () => {
  const made = await book();
  const booking = await row(made);
  const before = await issues("An online booking payment had the wrong amount");
  const result = await online.settle({ transactionId: booking.payment.transactionId, status: "SUCCESS", amount: 1 });
  assert.equal(result.outcome, "mismatch");
  assert.equal((await row(made)).status, "CANCELLED");
  assert.equal((await row(made)).payment.state, "REFUND_DUE");
  assert.equal(await issues("An online booking payment had the wrong amount"), before + 1);
});

it("a transaction that belongs to no booking is reported as unknown, not applied", async () => {
  assert.equal((await online.settle({ transactionId: "TXN-NOBODY", status: "SUCCESS" })).outcome, "unknown");
});

it("the sweep closes bookings whose payment window passed", async () => {
  const made = await book();
  await Booking.updateOne({ _id: made.body.data.booking.id }, { $set: { "payment.expiresAt": new Date(Date.now() - 60000), createdAt: new Date(Date.now() - 3600000) } });
  await online.sweep();
  assert.equal((await row(made)).status, "EXPIRED");
});

it("staff see online bookings with their payment, and a rival company cannot cancel them", async () => {
  const made = await book();
  const list = await api("GET", "/api/bookings?status=all", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const found = list.body.data.bookings.find((b) => b._id === made.body.data.booking.id);
  assert.ok(found);
  assert.equal(found.source, "ONLINE");
  assert.equal(found.payment.state, "PENDING");
  assert.ok(!("accessHash" in found));
  s.b = await registerCompany("onb2");
  assert.equal((await api("POST", `/api/bookings/${made.body.data.booking.id}/cancel`, { token: s.b.token, body: {} })).status, 404);
});

it("the simulate route is only for the simulated gateway and needs the token", async () => {
  const made = await book();
  const id = made.body.data.booking.id;
  assert.equal((await api("POST", `/api/public/booking/bookings/${id}/simulate`, { body: {} })).status, 404);
});

it("the public route limits how many bookings one address can make", async () => {
  process.env.PUBLIC_BOOKING_RATE_MAX = "1"; // far below the requests already made from this address
  try {
    const refused = await book({ vehicleType: "BIKE" });
    assert.equal(refused.status, 429, JSON.stringify(refused.body));
  } finally {
    process.env.PUBLIC_BOOKING_RATE_MAX = "1000";
  }
});
