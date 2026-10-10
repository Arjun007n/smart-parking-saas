const mongoose = require("mongoose");

// A person (or a firm's staff member) who holds parking passes: the "Pass User" of the Pass Management
// pages. One record per mobile number inside a company. Passes and vehicles hang off it.
const passUserSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // 10 digits. Empty only for users made from old passes that never had a number.
    mobile: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    address: { type: String, trim: true, maxlength: 255 },
    gstNumber: { type: String, trim: true, uppercase: true, maxlength: 15 },
    // The firm (Company Master) this user belongs to. Optional.
    passCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "PassCompany" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One user per mobile number in a company.
passUserSchema.index(
  { companyId: 1, mobile: 1 },
  { unique: true, partialFilterExpression: { mobile: { $type: "string", $gt: "" } } }
);
passUserSchema.index({ companyId: 1, name: 1 });
passUserSchema.index({ companyId: 1, passCompanyId: 1 }, { sparse: true });

module.exports = mongoose.model("PassUser", passUserSchema);
