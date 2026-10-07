// Customer bookings: a booking waits for its vehicle, then is marked ARRIVED
// by the entry, or EXPIRED when the customer never came.
const Booking = require("../models/Booking");

// A booking is kept this long after its expected time before it expires.
const GRACE_HOURS = Math.min(72, Math.max(1, Number(process.env.BOOKING_GRACE_HOURS) || 12));
// A booking may be made at most this far ahead.
const MAX_DAYS_AHEAD = 30;

// A location may set its own waiting time (Location.onlineBooking.waitingMinutes); without one the
// company-wide default (GRACE_HOURS) applies.
const MIN_WAITING_MINUTES = 5;
const MAX_WAITING_MINUTES = 3 * 24 * 60;
const waitingMinutesOf = (location) => {
  const minutes = Number(location && location.onlineBooking && location.onlineBooking.waitingMinutes);
  return Number.isFinite(minutes) && minutes >= MIN_WAITING_MINUTES ? Math.min(MAX_WAITING_MINUTES, Math.floor(minutes)) : GRACE_HOURS * 60;
};

const graceCutoff = (now = new Date(), location) => new Date(now.getTime() - waitingMinutesOf(location) * 60000);

// When a booking stops waiting: its arrival time plus the location's waiting time. Stored on the
// booking so a later change to the setting does not move bookings that are already made.
const holdUntilFor = (location, expectedAt) => new Date(new Date(expectedAt).getTime() + waitingMinutesOf(location) * 60000);

// Closes bookings whose customer never came. Run before listing, so no timer is needed.
const expireOld = (filter = {}, now = new Date()) =>
  Booking.updateMany(
    {
      ...filter,
      status: "BOOKED",
      // Bookings made before waiting times existed have no holdUntil and use the default.
      $or: [{ holdUntil: { $lt: now } }, { holdUntil: { $exists: false }, expectedAt: { $lt: graceCutoff(now) } }],
    },
    { $set: { status: "EXPIRED" } }
  );

// The vehicle got a ticket: its waiting booking (if any) is now ARRIVED.
// Returns that booking, or null. Never throws into the entry.
const markArrived = async ({ companyId, locationId, vehicleNumber, session }) => {
  try {
    return await Booking.findOneAndUpdate(
      { companyId, locationId, vehicleNumber, status: "BOOKED" },
      { $set: { status: "ARRIVED", sessionId: session._id, arrivedAt: new Date() } },
      { returnDocument: "after" }
    );
  } catch (error) {
    console.error("Could not mark the booking as arrived:", error.message);
    return null;
  }
};

module.exports = { GRACE_HOURS, MAX_DAYS_AHEAD, MIN_WAITING_MINUTES, MAX_WAITING_MINUTES, waitingMinutesOf, holdUntilFor, graceCutoff, expireOld, markArrived };
