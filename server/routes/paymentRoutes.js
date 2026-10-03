const router = require("express").Router();
const controller = require("../controllers/paymentController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { PAYMENT_METHODS } = require("../models/constants");

// Called by the payment gateway. It has no login; its signature is checked instead.
router.post("/webhook", controller.gatewayWebhook);

router.use(protect, tenant);

router.post(
  "/",
  requirePermission(P.PAYMENT_COLLECT),
  validateBody({
    sessionId: { type: "objectId", required: true },
    method: { type: "string", required: true, enum: PAYMENT_METHODS },
    amount: { type: "number", required: true, min: 0, max: 10000000 },
    // UPI or card reference, when there is one.
    transactionId: { type: "string", min: 4, max: 100 },
  }),
  controller.createPayment
);

// Refunds are for admins and are always recorded in the audit log.
router.post(
  "/:id/refund",
  validateIdParam(),
  requirePermission(P.LOCATION_MANAGE),
  validateBody({ reason: { type: "string", required: true, min: 5, max: 300 } }),
  controller.refundPayment
);

const canSeeMoney = requireAnyPermission(P.PAYMENT_COLLECT, P.REPORT_VIEW);
router.get("/", canSeeMoney, controller.listPayments);
router.get("/collection", canSeeMoney, controller.collectionSummary);

module.exports = router;
