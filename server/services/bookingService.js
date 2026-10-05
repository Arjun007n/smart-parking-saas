// Customer bookings: a booking waits for its vehicle, then is marked ARRIVED
// by the entry, or EXPIRED when the customer never came.
const Booking = require("../models/Booking");

// A booking is kept this long after its expected time before it expires.
const GRACE_HOURS = Math.min(72, Math.max(1, Number(process.env.BOOKING_GRACE_HOURS) || 12));
// A booking may be made at most this far ahead.
const MAX_DAYS_AHEAD = 30;

const graceCutoff = (now = new Date()) => new Date(now.getTime() - GRACE_HOURS * 3600 * 1000);

// Closes bookings whose customer never came. Run before listing, so no timer is needed.
const expireOld = (filter = {}, now = new Date()) =>
  Booking.updateMany({ ...filter, status: "BOOKED", expectedAt: { $lt: graceCutoff(now) } }, { $set: { status: "EXPIRED" } });

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

module.exports = { GRACE_HOURS, MAX_DAYS_AHEAD, graceCutoff, expireOld, markArrived };
