const mongoose = require("mongoose");

// One hardware order: what was bought (prices copied at the time), where it goes, the online payment for it,
// and how far the delivery has got.
//
// Payment:    PENDING ─► PAID      the gateway says the money arrived (a late payment still counts)
//                │  └──► FAILED    the gateway said no, or the link ran out of time
//                └─────► CANCELLED the buyer started a new order instead
// Delivery:   NONE (not paid yet) ─► PROCESSING ─► SHIPPED ─► DELIVERED      (or CANCELLED, by the platform)
const lineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    category: String,
    hsn: String,
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true }, // rupees, before GST
    gstPercent: { type: Number, required: true },
    taxable: { type: Number, required: true },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  { _id: false }
);

const shipToSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    stateCode: String,
    pincode: { type: String, required: true },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  { at: { type: Date, default: Date.now }, status: String, note: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" } },
  { _id: false }
);

const shopOrderSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    number: { type: String, unique: true, sparse: true },
    financialYear: String,
    sequence: Number,
    // Same cart, same address, same total: lets a second press of "Pay" reuse the waiting payment link.
    fingerprint: String,
    lines: { type: [lineSchema], required: true, validate: [(v) => Array.isArray(v) && v.length > 0, "An order needs at least one line"] },
    // Rupees. goods = sum of line taxable values; shipping is charged on top and carries GST too.
    goods: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    shippingGstPercent: { type: Number, default: 0 },
    shippingGst: { type: Number, default: 0 },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
    shipTo: { type: shipToSchema, required: true },
    // The buyer's GSTIN for the invoice (optional; defaults to the company's).
    buyerGstin: String,
    installationRequested: { type: Boolean, default: false },
    notes: { type: String, maxlength: 500 },

    status: { type: String, enum: ["PENDING", "PAID", "FAILED", "CANCELLED"], default: "PENDING", index: true },
    provider: String,
    transactionId: { type: String, unique: true, sparse: true },
    gatewayRef: String,
    gatewayPaymentId: String,
    payUrl: String,
    expiresAt: Date,
    paidAt: Date,
    failureReason: String,
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    // Set once stock has been counted down for this order (so a repeated payment message cannot count it twice).
    stockCounted: { type: Boolean, default: false },

    fulfilment: { type: String, enum: ["NONE", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"], default: "NONE", index: true },
    courier: String,
    trackingNumber: String,
    shippedAt: Date,
    deliveredAt: Date,
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

shopOrderSchema.index({ companyId: 1, createdAt: -1 });
// Only one waiting order per identical cart: two checkouts at the same moment cannot both create one.
shopOrderSchema.index({ companyId: 1, fingerprint: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });
shopOrderSchema.index({ financialYear: 1, sequence: 1 }, { unique: true, sparse: true });
shopOrderSchema.index({ status: 1, fulfilment: 1, createdAt: -1 });

module.exports = mongoose.model("ShopOrder", shopOrderSchema);
