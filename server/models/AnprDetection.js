const mongoose = require("mongoose");

const DETECTION_STATUSES = ["PENDING", "CONFIRMED", "DISMISSED", "EXPIRED"];
// CAMERA: an ANPR camera. PHOTO: a picture an operator took. RFID: a pass tag read by a
// UHF reader. FASTAG: a FASTag read by a reader.
const DETECTION_SOURCES = ["CAMERA", "PHOTO", "RFID", "FASTAG"];

// One number plate seen by an ANPR camera. A detection is only a SUGGESTION:
// an operator confirms (or corrects) it, and only then is an entry or exit
// made. The original text and image address are kept for audit.
const anprDetectionSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    // Camera detections have a camera; a plate read from an operator's photo does not.
    hardwareId: { type: mongoose.Schema.Types.ObjectId, ref: "Hardware" },
    source: { type: String, enum: DETECTION_SOURCES, default: "CAMERA" },
    readBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // PHOTO: who took the picture
    gate: String,
    direction: { type: String, enum: ["ENTRY", "EXIT"], required: true },

    plateRaw: { type: String, maxlength: 40 }, // exactly what the camera said
    plate: { type: String, default: "" }, // cleaned up; empty = nothing could be read
    confidence: { type: Number, min: 0, max: 1 }, // 0..1
    capturedAt: { type: Date, default: Date.now },
    imageUrl: { type: String, maxlength: 500 },
    deviceEventId: String, // the camera's own id for this event, if it has one
    // RFID / FASTAG readers: the tag that was read, and the pass it belongs to (RFID).
    tagId: { type: String, maxlength: 48 },
    passNumber: { type: String, maxlength: 40 },

    status: { type: String, enum: DETECTION_STATUSES, default: "PENDING" },
    // True when a person must look at it before using it.
    needsReview: { type: Boolean, default: false },
    reviewReasons: [String],

    // The same plate seen again within the duplicate window only adds a hit.
    hits: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
    dedupeKey: String,

    // Exit cameras: the vehicle that is inside with this plate.
    matchedSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
    matchedTicketNumber: String,
    alreadyInside: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false },

    // How it was settled.
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
    finalPlate: String, // the plate the operator actually used (after any correction)
    corrected: { type: Boolean, default: false },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
  },
  { timestamps: true }
);

anprDetectionSchema.index({ companyId: 1, locationId: 1, status: 1, createdAt: -1 });
anprDetectionSchema.index(
  { hardwareId: 1, deviceEventId: 1 },
  { unique: true, partialFilterExpression: { deviceEventId: { $type: "string" } } }
);
// While a detection is waiting, one per plate / direction / location / time window.
anprDetectionSchema.index(
  { companyId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" }, status: "PENDING" } }
);
// Removed automatically after 60 days.
anprDetectionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model("AnprDetection", anprDetectionSchema);
module.exports.DETECTION_STATUSES = DETECTION_STATUSES;
module.exports.DETECTION_SOURCES = DETECTION_SOURCES;
