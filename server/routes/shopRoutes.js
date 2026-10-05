const router = require("express").Router();
const controller = require("../controllers/shopController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam, collectCleared } = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");
const { PERMISSIONS: P } = require("../config/permissions");

const cartItems = { type: "array", required: true, max: 40, of: { type: "object", fields: { productId: { type: "objectId", required: true }, qty: { type: "number", required: true, integer: true, min: 1, max: 100 } } } };

// ---- anyone: the catalog and the cart ----
router.get("/info", controller.info);
router.get("/products", controller.listProducts);
router.get("/products/:id", validateIdParam(), controller.getProduct);
router.post(
  "/cart",
  rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many cart requests. Please slow down." }),
  validateBody({ items: cartItems }),
  controller.priceCart
);

// ---- the platform (Super Admin) ----
const productRules = (creating) => ({
  name: { type: "string", required: creating, min: 2, max: 120 },
  category: { type: "string", required: creating, min: 2, max: 60 },
  brand: { type: "string", max: 60 },
  modelNumber: { type: "string", max: 60 },
  description: { type: "string", max: 1500 },
  highlights: { type: "array", max: 8, of: { type: "string", required: true, max: 120 } },
  imageUrl: { type: "string", max: 500, pattern: /^(https:\/\/[^\s]+)?$/, message: "must be a web address starting with https://" },
  price: { type: "number", min: 0, max: 10000000 },
  gstPercent: { type: "number", min: 0, max: 28 },
  hsn: { type: "string", max: 10, pattern: /^[0-9]*$/, message: "must be digits only" },
  stock: { type: "number", integer: true, min: 0, max: 1000000 },
  maxPerOrder: { type: "number", integer: true, min: 1, max: 100 },
  worksWithSoftware: { type: "boolean" },
  isActive: { type: "boolean" },
  sortOrder: { type: "number", integer: true, min: -10000, max: 10000 },
});
const platform = [protect, requirePermission(P.PLATFORM_MANAGE)];

router.get("/admin/products", ...platform, controller.adminListProducts);
router.post("/admin/products/import-starter", ...platform, controller.adminImportStarter);
router.post("/admin/products", ...platform, collectCleared(["price", "stock"]), validateBody(productRules(true)), controller.adminCreateProduct);
router.put("/admin/products/:id", ...platform, validateIdParam(), collectCleared(["price", "stock"]), validateBody(productRules(false)), controller.adminUpdateProduct);
router.get("/admin/orders", ...platform, controller.adminListOrders);
router.get("/admin/orders/:id", ...platform, validateIdParam(), controller.adminGetOrder);
router.put(
  "/admin/orders/:id/fulfilment",
  ...platform,
  validateIdParam(),
  validateBody({
    to: { type: "string", required: true, enum: ["SHIPPED", "DELIVERED", "CANCELLED"] },
    courier: { type: "string", max: 80 },
    trackingNumber: { type: "string", max: 80 },
    note: { type: "string", max: 300 },
  }),
  controller.adminSetFulfilment
);

// ---- a company's own orders: for the people who manage the company ----
const customer = [protect, tenant, requireCompany, requirePermission(P.COMPANY_MANAGE)];
router.post(
  "/checkout",
  ...customer,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many checkout attempts. Please try again in a few minutes." }),
  validateBody({
    items: cartItems,
    shipTo: {
      type: "object",
      required: true,
      fields: {
        name: { type: "string", required: true, max: 100 },
        phone: { type: "string", required: true, max: 20 },
        line1: { type: "string", required: true, max: 200 },
        line2: { type: "string", max: 200 },
        city: { type: "string", required: true, max: 80 },
        state: { type: "string", required: true, max: 80 },
        pincode: { type: "string", required: true, max: 6 },
      },
    },
    installationRequested: { type: "boolean" },
    notes: { type: "string", max: 500 },
    gstin: { type: "string", max: 15, upper: true },
  }),
  controller.checkout
);
router.get("/orders", ...customer, controller.listOwnOrders);
router.get("/orders/:id", ...customer, validateIdParam(), controller.getOwnOrder);
router.post("/orders/:id/cancel", ...customer, validateIdParam(), controller.cancelOwnOrder);
router.post("/orders/:id/simulate", ...customer, validateIdParam(), validateBody({ outcome: { type: "string", enum: ["SUCCESS", "FAILED"] } }), controller.simulateOrder);

module.exports = router;
