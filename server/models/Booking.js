const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

const BOOKING_STATUSES = ["AWAITING_PAYMENT", "BOOKED", "ARRIVED", "CANCELLED", "EXPIRED"];
const PAYMENT_STATES = ["NONE", "PENDING", "PAID", "FAILED", "REFUND_DUE"];

// A customer who told the parking in advance that they are coming. It does not
// hold a space and takes no money: it is a note the gate staff can see, and it
// is marked ARRIVED when that vehicle gets a ticket.
const bookingSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    vehicleNumber: { type: String, required: true, uppercase: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    customerName: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20 },
    note: { type: String, trim: true, maxlength: 300 },
    // When the customer plans to arrive.
    expectedAt: { type: Date, required: true },
    // After this moment a booking that nobody used expires (arrival time plus the location's waiting time).
    holdUntil: Date,
    status: { type: String, enum: BOOKING_STATUSES, default: "BOOKED" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
    arrivedAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: String,
    // Where the booking came from. ONLINE ones are made by the customer on the public page.
    source: { type: String, enum: ["STAFF", "ONLINE"], default: "STAFF" },
    // The booking fee (set against the parking fee on arrival). 0 for a free booking.
    amount: { type: Number, default: 0, min: 0 },
    payment: {
      state: { type: String, enum: PAYMENT_STATES, default: "NONE" },
      transactionId: String,
      provider: String,
      gatewayRef: String,
      gatewayPaymentId: String,
      payUrl: String,
      expiresAt: Date,
      paidAt: Date,
      failureReason: String,
      // Set when the paid fee was applied to the vehicle's ticket as an advance.
      appliedToSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
    },
    // Hash of the secret the customer's page uses to look the booking up (never stored in clear).
    accessHash: { type: String, select: false },
  },
  { timestamps: true }
);

// One waiting booking per vehicle at a location.
bookingSchema.index(
  { locationId: 1, vehicleNumber: 1 },
  { unique: true, partialFilterExpression: { status: "BOOKED" }, name: "one_waiting_booking_per_vehicle" }
);
bookingSchema.index({ companyId: 1, locationId: 1, status: 1, expectedAt: 1 });
bookingSchema.index({ "payment.transactionId": 1 }, { unique: true, partialFilterExpression: { "payment.transactionId": { $type: "string" } } });
bookingSchema.index({ status: 1, "payment.state": 1, "payment.expiresAt": 1 });

module.exports = mongoose.model("Booking", bookingSchema);
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;
