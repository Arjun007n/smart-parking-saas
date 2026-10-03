const router = require("express").Router();
const controller = require("../controllers/leadController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");
const { PERMISSIONS } = require("../config/permissions");
const { LEAD_TYPES, LEAD_STATUSES } = require("../models/Lead");

// The contact form is public, so limit how often one address can post.
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => Number(process.env.LEAD_RATE_LIMIT_MAX) || 5,
  message: "You have sent several messages already. Please try again later.",
});

router.post(
  "/",
  leadLimiter,
  validateBody({
    name: { type: "string", required: true, min: 2, max: 100 },
    email: { type: "email", required: true },
    phone: { type: "string", max: 20, pattern: /^[0-9+()\-\s]{6,20}$/, message: "must be a valid phone number" },
    company: { type: "string", max: 150 },
    message: { type: "string", max: 2000 },
    type: { type: "string", enum: LEAD_TYPES },
    subject: { type: "string", max: 150 },
    website: { type: "string", max: 200 }, // spam trap, see the controller
  }),
  controller.createLead
);

const admin = [protect, tenant, requirePermission(PERMISSIONS.PLATFORM_MANAGE)];
router.get("/", admin, controller.listLeads);
router.put(
  "/:id",
  validateIdParam(),
  admin,
  validateBody({ status: { type: "string", enum: LEAD_STATUSES }, notes: { type: "string", max: 2000 } }),
  controller.updateLead
);

module.exports = router;
