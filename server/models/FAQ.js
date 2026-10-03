const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 3000 },
    category: { type: String, required: true, trim: true, maxlength: 60, default: "General" },
    // Lower numbers are shown first within a category.
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);

faqSchema.index({ isPublished: 1, category: 1, order: 1 });

module.exports = mongoose.model("FAQ", faqSchema);
