const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

const countsByVehicle = {
  car: { type: Number, default: 0, min: 0 },
  bike: { type: Number, default: 0, min: 0 },
  heavy: { type: Number, default: 0, min: 0 },
};

const locationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    address: {
      line1: { type: String, required: true, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    coordinates: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    contact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
    },
    operatingHours: {
      is24x7: { type: Boolean, default: true },
      open: { type: String, default: "00:00" },
      close: { type: String, default: "23:59" },
    },
    vehicleTypes: { type: [{ type: String, enum: VEHICLE_TYPES }], default: ["CAR", "BIKE"] },
    // MVP works on total capacity and occupancy counts (plan, Day 9).
    // Bay-level detail lives in ParkingSlot.
    capacity: countsByVehicle,
    occupied: countsByVehicle,
    gates: [
      {
        name: { type: String, required: true, trim: true },
        type: { type: String, enum: ["ENTRY", "EXIT", "BOTH"], default: "BOTH" },
      },
    ],
    zones: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

locationSchema.index({ companyId: 1, name: 1 }, { unique: true });
locationSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("Location", locationSchema);
