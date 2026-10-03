const mongoose = require("mongoose");

// A blog article. The body is plain text: blank lines separate paragraphs and
// a line starting with "## " is a heading. It is never stored or shown as HTML.
const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    excerpt: { type: String, trim: true, maxlength: 400 },
    body: { type: String, required: true, maxlength: 50000 },
    category: { type: String, trim: true, maxlength: 60, default: "General" },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
    author: { type: String, trim: true, maxlength: 100 },
    isPublished: { type: Boolean, default: false },
    publishedAt: Date,
    views: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

blogSchema.index({ isPublished: 1, publishedAt: -1 });
blogSchema.index({ isPublished: 1, category: 1, publishedAt: -1 });
blogSchema.index({ isPublished: 1, tags: 1, publishedAt: -1 });

module.exports = mongoose.model("Blog", blogSchema);
