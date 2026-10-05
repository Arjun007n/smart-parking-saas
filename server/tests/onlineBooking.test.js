// Online booking helpers that need no database: the customer's secret, the reference code,
// the fee lookup and what the public page is told about a parking.
process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const online = require("../services/onlineBookingService");

const location = (overrides = {}) => ({
  _id: "64b0000000000000000000aa", name: "City Mall", isActive: true, companyId: "64b000000000000000000001",
  address: { line1: "MG Road", city: "Jaipur", state: "RJ", pincode: "302001" },
  vehicleTypes: ["CAR", "BIKE", "TAXI"],
  onlineBooking: { enabled: true, fees: { car: 50, bike: 0, taxi: 80 }, note: "Gate 2" },
  ...overrides,
});

test("a token is long, random and checked against its hash only", () => {
  const a = online.newToken();
  const b = online.newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 30);
  const booking = { accessHash: online.hashToken(a) };
  assert.equal(online.tokenMatches(booking, a), true);
  assert.equal(online.tokenMatches(booking, b), false);
  assert.equal(online.tokenMatches(booking, ""), false);
  assert.equal(online.tokenMatches(booking, undefined), false);
  assert.equal(online.tokenMatches(booking, a.slice(0, -1)), false);
  assert.equal(online.tokenMatches({}, a), false, "a booking with no hash opens for nobody");
  assert.equal(online.tokenMatches(null, a), false);
  assert.notEqual(online.hashToken(a), a, "the token itself is never stored");
});

test("the reference code is BK- and the last six characters of the id", () => {
  assert.equal(online.codeOf({ _id: "64b0000000000000000abcdef" }), "BK-ABCDEF");
});

test("fees come from the location, per class; a missing or unknown class is free", () => {
  const l = location();
  assert.equal(online.feeFor(l, "CAR"), 50);
  assert.equal(online.feeFor(l, "TAXI"), 80);
  assert.equal(online.feeFor(l, "BIKE"), 0);
  assert.equal(online.feeFor(l, "HEAVY"), 0);
  assert.equal(online.feeFor(location({ onlineBooking: undefined }), "CAR"), 0);
});

test("only an active location with online booking switched on can be booked", () => {
  assert.equal(online.isOpenForBooking(location()), true);
  assert.equal(online.isOpenForBooking(location({ isActive: false })), false);
  assert.equal(online.isOpenForBooking(location({ onlineBooking: { enabled: false } })), false);
  assert.equal(online.isOpenForBooking(location({ onlineBooking: undefined })), false);
  assert.equal(online.isOpenForBooking(null), false);
});

test("without a payment page, only the free classes are offered", () => {
  const previous = process.env.PAYMENT_PROVIDER;
  try {
    process.env.PAYMENT_PROVIDER = "none";
    assert.equal(online.canTakePayments(), false);
    const without = online.offerOf(location());
    assert.equal(without.paymentAvailable, false);
    assert.deepEqual(without.types.map((t) => t.type), ["BIKE"]);

    process.env.PAYMENT_PROVIDER = "simulated";
    assert.equal(online.canTakePayments(), true);
    const withPay = online.offerOf(location());
    assert.equal(withPay.paymentAvailable, true);
    assert.deepEqual(withPay.types, [{ type: "CAR", fee: 50 }, { type: "BIKE", fee: 0 }, { type: "TAXI", fee: 80 }]);
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = previous;
  }
});

test("what the public page is told leaves out company ids and anything internal", () => {
  process.env.PAYMENT_PROVIDER = "simulated";
  const offer = online.offerOf(location());
  const text = JSON.stringify(offer);
  assert.ok(!text.includes("companyId"));
  assert.ok(!text.includes("64b000000000000000000001"));
  assert.equal(offer.name, "City Mall");
  assert.equal(offer.address.city, "Jaipur");
  assert.ok(!("pincode" in offer.address), "only line, city and state go out");
});

test("the customer's view never carries the secret hash or the gateway's ids", () => {
  const booking = {
    _id: "64b0000000000000000abcdef", status: "AWAITING_PAYMENT", vehicleNumber: "RJ14AB1234", vehicleType: "CAR",
    customerName: "Asha", phone: "9876543210", expectedAt: new Date("2026-10-10T10:00:00Z"), amount: 50, accessHash: "secret",
    payment: { state: "PENDING", payUrl: "https://pay.example/x", transactionId: "TXN1", gatewayRef: "ref", gatewayPaymentId: "pay_1", expiresAt: new Date() },
  };
  const view = online.viewOf(booking, { name: "City Mall", address: { line1: "MG Road", city: "Jaipur" } });
  const text = JSON.stringify(view);
  for (const hidden of ["secret", "TXN1", "ref\"", "pay_1", "accessHash", "9876543210"]) assert.ok(!text.includes(hidden), hidden);
  assert.equal(view.code, "BK-ABCDEF");
  assert.equal(view.payment.payUrl, "https://pay.example/x", "a pending payment shows where to pay");
  const paid = online.viewOf({ ...booking, status: "BOOKED", payment: { state: "PAID", paidAt: new Date(), payUrl: "https://pay.example/x" } });
  assert.ok(!("payUrl" in paid.payment), "once paid there is nowhere left to pay");
});
