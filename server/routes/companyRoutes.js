const router = require("express").Router();
const controller = require("../controllers/companyController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");
const { SUBSCRIPTION_STATUSES } = require("../models/constants");

const text = (max = 150) => ({ type: "string", max });

const companyFields = {
  name: { type: "string", min: 2, max: 150 },
  legalName: text(200),
  businessType: text(100),
  gstNumber: {
    type: "string", upper: true, max: 15,
    pattern: /^[0-9]{2}[A-Z0-9]{13}$/, message: "must be a valid 15-character GSTIN",
  },
  taxId: text(50),
  logoUrl: { type: "string", max: 500, pattern: /^https:\/\//, message: "must be an https link" },
  billingContact: {
    type: "object",
    fields: { name: text(100), email: { type: "email" }, phone: text(20) },
  },
  address: {
    type: "object",
    fields: { line1: text(200), city: text(100), state: text(100), pincode: text(10), country: text(100) },
  },
  // The fields below are applied only when a Super Admin sends them.
  subscriptionStatus: { type: "string", enum: SUBSCRIPTION_STATUSES },
  plan: {
    type: "object",
    fields: {
      name: text(50),
      maxLocations: { type: "number", integer: true, min: 0, max: 10000 },
      maxUsers: { type: "number", integer: true, min: 0, max: 100000 },
    },
  },
  isActive: { type: "boolean" },
  isVerified: { type: "boolean" },
};

router.use(protect, tenant);

router.get("/", controller.listCompanies);
router.post(
  "/",
  requirePermission(PERMISSIONS.PLATFORM_MANAGE),
  validateBody({ ...companyFields, name: { ...companyFields.name, required: true } }),
  controller.createCompany
);
router.get("/:id", validateIdParam(), controller.getCompany);
router.get("/:id/onboarding", validateIdParam(), controller.getOnboarding);
router.get("/:id/report-email", validateIdParam(), requirePermission(PERMISSIONS.COMPANY_MANAGE), controller.getReportEmail);
router.put(
  "/:id/report-email",
  validateIdParam(),
  requirePermission(PERMISSIONS.COMPANY_MANAGE),
  validateBody({
    enabled: { type: "boolean" },
    recipients: { type: "array", max: 10, of: { type: "email" } },
    sendAt: { type: "string", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "must look like 22:00" },
  }),
  controller.updateReportEmail
);
router.post("/:id/report-email/test", validateIdParam(), requirePermission(PERMISSIONS.COMPANY_MANAGE), controller.sendReportEmailTest);
router.put(
  "/:id",
  validateIdParam(),
  requirePermission(PERMISSIONS.COMPANY_MANAGE),
  validateBody(companyFields),
  controller.updateCompany
);

module.exports = router;
