const mongoose = require("mongoose");

// One purchase of a plan: the price quoted, the online payment for it, and (once paid) the period it buys.
//
//   PENDING ─► PAID        the gateway says the money arrived
//      │  └──► FAILED      the gateway said it failed, or the link ran out of time (a late payment still counts)
//      └─────► CANCELLED   the buyer started a new order instead
const planOrderSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    planName: { type: String, required: true },
    users: { type: Number, required: true, min: 1 },
    months: { type: Number, required: true, min: 1 },
    // The price in whole rupees, as quoted.
    subtotal: { type: Number, required: true },
    discount: { type: Number, required: true },
    discountPercent: { type: Number, required: true },
    gross: { type: Number, required: true },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
    // Where the service is supplied (decides CGST + SGST or IGST). Fixed when the order is made.
    buyerState: String,
    buyerStateCode: String,
    status: { type: String, enum: ["PENDING", "PAID", "FAILED", "CANCELLED"], default: "PENDING", index: true },
    provider: String,
    transactionId: { type: String, unique: true, sparse: true },
    gatewayRef: String,
    gatewayPaymentId: String,
    payUrl: String,
    expiresAt: Date,
    paidAt: Date,
    failureReason: String,
    // Set when the order is paid: the days this order adds to the company's subscription.
    periodStart: Date,
    periodEnd: Date,
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
  },
  { timestamps: true }
);

planOrderSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model("PlanOrder", planOrderSchema);
