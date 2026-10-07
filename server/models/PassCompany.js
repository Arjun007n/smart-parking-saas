const mongoose = require("mongoose");

// A firm, society or school that buys passes for its people. Pass holders can be linked to it, so
// the company can see all its passes, vehicles and what it has paid in one place.
const passCompanySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    contactName: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    gstNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 300 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

passCompanySchema.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.model("PassCompany", passCompanySchema);
