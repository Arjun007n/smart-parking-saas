const mongoose = require("mongoose");
const { VEHICLE_TYPES, TARIFF_KINDS, TIME_PATTERN } = require("./constants");

const tariffSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    name: { type: String, required: true, trim: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    gracePeriodMinutes: { type: Number, default: 0, min: 0 },
    // Duration slabs, for example: up to 60 min = 20, up to 180 min = 50.
    slabs: [
      {
        uptoMinutes: { type: Number, required: true, min: 1 },
        rate: { type: Number, required: true, min: 0 },
      },
    ],
    // Charged for each started hour after the last slab.
    additionalPerHour: { type: Number, default: 0, min: 0 },
    minimumFee: { type: Number, default: 0, min: 0 },
    maxDailyFee: { type: Number, min: 0 },
    overnightFee: { type: Number, min: 0 },
    lostTicketFee: { type: Number, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxInclusive: { type: Boolean, default: true },
    // Optional day/time limits. Empty means the tariff always applies.
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    validFrom: Date,
    validTo: Date,
    // Event and airport pricing (Phase 4).
    // STANDARD = everyday tariff, EVENT = a dated event (match, concert, festival),
    // AIRPORT = long-stay style pricing. The kind decides which tariff wins and
    // which fields the web form shows; the fee engine reads the fields themselves.
    kind: { type: String, enum: TARIFF_KINDS, default: "STANDARD" },
    eventName: { type: String, trim: true, maxlength: 100 },
    // Higher wins when several tariffs apply. Normally left at 0.
    priority: { type: Number, default: 0, min: 0, max: 100, validate: Number.isInteger },
    // Local time window for the ENTRY time, "HH:MM". The window may cross midnight
    // (22:00 to 06:00). Empty means any time of day.
    startTime: { type: String, match: TIME_PATTERN },
    endTime: { type: String, match: TIME_PATTERN },
    // One fee for the whole stay, instead of slabs (typical for events).
    flatFee: { type: Number, min: 0 },
    // Airport long stay: once a stay is longer than this many minutes, it is
    // charged this rate for every started 24 hours instead of slabs/hourly.
    longStayAfterMinutes: { type: Number, min: 1 },
    longStayDailyRate: { type: Number, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

tariffSchema.index({ companyId: 1, locationId: 1, vehicleType: 1, isActive: 1 });

module.exports = mongoose.model("Tariff", tariffSchema);
