const mongoose = require("mongoose");
const { SUBSCRIPTION_STATUSES } = require("./constants");

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    legalName: { type: String, trim: true, maxlength: 200 },
    businessType: { type: String, trim: true, maxlength: 100 },
    gstNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    taxId: { type: String, trim: true, maxlength: 50 },
    billingContact: {
      name: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      phone: { type: String, trim: true },
    },
    address: {
      line1: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      country: { type: String, trim: true, default: "India" },
    },
    logoUrl: { type: String, trim: true },
    subscriptionStatus: { type: String, enum: SUBSCRIPTION_STATUSES, default: "TRIAL" },
    plan: {
      name: { type: String, default: "Trial" },
      maxLocations: { type: Number, default: 2, min: 0 },
      maxUsers: { type: Number, default: 10, min: 0 },
    },
    trialEndsAt: Date,
    // Flags for onboarding steps that cannot be derived from other data.
    onboarding: {
      isVerified: { type: Boolean, default: false },
      planSelected: { type: Boolean, default: false },
      wentLiveAt: Date,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

companySchema.index({ subscriptionStatus: 1, trialEndsAt: 1 });
companySchema.index({ name: 1 });

module.exports = mongoose.model("Company", companySchema);
