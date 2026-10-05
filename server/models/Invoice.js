const mongoose = require("mongoose");

// A GST tax invoice for a paid plan order. Everything printed on it is copied here when it is issued, so
// later changes to the company's details never rewrite an old invoice. Invoices are never edited or deleted.
const party = {
  name: String,
  gstin: String,
  address: String,
  state: String,
  stateCode: String,
  email: String,
  phone: String,
};

const invoiceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    // PLAN invoices point at a PlanOrder, SHOP invoices at a ShopOrder.
    kind: { type: String, enum: ["PLAN", "SHOP"], default: "PLAN" },
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    number: { type: String, required: true, unique: true },
    financialYear: { type: String, required: true },
    sequence: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    seller: { ...party, sac: String },
    buyer: party,
    description: { type: String, required: true },
    // SHOP invoices list what was bought, one row each (delivery is a row too).
    lines: {
      type: [{ _id: false, description: String, hsn: String, qty: Number, rate: Number, taxable: Number, gstPercent: Number, amount: Number }],
      default: undefined,
    },
    shipTo: String,
    users: Number,
    months: Number,
    periodStart: Date,
    periodEnd: Date,
    // Rupees. taxable = subtotal less discount.
    subtotal: Number,
    discount: Number,
    taxable: Number,
    gstPercent: Number,
    taxType: { type: String, enum: ["INTRA", "INTER"] },
    cgst: Number,
    sgst: Number,
    igst: Number,
    total: Number,
    paymentRef: String,
  },
  { timestamps: true }
);

invoiceSchema.index({ companyId: 1, issuedAt: -1 });
invoiceSchema.index({ financialYear: 1, sequence: 1 }, { unique: true });

module.exports = mongoose.model("Invoice", invoiceSchema);
