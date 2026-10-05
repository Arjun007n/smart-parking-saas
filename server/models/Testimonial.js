const mongoose = require("mongoose");

// What a customer said about the product, shown on the public home page. Written by the
// platform owner (Super Admin) in Dashboard > Website, so only real quotes should be added.
const testimonialSchema = new mongoose.Schema(
  {
    quote: { type: String, required: true, trim: true, maxlength: 600 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    role: { type: String, trim: true, maxlength: 100 },
    company: { type: String, trim: true, maxlength: 150 },
    // Lower numbers are shown first.
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);

testimonialSchema.index({ isPublished: 1, order: 1 });

module.exports = mongoose.model("Testimonial", testimonialSchema);
