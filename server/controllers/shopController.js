const AppError = require("../utils/AppError");
const shop = require("../services/shopService");
const audit = require("../services/auditService");
const gateway = require("../integrations/payment");
const starter = require("../config/shopStarter");
const shopConfig = require("../config/shop");
const { STATES } = require("../utils/gst");
const Company = require("../models/Company");
const Product = require("../models/Product");
const ShopOrder = require("../models/ShopOrder");

// ---- public: the catalog and the cart ----------------------------------------------------------

// GET /api/shop/products?category=
const listProducts = async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category.slice(0, 60) : undefined;
  res.json({ success: true, data: await shop.listPublicProducts({ category }) });
};

// GET /api/shop/products/:id
const getProduct = async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isActive: true });
  if (!product) throw new AppError("Product not found", 404);
  res.json({ success: true, data: shop.publicProduct(product) });
};

// GET /api/shop/info    what the cart page needs to explain: delivery charge, states, whether ordering works
const info = (req, res) => {
  const cfg = shopConfig.shipping();
  res.json({
    success: true,
    data: {
      orderingOpen: shop.shopReady(),
      shipping: { flat: cfg.flat, freeAbove: cfg.freeAbove, gstPercent: cfg.gstPercent },
      maxLines: shopConfig.MAX_LINES,
      states: [...new Set(Object.values(STATES))].sort(),
    },
  });
};

// POST /api/shop/cart   { items: [{ productId, qty }] }   Prices a cart (no login needed).
const priceCart = async (req, res) => {
  const priced = await shop.priceCart(req.body.items, { strict: false });
  res.json({ success: true, data: priced });
};

// ---- customer: checkout and own orders ---------------------------------------------------------

const companyOf = async (req) => {
  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);
  return company;
};

// POST /api/shop/checkout
const checkout = async (req, res) => {
  const company = await companyOf(req);
  const { items, shipTo, installationRequested, notes, gstin } = req.body;
  const { order, repeated } = await shop.checkout({ company, user: req.user, items, shipTo, installationRequested, notes, gstin, req });
  res.status(repeated ? 200 : 201).json({ success: true, data: { order: shop.orderView(order), repeated } });
};

const ownOrder = async (req) => {
  const order = await ShopOrder.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!order) throw new AppError("Order not found", 404);
  return order;
};

// GET /api/shop/orders
const listOwnOrders = async (req, res) => {
  const orders = await ShopOrder.find({ companyId: req.companyId, number: { $exists: true } }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: orders.map(shop.orderView) });
};

// GET /api/shop/orders/:id   (the page polls this after the customer comes back from paying)
const getOwnOrder = async (req, res) => {
  res.json({ success: true, data: shop.orderView(await ownOrder(req)) });
};

// POST /api/shop/orders/:id/cancel
const cancelOwnOrder = async (req, res) => {
  const order = await ownOrder(req);
  const cancelled = await shop.cancelPending({ order, req });
  res.json({ success: true, data: shop.orderView(cancelled) });
};

// POST /api/shop/orders/:id/simulate   { outcome }   Plays the customer's side with the simulated gateway.
const simulateOrder = async (req, res) => {
  const chosen = gateway.provider();
  if (!chosen || !chosen.simulated || !chosen.isConfigured()) {
    throw new AppError("Simulated payments are only available with PAYMENT_PROVIDER=simulated (not in production)", 409);
  }
  const order = await ownOrder(req);
  if (order.provider !== "simulated") throw new AppError("Only a simulated order can be simulated", 409);
  const outcome = req.body.outcome || "SUCCESS";
  const result = await shop.settle({
    transactionId: order.transactionId,
    status: outcome,
    gatewayRef: `SIM-${order.transactionId.slice(-8)}`,
    gatewayPaymentId: `simpay-${order.transactionId.slice(-8)}`,
    ...(outcome === "FAILED" ? { reason: "Declined in the simulator" } : {}),
  }, req);
  res.json({ success: true, data: { outcome: result.outcome, order: shop.orderView(result.order || order) } });
};

// ---- platform (Super Admin): products ----------------------------------------------------------

const PRODUCT_FIELDS = ["name", "category", "brand", "modelNumber", "description", "highlights", "imageUrl", "price", "gstPercent", "hsn", "stock", "maxPerOrder", "worksWithSoftware", "isActive", "sortOrder"];

const adminProduct = (product) => ({ ...product.toObject(), canBuy: product.canBuy() });

// GET /api/shop/admin/products
const adminListProducts = async (req, res) => {
  const products = await Product.find({}).sort({ sortOrder: 1, name: 1 }).limit(1000);
  res.json({ success: true, data: products.map(adminProduct) });
};

const applyProduct = (product, body, cleared = []) => {
  if (body.price !== undefined && Math.abs(body.price * 100 - Math.round(body.price * 100)) > 1e-6) {
    throw new AppError("The price can have at most 2 decimal places", 400);
  }
  for (const field of PRODUCT_FIELDS) if (body[field] !== undefined) product[field] = body[field];
  for (const field of cleared) {
    if (["price", "stock"].includes(field)) product[field] = null; // price off = "ask us"; stock off = made to order
  }
  // A price of 0 would mean "free": treat it as no price.
  if (product.price === 0) product.price = null;
};

// POST /api/shop/admin/products
const adminCreateProduct = async (req, res) => {
  const product = new Product();
  applyProduct(product, req.body, req.cleared);
  await product.save();
  await audit.record(req, "SHOP_PRODUCT_CREATE", { entity: "Product", entityId: product._id, meta: { name: product.name } });
  res.status(201).json({ success: true, data: adminProduct(product) });
};

// PUT /api/shop/admin/products/:id
const adminUpdateProduct = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError("Product not found", 404);
  applyProduct(product, req.body, req.cleared);
  await product.save();
  await audit.record(req, "SHOP_PRODUCT_UPDATE", { entity: "Product", entityId: product._id, meta: { name: product.name, changed: Object.keys(req.body).concat(req.cleared || []) } });
  res.json({ success: true, data: adminProduct(product) });
};

// POST /api/shop/admin/products/import-starter   Adds the starter list, only while the catalog is empty.
const adminImportStarter = async (req, res) => {
  if (await Product.countDocuments({}) > 0) throw new AppError("The catalog already has products. Edit them instead.", 409);
  const created = await Product.insertMany(starter);
  await audit.record(req, "SHOP_STARTER_IMPORTED", { entity: "Product", meta: { count: created.length } });
  res.status(201).json({ success: true, data: created.map(adminProduct) });
};

// ---- platform (Super Admin): orders ------------------------------------------------------------

const adminOrderView = (order) => ({
  ...shop.orderView(order),
  buyerGstin: order.buyerGstin,
  company: order.companyId && order.companyId.name
    ? { _id: order.companyId._id, name: order.companyId.name, email: order.companyId.billingContact && order.companyId.billingContact.email, phone: order.companyId.billingContact && order.companyId.billingContact.phone }
    : undefined,
});

// GET /api/shop/admin/orders?status=&fulfilment=&q=
const adminListOrders = async (req, res) => {
  const { status, fulfilment, q } = req.query;
  const filter = { number: { $exists: true } };
  if (["PENDING", "PAID", "FAILED", "CANCELLED"].includes(status)) filter.status = status;
  if (["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].includes(fulfilment)) filter.fulfilment = fulfilment;
  if (typeof q === "string" && q.trim()) {
    const pattern = new RegExp(shop.escapeRegex(q.trim().slice(0, 60)), "i");
    const companies = await Company.find({ name: pattern }).select("_id").limit(50).lean();
    filter.$or = [{ number: pattern }, { companyId: { $in: companies.map((c) => c._id) } }];
  }
  const orders = await ShopOrder.find(filter).sort({ createdAt: -1 }).limit(200).populate("companyId", "name billingContact");
  res.json({ success: true, data: orders.map(adminOrderView) });
};

// GET /api/shop/admin/orders/:id
const adminGetOrder = async (req, res) => {
  const order = await ShopOrder.findById(req.params.id).populate("companyId", "name billingContact");
  if (!order) throw new AppError("Order not found", 404);
  res.json({ success: true, data: adminOrderView(order) });
};

// PUT /api/shop/admin/orders/:id/fulfilment   { to, courier?, trackingNumber?, note? }
const adminSetFulfilment = async (req, res) => {
  const order = await ShopOrder.findById(req.params.id);
  if (!order) throw new AppError("Order not found", 404);
  const updated = await shop.setFulfilment({ order, to: req.body.to, courier: req.body.courier, trackingNumber: req.body.trackingNumber, note: req.body.note, req });
  const withCompany = await ShopOrder.findById(updated._id).populate("companyId", "name billingContact");
  res.json({ success: true, data: adminOrderView(withCompany) });
};

module.exports = {
  listProducts, getProduct, info, priceCart, checkout, listOwnOrders, getOwnOrder, cancelOwnOrder, simulateOrder,
  adminListProducts, adminCreateProduct, adminUpdateProduct, adminImportStarter, adminListOrders, adminGetOrder, adminSetFulfilment,
};
