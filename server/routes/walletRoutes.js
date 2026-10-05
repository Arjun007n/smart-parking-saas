const router = require("express").Router();
const controller = require("../controllers/walletController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { WALLET_STATUSES, MAX_WALLET_VEHICLES } = require("../models/Wallet");
const { TOPUP_METHODS } = require("../models/WalletTxn");

const plate = { type: "string", max: 20 };
const details = {
  holderName: { type: "string", min: 2, max: 100 },
  phone: { type: "string", max: 20 },
  vehicles: { type: "array", max: MAX_WALLET_VEHICLES, of: { ...plate, required: true } },
  notes: { type: "string", max: 300 },
  lowBalanceAlert: { type: "number", min: 0, max: 100000 },
};
const requestId = { type: "string", min: 8, max: 64, pattern: /^[A-Za-z0-9_-]+$/, message: "has an invalid format" };

router.use(protect, tenant);

// Gate staff and admins can find and see wallets. Money moves through the routes below.
const canSee = requireAnyPermission(P.WALLET_MANAGE, P.PAYMENT_COLLECT);
router.get("/", canSee, controller.listWallets);
router.get("/lookup", requireCompany, canSee, controller.lookupWallet);
router.get("/:id", validateIdParam(), canSee, controller.getWallet);
router.get("/:id/transactions", validateIdParam(), canSee, controller.listTransactions);

// Money in: whoever collects payments at the counter.
router.post(
  "/:id/topup",
  validateIdParam(),
  requirePermission(P.PAYMENT_COLLECT),
  validateBody({
    amount: { type: "number", required: true, min: 1, max: 100000 },
    method: { type: "string", required: true, enum: TOPUP_METHODS },
    reference: { type: "string", min: 4, max: 100 },
    requestId,
    locationId: { type: "objectId", required: true },
  }),
  controller.topUp
);

// Everything else is for admins.
router.post(
  "/",
  requireCompany,
  requirePermission(P.WALLET_MANAGE),
  validateBody({ ...details, holderName: { ...details.holderName, required: true } }),
  controller.createWallet
);
router.put(
  "/:id",
  validateIdParam(),
  requirePermission(P.WALLET_MANAGE),
  validateBody({
    ...details,
    status: { type: "string", enum: WALLET_STATUSES },
    statusReason: { type: "string", min: 3, max: 300 },
  }),
  controller.updateWallet
);
router.post(
  "/:id/adjust",
  validateIdParam(),
  requirePermission(P.WALLET_MANAGE),
  validateBody({
    amount: { type: "number", required: true, min: -100000, max: 100000 },
    reason: { type: "string", required: true, min: 5, max: 300 },
    requestId,
  }),
  controller.adjust
);
router.get("/:id/verify", validateIdParam(), requirePermission(P.WALLET_MANAGE), controller.verifyWallet);

module.exports = router;
