const mongoose = require("mongoose");

const PASS_PAYMENT_METHODS = ["CASH", "UPI", "CARD", "COMPLIMENTARY"];

// Money taken for selling or renewing a pass. Kept apart from parking
// payments (which always belong to a session) but counted together with them
// in the collection summary, the revenue report and the shift cash count.
const passPaymentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Where the pass was sold (and where the cash went).
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    passId: { type: mongoose.Schema.Types.ObjectId, ref: "Pass", required: true },
    kind: { type: String, enum: ["NEW", "RENEWAL"], required: true },
    amount: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: PASS_PAYMENT_METHODS, required: true },
    transactionId: String,
    // The period this payment bought: [periodStart, periodEnd).
    // What was bought: `periodCount` days, weeks or months.
    periodUnit: { type: String, enum: ["DAY", "WEEK", "MONTH"], default: "MONTH" },
    periodCount: { type: Number, default: 1, min: 1 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    paidAt: { type: Date, default: Date.now },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
  },
  { timestamps: true }
);

passPaymentSchema.index({ companyId: 1, locationId: 1, paidAt: -1 });
passPaymentSchema.index({ passId: 1, paidAt: -1 });
passPaymentSchema.index({ shiftId: 1 });
// A payment reference is unique within a company (not across companies: one company must not be able to
// learn or block another's references). Databases made before this change still hold the old global index
// `transactionId_1`; scripts/migrate_passpayment_index.js drops it. Until then the old index keeps working.
passPaymentSchema.index(
  { companyId: 1, transactionId: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "string" } } }
);

module.exports = mongoose.model("PassPayment", passPaymentSchema);
module.exports.PASS_PAYMENT_METHODS = PASS_PAYMENT_METHODS;
