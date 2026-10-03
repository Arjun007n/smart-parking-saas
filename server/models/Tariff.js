const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

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
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

tariffSchema.index({ companyId: 1, locationId: 1, vehicleType: 1, isActive: 1 });

module.exports = mongoose.model("Tariff", tariffSchema);
