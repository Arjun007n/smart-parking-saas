const mongoose = require("mongoose");

const FASTAG_CHARGE_STATUSES = ["PENDING", "UNKNOWN", "SUCCESS", "FAILED"];

// One attempt to take a parking fee from a FASTag. The attempt is written BEFORE the
// partner is called, so a crash or a timeout can never leave money taken with no
// trace. `reference` is our idempotency key: the partner must never charge twice for it.
// A session has at most one ACTIVE attempt (anything that is not FAILED); a declined
// attempt frees the session for another try or another payment method.
const fastagChargeSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession", required: true },
    tagId: { type: String, required: true, maxlength: 48 },
    vehicleNumber: { type: String, maxlength: 20 },
    // Rupees, the amount that was owed when the attempt began.
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: FASTAG_CHARGE_STATUSES, default: "PENDING" },
    active: { type: Boolean, default: true },
    provider: String,
    // The partner's own reference for the money (becomes the payment's reference).
    providerReference: String,
    failureReason: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    checkedAt: Date,
    // The tag was charged but the fee had changed, so no payment could be made from it: an admin must reconcile.
    needsReview: { type: Boolean, default: false },
  },
  { timestamps: true }
);

fastagChargeSchema.index({ sessionId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "one_active_charge_per_session" });
fastagChargeSchema.index({ companyId: 1, createdAt: -1 });
fastagChargeSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.model("FastagCharge", fastagChargeSchema);
module.exports.FASTAG_CHARGE_STATUSES = FASTAG_CHARGE_STATUSES;
