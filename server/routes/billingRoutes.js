const router = require("express").Router();
const controller = require("../controllers/billingController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");
const { PERMISSIONS: P } = require("../config/permissions");
const { MIN_USERS, MAX_USERS } = require("../config/pricing");

// Buying a plan is for the people who manage the company.
router.use(protect, tenant, requireCompany, requirePermission(P.COMPANY_MANAGE));

router.get("/", controller.summary);
router.post(
  "/checkout",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many checkout attempts. Please try again in a few minutes." }),
  validateBody({
    users: { type: "number", required: true, integer: true, min: MIN_USERS, max: MAX_USERS },
    months: { type: "number", required: true, integer: true, min: 1, max: 60 },
  }),
  controller.startCheckout
);
router.get("/orders/:id", validateIdParam(), controller.getOrder);
router.post(
  "/orders/:id/simulate",
  validateIdParam(),
  validateBody({ outcome: { type: "string", enum: ["SUCCESS", "FAILED"] } }),
  controller.simulateOrder
);
router.get("/invoices/:id", validateIdParam(), controller.getInvoice);
router.get("/invoices/:id/pdf", validateIdParam(), controller.invoicePdf);

module.exports = router;
