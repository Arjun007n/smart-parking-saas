const router = require("express").Router();
const controller = require("../controllers/passInvoiceController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");

const choice = {
  locationId: { type: "objectId", required: true },
  // A company id, or "none" for passes that belong to no company (then passUserId is needed).
  passCompanyId: { type: "string", required: true, max: 40 },
  passUserId: { type: "objectId" },
  passIds: { type: "array", required: true, max: 200, of: { type: "objectId" } },
  taxPercent: { type: "number", min: 0, max: 100 },
};

router.use(protect, tenant, requirePermission(P.PASS_MANAGE));
router.get("/", controller.list);
router.get("/eligible", controller.eligible);
router.post("/preview", validateBody(choice), controller.preview);
router.post("/", requireCompany, validateBody(choice), controller.generate);
router.get("/:id", validateIdParam(), controller.getOne);

module.exports = router;
