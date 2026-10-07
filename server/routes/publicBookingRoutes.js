const express = require("express");

const router = express.Router();
const controller = require("../controllers/publicBookingController");
const rateLimit = require("../middleware/rateLimit");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { VEHICLE_TYPES } = require("../models/constants");

// No login here, so the limits are tighter than for the rest of the API.
// PUBLIC_BOOKING_RATE_MAX (default 10) is read on every request, so tests can change it.
const createLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: () => Number(process.env.PUBLIC_BOOKING_RATE_MAX) || 10, message: "Too many bookings from this address. Please try again later." });
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

router.get("/locations", readLimiter, controller.listLocations);
router.get("/locations/:id", readLimiter, validateIdParam(), controller.getLocation);
router.post(
  "/bookings",
  createLimiter,
  validateBody({
    locationId: { type: "objectId", required: true },
    vehicleNumber: { type: "string", required: true, max: 20 },
    vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
    customerName: { type: "string", required: true, min: 2, max: 100 },
    phone: { type: "string", required: true, max: 20, pattern: /^[0-9+\-\s]{6,20}$/, message: "must be a phone number" },
    note: { type: "string", max: 300 },
    expectedAt: { type: "date", required: true },
  }),
  controller.createBooking
);
router.get("/bookings/:id", readLimiter, validateIdParam(), controller.getBooking);
router.post("/bookings/:id/cancel", readLimiter, validateIdParam(), controller.cancelBooking);
router.post(
  "/bookings/:id/simulate",
  readLimiter,
  validateIdParam(),
  validateBody({ outcome: { type: "string", enum: ["SUCCESS", "FAILED"] } }),
  controller.simulate
);

module.exports = router;
