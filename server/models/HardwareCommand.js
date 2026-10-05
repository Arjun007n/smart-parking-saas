const mongoose = require("mongoose");

const COMMAND_TYPES = [
  "BARRIER_OPEN", "BARRIER_CLOSE", "PRINT_TICKET", "PRINT_RECEIPT", "PRINT_TEST",
  "CAPTURE_SNAPSHOT", "SNAPSHOT_TEST",
];
const COMMAND_STATUSES = ["PENDING", "SENT", "ACKED", "FAILED", "EXPIRED"];
const FINAL_STATUSES = ["ACKED", "FAILED", "EXPIRED"];

// An instruction for one device. Devices are unreliable, so every command has
// a deadline (`expiresAt`): a "raise the barrier" that could not be delivered
// within seconds must never be carried out minutes later.
//
//   PENDING ─► SENT ─► ACKED          device did it
//      ▲         ├───► FAILED         device could not, no attempts left
//      └─────────┤                    device could not / did not answer: tried again
//                └───► EXPIRED        deadline passed
const hardwareCommandSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    hardwareId: { type: mongoose.Schema.Types.ObjectId, ref: "Hardware", required: true },
    type: { type: String, enum: COMMAND_TYPES, required: true },
    payload: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: COMMAND_STATUSES, default: "PENDING" },
    // Same key for the same device = the same command (no duplicates).
    idempotencyKey: String,
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    ackTimeoutSeconds: { type: Number, default: 8 },
    // The earliest moment a device may (re)take this command.
    availableAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    sentAt: Date,
    completedAt: Date,
    error: { type: String, maxlength: 300 },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reason: { type: String, maxlength: 300 },
  },
  { timestamps: true }
);

hardwareCommandSchema.index({ hardwareId: 1, status: 1, availableAt: 1 });
hardwareCommandSchema.index({ status: 1, expiresAt: 1 });
hardwareCommandSchema.index({ companyId: 1, createdAt: -1 });
hardwareCommandSchema.index(
  { hardwareId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);
// Removed automatically after 30 days.
hardwareCommandSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("HardwareCommand", hardwareCommandSchema);
module.exports.COMMAND_TYPES = COMMAND_TYPES;
module.exports.COMMAND_STATUSES = COMMAND_STATUSES;
module.exports.FINAL_STATUSES = FINAL_STATUSES;
