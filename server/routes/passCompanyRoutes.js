const router = require("express").Router();
const controller = require("../controllers/passCompanyController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");

const fields = (isCreate) => ({
  name: { type: "string", required: isCreate, min: 2, max: 150 },
  contactName: { type: "string", max: 100 },
  phone: { type: "string", max: 20 },
  email: { type: "string", max: 254 },
  gstNumber: { type: "string", max: 20 },
  address: { type: "string", max: 300 },
  ...(isCreate ? {} : { isActive: { type: "boolean" } }),
});

router.use(protect, tenant, requirePermission(P.PASS_MANAGE));
router.get("/", controller.listPassCompanies);
router.post("/", requireCompany, validateBody(fields(true)), controller.createPassCompany);
router.put("/:id", validateIdParam(), validateBody(fields(false)), controller.updatePassCompany);

module.exports = router;
