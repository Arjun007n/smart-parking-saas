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
    users: { type: Number, required: true, min: 0 },
    months: { type: Number, required: true, min: 0 },
    // PLAN is the old company-wide plan. The others are for one location's subscription (see services/subscriptionService.js):
    // PURCHASE makes a subscription, RENEWAL adds months to it, UPDATE adds users or add-ons for the rest of the period.
    kind: { type: String, enum: ["PLAN", "PURCHASE", "RENEWAL", "UPDATE"], default: "PLAN" },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    orderNumber: String,
    // What was bought, one row each, and the add-ons the order asks for (the whole set for a purchase, the extra for an update).
    lines: {
      type: [{ _id: false, key: String, label: String, qty: Number, rate: Number, months: Number, amount: Number, discount: Number, taxable: Number }],
      default: undefined,
    },
    addons: mongoose.Schema.Types.Mixed,
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
    // UPDATE orders: the subscription's end date when the order was quoted. An update is priced for the rest of
    // that period, so if the period has changed by the time it is paid (a renewal), it is not applied.
    quotedPeriodEnd: Date,
    // Paid, but not applied because the subscription changed since the quote (the money is to be refunded).
    superseded: Boolean,
  },
  { timestamps: true }
);

planOrderSchema.index({ companyId: 1, createdAt: -1 });
planOrderSchema.index({ companyId: 1, locationId: 1, createdAt: -1 });
planOrderSchema.index({ orderNumber: 1 }, { unique: true, partialFilterExpression: { orderNumber: { $type: "string" } } });

module.exports = mongoose.model("PlanOrder", planOrderSchema);
