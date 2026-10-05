// The hardware shop: price a cart, take the order and the online payment, count stock, issue the GST
// invoice and follow the delivery.
//
//   checkout ─► ShopOrder PENDING + a payment link
//                  │
//   paid (webhook, or the sweep asked the gateway) ─► PAID, delivery PROCESSING ─► stock counted down
//                  │                                   ─► GST invoice issued and emailed
//                  └─► FAILED (the gateway said so, or the link ran out of time)
//
// Rules this file keeps (the same as for parking and plan payments):
//  * The money is truth. A payment that arrives for an order we had given up on still counts: the
//    customer really paid, so the order goes ahead.
//  * Results can arrive twice, late or out of order. The order moves out of a waiting state only once
//    and every step after it is safe to repeat.
//  * A payment for the wrong amount never starts an order; an admin is alerted to refund it.
//  * Prices come from the catalog on the server, never from the browser.
//  * Stock is checked when the order is made and counted down when it is paid. Two buyers can race for
//    the last unit: both payments are honoured (the money is truth) and stock stops at zero.
//
// Goods are taxed where they are delivered (the place of supply): the ship-to state against the seller's
// state decides CGST + SGST or IGST.

const crypto = require("crypto");
const AppError = require("../utils/AppError");
const env = require("../config/env");
const shopConfig = require("../config/shop");
const { stateOf, isGstin, splitTaxExact, financialYear, round2 } = require("../utils/gst");
const { localDateText } = require("../utils/time");
const audit = require("./auditService");
const { notify } = require("./notificationService");
const emailService = require("./emailService");
const billing = require("./billingService");
const { buildInvoicePdf } = require("../utils/invoicePdf");
const gateway = require("../integrations/payment");
const Company = require("../models/Company");
const User = require("../models/User");
const Product = require("../models/Product");
const ShopOrder = require("../models/ShopOrder");
const Invoice = require("../models/Invoice");

const SYSTEM_REQ = Object.freeze({ headers: {}, ip: "system" });
const sameAmount = (a, b) => Math.abs(a - b) <= 0.005;
const OPEN = ["PENDING", "FAILED", "CANCELLED"];
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- catalog views -----------------------------------------------------------------------------

const withGst = (product) => (typeof product.price === "number" ? round2(product.price * (1 + product.gstPercent / 100)) : null);

// What a visitor sees. The stock count itself stays private.
const publicProduct = (product) => ({
  _id: product._id,
  name: product.name,
  category: product.category,
  brand: product.brand,
  modelNumber: product.modelNumber,
  description: product.description,
  highlights: product.highlights || [],
  imageUrl: product.imageUrl,
  price: typeof product.price === "number" && product.price > 0 ? product.price : null,
  gstPercent: product.gstPercent,
  priceWithGst: typeof product.price === "number" && product.price > 0 ? withGst(product) : null,
  inStock: product.stock === null || product.stock === undefined || product.stock > 0,
  canBuy: product.canBuy(),
  worksWithSoftware: product.worksWithSoftware,
  maxPerOrder: product.stock === null || product.stock === undefined ? product.maxPerOrder : Math.min(product.maxPerOrder, product.stock),
});

const listPublicProducts = async ({ category } = {}) => {
  const filter = { isActive: true, ...(category ? { category } : {}) };
  const products = await Product.find(filter).sort({ sortOrder: 1, name: 1 }).limit(500);
  return products.map(publicProduct);
};

// ---- pricing a cart ----------------------------------------------------------------------------

// Delivery charge for goods worth `goods` rupees (before GST).
const shippingFor = (goods) => {
  const cfg = shopConfig.shipping();
  const fee = cfg.freeAbove > 0 && goods >= cfg.freeAbove ? 0 : cfg.flat;
  return { fee: round2(fee), gstPercent: cfg.gstPercent, gst: round2((fee * cfg.gstPercent) / 100) };
};

// Merges repeated products and checks the shape of the cart. items: [{ productId, qty }].
const cleanItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) throw new AppError("Your cart is empty", 400);
  const merged = new Map();
  for (const item of items) {
    const id = item && String(item.productId || "");
    const qty = item && item.qty;
    if (!/^[0-9a-f]{24}$/i.test(id)) throw new AppError("The cart has an item we do not recognise", 400);
    if (!Number.isInteger(qty) || qty < 1) throw new AppError("Quantities must be whole numbers of at least 1", 400);
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  if (merged.size > shopConfig.MAX_LINES) throw new AppError(`An order can have at most ${shopConfig.MAX_LINES} different products. Split it into two orders.`, 400);
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
};

// Prices a cart from the catalog.
//   strict (checkout): any problem stops with an error that names the product.
//   not strict (the cart page): problems are reported per item and the rest is still priced.
const priceCart = async (items, { strict = true } = {}) => {
  const wanted = cleanItems(items);
  const products = await Product.find({ _id: { $in: wanted.map((i) => i.productId) } });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const problems = [];
  for (const item of wanted) {
    const product = byId.get(item.productId);
    let problem = null;
    if (!product || !product.isActive) problem = "This product is no longer sold";
    else if (!product.canBuy()) problem = product.stock === 0 ? "Out of stock" : "Ask us for a price: it cannot be ordered online yet";
    else if (item.qty > product.maxPerOrder) problem = `At most ${product.maxPerOrder} per order. For more, contact us.`;
    else if (product.stock !== null && product.stock !== undefined && item.qty > product.stock) problem = `Only ${product.stock} in stock`;
    if (problem) {
      if (strict) throw new AppError(`${product ? product.name : "An item"}: ${problem}`, 409);
      problems.push({ productId: item.productId, name: product && product.name, problem });
      continue;
    }
    const taxable = round2(product.price * item.qty);
    const gst = round2((taxable * product.gstPercent) / 100);
    lines.push({
      productId: product._id,
      name: product.name,
      category: product.category,
      hsn: product.hsn || undefined,
      qty: item.qty,
      unitPrice: product.price,
      gstPercent: product.gstPercent,
      taxable,
      gst,
      total: round2(taxable + gst),
      imageUrl: product.imageUrl,
    });
  }

  const goods = round2(lines.reduce((sum, l) => sum + l.taxable, 0));
  const ship = lines.length ? shippingFor(goods) : { fee: 0, gstPercent: 0, gst: 0 };
  const gst = round2(lines.reduce((sum, l) => sum + l.gst, 0) + ship.gst);
  return {
    lines,
    problems,
    goods,
    shippingFee: ship.fee,
    shippingGstPercent: ship.gstPercent,
    shippingGst: ship.gst,
    gst,
    total: round2(goods + ship.fee + gst),
  };
};

// ---- checkout ----------------------------------------------------------------------------------

const PHONE = /^[0-9+\-\s]{10,15}$/;
const PINCODE = /^[1-9][0-9]{5}$/;

// Checks the delivery address and works out its state (needed for the GST).
const cleanShipTo = (input) => {
  const value = (key, max = 150) => String((input && input[key]) || "").trim().slice(0, max);
  const shipTo = {
    name: value("name", 100), phone: value("phone", 20), line1: value("line1", 200), line2: value("line2", 200),
    city: value("city", 80), state: value("state", 80), pincode: value("pincode", 6),
  };
  const missing = ["name", "phone", "line1", "city", "state", "pincode"].filter((k) => !shipTo[k]);
  if (missing.length) throw new AppError(`Please fill in the delivery address (${missing.join(", ")})`, 400);
  if (!PHONE.test(shipTo.phone)) throw new AppError("The phone number for delivery does not look right", 400);
  if (!PINCODE.test(shipTo.pincode)) throw new AppError("The PIN code must be 6 digits", 400);
  const state = stateOf({ name: shipTo.state });
  if (!state) throw new AppError("Choose the delivery state from the list", 400);
  const { line2, ...rest } = shipTo;
  return { ...rest, ...(line2 ? { line2 } : {}), state: state.name, stateCode: state.code };
};

const fingerprintOf = (companyId, priced, shipTo, installation, extra = {}) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([
      String(companyId), priced.lines.map((l) => [String(l.productId), l.qty, l.unitPrice]), priced.total,
      shipTo.name, shipTo.phone, shipTo.line1, shipTo.line2 || "", shipTo.city, shipTo.stateCode, shipTo.pincode,
      Boolean(installation), String(extra.gstin || ""), String(extra.notes || ""),
    ]))
    .digest("hex")
    .slice(0, 32);

// Gives the order the next number of the financial year ("HW/26-27/0001") and saves it.
const saveWithNumber = async (order) => {
  const fy = financialYear(localDateText(new Date()));
  const prefix = String(process.env.SHOP_ORDER_PREFIX || "HW").replace(/[^A-Za-z0-9-]/g, "").slice(0, 6) || "HW";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const last = await ShopOrder.findOne({ financialYear: fy }).sort({ sequence: -1 }).select("sequence").lean();
    const sequence = (last ? last.sequence : 0) + 1;
    order.financialYear = fy;
    order.sequence = sequence;
    order.number = `${prefix}/${fy}/${String(sequence).padStart(4, "0")}`;
    try {
      await order.save();
      return order;
    } catch (error) {
      if (error.code !== 11000 || !/sequence|number/.test(String(error.message))) throw error;
    }
  }
  throw new Error("Could not choose an order number");
};

const shopReady = () => billing.sellerProblems().length === 0 && Boolean(gateway.provider() && gateway.provider().isConfigured() && gateway.provider().hostedPage);

const checkout = async ({ company, user, items, shipTo: shipInput, installationRequested, notes, gstin, req }) => {
  if (billing.sellerProblems().length) throw new AppError("The shop is not set up for orders yet. Please contact support.", 503);
  const chosen = gateway.provider();
  if (!chosen || !chosen.isConfigured() || !chosen.hostedPage) throw new AppError("Online payment is not set up yet. Please contact support.", 503);

  const shipTo = cleanShipTo(shipInput);
  const given = String(gstin || "").trim().toUpperCase();
  if (given && !isGstin(given)) throw new AppError("The GSTIN does not look right. Fix it, or leave it empty.", 400);
  // Without one typed here, the company's own GSTIN is used (if it is a valid one).
  const onFile = String(company.gstNumber || "").trim().toUpperCase();
  const buyerGstin = given || (isGstin(onFile) ? onFile : "");

  const priced = await priceCart(items, { strict: true });
  const fingerprint = fingerprintOf(company._id, priced, shipTo, installationRequested, { gstin: buyerGstin, notes });
  const waiting = await ShopOrder.findOne({ companyId: company._id, status: "PENDING", fingerprint, payUrl: { $exists: true }, expiresAt: { $gt: new Date() } });
  if (waiting) return { order: waiting, repeated: true };
  // An identical order whose link has run out is put aside first (a payment on it would still count).
  await ShopOrder.updateMany(
    { companyId: company._id, status: "PENDING", fingerprint, expiresAt: { $lte: new Date() } },
    { $set: { status: "CANCELLED", failureReason: "Replaced by a newer order" } }
  );

  const expiresAt = new Date(Date.now() + shopConfig.SHOP_LINK_HOURS() * 3600 * 1000);
  const order = new ShopOrder({
    companyId: company._id,
    createdBy: user._id,
    lines: priced.lines.map(({ imageUrl, ...line }) => line),
    goods: priced.goods,
    shippingFee: priced.shippingFee,
    shippingGstPercent: priced.shippingGstPercent,
    shippingGst: priced.shippingGst,
    gst: priced.gst,
    total: priced.total,
    shipTo,
    buyerGstin: buyerGstin || undefined,
    installationRequested: Boolean(installationRequested),
    notes: notes ? String(notes).slice(0, 500) : undefined,
    fingerprint,
    history: [{ at: new Date(), status: "ORDERED", by: user._id }],
  });

  const count = priced.lines.reduce((sum, l) => sum + l.qty, 0);
  const made = await chosen.createOrder({
    amount: priced.total,
    expiresAt,
    description: `Hardware order: ${count} item${count === 1 ? "" : "s"}`,
    returnUrl: `${env.clientUrl}/dashboard/orders/${order._id}`,
    notes: { shop: "hardware", order: String(order._id) },
  });
  Object.assign(order, {
    provider: chosen.name,
    transactionId: made.transactionId,
    ...(made.gatewayRef ? { gatewayRef: made.gatewayRef } : {}),
    ...(made.payUrl ? { payUrl: made.payUrl } : {}),
    expiresAt: made.expiresAt || expiresAt,
  });
  try {
    await saveWithNumber(order);
  } catch (error) {
    // Two identical checkouts at the same moment: the other one won. Drop our extra payment link and use theirs.
    if (error.code === 11000 && /fingerprint/.test(String(error.message))) {
      if (chosen.cancel && made.gatewayRef) chosen.cancel({ gatewayRef: made.gatewayRef }).catch(() => {});
      const other = await ShopOrder.findOne({ companyId: company._id, status: "PENDING", fingerprint });
      if (other) return { order: other, repeated: true };
    }
    throw error;
  }

  await audit.record(req, "SHOP_CHECKOUT_STARTED", {
    entity: "ShopOrder", entityId: order._id, companyId: company._id, meta: { number: order.number, total: order.total, items: count },
  });
  return { order, repeated: false };
};

// The customer gives up on an order that is still waiting for payment.
const cancelPending = async ({ order, req }) => {
  const cancelled = await ShopOrder.findOneAndUpdate(
    { _id: order._id, status: "PENDING" },
    { $set: { status: "CANCELLED", failureReason: "Cancelled by the buyer" } },
    { returnDocument: "after" }
  );
  if (!cancelled) throw new AppError("Only an order that is waiting for payment can be cancelled", 409);
  const owner = gateway.PROVIDERS[cancelled.provider];
  if (owner && owner.cancel && cancelled.gatewayRef) owner.cancel(cancelled).catch(() => {});
  await audit.record(req, "SHOP_ORDER_CANCELLED_BY_BUYER", { entity: "ShopOrder", entityId: order._id, companyId: order.companyId });
  return cancelled;
};

// ---- after payment -----------------------------------------------------------------------------

const addressText = (shipTo) => [shipTo.name, shipTo.phone, shipTo.line1, shipTo.line2, shipTo.city, `${shipTo.state} ${shipTo.pincode}`].filter(Boolean).join(", ");

const issueShopInvoice = async (order, company) => {
  const seller = billing.sellerDetails();
  const buyer = billing.buyerDetails(company);
  const sellerState = seller.state ? { code: seller.stateCode, name: seller.state } : null;
  const placeOfSupply = { code: order.shipTo.stateCode, name: order.shipTo.state };
  const tax = splitTaxExact({ gst: order.gst, sellerState, buyerState: placeOfSupply });

  const lines = order.lines.map((l) => ({
    description: l.name, hsn: l.hsn, qty: l.qty, rate: l.unitPrice, taxable: l.taxable, gstPercent: l.gstPercent, amount: l.total,
  }));
  if (order.shippingFee > 0) {
    lines.push({
      description: "Delivery charges", hsn: process.env.SHOP_SHIPPING_SAC || undefined, qty: 1, rate: order.shippingFee, taxable: order.shippingFee,
      gstPercent: order.shippingGstPercent, amount: round2(order.shippingFee + order.shippingGst),
    });
  }
  const taxable = round2(order.goods + order.shippingFee);
  return billing.issueInvoice({
    orderId: order._id,
    companyId: order.companyId,
    kind: "SHOP",
    fields: {
      seller,
      buyer: { ...buyer, gstin: order.buyerGstin || buyer.gstin || "", state: placeOfSupply.name, stateCode: placeOfSupply.code },
      description: `Hardware order ${order.number}`,
      lines,
      shipTo: addressText(order.shipTo),
      subtotal: taxable,
      discount: 0,
      taxable,
      gstPercent: Math.max(...lines.map((l) => l.gstPercent)),
      ...tax,
      total: order.total,
      paymentRef: order.gatewayPaymentId || order.gatewayRef || order.transactionId,
    },
  });
};

// Counts stock down once for a paid order (never below zero).
const countStock = async (order) => {
  // A cancelled order has already given its stock back: a repeated payment message must not take it again.
  const claimed = await ShopOrder.updateOne({ _id: order._id, stockCounted: false, fulfilment: { $ne: "CANCELLED" } }, { $set: { stockCounted: true } });
  if (claimed.modifiedCount === 0) return false;
  for (const line of order.lines) {
    const taken = await Product.updateOne({ _id: line.productId, stock: { $gte: line.qty } }, { $inc: { stock: -line.qty } });
    // Less stock than the order needs (someone else got there first): stop at zero.
    if (taken.modifiedCount === 0) await Product.updateOne({ _id: line.productId, stock: { $ne: null, $lt: line.qty } }, { $set: { stock: 0 } });
  }
  return true;
};

// Puts the stock of a cancelled paid order back.
const restoreStock = async (order) => {
  const claimed = await ShopOrder.updateOne({ _id: order._id, stockCounted: true }, { $set: { stockCounted: false } });
  if (claimed.modifiedCount === 0) return false;
  for (const line of order.lines) {
    await Product.updateOne({ _id: line.productId, stock: { $ne: null } }, { $inc: { stock: line.qty } });
  }
  return true;
};

const platformEmail = () => String(process.env.SHOP_NOTIFY_EMAIL || process.env.SELLER_EMAIL || "").trim();

// Everything that follows a paid order. Safe to repeat.
const finalize = async (order, req) => {
  const company = await Company.findById(order.companyId);
  if (!company) return { company: null };

  const counted = await countStock(order);
  const { invoice, created } = await issueShopInvoice(order, company);
  if (!order.invoiceId || String(order.invoiceId) !== String(invoice._id)) {
    await ShopOrder.updateOne({ _id: order._id }, { $set: { invoiceId: invoice._id } });
  }

  if (counted) {
    await audit.record(req, "SHOP_ORDER_PAID", {
      actor: undefined, entity: "ShopOrder", entityId: order._id, companyId: company._id,
      meta: { number: order.number, total: order.total, invoice: invoice.number },
    });
    await notify({
      companyId: company._id, type: "GENERAL", severity: "info",
      title: `Order ${order.number} is confirmed`,
      message: `We received your payment of Rs ${order.total.toFixed(2)}. Invoice ${invoice.number} is in My orders. We will update you when it ships.`,
      dedupeKey: `shop-paid:${order._id}`,
    });
  }
  if (created) await sendOrderEmails({ order, invoice, company });
  return { company, invoice, counted };
};

// To the buyer (with the invoice) and to the seller (so the order is not missed). Background: never fails the payment.
const sendOrderEmails = async ({ order, invoice, company }) => {
  try {
    const admins = await User.find({ companyId: company._id, role: "COMPANY_ADMIN", isActive: true }).select("email").lean();
    const to = [...new Set([company.billingContact && company.billingContact.email, ...admins.map((a) => a.email)].filter(Boolean))];
    emailService.sendInvoice({ to, invoice, company, pdf: buildInvoicePdf(invoice) });
    const seller = platformEmail();
    if (seller) {
      emailService.sendMessage({
        to: [seller],
        key: `shop-new:${order._id}`,
        message: {
          subject: `New hardware order ${order.number}: Rs ${order.total.toFixed(2)}`,
          ...emailService.layout({
            heading: "A hardware order was paid",
            paragraphs: [
              `${company.name}: ${order.lines.map((l) => `${l.qty} x ${l.name}`).join(", ")}.`,
              `Deliver to: ${addressText(order.shipTo)}.${order.installationRequested ? " Installation was requested." : ""}`,
              `Total Rs ${order.total.toFixed(2)} including GST. Invoice ${invoice.number}.`,
            ],
            button: { label: "Open shop orders", url: `${env.clientUrl}/dashboard/shop` },
            footer: "You get this because SHOP_NOTIFY_EMAIL (or SELLER_EMAIL) is set on the server.",
          }),
        },
      });
    }
  } catch (error) {
    console.error("Order email failed:", error.message);
  }
};

// event: { transactionId, status: "SUCCESS" | "FAILED", gatewayRef?, gatewayPaymentId?, reason?, amount? }
// Returns { outcome: "unknown" | "failed" | "ignored" | "mismatch" | "already" | "success" | "unmatched", order?, invoice? }.
const settle = async (event, req = SYSTEM_REQ) => {
  const { transactionId, status, gatewayRef, gatewayPaymentId, reason, amount } = event || {};
  if (typeof transactionId !== "string") return { outcome: "unknown" };
  const existing = await ShopOrder.findOne({ transactionId });
  if (!existing) return { outcome: "unknown" };
  const refs = { ...(gatewayRef ? { gatewayRef } : {}), ...(gatewayPaymentId ? { gatewayPaymentId } : {}) };

  if (status === "FAILED") {
    const failed = await ShopOrder.findOneAndUpdate(
      { _id: existing._id, status: "PENDING" },
      { $set: { status: "FAILED", failureReason: String(reason || "Payment failed").slice(0, 200), ...refs } },
      { returnDocument: "after" }
    );
    return failed ? { outcome: "failed", order: failed } : { outcome: "ignored", order: existing };
  }

  if (status !== "SUCCESS") return { outcome: "ignored", order: existing };

  if (existing.status === "PAID") {
    const done = await finalize(existing, req); // finishes anything a crash left undone
    if (done.invoice) existing.invoiceId = done.invoice._id;
    return { outcome: "already", order: existing, invoice: done.invoice };
  }

  if (amount !== undefined && !sameAmount(amount, existing.total)) {
    if (existing.status === "FAILED" && /^The gateway reports/.test(existing.failureReason || "")) return { outcome: "mismatch", order: existing }; // already flagged
    const flagged = await ShopOrder.findOneAndUpdate(
      { _id: existing._id, status: { $in: OPEN } },
      { $set: { status: "FAILED", failureReason: `The gateway reports ${amount}, but the order was for ${existing.total}`, ...refs } },
      { returnDocument: "after" }
    );
    if (flagged) {
      await notify({
        companyId: flagged.companyId, type: "PAYMENT_ISSUE", severity: "critical",
        title: "A shop payment had the wrong amount",
        message: `Order ${flagged.number}: the gateway took ${amount} but the order was for ${flagged.total}. The order was not started. Refund it in the gateway and order again.`,
        dedupeKey: `shop-mismatch:${flagged._id}`,
      });
      await audit.record(req, "SHOP_PAYMENT_MISMATCH", { entity: "ShopOrder", entityId: flagged._id, companyId: flagged.companyId, meta: { reported: amount, expected: flagged.total } });
    }
    return { outcome: "mismatch", order: flagged || existing };
  }

  const paid = await ShopOrder.findOneAndUpdate(
    { _id: existing._id, status: { $in: OPEN } },
    {
      $set: { status: "PAID", fulfilment: "PROCESSING", paidAt: new Date(), ...refs },
      $unset: { failureReason: "" },
      $push: { history: { at: new Date(), status: "PAID" } },
    },
    { returnDocument: "after" }
  );
  if (!paid) {
    // Another call paid it a moment ago.
    const latest = await ShopOrder.findById(existing._id);
    if (latest && latest.status === "PAID") {
      const done = await finalize(latest, req);
      if (done.invoice) latest.invoiceId = done.invoice._id;
      return { outcome: "already", order: latest, invoice: done.invoice };
    }
    return { outcome: "ignored", order: existing };
  }
  const done = await finalize(paid, req);
  if (!done.company) {
    console.error(`Shop order ${paid._id} was paid but its company no longer exists`);
    return { outcome: "unmatched", order: paid };
  }
  paid.invoiceId = done.invoice._id; // finalize saved it; the copy we hand back must show it too
  return { outcome: "success", order: paid, invoice: done.invoice };
};

// Every minute: ask the gateway about links whose result never arrived.
const sweep = async (now = new Date()) => {
  const waiting = await ShopOrder.find({ status: "PENDING", createdAt: { $lte: new Date(now.getTime() - 90 * 1000) } }).sort({ createdAt: 1 }).limit(50);
  let settled = 0;
  for (const order of waiting) {
    const owner = gateway.PROVIDERS[order.provider];
    let known = null;
    try {
      known = owner ? await owner.fetchStatus(order) : null;
    } catch (error) {
      console.error(`Could not ask the gateway about shop order ${order.transactionId}:`, error.message);
    }
    if (known) {
      const result = await settle({ transactionId: order.transactionId, ...known });
      if (["success", "failed", "mismatch"].includes(result.outcome)) settled += 1;
      continue;
    }
    if (order.expiresAt && order.expiresAt <= now) {
      await ShopOrder.updateOne({ _id: order._id, status: "PENDING" }, { $set: { status: "FAILED", failureReason: "Not paid in time" } });
    }
  }
  return { checked: waiting.length, settled };
};

// ---- delivery (platform side) ------------------------------------------------------------------

// What may follow what.
const NEXT = { PROCESSING: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED", "CANCELLED"], DELIVERED: [], CANCELLED: [], NONE: [] };

// order: a paid ShopOrder document. to: "SHIPPED" | "DELIVERED" | "CANCELLED".
const setFulfilment = async ({ order, to, courier, trackingNumber, note, req }) => {
  if (order.status !== "PAID") throw new AppError("This order has not been paid, so it cannot be shipped", 409);
  if (!(NEXT[order.fulfilment] || []).includes(to)) {
    throw new AppError(`An order that is ${order.fulfilment.toLowerCase()} cannot be marked ${to.toLowerCase()}`, 409);
  }
  if (to === "SHIPPED" && !String(courier || "").trim()) throw new AppError("Enter the courier or delivery partner", 400);
  if (to === "CANCELLED" && !String(note || "").trim()) throw new AppError("Say why the order is cancelled", 400);

  const set = { fulfilment: to };
  if (to === "SHIPPED") Object.assign(set, { courier: String(courier).trim().slice(0, 80), trackingNumber: String(trackingNumber || "").trim().slice(0, 80) || undefined, shippedAt: new Date() });
  if (to === "DELIVERED") set.deliveredAt = new Date();
  const updated = await ShopOrder.findOneAndUpdate(
    { _id: order._id, fulfilment: order.fulfilment },
    { $set: set, $push: { history: { at: new Date(), status: to, note: note ? String(note).slice(0, 300) : undefined, by: req.user && req.user._id } } },
    { returnDocument: "after" }
  );
  if (!updated) throw new AppError("The order changed while you were editing it. Reload and try again.", 409);
  if (to === "CANCELLED") await restoreStock(updated);

  await audit.record(req, `SHOP_ORDER_${to}`, { entity: "ShopOrder", entityId: updated._id, companyId: updated.companyId, meta: { number: updated.number, courier: updated.courier, trackingNumber: updated.trackingNumber } });
  await tellBuyer(updated, to, note);
  return updated;
};

const tellBuyer = async (order, to, note) => {
  const text = {
    SHIPPED: { title: `Order ${order.number} has shipped`, message: `Sent with ${order.courier}${order.trackingNumber ? `, tracking number ${order.trackingNumber}` : ""}.` },
    DELIVERED: { title: `Order ${order.number} was delivered`, message: "Thank you. If anything is wrong, contact us and quote the order number." },
    CANCELLED: { title: `Order ${order.number} was cancelled`, message: `${note ? `${note}. ` : ""}Any money you paid will be refunded by us; contact support if it does not arrive.` },
  }[to];
  if (!text) return;
  await notify({
    companyId: order.companyId, type: "GENERAL", severity: to === "CANCELLED" ? "warning" : "info",
    title: text.title, message: text.message, dedupeKey: `shop-${to.toLowerCase()}:${order._id}`,
  });
  try {
    const company = await Company.findById(order.companyId).select("name billingContact").lean();
    const admins = await User.find({ companyId: order.companyId, role: "COMPANY_ADMIN", isActive: true }).select("email").lean();
    const recipients = [...new Set([company && company.billingContact && company.billingContact.email, ...admins.map((a) => a.email)].filter(Boolean))];
    emailService.sendMessage({
      to: recipients,
      key: `shop-${to.toLowerCase()}:${order._id}`,
      message: {
        subject: text.title,
        ...emailService.layout({
          heading: text.title,
          paragraphs: [text.message],
          button: { label: "Open My orders", url: `${env.clientUrl}/dashboard/orders/${order._id}` },
          footer: `Sent to the billing contact and admins of ${company ? company.name : "your company"}.`,
        }),
      },
    });
  } catch (error) {
    console.error("Order update email failed:", error.message);
  }
};

// ---- order views -------------------------------------------------------------------------------

// What the buyer sees. The gateway's own ids stay on the server.
const orderView = (order) => ({
  _id: order._id,
  number: order.number,
  lines: order.lines.map((l) => ({ productId: l.productId, name: l.name, category: l.category, qty: l.qty, unitPrice: l.unitPrice, gstPercent: l.gstPercent, taxable: l.taxable, gst: l.gst, total: l.total })),
  goods: order.goods,
  shippingFee: order.shippingFee,
  shippingGst: order.shippingGst,
  gst: order.gst,
  total: order.total,
  shipTo: order.shipTo,
  installationRequested: order.installationRequested,
  notes: order.notes,
  status: order.status,
  failureReason: order.failureReason,
  payUrl: order.status === "PENDING" && order.payUrl && !String(order.payUrl).startsWith("simulated://") ? order.payUrl : undefined,
  simulated: order.provider === "simulated",
  expiresAt: order.expiresAt,
  paidAt: order.paidAt,
  invoiceId: order.invoiceId,
  fulfilment: order.fulfilment,
  courier: order.courier,
  trackingNumber: order.trackingNumber,
  shippedAt: order.shippedAt,
  deliveredAt: order.deliveredAt,
  history: (order.history || []).map((h) => ({ at: h.at, status: h.status, note: h.note })),
  createdAt: order.createdAt,
});

module.exports = {
  OPEN, NEXT, publicProduct, listPublicProducts, shippingFor, cleanItems, priceCart, cleanShipTo, shopReady, checkout, cancelPending,
  settle, sweep, finalize, setFulfilment, orderView, addressText, countStock, restoreStock, escapeRegex,
};
