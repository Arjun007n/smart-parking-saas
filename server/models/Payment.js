const mongoose = require("mongoose");
const { PAYMENT_METHODS, PAYMENT_STATUSES } = require("./constants");

const paymentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession", required: true },
    amount: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: "PENDING" },
    // Reference from the gateway / UPI / card machine, when there is one.
    transactionId: String,
    gatewayRef: String,
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
// A session can be paid successfully only once.
paymentSchema.index(
  { sessionId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "SUCCESS" }, name: "one_success_per_session" }
);
paymentSchema.index({ companyId: 1, locationId: 1, status: 1, paidAt: -1 });
paymentSchema.index({ companyId: 1, collectedBy: 1, paidAt: -1 });
paymentSchema.index({ shiftId: 1 });
paymentSchema.index({ companyId: 1, "refund.refundedAt": -1 });

module.exports = mongoose.model("Payment", paymentSchema);
