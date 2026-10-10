const router = require("express").Router();
const controller = require("../controllers/subscriptionController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");
const { PERMISSIONS: P } = require("../config/permissions");
const { ADDONS } = require("../config/addons");
const { MIN_USERS, MAX_USERS } = require("../config/pricing");

// Manage Subscriptions: a subscription for each location. The people who manage the company buy and change them.
router.use(protect, tenant);

// The price list is for anyone who may buy (or the Super Admin, who sets the prices).
router.get("/catalog", requireAnyPermission(P.COMPANY_MANAGE, P.PLATFORM_MANAGE), controller.catalog);
router.put(
  "/prices",
  requirePermission(P.PLATFORM_MANAGE),
  validateBody({ prices: { type: "object", required: true, fields: Object.fromEntries(ADDONS.map((a) => [a.key, { type: "number", min: 0, max: 1000000 }])) } }),
  controller.setPrices
);

router.use(requireCompany, requirePermission(P.COMPANY_MANAGE));

const addons = {
  type: "object",
  fields: Object.fromEntries(ADDONS.map((a) => [a.key, a.kind === "FLAG" ? { type: "boolean" } : { type: "number", integer: true, min: 0, max: a.kind === "COUNT" ? 100 : 60 }])),
};
const change = {
  type: "object",
  fields: {
    addUsers: { type: "number", integer: true, min: 0, max: MAX_USERS },
    pass: { type: "boolean" }, photo: { type: "boolean" }, gateway: { type: "boolean" },
    addAnpr: { type: "number", integer: true, min: 0, max: 100 }, addFastag: { type: "number", integer: true, min: 0, max: 100 },
    dataBackup: { type: "number", integer: true, min: 0, max: 60 }, photoBackup: { type: "number", integer: true, min: 0, max: 60 },
  },
};
const orderBody = {
  kind: { type: "string", required: true, enum: ["PURCHASE", "RENEWAL", "UPDATE"] },
  locationId: { type: "objectId" },
  subscriptionId: { type: "objectId" },
  users: { type: "number", integer: true, min: MIN_USERS, max: MAX_USERS },
  months: { type: "number", integer: true, min: 1, max: 60 },
  addons,
  change,
};

router.get("/", controller.list);
router.get("/locations/:locationId", validateIdParam("locationId"), controller.locationDetail);
router.post("/quote", validateBody(orderBody), controller.quote);
router.post(
  "/orders",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many checkout attempts. Please try again in a few minutes." }),
  validateBody(orderBody),
  controller.createOrder
);
router.get("/orders/:id", validateIdParam(), controller.getOrder);
router.get("/:id", validateIdParam(), controller.getOne);
router.post("/:id/cancel", validateIdParam(), validateBody({ reason: { type: "string", required: true, min: 5, max: 300 } }), controller.cancelSubscription);

module.exports = router;
