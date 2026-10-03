const router = require("express").Router();
const controller = require("../controllers/shiftController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");

const cash = { type: "number", required: true, min: 0, max: 100000000 };

router.use(protect, tenant);

router.get("/", requireAnyPermission(P.PAYMENT_COLLECT, P.REPORT_VIEW), controller.listShifts);
router.get("/current", requirePermission(P.PAYMENT_COLLECT), controller.currentShift);
router.post(
  "/",
  requirePermission(P.PAYMENT_COLLECT),
  validateBody({ locationId: { type: "objectId", required: true }, openingCash: cash }),
  controller.openShift
);
router.post(
  "/:id/close",
  validateIdParam(),
  requirePermission(P.PAYMENT_COLLECT),
  validateBody({ closingCash: cash, notes: { type: "string", max: 500 } }),
  controller.closeShift
);
router.post(
  "/:id/adjustments",
  validateIdParam(),
  requirePermission(P.LOCATION_MANAGE),
  validateBody({
    amount: { type: "number", required: true, min: -100000000, max: 100000000 },
    reason: { type: "string", required: true, min: 5, max: 300 },
  }),
  controller.addAdjustment
);

module.exports = router;
