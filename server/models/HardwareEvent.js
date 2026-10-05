const mongoose = require("mongoose");

const EVENT_TYPES = [
  "ONLINE", "OFFLINE", "COMMAND_FAILED", "COMMAND_EXPIRED", "COMMAND_ACKED",
  "DEVICE_ERROR", "DEVICE_INFO", "KEY_ROTATED", "UNKNOWN_TAG",
];

// Things worth knowing about a device: it came online, went offline, a
// command failed, it reported an error. Heartbeats are not stored.
const hardwareEventSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    hardwareId: { type: mongoose.Schema.Types.ObjectId, ref: "Hardware", required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },
    message: { type: String, maxlength: 500 },
    data: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

hardwareEventSchema.index({ hardwareId: 1, createdAt: -1 });
hardwareEventSchema.index({ companyId: 1, createdAt: -1 });
// Removed automatically after 60 days.
hardwareEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model("HardwareEvent", hardwareEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
