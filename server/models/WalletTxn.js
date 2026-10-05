const mongoose = require("mongoose");

// TOPUP     money put in at the counter (cash, UPI or card)
// DEBIT     a parking fee paid from the wallet
// REFUND    a wallet payment given back to the wallet
// REVERSAL  a debit undone because the payment could not be completed
// ADJUST    a correction by an admin, with a reason (can be plus or minus)
const WALLET_TXN_TYPES = ["TOPUP", "DEBIT", "REFUND", "REVERSAL", "ADJUST"];
const TOPUP_METHODS = ["CASH", "UPI", "CARD"];

// The ledger of a wallet: one row for every change of the balance. Rows are
// never edited or deleted. The balance of a wallet must always equal the sum
// of its rows' deltaPaise (see walletService.verify).
const walletTxnSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
    type: { type: String, enum: WALLET_TXN_TYPES, required: true },
    // Positive adds to the balance, negative takes away.
    deltaPaise: { type: Number, required: true, validate: Number.isInteger },
    balanceAfterPaise: { type: Number, required: true, min: 0 },
    method: { type: String, enum: TOPUP_METHODS },
    // UPI / card reference typed by the operator.
    reference: { type: String, trim: true, maxlength: 100 },
    reason: { type: String, trim: true, maxlength: 300 },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    // The open shift of the operator who took a top-up (cash is counted in that drawer).
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession" },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Makes a repeated request (double tap, retry after a lost connection) change nothing.
    idempotencyKey: { type: String, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

walletTxnSchema.index({ walletId: 1, createdAt: -1 });
walletTxnSchema.index({ shiftId: 1, type: 1 });
walletTxnSchema.index({ companyId: 1, locationId: 1, type: 1, createdAt: -1 });
walletTxnSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.model("WalletTxn", walletTxnSchema);
module.exports.WALLET_TXN_TYPES = WALLET_TXN_TYPES;
module.exports.TOPUP_METHODS = TOPUP_METHODS;
