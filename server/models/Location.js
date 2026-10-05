const mongoose = require("mongoose");
const { VEHICLE_TYPES, VEHICLE_KEYS } = require("./constants");

const countsByVehicle = Object.fromEntries(VEHICLE_KEYS.map((key) => [key, { type: Number, default: 0, min: 0 }]));

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
        // A gate is a lane. These are optional labels shown on the lane's screen and,
        // for FASTag, the identifiers the toll-tag network knows the lane by.
        laneCode: { type: String, trim: true, maxlength: 30 },
        plazaId: { type: String, trim: true, maxlength: 30 },
        fastagLaneId: { type: String, trim: true, maxlength: 30 },
      },
    ],
    zones: [{ type: String, trim: true }],
    // Customers can book ahead on the public page and pay a fee, which is set against the parking
    // fee on arrival (see services/onlineBookingService.js). Off until a company switches it on.
    onlineBooking: {
      enabled: { type: Boolean, default: false },
      // The booking fee per vehicle class, in rupees. 0 = that class books free, with no payment.
      fees: Object.fromEntries(VEHICLE_KEYS.map((key) => [key, { type: Number, default: 0, min: 0, max: 100000 }])),
      note: { type: String, trim: true, maxlength: 300 },
    },
    // What the printed and on-screen ticket and receipt say (see utils/receiptSettings.js).
    receiptSettings: {
      headerNote: { type: String, trim: true, maxlength: 120 },
      ticketFooter: { type: String, trim: true, maxlength: 200 },
      receiptFooter: { type: String, trim: true, maxlength: 200 },
      showAddress: { type: Boolean },
      showGst: { type: Boolean },
      showQr: { type: String, enum: ["DEVICE", "ON", "OFF"] },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

locationSchema.index({ companyId: 1, name: 1 }, { unique: true });
locationSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("Location", locationSchema);
