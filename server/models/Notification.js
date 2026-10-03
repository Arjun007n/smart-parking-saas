const mongoose = require("mongoose");

const NOTIFICATION_TYPES = [
  "CAPACITY", "PAYMENT_FAILED", "SUBSCRIPTION_EXPIRY", "HARDWARE_OFFLINE", "SHIFT_DIFFERENCE", "GENERAL",
];
const SEVERITIES = ["info", "warning", "critical"];

// An in-app alert for the admins of a company (or of one location).
const notificationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Empty = for the whole company. Set = only admins of that location.
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, default: "info" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: mongoose.Schema.Types.Mixed,
    // Stops the same alert being raised again and again (see notificationService).
    dedupeKey: String,
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ companyId: 1, createdAt: -1 });
notificationSchema.index(
  { companyId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);
// Old alerts are removed automatically after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("Notification", notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.SEVERITIES = SEVERITIES;
