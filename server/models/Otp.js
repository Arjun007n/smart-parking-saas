const mongoose = require("mongoose");

// A one-time code sent to a mobile number (see services/otpService.js). Only a keyed hash of the code is
// stored. The record removes itself after it expires.
const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true }, // normalised, "+919876543210"
  purpose: { type: String, required: true, enum: ["SIGNUP"] },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  // How many codes were sent to this number in the current hour (the limit stops text-message abuse).
  sentCount: { type: Number, default: 1 },
  windowStartedAt: { type: Date, default: Date.now },
  lastSentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

otpSchema.index({ phone: 1, purpose: 1 }, { unique: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }); // removed an hour after expiry

module.exports = mongoose.model("Otp", otpSchema);
