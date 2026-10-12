const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

// The Pass Charges table: what a pass costs at a location for one kind of vehicle. When the dates of a new pass
// are chosen, the total is worked out from these two prices (see services/passChargeService.js):
// every full month at `monthlyRate`, every day left over at `dailyRate`.
const passChargeSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    monthlyRate: { type: Number, required: true, min: 0 },
    dailyRate: { type: Number, required: true, min: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One row per location and vehicle type.
passChargeSchema.index({ companyId: 1, locationId: 1, vehicleType: 1 }, { unique: true });

module.exports = mongoose.model("PassCharge", passChargeSchema);
