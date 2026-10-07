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
    // NORMAL = everyday parking. AIRPORT = long-stay parking (the Airport tariffs apply to it first).
    parkingType: { type: String, enum: ["NORMAL", "AIRPORT"], default: "NORMAL" },
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
        // Serial number of the camera fitted at this lane (for the lane list; the camera itself is set up on the Hardware page).
        cameraSerial: { type: String, trim: true, maxlength: 60 },
        // A lane that is switched off takes no entries or exits and keeps its set-up and history.
        isActive: { type: Boolean, default: true },
        // The kind of vehicle this lane is for (a car lane, a bike lane). The entry screen picks it by itself
        // when the camera cannot tell. Not set = the lane takes any type.
        vehicleType: { type: String, enum: VEHICLE_TYPES },
      },
    ],
    zones: [{ type: String, trim: true }],
    // How many staff may be assigned to this location. Not set = no limit of its own (the company's
    // plan still caps the total). See services/licenceService.js.
    userLicence: { limit: { type: Number, min: 0, max: 100000 } },
    // Customers can book ahead on the public page and pay a fee, which is set against the parking
    // fee on arrival (see services/onlineBookingService.js). Off until a company switches it on.
    onlineBooking: {
      enabled: { type: Boolean, default: false },
      // The booking fee per vehicle class, in rupees. 0 = that class books free, with no payment.
      fees: Object.fromEntries(VEHICLE_KEYS.map((key) => [key, { type: Number, default: 0, min: 0, max: 100000 }])),
      note: { type: String, trim: true, maxlength: 300 },
      waitingMinutes: { type: Number, min: 0, max: 4320 },
      cancelBeforeMinutes: { type: Number, min: 0, max: 10080 },
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
    // Who gets this location's own end-of-day report by email (needs the company's daily report switched on).
    reportRecipients: [{ type: String, trim: true, lowercase: true, maxlength: 254 }],
    // Switches for how the gate works (see utils/operations.js for what each one does and its default).
    operations: {
      allowReEntry: { type: Boolean },
      exitAmountEdit: { type: Boolean },
      autoExitHours: { type: Number, min: 0, max: 720 },
      // How many re-entries one gate operator may make in a day at this location (0 = no limit). Set by an admin.
      reEntryLimit: { type: Number, min: 0, max: 1000 },
      // Re-entries made before this moment are not counted (the admin's "reset counter").
      reEntryCountFrom: { type: Date },
      // Per vehicle type: close a ticket still open after `days` days. `amount` is what the vehicle
      // still owes (written on the ticket and in the alert; no money is recorded by the system).
      autoExitRules: [
        {
          _id: false,
          vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
          active: { type: Boolean, default: false },
          days: { type: Number, min: 1, max: 365, required: true },
          amount: { type: Number, min: 0, max: 1000000, default: 0 },
        },
      ],
      printTicketNumber: { type: Boolean },
      printPhoto: { type: Boolean },
      photoAutoCapture: { type: Boolean },
      printPassReceipt: { type: Boolean },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

locationSchema.index({ companyId: 1, name: 1 }, { unique: true });
locationSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("Location", locationSchema);
