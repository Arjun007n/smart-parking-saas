const mongoose = require("mongoose");

const WALLET_STATUSES = ["ACTIVE", "BLOCKED"];
const MAX_WALLET_VEHICLES = 5;

// A prepaid wallet ("parking card") that a company gives to a regular customer.
// The customer tops it up at the counter and the parking fee is taken from it
// when the vehicle leaves. It can only pay this company's parking fees.
//
// Money is kept in PAISE (whole numbers) so adding and taking away never
// drifts. `balancePaise` is only ever changed by services/walletService.js,
// which also writes a WalletTxn row for every change (the ledger).
const walletSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Printed on the card / shown as a QR code, for example W-K7QXMP4R.
    number: { type: String, required: true, unique: true, uppercase: true },
    holderName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20 },
    // Vehicles that pay from this wallet automatically (normalised plates).
    vehicles: { type: [String], default: [] },
    status: { type: String, enum: WALLET_STATUSES, default: "ACTIVE" },
    statusReason: { type: String, maxlength: 300 },
    balancePaise: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    // The list marks a wallet "low" below this amount (rupees). 0 = never.
    lowBalanceAlert: { type: Number, default: 100, min: 0, max: 100000 },
    notes: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

walletSchema.index({ companyId: 1, createdAt: -1 });
walletSchema.index({ companyId: 1, phone: 1 });
// A vehicle belongs to one wallet of the company. Wallets without vehicles are left out.
walletSchema.index(
  { companyId: 1, vehicles: 1 },
  { unique: true, partialFilterExpression: { "vehicles.0": { $exists: true } }, name: "one_wallet_per_vehicle" }
);

walletSchema.virtual("balance").get(function balance() {
  return this.balancePaise / 100;
});
walletSchema.set("toJSON", { virtuals: true });
walletSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Wallet", walletSchema);
module.exports.WALLET_STATUSES = WALLET_STATUSES;
module.exports.MAX_WALLET_VEHICLES = MAX_WALLET_VEHICLES;
