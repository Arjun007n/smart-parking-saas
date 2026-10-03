const mongoose = require("mongoose");

// An operator's working shift at one location, used to reconcile cash.
const shiftSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
    openedAt: { type: Date, required: true, default: Date.now },
    // Cash in the drawer when the shift started.
    openingCash: { type: Number, required: true, min: 0 },
    // Authorised corrections to the drawer (for example change added by a manager).
    adjustments: [
      {
        amount: { type: Number, required: true },
        reason: { type: String, required: true, trim: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
      },
    ],
    closedAt: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Cash counted at close, what the system expected, and the gap between them.
    closingCash: Number,
    expectedCash: Number,
    difference: Number,
    // Totals frozen at close so the record never changes afterwards.
    totals: mongoose.Schema.Types.Mixed,
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// An operator can have only one open shift at a time.
shiftSchema.index({ operatorId: 1 }, { unique: true, partialFilterExpression: { status: "OPEN" } });
shiftSchema.index({ companyId: 1, locationId: 1, openedAt: -1 });

module.exports = mongoose.model("Shift", shiftSchema);
