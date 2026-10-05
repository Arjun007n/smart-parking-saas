const mongoose = require("mongoose");
const { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_KINDS } = require("./constants");

const paymentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession", required: true },
    amount: { type: Number, required: true, min: 0 },
    // FEE: the parking fee (or what was left of it after an advance).
    // ADVANCE: money taken at entry, set against the fee when the vehicle leaves.
    // Rows made before advances existed have no kind and are fees.
    kind: { type: String, enum: PAYMENT_KINDS, default: "FEE" },
    tax: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: "PENDING" },
    // Reference from the gateway / UPI / card machine, when there is one.
    transactionId: String,
    // For method WALLET: the wallet that paid (needed to give the money back).
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet" },
    // For a FASTAG payment that was really charged: the attempt, and the tag that paid.
    fastagChargeId: { type: mongoose.Schema.Types.ObjectId, ref: "FastagCharge" },
    tagId: String,
    gatewayRef: String,
    // The gateway's own id for the money that was taken (needed to refund it).
    gatewayPaymentId: String,
    // Which gateway made the order, and where the customer pays (shown as a QR code).
    provider: String,
    payUrl: String,
    // A GATEWAY payment still PENDING after this moment is closed as expired.
    expiresAt: Date,
    failureReason: String,
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // The collecting operator's open shift, when there was one.
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
    paidAt: Date,
    refund: {
      amount: Number,
      reason: String,
      refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      refundedAt: Date,
      // For online payments: the gateway's refund id, and true while the gateway has not confirmed yet.
      gatewayRefundId: String,
      gatewayPending: Boolean,
      // The shift whose cash drawer the refund was paid from.
      shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
    },
  },
  { timestamps: true }
);

paymentSchema.index(
  { transactionId: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "string" } } }
);
paymentSchema.index({ sessionId: 1, createdAt: -1 });
// A session can have one successful fee payment and one successful advance.
// (This replaced the older "one_success_per_session" index, which the startup
// migration in services/advanceService.js removes.)
paymentSchema.index(
  { sessionId: 1, kind: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "SUCCESS" }, name: "one_success_per_session_kind" }
);
paymentSchema.index({ companyId: 1, locationId: 1, status: 1, paidAt: -1 });
paymentSchema.index({ companyId: 1, collectedBy: 1, paidAt: -1 });
paymentSchema.index({ shiftId: 1 });
// The reconciliation sweep looks for online payments still waiting.
paymentSchema.index({ status: 1, method: 1, createdAt: 1 });
paymentSchema.index({ companyId: 1, "refund.refundedAt": -1 });

module.exports = mongoose.model("Payment", paymentSchema);
