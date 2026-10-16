// The public booking page: no login. A customer sees the parkings that take online bookings,
// books one, pays the booking fee, and follows the booking with a secret link (the token).
// Everything a stranger can reach is limited here: only listed fields go out, the token is checked
// in constant time, and the "simulate" route exists only with the simulated gateway.

const AppError = require("../utils/AppError");
const Booking = require("../models/Booking");
const Company = require("../models/Company");
const Location = require("../models/Location");
const gateway = require("../integrations/payment");
const online = require("../services/onlineBookingService");
const { parsePlate } = require("../utils/plate");

const LIST_LIMIT = 100;
// The same list the login check uses (middleware/auth.js): suspended or cancelled companies take no bookings.
const BLOCKED_SUBSCRIPTIONS = ["SUSPENDED", "CANCELLED"];

const companyIsActive = async (companyId) => {
  const company = await Company.findById(companyId).select("isActive subscriptionStatus").lean();
  return Boolean(company && company.isActive !== false && !BLOCKED_SUBSCRIPTIONS.includes(company.subscriptionStatus));
};

// GET /api/public/booking/locations?q=
const listLocations = async (req, res) => {
  const filter = { isActive: true, "onlineBooking.enabled": true };
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { "address.city": rx }, { "address.line1": rx }];
  }
  const found = await Location.find(filter).sort({ name: 1 }).limit(LIST_LIMIT).lean();
  const active = new Set(
    (await Company.find({ _id: { $in: [...new Set(found.map((l) => String(l.companyId)))] }, isActive: { $ne: false }, subscriptionStatus: { $nin: BLOCKED_SUBSCRIPTIONS } }).select("_id").lean())
      .map((c) => String(c._id))
  );
  const items = found.filter((l) => active.has(String(l.companyId))).map(online.offerOf);
  res.json({ success: true, data: { locations: items, paymentAvailable: online.canTakePayments() } });
};

// GET /api/public/booking/locations/:id
const getLocation = async (req, res) => {
  const location = await Location.findById(req.params.id).lean();
  if (!online.isOpenForBooking(location) || !(await companyIsActive(location.companyId))) {
    throw new AppError("Online booking is not available at this parking", 404);
  }
  res.json({ success: true, data: online.offerOf(location) });
};

// POST /api/public/booking/bookings
const createBooking = async (req, res) => {
  const { locationId, vehicleType, customerName, phone, note, expectedAt } = req.body;
  const vehicleNumber = parsePlate(req.body.vehicleNumber);
  const location = await Location.findById(locationId).lean();
  if (!online.isOpenForBooking(location) || !(await companyIsActive(location.companyId))) {
    throw new AppError("Online booking is not available at this parking", 404);
  }
  const { booking, token } = await online.createOnline({
    location, vehicleNumber, vehicleType, customerName, phone, expectedAt, note,
  });
  res.status(201).json({ success: true, data: { booking: online.viewOf(booking, location), token } });
};

// The booking behind a token, or a plain "not found" for a wrong id or token (no hint which was wrong).
const findByToken = async (req) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const booking = await Booking.findById(req.params.id).select("+accessHash");
  if (!booking || booking.source !== "ONLINE" || !online.tokenMatches(booking, token)) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
};

// GET /api/public/booking/bookings/:id?token=
const getBooking = async (req, res) => {
  let booking = await findByToken(req);
  // Opening the page also closes a payment window that ran out, so the customer sees the truth.
  await online.expireUnpaid({ _id: booking._id });
  booking = await findByToken(req);
  const location = await Location.findById(booking.locationId).select("name address onlineBooking").lean();
  res.json({ success: true, data: { booking: online.viewOf(booking, location), simulated: Boolean(gateway.provider() && gateway.provider().simulated) } });
};

// POST /api/public/booking/bookings/:id/cancel?token=
// The customer cancels their own booking, when the parking allows it (see onlineBooking.cancelBeforeMinutes).
const cancelBooking = async (req, res) => {
  const booking = await findByToken(req);
  const location = await Location.findById(booking.locationId).select("name address onlineBooking").lean();
  const cancelled = await online.cancelByCustomer(booking, location);
  res.json({ success: true, data: { booking: online.viewOf(cancelled, location) } });
};

// POST /api/public/booking/bookings/:id/simulate?token=   { outcome }
// Plays the customer paying, with the simulated gateway only (never in production).
const simulate = async (req, res) => {
  const chosen = gateway.provider();
  if (!chosen || !chosen.simulated || !chosen.isConfigured()) {
    throw new AppError("Simulated payments are only available with PAYMENT_PROVIDER=simulated (not in production)", 409);
  }
  const booking = await findByToken(req);
  if (!booking.payment || booking.payment.provider !== "simulated") throw new AppError("This booking is not a simulated payment", 409);
  const outcome = req.body.outcome === "FAILED" ? "FAILED" : "SUCCESS";
  const tail = booking.payment.transactionId.slice(-8);
  const result = await online.settle({
    transactionId: booking.payment.transactionId, status: outcome, amount: booking.amount,
    gatewayRef: `SIM-${tail}`, gatewayPaymentId: `simpay-${tail}`,
    ...(outcome === "FAILED" ? { reason: "Declined in the simulator" } : {}),
  }, req);
  const fresh = await Booking.findById(booking._id);
  const location = await Location.findById(fresh.locationId).select("name address onlineBooking").lean();
  res.json({ success: true, data: { outcome: result.outcome, booking: online.viewOf(fresh, location) } });
};

module.exports = { listLocations, getLocation, createBooking, getBooking, cancelBooking, simulate };
