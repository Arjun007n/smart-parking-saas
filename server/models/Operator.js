const mongoose = require("mongoose");

// Operational profile of a user who works at parking locations.
// Login, role and assigned locations live on User; this holds shift and
// activity details (used from Day 13 of the plan).
const operatorSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    employeeCode: { type: String, trim: true },
    shift: {
      name: { type: String, trim: true },
      start: String,
      end: String,
    },
    lastActiveAt: Date,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

operatorSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("Operator", operatorSchema);
