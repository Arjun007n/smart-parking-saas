const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

const vehicleSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Stored without spaces or dashes, in capitals: "RJ14 AB-1234" -> "RJ14AB1234".
    plateNumber: {
      type: String,
      required: true,
      uppercase: true,
      set: (v) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v),
    },
    type: { type: String, enum: VEHICLE_TYPES, default: "CAR" },
    ownerName: { type: String, trim: true },
    phone: { type: String, trim: true },
    passId: { type: mongoose.Schema.Types.ObjectId, ref: "Pass" },
    lastLocationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    photos: [String],
    isBlocked: { type: Boolean, default: false },
    blockedReason: { type: String, trim: true },
  },
  { timestamps: true }
);

vehicleSchema.index({ companyId: 1, plateNumber: 1 }, { unique: true });
vehicleSchema.index({ companyId: 1, phone: 1 });

module.exports = mongoose.model("Vehicle", vehicleSchema);
