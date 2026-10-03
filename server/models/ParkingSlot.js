const mongoose = require("mongoose");
const { SLOT_TYPES, SLOT_STATUSES, VEHICLE_TYPES } = require("./constants");

const parkingSlotSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    zone: { type: String, trim: true },
    floor: { type: String, trim: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, default: "CAR" },
    type: { type: String, enum: SLOT_TYPES, default: "NORMAL" },
    status: { type: String, enum: SLOT_STATUSES, default: "FREE" },
    currentSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
  },
  { timestamps: true }
);

parkingSlotSchema.index({ locationId: 1, code: 1 }, { unique: true });
parkingSlotSchema.index({ companyId: 1, locationId: 1, status: 1 });

module.exports = mongoose.model("ParkingSlot", parkingSlotSchema);
