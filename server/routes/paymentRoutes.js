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
    // Which wallet pays, when the method is WALLET.
    walletId: { type: "objectId" },
    // Which FASTag to charge, when the method is FASTAG and a FASTag partner is set up.
    tagId: { type: "string", min: 4, max: 60 },
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
router.get("/options", canSeeMoney, controller.paymentOptions);
router.get("/:id", validateIdParam(), canSeeMoney, controller.getPayment);

// Stop waiting for an online payment (the customer will pay another way).
router.post("/:id/cancel", validateIdParam(), requirePermission(P.PAYMENT_COLLECT), controller.cancelPayment);

// Plays the customer's side of an online payment with the simulated gateway (never in production).
router.post(
  "/:id/simulate",
  validateIdParam(),
  requirePermission(P.PAYMENT_COLLECT),
  validateBody({ outcome: { type: "string", enum: ["SUCCESS", "FAILED"] } }),
  controller.simulatePayment
);

module.exports = router;
