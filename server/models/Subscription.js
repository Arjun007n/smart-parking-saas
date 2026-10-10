const mongoose = require("mongoose");

// One subscription of one location: how many users, which add-ons and for which dates.
//
// A location can have several over time (an expired one, the running one, a later one that starts when the
// running one ends). A renewal moves the end date of the same subscription. An update (more users, more
// cameras, a new add-on) changes it for the rest of the period.
//
// `legacy` marks one made from the company's old company-wide plan or free trial, with every add-on included.
const addons = {
  pass: { type: Boolean, default: false },
  photo: { type: Boolean, default: false },
  anpr: { type: Number, default: 0, min: 0, max: 1000 },
  fastag: { type: Number, default: 0, min: 0, max: 1000 },
  gateway: { type: Boolean, default: false },
  dataBackup: { type: Number, default: 1, min: 0, max: 60 },
  photoBackup: { type: Number, default: 0, min: 0, max: 60 },
};

const subscriptionSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    code: { type: String, required: true },
    planName: { type: String, required: true },
    users: { type: Number, required: true, min: 0 },
    // The length last bought, for display ("1 month").
    months: { type: Number, default: 1, min: 0 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    addons,
    status: { type: String, enum: ["ACTIVE", "CANCELLED"], default: "ACTIVE" },
    cancelReason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelledAt: Date,
    legacy: { type: Boolean, default: false },
    // The order that made it (a repeated payment result makes it only once) and the orders applied to it.
    createdByOrderId: { type: mongoose.Schema.Types.ObjectId },
    appliedOrders: { type: [mongoose.Schema.Types.ObjectId], select: false },
  },
  { timestamps: true }
);

subscriptionSchema.index({ companyId: 1, code: 1 }, { unique: true });
subscriptionSchema.index({ companyId: 1, locationId: 1, periodEnd: -1 });
subscriptionSchema.index({ createdByOrderId: 1 }, { unique: true, partialFilterExpression: { createdByOrderId: { $type: "objectId" } } });

module.exports = mongoose.model("Subscription", subscriptionSchema);
