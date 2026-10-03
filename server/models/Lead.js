const mongoose = require("mongoose");

const LEAD_TYPES = ["CONTACT", "DEMO", "PARTNER", "PRODUCT"];
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CLOSED"];

// An enquiry sent from the public website.
const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    company: { type: String, trim: true, maxlength: 150 },
    message: { type: String, trim: true, maxlength: 2000 },
    type: { type: String, enum: LEAD_TYPES, default: "CONTACT" },
    // What the visitor was asking about (a plan or product name), when relevant.
    subject: { type: String, trim: true, maxlength: 150 },
    status: { type: String, enum: LEAD_STATUSES, default: "NEW" },
    notes: { type: String, trim: true, maxlength: 2000 },
    ip: String,
  },
  { timestamps: true }
);

leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
module.exports.LEAD_TYPES = LEAD_TYPES;
module.exports.LEAD_STATUSES = LEAD_STATUSES;
