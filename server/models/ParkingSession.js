const mongoose = require("mongoose");
const { SESSION_STATUSES, VEHICLE_TYPES } = require("./constants");

const OPEN_STATUSES = ["ACTIVE", "PAYMENT_PENDING"];

const parkingSessionSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    ticketNumber: { type: String, required: true, unique: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
    vehicleNumber: { type: String, required: true, uppercase: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    status: { type: String, enum: SESSION_STATUSES, default: "ACTIVE" },
    // True while the vehicle is still inside. Kept in sync with `status`
    // below and used by the "one open session per vehicle" index.
    isOpen: { type: Boolean, default: true },
    entryTime: { type: Date, required: true, default: Date.now },
    exitTime: Date,
    entryGate: String,
    exitGate: String,
    entryOperatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    exitOperatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSlot" },
    tariffId: { type: mongoose.Schema.Types.ObjectId, ref: "Tariff" },
    passId: { type: mongoose.Schema.Types.ObjectId, ref: "Pass" },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    durationMinutes: Number,
    // Filled when the exit fee is calculated (see services/tariffService.js).
    fee: {
      subtotal: Number,
      tax: Number,
      total: Number,
      taxPercent: Number,
      taxInclusive: Boolean,
      reason: String,
      breakdown: {
        base: Number,
        overnight: Number,
        lostTicket: Number,
        discount: Number,
      },
    },
    lostTicket: { type: Boolean, default: false },
    // Why an admin cancelled the session or closed it by hand.
    overrideReason: String,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Sent by the client so a repeated request does not create two sessions.
    idempotencyKey: String,
  },
  { timestamps: true }
);

parkingSessionSchema.pre("validate", function syncOpenFlag() {
  this.isOpen = OPEN_STATUSES.includes(this.status);
});

// A vehicle can have only one open session at a location.
parkingSessionSchema.index(
  { locationId: 1, vehicleNumber: 1 },
  { unique: true, partialFilterExpression: { isOpen: true } }
);
parkingSessionSchema.index({ companyId: 1, locationId: 1, status: 1 });
parkingSessionSchema.index({ companyId: 1, entryTime: -1 });
parkingSessionSchema.index({ companyId: 1, exitTime: -1 });
parkingSessionSchema.index(
  { companyId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.model("ParkingSession", parkingSessionSchema);
module.exports.OPEN_STATUSES = OPEN_STATUSES;
