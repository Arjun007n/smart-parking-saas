// Online bookings: a customer books a space on the public page, pays a booking fee through the
// payment gateway, and the paid fee is set against the parking fee when the vehicle arrives.
//
//   create ─► AWAITING_PAYMENT (payment PENDING) ─► BOOKED (payment PAID) ─► ARRIVED
//                  │                                    │        └─ the fee becomes the ticket's advance
//                  └─► EXPIRED / CANCELLED (FAILED)     └─► CANCELLED / EXPIRED with the fee still held:
//                                                          payment becomes REFUND_DUE and an admin is alerted
//
// A free booking (fee 0) is BOOKED at once. A booking never holds a space (as for staff bookings).
// The money rules are the same as for the exit payments: results can arrive twice, late or out of
// order, every change is guarded by the current state, and money that cannot be matched to a live
// booking raises an alert instead of disappearing. Refunds are made by an admin in the gateway.
//
// It is kept apart from services/paymentService.js on purpose: a booking has no ticket yet, so it
// cannot use the session-based settle, and a mistake here must never affect an exit payment.

const crypto = require("crypto");
const env = require("../config/env");
const AppError = require("../utils/AppError");
const audit = require("./auditService");
const bookings = require("./bookingService");
const messageService = require("./messageService");
const { notify } = require("./notificationService");
const gateway = require("../integrations/payment");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const ParkingSession = require("../models/ParkingSession");

const SYSTEM_REQ = Object.freeze({ headers: {}, ip: "system" });
const EXPIRED_REASON = "Not paid in time";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sameAmount = (a, b) => Math.abs(a - b) <= 0.005;
const paymentMinutes = () => Math.min(120, Math.max(5, Number(process.env.GATEWAY_PAYMENT_MINUTES) || 20));

// ---- the customer's secret -------------------------------------------------

const newToken = () => crypto.randomBytes(24).toString("base64url");
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const tokenMatches = (booking, token) => {
  if (!booking || !booking.accessHash || typeof token !== "string" || token.length < 20) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(booking.accessHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Short reference the customer can read out at the gate: BK- and the last six characters of the id.
const codeOf = (booking) => `BK-${String(booking._id).slice(-6).toUpperCase()}`;

// ---- what a location offers --------------------------------------------------

const feeFor = (location, vehicleType) =>
  round2((location.onlineBooking && location.onlineBooking.fees && location.onlineBooking.fees[String(vehicleType).toLowerCase()]) || 0);

const isOpenForBooking = (location) => Boolean(location && location.isActive && location.onlineBooking && location.onlineBooking.enabled);

// True when a customer can be sent to a payment page (fees can only be charged then).
const canTakePayments = () => {
  const chosen = gateway.provider();
  return Boolean(chosen && chosen.isConfigured() && chosen.hostedPage);
};

const offerOf = (location) => {
  const types = (location.vehicleTypes || []).map((type) => ({ type, fee: feeFor(location, type) }));
  return {
    id: location._id,
    name: location.name,
    address: {
      line1: location.address && location.address.line1, city: location.address && location.address.city,
      state: location.address && location.address.state,
    },
    // Where the parking is, so the public page can offer directions and sort by distance. Only when it was set.
    ...(location.coordinates && Number.isFinite(location.coordinates.lat) && Number.isFinite(location.coordinates.lng)
      ? { coordinates: { lat: location.coordinates.lat, lng: location.coordinates.lng } }
      : {}),
    types: canTakePayments() ? types : types.filter((t) => t.fee === 0),
    paymentAvailable: canTakePayments(),
    note: (location.onlineBooking && location.onlineBooking.note) || "",
    graceHours: bookings.GRACE_HOURS,
    maxDaysAhead: bookings.MAX_DAYS_AHEAD,
    hours: location.operatingHours,
  };
};

// ---- creating a booking --------------------------------------------------------

// Returns { booking, token }. The token is shown to the customer once and is the key to their booking page.
const createOnline = async ({ location, vehicleNumber, vehicleType, customerName, phone, expectedAt, note, now = new Date() }) => {
  if (!isOpenForBooking(location)) throw new AppError("Online booking is not available at this parking", 404);
  if (!location.vehicleTypes.includes(vehicleType)) {
    throw new AppError(`This parking does not accept ${vehicleType.toLowerCase()} vehicles`, 400);
  }
  if (expectedAt < bookings.graceCutoff(now)) throw new AppError("The arrival time has already passed", 400);
  if (expectedAt > new Date(now.getTime() + bookings.MAX_DAYS_AHEAD * 86400000)) {
    throw new AppError(`A booking can be at most ${bookings.MAX_DAYS_AHEAD} days ahead`, 400);
  }
  const amount = feeFor(location, vehicleType);
  if (amount > 0 && !canTakePayments()) throw new AppError("Paying a booking fee online is not available right now", 503);

  const companyId = location.companyId;
  if (await ParkingSession.exists({ companyId, vehicleNumber, isOpen: true })) {
    throw new AppError(`Vehicle ${vehicleNumber} is already inside`, 409);
  }
  await bookings.expireOld({ companyId, locationId: location._id, vehicleNumber }, now);
  await expireUnpaid({ companyId, locationId: location._id, vehicleNumber }, now);
  if (await Booking.exists({ locationId: location._id, vehicleNumber, status: { $in: ["BOOKED", "AWAITING_PAYMENT"] } })) {
    throw new AppError(`Vehicle ${vehicleNumber} already has a booking here`, 409);
  }

  const token = newToken();
  const base = {
    companyId, locationId: location._id, vehicleNumber, vehicleType, expectedAt, customerName, phone,
    ...(note ? { note } : {}), source: "ONLINE", amount, accessHash: hashToken(token),
  };

  if (amount <= 0) {
    const booking = await createBooking({ ...base, status: "BOOKED" });
    await audit.record(SYSTEM_REQ, "BOOKING_CREATED", { entity: "Booking", entityId: booking._id, companyId, meta: { vehicleNumber, expectedAt, source: "ONLINE" } });
    messageService.sendBookingNotice({ booking });
    return { booking, token };
  }

  const chosen = gateway.provider();
  const expiresAt = new Date(now.getTime() + paymentMinutes() * 60000);
  let order;
  try {
    order = await chosen.createOrder({
      amount, session: { ticketNumber: "booking fee", vehicleNumber }, expiresAt,
      description: `Parking booking fee (${vehicleNumber})`, returnUrl: `${env.clientUrl}/booking/return`,
    });
  } catch (error) {
    console.error("Could not start a booking payment:", error.message);
    throw new AppError("The payment page could not be started. Please try again.", 502);
  }
  const booking = await createBooking({
    ...base,
    status: "AWAITING_PAYMENT",
    payment: {
      state: "PENDING", provider: chosen.name, transactionId: order.transactionId,
      ...(order.gatewayRef ? { gatewayRef: order.gatewayRef } : {}), ...(order.payUrl ? { payUrl: order.payUrl } : {}),
      expiresAt: order.expiresAt || expiresAt,
    },
  });
  await audit.record(SYSTEM_REQ, "BOOKING_CREATED", { entity: "Booking", entityId: booking._id, companyId, meta: { vehicleNumber, expectedAt, source: "ONLINE", amount } });
  return { booking, token };
};

const createBooking = async (data) => {
  try {
    return await Booking.create(data);
  } catch (error) {
    if (error.code === 11000) throw new AppError(`Vehicle ${data.vehicleNumber} already has a booking here`, 409);
    throw error;
  }
};

// ---- the customer's view -------------------------------------------------------

const viewOf = (booking, location) => ({
  id: booking._id,
  code: codeOf(booking),
  status: booking.status,
  vehicleNumber: booking.vehicleNumber,
  vehicleType: booking.vehicleType,
  customerName: booking.customerName,
  expectedAt: booking.expectedAt,
  amount: booking.amount,
  payment: {
    state: booking.payment && booking.payment.state,
    ...(booking.payment && booking.payment.state === "PENDING" ? { payUrl: booking.payment.payUrl, expiresAt: booking.payment.expiresAt } : {}),
    ...(booking.payment && booking.payment.paidAt ? { paidAt: booking.payment.paidAt } : {}),
  },
  location: location ? { name: location.name, address: location.address && location.address.line1, city: location.address && location.address.city } : undefined,
  graceHours: bookings.GRACE_HOURS,
});

// ---- payment results -------------------------------------------------------------

const alertAdmin = (booking, title, message) =>
  notify({
    companyId: booking.companyId, locationId: booking.locationId, type: "PAYMENT_ISSUE", severity: "critical", title, message,
    data: { bookingId: booking._id, transactionId: booking.payment && booking.payment.transactionId },
    dedupeKey: `booking-issue:${booking._id}:${title}`,
  });

// Applies a gateway result to a booking. event: { transactionId, status: "SUCCESS" | "FAILED", gatewayRef?,
// gatewayPaymentId?, reason?, amount? }. Returns { outcome, booking? }; outcome "unknown" means this
// transaction is not a booking's (the caller tries other owners).
const settle = async (event, req = SYSTEM_REQ) => {
  const { transactionId, status, gatewayRef, gatewayPaymentId, reason, amount } = event;
  if (typeof transactionId !== "string") return { outcome: "unknown" };
  const existing = await Booking.findOne({ "payment.transactionId": transactionId });
  if (!existing) return { outcome: "unknown" };
  const refs = {
    ...(gatewayRef ? { "payment.gatewayRef": gatewayRef } : {}),
    ...(gatewayPaymentId ? { "payment.gatewayPaymentId": gatewayPaymentId } : {}),
  };
  const meta = { bookingId: existing._id, amount: existing.amount, provider: existing.payment.provider };

  if (status === "FAILED") {
    const failed = await Booking.findOneAndUpdate(
      { _id: existing._id, "payment.state": "PENDING" },
      { $set: { "payment.state": "FAILED", "payment.failureReason": (reason || "Payment failed").slice(0, 200), status: "CANCELLED", cancelReason: "Payment failed", ...refs } },
      { returnDocument: "after" }
    );
    if (!failed) return { outcome: "ignored", booking: existing };
    await audit.record(req, "BOOKING_PAYMENT_FAILED", { entity: "Booking", entityId: failed._id, companyId: failed.companyId, meta });
    return { outcome: "failed", booking: failed };
  }

  if (existing.payment.state === "PAID") return { outcome: "already", booking: existing };

  if (amount !== undefined && !sameAmount(amount, existing.amount)) {
    const flagged = await Booking.findOneAndUpdate(
      { _id: existing._id, "payment.state": { $in: ["PENDING", "FAILED"] } },
      { $set: { "payment.state": "REFUND_DUE", "payment.failureReason": `The gateway reports ${amount}, but the booking fee was ${existing.amount}`, status: "CANCELLED", cancelReason: "Wrong amount paid", ...refs } },
      { returnDocument: "after" }
    );
    if (!flagged) return { outcome: "ignored", booking: existing };
    await alertAdmin(flagged, "An online booking payment had the wrong amount",
      `Booking ${codeOf(flagged)} (${flagged.vehicleNumber}): ${flagged.payment.failureReason}. The booking was not confirmed. Refund it in the gateway.`);
    await audit.record(req, "BOOKING_PAYMENT_MISMATCH", { entity: "Booking", entityId: flagged._id, companyId: flagged.companyId, meta: { ...meta, reported: amount } });
    return { outcome: "mismatch", booking: flagged };
  }

  // A payment that arrives late (after we gave up waiting) still confirms the booking if the
  // arrival time has not passed and nobody else took the plate in the meantime.
  const stillUseful = existing.expectedAt >= bookings.graceCutoff();
  let paid = null;
  if (stillUseful) {
    try {
      paid = await Booking.findOneAndUpdate(
        { _id: existing._id, "payment.state": { $in: ["PENDING", "FAILED"] }, status: { $in: ["AWAITING_PAYMENT", "EXPIRED", "CANCELLED"] }, cancelReason: { $in: [null, "Payment failed", EXPIRED_REASON] } },
        { $set: { status: "BOOKED", "payment.state": "PAID", "payment.paidAt": new Date(), ...refs }, $unset: { "payment.failureReason": "", cancelReason: "" } },
        { returnDocument: "after" }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      paid = null; // another waiting booking for this plate
    }
  }
  if (paid) {
    await audit.record(req, "BOOKING_PAID", { entity: "Booking", entityId: paid._id, companyId: paid.companyId, meta });
    messageService.sendBookingNotice({ booking: paid });
    await notify({
      companyId: paid.companyId, locationId: paid.locationId, type: "BOOKING", severity: "info",
      title: `Online booking paid: ${paid.vehicleNumber}`, message: `${codeOf(paid)} · Rs ${paid.amount} · expected ${paid.expectedAt.toISOString()}`,
      data: { bookingId: paid._id }, dedupeKey: `booking-paid:${paid._id}`,
    });
    return { outcome: "success", booking: paid };
  }

  // The money is real but the booking cannot use it: keep it visible.
  const stranded = await Booking.findOneAndUpdate(
    { _id: existing._id, "payment.state": { $in: ["PENDING", "FAILED"] } },
    { $set: { "payment.state": "REFUND_DUE", "payment.paidAt": new Date(), ...refs } },
    { returnDocument: "after" }
  );
  const target = stranded || existing;
  await alertAdmin(target, "Money arrived for an online booking that cannot be confirmed",
    `Booking ${codeOf(target)} (${target.vehicleNumber}) was ${String(target.status).toLowerCase().replace("_", " ")}, but the gateway took Rs ${target.amount}. Refund it in the gateway or confirm the customer another way.`);
  await audit.record(req, "BOOKING_PAYMENT_UNMATCHED", { entity: "Booking", entityId: target._id, companyId: target.companyId, meta });
  return { outcome: "unmatched", booking: target };
};

// Marks bookings whose payment time ran out. Safe to run any time; a late payment can still revive one.
const expireUnpaid = (filter = {}, now = new Date()) =>
  Booking.updateMany(
    { ...filter, status: "AWAITING_PAYMENT", "payment.state": "PENDING", "payment.expiresAt": { $lt: now } },
    { $set: { status: "EXPIRED", "payment.state": "FAILED", "payment.failureReason": EXPIRED_REASON, cancelReason: EXPIRED_REASON } }
  );

// Housekeeping, run every minute: ask the gateway about payments whose result never arrived, then expire the rest.
const sweep = async (now = new Date()) => {
  const waiting = await Booking.find({
    status: "AWAITING_PAYMENT", "payment.state": "PENDING", createdAt: { $lte: new Date(now.getTime() - 60 * 1000) },
  }).sort({ createdAt: 1 }).limit(100);
  let settled = 0;
  for (const booking of waiting) {
    const owner = gateway.PROVIDERS[booking.payment.provider] || gateway.provider();
    let known = null;
    try {
      known = owner ? await owner.fetchStatus({ gatewayRef: booking.payment.gatewayRef, transactionId: booking.payment.transactionId }) : null;
    } catch (error) {
      console.error(`Could not ask the gateway about booking ${codeOf(booking)}:`, error.message);
    }
    if (known) {
      const result = await settle({ transactionId: booking.payment.transactionId, ...known });
      if (["success", "failed", "mismatch", "unmatched"].includes(result.outcome)) settled += 1;
    }
  }
  const expired = await expireUnpaid({}, now);
  return { checked: waiting.length, settled, expired: expired.modifiedCount || 0 };
};

// ---- arrival ----------------------------------------------------------------------

// The vehicle got its ticket. A paid booking fee becomes the ticket's advance (an ADVANCE payment row,
// so shifts and reports count it like any other advance). Never throws into the entry.
// Returns the advance applied ({ amount, paymentId }) or null.
const applyToSession = async (req, booking, session) => {
  try {
    if (!booking || booking.source !== "ONLINE" || !booking.payment || booking.payment.state !== "PAID" || !(booking.amount > 0)) return null;
    const claimed = await Booking.findOneAndUpdate(
      { _id: booking._id, "payment.appliedToSessionId": { $exists: false } },
      { $set: { "payment.appliedToSessionId": session._id } },
      { returnDocument: "after" }
    );
    if (!claimed) return null;
    try {
      if (session.advance && session.advance.amount > 0) throw new Error("an advance was already taken at the gate");
      const payment = await Payment.create({
        companyId: session.companyId, locationId: session.locationId, sessionId: session._id, kind: "ADVANCE",
        amount: booking.amount, tax: 0, method: "GATEWAY", status: "SUCCESS", paidAt: booking.payment.paidAt || new Date(),
        provider: booking.payment.provider, transactionId: booking.payment.transactionId,
        ...(booking.payment.gatewayRef ? { gatewayRef: booking.payment.gatewayRef } : {}),
        ...(booking.payment.gatewayPaymentId ? { gatewayPaymentId: booking.payment.gatewayPaymentId } : {}),
        ...(req && req.user ? { collectedBy: req.user._id } : {}),
      });
      await ParkingSession.updateOne(
        { _id: session._id },
        { $set: { advance: { amount: booking.amount, method: "GATEWAY", paymentId: payment._id, at: payment.paidAt } } }
      );
      await audit.record(req || SYSTEM_REQ, "ADVANCE_RECEIVED", {
        entity: "Payment", entityId: payment._id, companyId: session.companyId,
        meta: { sessionId: session._id, ticketNumber: session.ticketNumber, amount: booking.amount, method: "GATEWAY", booking: codeOf(booking) },
      });
      return { amount: booking.amount, paymentId: payment._id };
    } catch (error) {
      // Could not use the fee on this ticket (for example an advance was already taken at the gate).
      await Booking.updateOne({ _id: booking._id }, { $unset: { "payment.appliedToSessionId": "" }, $set: { "payment.state": "REFUND_DUE" } });
      await alertAdmin(booking, "A paid booking fee could not be set against the ticket",
        `Booking ${codeOf(booking)} (${booking.vehicleNumber}) paid Rs ${booking.amount}, but it could not be used on ticket ${session.ticketNumber} (${error.message}). Refund it in the gateway or take it into account by hand.`);
      return null;
    }
  } catch (error) {
    console.error("Could not apply the booking fee:", error.message);
    return null;
  }
};

// A staff member or the customer cancelled a booking that carries a paid fee: it must be refunded.
// Called after the booking was set to CANCELLED. Returns the updated booking.
const flagRefundIfPaid = async (booking) => {
  if (!booking || !booking.payment || booking.payment.state !== "PAID" || booking.payment.appliedToSessionId) return booking;
  const flagged = await Booking.findOneAndUpdate(
    { _id: booking._id, "payment.state": "PAID", "payment.appliedToSessionId": { $exists: false } },
    { $set: { "payment.state": "REFUND_DUE" } },
    { returnDocument: "after" }
  );
  if (flagged) {
    await alertAdmin(flagged, "Refund an online booking fee",
      `Booking ${codeOf(flagged)} (${flagged.vehicleNumber}) was cancelled and Rs ${flagged.amount} was paid online. Refund it in the gateway (transaction ${flagged.payment.transactionId}).`);
  }
  return flagged || booking;
};

module.exports = {
  EXPIRED_REASON, SYSTEM_REQ, newToken, hashToken, tokenMatches, codeOf, feeFor, isOpenForBooking, canTakePayments,
  offerOf, viewOf, createOnline, settle, expireUnpaid, sweep, applyToSession, flagRefundIfPaid,
};
