const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { uniqueSlug, slugify } = require("../utils/slug");
const FAQ = require("../models/FAQ");
const Blog = require("../models/Blog");

const PAGE_SIZE = 12;

// ------------------------------------------------------------------ FAQ ----

// GET /api/faq   (public: published questions, grouped by category on the page)
const listFaqs = async (req, res) => {
  const faqs = await FAQ.find({ isPublished: true }).sort({ category: 1, order: 1, createdAt: 1 }).limit(500);
  res.json({ success: true, data: faqs });
};

// GET /api/faq/all   (Super Admin: includes unpublished)
const listAllFaqs = async (req, res) => {
  const faqs = await FAQ.find().sort({ category: 1, order: 1, createdAt: 1 }).limit(1000);
  res.json({ success: true, data: faqs });
};

const createFaq = async (req, res) => {
  const faq = await FAQ.create(req.body);
  await audit.record(req, "FAQ_CREATE", { entity: "FAQ", entityId: faq._id });
  res.status(201).json({ success: true, data: faq });
};

const updateFaq = async (req, res) => {
  const faq = await FAQ.findById(req.params.id);
  if (!faq) throw new AppError("Question not found", 404);
  Object.assign(faq, req.body);
  await faq.save();
  await audit.record(req, "FAQ_UPDATE", { entity: "FAQ", entityId: faq._id });
  res.json({ success: true, data: faq });
};

const deleteFaq = async (req, res) => {
  const faq = await FAQ.findByIdAndDelete(req.params.id);
  if (!faq) throw new AppError("Question not found", 404);
  await audit.record(req, "FAQ_DELETE", { entity: "FAQ", entityId: faq._id, meta: { question: faq.question } });
  res.json({ success: true, data: { _id: faq._id } });
};

// ----------------------------------------------------------------- Blog ----

const text = (value) => (typeof value === "string" ? value.trim().slice(0, 60) : "");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/blog?category=&tag=&page=   (public: published articles, newest first)
const listPosts = async (req, res) => {
  const filter = { isPublished: true };
  const category = text(req.query.category);
  const tag = text(req.query.tag).toLowerCase();
  if (category) filter.category = { $regex: `^${escapeRegex(category)}$`, $options: "i" };
  if (tag) filter.tags = tag;

  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const [posts, total, categories, tags] = await Promise.all([
    Blog.find(filter).sort({ publishedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).select("-body"),
    Blog.countDocuments(filter),
    Blog.distinct("category", { isPublished: true }),
    Blog.distinct("tags", { isPublished: true }),
  ]);

  res.json({
    success: true,
    data: { posts, total, page, pageSize: PAGE_SIZE, categories: categories.sort(), tags: tags.sort() },
  });
};

// GET /api/blog/:slug   (public: one article; counts a view)
const getPost = async (req, res) => {
  const post = await Blog.findOneAndUpdate(
    { slug: slugify(req.params.slug), isPublished: true },
    { $inc: { views: 1 } },
    { returnDocument: "after", timestamps: false }
  );
  if (!post) throw new AppError("Article not found", 404);
  res.json({ success: true, data: post });
};

// GET /api/blog/admin/all   (Super Admin: includes drafts)
const listAllPosts = async (req, res) => {
  const posts = await Blog.find().sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, data: posts });
};

const createPost = async (req, res) => {
  const slug = await uniqueSlug(req.body.title, (candidate) => Blog.exists({ slug: candidate }));
  const post = await Blog.create({
    ...req.body,
    slug,
    publishedAt: req.body.isPublished ? new Date() : undefined,
  });
  await audit.record(req, "BLOG_CREATE", { entity: "Blog", entityId: post._id, meta: { slug } });
  res.status(201).json({ success: true, data: post });
};

// The slug (web address) of an article never changes, so shared links keep working.
const updatePost = async (req, res) => {
  const post = await Blog.findById(req.params.id);
  if (!post) throw new AppError("Article not found", 404);

  Object.assign(post, req.body);
  if (post.isPublished && !post.publishedAt) post.publishedAt = new Date();
  await post.save();
  await audit.record(req, "BLOG_UPDATE", { entity: "Blog", entityId: post._id, meta: { changed: Object.keys(req.body) } });
  res.json({ success: true, data: post });
};

const deletePost = async (req, res) => {
  const post = await Blog.findByIdAndDelete(req.params.id);
  if (!post) throw new AppError("Article not found", 404);
  await audit.record(req, "BLOG_DELETE", { entity: "Blog", entityId: post._id, meta: { slug: post.slug } });
  res.json({ success: true, data: { _id: post._id } });
};

module.exports = {
  listFaqs, listAllFaqs, createFaq, updateFaq, deleteFaq,
  listPosts, getPost, listAllPosts, createPost, updatePost, deletePost,
};
