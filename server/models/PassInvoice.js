const mongoose = require("mongoose");

// A GST invoice made from a set of passes (Pass Management > Manage Invoice). The amounts of the passes
// already contain the tax, so the invoice splits each total into taxable value and tax.
const passInvoiceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    // 100001, 100002, ... counted inside the company.
    invoiceNumber: { type: Number, required: true },
    invoiceDate: { type: Date, default: Date.now },
    passCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "PassCompany" },
    passUserId: { type: mongoose.Schema.Types.ObjectId, ref: "PassUser" },
    // Who the invoice is made out to, as it was on the day.
    billTo: {
      name: String, address: String, gstNumber: String, mobile: String, email: String,
    },
    passIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Pass" }],
    vehicles: [String],
    quantity: { type: Number, required: true },
    taxPercent: { type: Number, required: true, min: 0, max: 100 },
    taxable: { type: Number, required: true },
    tax: { type: Number, required: true },
    total: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

passInvoiceSchema.index({ companyId: 1, invoiceNumber: 1 }, { unique: true });
passInvoiceSchema.index({ companyId: 1, invoiceDate: -1 });
passInvoiceSchema.index({ companyId: 1, locationId: 1, invoiceDate: -1 });

module.exports = mongoose.model("PassInvoice", passInvoiceSchema);
