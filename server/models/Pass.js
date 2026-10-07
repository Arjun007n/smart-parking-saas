const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("./constants");

const PASS_STATUSES = ["ACTIVE", "SUSPENDED", "CANCELLED"];
// What kind of customer the pass is for. Only a label for filtering and
// reports; the rules (validity, locations, free parking) are the same.
const PASS_TYPES = ["REGULAR", "EMPLOYEE", "RESIDENT", "VIP", "CORPORATE"];
const PASS_UNITS = ["DAY", "WEEK", "MONTH"];
const MAX_PASS_VEHICLES = 10;

// One vehicle that may use the pass.
const passVehicleSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, uppercase: true },
    type: { type: String, enum: VEHICLE_TYPES, required: true },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // The UHF / RFID tag stuck on this vehicle (capitals, letters and digits). Optional.
    tag: { type: String, uppercase: true, trim: true, maxlength: 48 },
  },
  { _id: false }
);

// History of vehicle changes on the pass (who, when, why).
const vehicleChangeSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["ADDED", "REMOVED", "REPLACED"], required: true },
    from: String,
    to: String,
    reason: { type: String, maxlength: 300 },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

// A monthly (or longer) parking pass for one vehicle. While it is valid the
// vehicle leaves without paying the tariff (session status PASS_EXIT).
//
// `status` is what an admin decided; whether the pass is valid *now* also
// depends on its dates (see services/passService.js, passState).
const passSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Locations where the pass works. Empty = every location of the company.
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    passNumber: { type: String, required: true, unique: true },
    passType: { type: String, enum: PASS_TYPES, default: "REGULAR" },
    // The firm or society this pass was bought for (see models/PassCompany.js). Optional.
    passCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "PassCompany" },
    // The vehicles that may use this pass (at most `maxVehicles`). The first
    // one is the main vehicle; vehicleNumber/vehicleType below always mirror it.
    vehicles: { type: [passVehicleSchema], default: [] },
    maxVehicles: { type: Number, default: 1, min: 1, max: MAX_PASS_VEHICLES },
    vehicleChanges: { type: [vehicleChangeSchema], default: [] },
    // Stored without spaces or dashes, in capitals, like Vehicle.plateNumber.
    vehicleNumber: { type: String, required: true, uppercase: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    holderName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20 },
    // Where the pass confirmation and the "ends soon" reminder are emailed (optional).
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    notes: { type: String, trim: true, maxlength: 300 },
    // Local midnight at the start of the first day, and local midnight AFTER the last day.
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: PASS_STATUSES, default: "ACTIVE" },
    statusReason: String,
    statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    statusChangedAt: Date,
    // True until cancelled. A vehicle has at most one current pass; renewing
    // extends it instead of making a second one.
    isCurrent: { type: Boolean, default: true },
    renewals: { type: Number, default: 0 },
    lastRenewedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

passSchema.pre("validate", function syncCurrentFlag() {
  this.isCurrent = this.status !== "CANCELLED";
  // Passes made before multi-vehicle support have only vehicleNumber.
  if (this.vehicles.length === 0 && this.vehicleNumber) {
    this.vehicles.push({ number: this.vehicleNumber, type: this.vehicleType });
  }
  if (this.vehicles.length > 0) {
    this.vehicleNumber = this.vehicles[0].number;
    this.vehicleType = this.vehicles[0].type;
  }
  if (this.vehicles.length > this.maxVehicles) {
    this.invalidate("vehicles", `A pass can have at most ${this.maxVehicles} vehicle(s)`);
  }
});

passSchema.index(
  { companyId: 1, vehicleNumber: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } }
);
// A vehicle belongs to at most one current pass of the company, whichever
// position it has in `vehicles`.
passSchema.index(
  { companyId: 1, "vehicles.number": 1 },
  { unique: true, partialFilterExpression: { isCurrent: true, "vehicles.number": { $type: "string" } } }
);
// A tag belongs to one vehicle of one current pass of the company.
passSchema.index(
  { companyId: 1, "vehicles.tag": 1 },
  { unique: true, partialFilterExpression: { isCurrent: true, "vehicles.tag": { $type: "string" } } }
);
passSchema.index({ companyId: 1, endDate: 1 });
passSchema.index({ companyId: 1, locationIds: 1 });
passSchema.index({ companyId: 1, holderName: 1 });
passSchema.index({ companyId: 1, passCompanyId: 1 }, { sparse: true });

module.exports = mongoose.model("Pass", passSchema);
module.exports.PASS_STATUSES = PASS_STATUSES;
module.exports.PASS_TYPES = PASS_TYPES;
module.exports.PASS_UNITS = PASS_UNITS;
module.exports.MAX_PASS_VEHICLES = MAX_PASS_VEHICLES;
