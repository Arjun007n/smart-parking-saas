const mongoose = require("mongoose");
const { SESSION_STATUSES, VEHICLE_TYPES } = require("./constants");

const OPEN_STATUSES = ["ACTIVE", "PAYMENT_PENDING"];

// A photo of the vehicle taken at the gate. The picture itself is a file on
// disk (see services/photoStorage.js); only its name is kept here, and that
// name is never sent to clients (the toJSON below removes it).
const PHOTO_KINDS = ["ENTRY", "EXIT", "OTHER"];
const photoSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: PHOTO_KINDS, default: "OTHER" },
    file: { type: String, required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    takenAt: { type: Date, default: Date.now },
    takenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Pictures from a CCTV camera: its name, and the command that asked for it (a repeat adds nothing).
    takenByDevice: { type: String, maxlength: 100 },
    deviceCommandId: { type: mongoose.Schema.Types.ObjectId },
  },
  {
    toJSON: {
      transform: (doc, ret) => {
        delete ret.file;
        return ret;
      },
    },
  }
);

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
    // True when this ticket replaced another one (a re-entry). Counted per operator for the admin.
    reEntry: { type: Boolean },
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
      // Set when the vehicle paid an advance at entry (see services/advanceService.js):
      // how much of the advance went against this fee, what is still to pay, and
      // how much of the advance was given back.
      advanceApplied: Number,
      due: Number,
      advanceRefunded: Number,
      breakdown: {
        base: Number,
        overnight: Number,
        lostTicket: Number,
        discount: Number,
      },
    },
    // Money taken at entry. The matching Payment row (kind ADVANCE) is the record
    // the books use; this is a copy so lists and tickets can show it.
    advance: {
      amount: Number,
      method: String,
      paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
      at: Date,
    },
    lostTicket: { type: Boolean, default: false },
    // How many times the ticket was printed again after the first print.
    reprints: { type: Number, default: 0, min: 0 },
    // Set when the person at the exit changed the amount: what the tariff said, and why.
    feeEdit: {
      calculated: Number,
      reason: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: Date,
    },
    // True when the ticket was closed by the "close forgotten tickets" switch of its location.
    autoClosed: { type: Boolean, default: false },
    // Why an admin cancelled the session or closed it by hand.
    overrideReason: String,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Sent by the client so a repeated request does not create two sessions.
    idempotencyKey: String,
    photos: { type: [photoSchema], default: [] },
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
// Reports: one location (or a few) over a period of entries or exits.
parkingSessionSchema.index({ companyId: 1, locationId: 1, entryTime: -1 });
parkingSessionSchema.index({ companyId: 1, locationId: 1, exitTime: -1 });
parkingSessionSchema.index({ companyId: 1, exitTime: -1 });
// The nightly clean-up looks for old photos.
parkingSessionSchema.index({ "photos.takenAt": 1 }, { sparse: true });
parkingSessionSchema.index(
  { companyId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.model("ParkingSession", parkingSessionSchema);
module.exports.OPEN_STATUSES = OPEN_STATUSES;
module.exports.PHOTO_KINDS = PHOTO_KINDS;
