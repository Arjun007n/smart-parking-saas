const express = require("express");
const controller = require("../controllers/cmsController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");

// Website content is managed by the platform owner (Super Admin) only.
const admin = [protect, tenant, requirePermission(PERMISSIONS.PLATFORM_MANAGE)];

// ---- /api/faq
const faq = express.Router();
const faqFields = (isCreate) => ({
  question: { type: "string", required: isCreate, min: 5, max: 300 },
  answer: { type: "string", required: isCreate, min: 5, max: 3000 },
  category: { type: "string", min: 2, max: 60 },
  order: { type: "number", integer: true, min: 0, max: 10000 },
  isPublished: { type: "boolean" },
});

faq.get("/", controller.listFaqs);
faq.get("/all", admin, controller.listAllFaqs);
faq.post("/", admin, validateBody(faqFields(true)), controller.createFaq);
faq.put("/:id", validateIdParam(), admin, validateBody(faqFields(false)), controller.updateFaq);
faq.delete("/:id", validateIdParam(), admin, controller.deleteFaq);

// ---- /api/blog
const blog = express.Router();
const postFields = (isCreate) => ({
  title: { type: "string", required: isCreate, min: 5, max: 200 },
  excerpt: { type: "string", max: 400 },
  body: { type: "string", required: isCreate, min: 20, max: 50000 },
  category: { type: "string", min: 2, max: 60 },
  tags: { type: "array", max: 10, of: { type: "string", min: 2, max: 40, pattern: /^[A-Za-z0-9 -]+$/, message: "may contain letters, digits, spaces and dashes" } },
  author: { type: "string", max: 100 },
  isPublished: { type: "boolean" },
});

blog.get("/", controller.listPosts);
blog.get("/admin/all", admin, controller.listAllPosts);
blog.post("/", admin, validateBody(postFields(true)), controller.createPost);
blog.put("/:id", validateIdParam(), admin, validateBody(postFields(false)), controller.updatePost);
blog.delete("/:id", validateIdParam(), admin, controller.deletePost);
blog.get("/:slug", controller.getPost);

module.exports = { faq, blog };
