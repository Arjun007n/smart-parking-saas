const mongoose = require("mongoose");
const { SUBSCRIPTION_STATUSES } = require("./constants");

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    // The code staff type at sign-in together with their Login ID. Made once, never changed
    // (see services/accountService.js); old companies get theirs when the server starts.
    code: { type: String, trim: true, uppercase: true, maxlength: 12, unique: true, sparse: true },
    legalName: { type: String, trim: true, maxlength: 200 },
    businessType: { type: String, trim: true, maxlength: 100 },
    gstNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    taxId: { type: String, trim: true, maxlength: 50 },
    // GST charged on passes (a share of the pass price when it is sold, already inside the amount). 0 = none.
    passGstPercent: { type: Number, default: 0, min: 0, max: 100 },
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
    // The paid plan (see services/billingService.js). `appliedOrders` makes applying an order safe to repeat.
    subscription: {
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
      users: Number,
      months: Number,
      lastPaidAt: Date,
      appliedOrders: { type: [mongoose.Schema.Types.ObjectId], select: false },
    },
    // The end-of-day report email (see services/dailyReportService.js).
    reportEmail: {
      enabled: { type: Boolean, default: false },
      recipients: [{ type: String, trim: true, lowercase: true }],
      // Local time of day to send, as minutes after midnight (default 22:00).
      sendAtMinutes: { type: Number, default: 1320, min: 0, max: 1439 },
      lastSentFor: String, // the local date ("2026-10-05") the last report covered
    },
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

// A new company gets its sign-in code before it is saved.
companySchema.pre("validate", async function giveCode() {
  if (this.code || !this.isNew) return;
  this.code = await require("../services/accountService").uniqueCompanyCode(this.constructor);
});

companySchema.index({ subscriptionStatus: 1, trialEndsAt: 1 });
companySchema.index({ name: 1 });

module.exports = mongoose.model("Company", companySchema);
