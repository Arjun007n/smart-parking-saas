const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const bookings = require("../services/bookingService");
const { parsePlate } = require("../utils/plate");
const { locationScopedFilter, getAccessibleLocation, locationIdFromQuery } = require("../utils/scope");
const Booking = require("../models/Booking");
const messageService = require("../services/messageService");
const onlineBookings = require("../services/onlineBookingService");
const ParkingSession = require("../models/ParkingSession");

const PAGE_SIZE = 100;

// GET /api/bookings?locationId=&status=waiting|all
const listBookings = async (req, res) => {
  const conditions = [locationScopedFilter(req)];
  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId });
  await bookings.expireOld({ $and: conditions });
  await onlineBookings.expireUnpaid({ $and: conditions });
  if (req.query.status !== "all") conditions.push({ status: { $in: ["BOOKED", "AWAITING_PAYMENT"] } });

  const items = await Booking.find({ $and: conditions }).sort({ expectedAt: 1 }).limit(PAGE_SIZE);
  res.json({ success: true, data: { bookings: items, graceHours: bookings.GRACE_HOURS } });
};

// POST /api/bookings
const createBooking = async (req, res) => {
  const { locationId, vehicleType, customerName, phone, note } = req.body;
  const vehicleNumber = parsePlate(req.body.vehicleNumber);
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });
  if (!location.vehicleTypes.includes(vehicleType)) {
    throw new AppError(`This location does not accept ${vehicleType.toLowerCase()} vehicles`, 400);
  }

  const now = new Date();
  const expectedAt = req.body.expectedAt || now;
  if (expectedAt < bookings.graceCutoff(now, location)) throw new AppError("The arrival time has already passed", 400);
  if (expectedAt > new Date(now.getTime() + bookings.MAX_DAYS_AHEAD * 86400000)) {
    throw new AppError(`A booking can be at most ${bookings.MAX_DAYS_AHEAD} days ahead`, 400);
  }

  if (await ParkingSession.exists({ companyId: location.companyId, vehicleNumber, isOpen: true })) {
    throw new AppError(`Vehicle ${vehicleNumber} is already inside`, 409);
  }
  await bookings.expireOld({ companyId: location.companyId, locationId: location._id, vehicleNumber });

  let booking;
  try {
    booking = await Booking.create({
      companyId: location.companyId, locationId: location._id, vehicleNumber, vehicleType, expectedAt,
      holdUntil: bookings.holdUntilFor(location, expectedAt),
      ...(customerName ? { customerName } : {}), ...(phone ? { phone } : {}), ...(note ? { note } : {}),
      createdBy: req.user._id,
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError(`Vehicle ${vehicleNumber} already has a booking waiting here`, 409);
    throw error;
  }
  await audit.record(req, "BOOKING_CREATED", {
    entity: "Booking", entityId: booking._id, companyId: booking.companyId, meta: { vehicleNumber, expectedAt },
  });
  messageService.sendBookingNotice({ booking });
  res.status(201).json({ success: true, data: booking });
};

// POST /api/bookings/:id/cancel
const cancelBooking = async (req, res) => {
  const booking = await Booking.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!booking) throw new AppError("Booking not found", 404);
  let cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ["BOOKED", "AWAITING_PAYMENT"] } },
    { $set: { status: "CANCELLED", cancelledBy: req.user._id, ...(req.body.reason ? { cancelReason: req.body.reason } : {}) } },
    { returnDocument: "after" }
  );
  if (!cancelled) throw new AppError(`This booking is already ${booking.status.toLowerCase().replace("_", " ")}`, 409);
  // A fee already paid online has to go back to the customer.
  cancelled = await onlineBookings.flagRefundIfPaid(cancelled);
  await audit.record(req, "BOOKING_CANCELLED", {
    entity: "Booking", entityId: cancelled._id, companyId: cancelled.companyId, meta: { vehicleNumber: cancelled.vehicleNumber },
  });
  res.json({ success: true, data: cancelled });
};

module.exports = { listBookings, createBooking, cancelBooking };
