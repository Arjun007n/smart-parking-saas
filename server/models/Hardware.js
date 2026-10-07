const mongoose = require("mongoose");

// Device types the platform can talk to. More (LED displays...) can be added
// here later without touching the rest.
//   RFID_READER   UHF / RFID reader: a pass tag is read, the vehicle is suggested
//   FASTAG_READER FASTag reader: the vehicle (and its FASTag) is suggested
//   CCTV_CAMERA   takes a snapshot at entry and exit and files it as a photo
const HARDWARE_TYPES = ["ANPR_CAMERA", "BARRIER", "PRINTER", "RFID_READER", "FASTAG_READER", "CCTV_CAMERA"];
const DIRECTIONS = ["ENTRY", "EXIT", "BOTH"];

// A device (camera, barrier controller, printer, reader) installed at a location.
//
// Devices never use a user login. Each one has its own secret key, shown once
// when it is created; only a SHA-256 hash of it is stored.
const hardwareSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: HARDWARE_TYPES, required: true },
    // Which gate of the location it serves (matches Location.gates[].name).
    gate: { type: String, trim: true, maxlength: 50 },
    direction: { type: String, enum: DIRECTIONS, default: "BOTH" },
    vendor: { type: String, trim: true, maxlength: 80 },
    model: { type: String, trim: true, maxlength: 80 },

    keyHash: { type: String, required: true, select: false },
    keyPrefix: { type: String, required: true }, // first characters, to recognise a key

    isActive: { type: Boolean, default: true },
    // Devices that only speak when something happens (some cameras) can be
    // left unmonitored so quiet periods are not reported as "offline".
    monitorOnline: { type: Boolean, default: true },
    offlineAfterSeconds: { type: Number, default: 120, min: 30, max: 3600 },

    isOnline: { type: Boolean, default: false },
    lastSeenAt: Date,
    lastIp: String,
    agentVersion: { type: String, maxlength: 40 },

    config: {
      // ANPR: detections below this confidence need a human to check the plate.
      minConfidence: { type: Number, min: 0, max: 1 },
      // Barrier: how long the relay is pulsed to open the arm.
      pulseMs: { type: Number, min: 100, max: 10000 },
      // Printer: paper width and automatic printing.
      paperWidthMm: {
        type: Number,
        default: 80,
        validate: { validator: (v) => v === 58 || v === 80, message: "Paper width must be 58 or 80 mm" },
      },
      autoPrint: { type: Boolean, default: true },
      printQr: { type: Boolean, default: false },
      // ANPR camera: where the camera's live picture is (a token in the address keeps it private).
      previewUrl: { type: String, trim: true, maxlength: 300 },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.keyHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

hardwareSchema.index({ keyHash: 1 }, { unique: true });
hardwareSchema.index({ companyId: 1, locationId: 1, type: 1 });
hardwareSchema.index({ companyId: 1, locationId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Hardware", hardwareSchema);
module.exports.HARDWARE_TYPES = HARDWARE_TYPES;
module.exports.DIRECTIONS = DIRECTIONS;
