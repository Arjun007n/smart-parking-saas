// Security hardening of the public booking page: SMS limits per number, one answer for "inside" and "booked",
// and no bookings for suspended companies. No database: models are replaced by small stubs.
process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const caps = require("../utils/messageCaps");
const messaging = require("../integrations/messaging");
const messageService = require("../services/messageService");
const bookings = require("../services/bookingService");
const online = require("../services/onlineBookingService");
const Booking = require("../models/Booking");
const Company = require("../models/Company");
const Location = require("../models/Location");
const ParkingSession = require("../models/ParkingSession");
const controller = require("../controllers/publicBookingController");

const KEYS = ["MESSAGING_PROVIDER", "ALLOWED_SMS_COUNTRIES", "BOOKING_SMS_RECIPIENT_CAP"];
const saved = { errors: console.error };
for (const k of KEYS) saved[k] = process.env[k];
const chain = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
Company.findById = () => chain({ name: "Acme" });
Location.findById = () => chain({ name: "Main" });

test.beforeEach(() => {
  caps.reset();
  messaging.outbox.length = 0;
  console.error = () => {};
});
test.afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  console.error = saved.errors;
});

const booking = (over = {}) => ({ _id: "b1", companyId: "c1", locationId: "l1", vehicleNumber: "MH12AB1234", expectedAt: new Date("2026-03-02T04:30:00Z"), phone: "9876543210", ...over });

test("public booking SMS: at most 3 per number per day by default; the booking is not affected", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  for (let i = 0; i < 5; i += 1) messageService.sendBookingNotice({ booking: booking({ _id: `b${i}` }), publicPage: true });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 3);
  // another number is independent
  messageService.sendBookingNotice({ booking: booking({ phone: "9876500000" }), publicPage: true });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 4);
});

test("staff bookings (not the public page) are not limited", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  for (let i = 0; i < 5; i += 1) messageService.sendBookingNotice({ booking: booking({ _id: `s${i}` }) });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 5);
});

test("BOOKING_SMS_RECIPIENT_CAP changes the limit", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  process.env.BOOKING_SMS_RECIPIENT_CAP = "1";
  for (let i = 0; i < 3; i += 1) messageService.sendBookingNotice({ booking: booking({ _id: `c${i}` }), publicPage: true });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 1);
});

test("ALLOWED_SMS_COUNTRIES: empty allows every country, a list allows only those calling codes", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  delete process.env.ALLOWED_SMS_COUNTRIES;
  assert.equal(caps.countryAllowed("+14155552671"), true);
  process.env.ALLOWED_SMS_COUNTRIES = "91, +44";
  assert.equal(caps.countryAllowed("+919876543210"), true);
  assert.equal(caps.countryAllowed("+447911123456"), true);
  assert.equal(caps.countryAllowed("+14155552671"), false);
  messageService.sendBookingNotice({ booking: booking({ phone: "+1 415 555 2671" }), publicPage: true });
  messageService.sendBookingNotice({ booking: booking({ _id: "b2" }), publicPage: true });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 1);
  assert.equal(messaging.outbox[0].to, "+919876543210");
});

const location = {
  _id: "l1", companyId: "c1", isActive: true, name: "Main", vehicleTypes: ["CAR"], onlineBooking: { enabled: true, fees: { car: 0 } },
};
const request = () => ({ location, vehicleNumber: "MH12AB1234", vehicleType: "CAR", customerName: "Asha", phone: "9876543210", expectedAt: new Date(Date.now() + 3600000) });

test("a plate that is inside and a plate that is already booked get the same 409 answer", async () => {
  const originals = { exists: ParkingSession.exists, bExists: Booking.exists, expireOld: bookings.expireOld, update: Booking.updateMany };
  bookings.expireOld = async () => {};
  Booking.updateMany = async () => {};
  try {
    ParkingSession.exists = async () => true;
    Booking.exists = async () => false;
    const inside = await online.createOnline(request()).catch((e) => e);
    ParkingSession.exists = async () => false;
    Booking.exists = async () => true;
    const booked = await online.createOnline(request()).catch((e) => e);
    assert.equal(inside.statusCode, 409);
    assert.equal(booked.statusCode, 409);
    assert.equal(inside.message, booked.message);
    assert.ok(!/inside|booking here|MH12AB1234/i.test(inside.message), inside.message);
  } finally {
    ParkingSession.exists = originals.exists; Booking.exists = originals.bExists; bookings.expireOld = originals.expireOld; Booking.updateMany = originals.update;
  }
});

test("the public page refuses suspended and cancelled companies, and keeps taking active ones", async () => {
  const originals = { findLoc: Location.findById, findCo: Company.findById, findMany: Company.find, locFind: Location.find };
  const run = async (company) => {
    Location.findById = () => ({ lean: async () => ({ ...location }) });
    Company.findById = () => ({ select: () => ({ lean: async () => company }) });
    let sent;
    await controller.getLocation({ params: { id: "l1" } }, { json: (body) => { sent = body; } }).catch((e) => { sent = e; });
    return sent;
  };
  try {
    for (const subscriptionStatus of ["SUSPENDED", "CANCELLED"]) {
      const err = await run({ isActive: true, subscriptionStatus });
      assert.equal(err.statusCode, 404, subscriptionStatus);
    }
    assert.equal((await run({ isActive: false, subscriptionStatus: "ACTIVE" })).statusCode, 404);
    for (const subscriptionStatus of ["ACTIVE", "TRIAL", "PAST_DUE", undefined]) {
      const ok = await run({ isActive: true, subscriptionStatus });
      assert.equal(ok.success, true, String(subscriptionStatus));
    }
    // the list filters on the same rule
    let filter;
    Location.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ ...location }] }) }) });
    Company.find = (f) => { filter = f; return { select: () => ({ lean: async () => [{ _id: "c1" }] }) }; };
    await controller.listLocations({ query: {} }, { json() {} });
    assert.deepEqual(filter.subscriptionStatus, { $nin: ["SUSPENDED", "CANCELLED"] });
  } finally {
    Location.findById = originals.findLoc; Company.findById = originals.findCo; Company.find = originals.findMany; Location.find = originals.locFind;
  }
});
