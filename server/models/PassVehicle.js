const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

// A vehicle that belongs to a pass user, with or without a pass. The Vehicle List and the "Add New
// Vehicle" page work on these; selling a pass adds its vehicles here too.
const passVehicleSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    passUserId: { type: mongoose.Schema.Types.ObjectId, ref: "PassUser", required: true },
    // Stored without spaces or dashes, in capitals.
    plateNumber: { type: String, required: true, uppercase: true, trim: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
  },
  { timestamps: true }
);

// A vehicle number belongs to one pass user of the company.
passVehicleSchema.index({ companyId: 1, plateNumber: 1 }, { unique: true });
passVehicleSchema.index({ companyId: 1, passUserId: 1 });

module.exports = mongoose.model("PassVehicle", passVehicleSchema);
