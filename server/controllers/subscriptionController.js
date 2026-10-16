const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const pricing = require("../config/pricing");
const { ADDONS, byKey } = require("../config/addons");
const subs = require("../services/subscriptionService");
const billing = require("../services/billingService");
const audit = require("../services/auditService");
const gateway = require("../integrations/payment");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Subscription = require("../models/Subscription");
const PlanOrder = require("../models/PlanOrder");
const AddonPrice = require("../models/AddonPrice");
const Invoice = require("../models/Invoice");

const companyOf = async (req) => {
  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);
  return company;
};

const locationOf = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid location", 400);
  const location = await Location.findOne({ _id: id, ...req.tenantFilter });
  if (!location) throw new AppError("Location not found", 404);
  return location;
};

const subOf = async (req) => {
  const sub = await Subscription.findOne({ _id: req.params.id, ...req.tenantFilter });
  if (!sub) throw new AppError("Subscription not found", 404);
  return sub;
};

// A subscription as the screens show it.
const subView = (sub, now = new Date()) => {
  const addons = sub.addons && sub.addons.toObject ? sub.addons.toObject() : sub.addons;
  return {
    _id: sub._id, locationId: sub.locationId, code: sub.code, planName: sub.planName, users: sub.users, months: sub.months,
    periodStart: sub.periodStart, periodEnd: sub.periodEnd, addons, legacy: sub.legacy, status: sub.status,
    state: subs.stateOf(sub, now), daysLeft: subs.daysLeft(sub, now), cancelReason: sub.cancelReason, cancelledAt: sub.cancelledAt,
    items: itemsOf(sub, addons),
  };
};

// "Vehicle Pass Management", "ANPR Camera Service (ANPR cameras: 1)" ... the add-ons that are on.
const itemsOf = (sub, addons) => {
  if (sub.legacy) {
    const a = sub.addons || {};
    // The free trial and earlier all-inclusive plans have every add-on; a newer company-wide plan only the users.
    if (a.pass && a.gateway && a.anpr >= 1000) return ["All features included (free trial or earlier plan)"];
    return ["Users only (add pass, photos, gateway, cameras and backups for this location under Manage Subscriptions)"];
  }
  const out = [];
  for (const a of ADDONS) {
    const value = addons[a.key];
    if (a.kind === "FLAG" && value) out.push(a.label);
    if (a.kind === "COUNT" && value > 0) out.push(`${a.label} (${a.noun}: ${value})`);
    if (a.kind === "RETENTION" && value > 0) out.push(`${a.label} (${value} month${value === 1 ? "" : "s"})`);
  }
  return out;
};

const readiness = () => {
  const provider = gateway.provider();
  const ready = billing.billingReady();
  return {
    ready,
    notReady: ready ? [] : [
      ...(billing.sellerProblems().length ? ["The seller's details are not set up on the server"] : []),
      ...(provider && provider.isConfigured() && provider.hostedPage ? [] : ["Online payment is not set up on the server"]),
    ],
  };
};

// The order as the order page shows it. The gateway's own ids stay on the server.
const orderView = (order, extra = {}) => ({
  _id: order._id, orderNumber: order.orderNumber, kind: order.kind, locationId: order.locationId, subscriptionId: order.subscriptionId,
  planName: order.planName, users: order.users, months: order.months, lines: order.lines || [],
  subtotal: order.subtotal, discount: order.discount, discountPercent: order.discountPercent, gross: order.gross, gst: order.gst, total: order.total,
  status: order.status, failureReason: order.failureReason,
  payUrl: order.payUrl && !String(order.payUrl).startsWith("simulated://") ? order.payUrl : undefined,
  simulated: order.provider === "simulated", provider: order.provider,
  expiresAt: order.expiresAt, paidAt: order.paidAt, periodStart: order.periodStart, periodEnd: order.periodEnd,
  invoiceId: order.invoiceId, createdAt: order.createdAt, paymentRef: order.status === "PAID" ? (order.gatewayPaymentId || order.gatewayRef || order.transactionId) : undefined,
  ...extra,
});


// The order's lines with the GST on each, as the order page of ismartparking.com lists them. Any paisa left over
// goes to the largest line so the lines add up to the order's GST.
const withTax = (order) => {
  const cents = (n) => Math.round(n * 100);
  const lines = (order.lines || []).map((l) => (l.toObject ? l.toObject() : l));
  const percent = pricing.PRICING.gstPercent;
  const tax = lines.map((l) => cents((l.taxable * percent) / 100));
  if (lines.length) {
    let biggest = 0;
    lines.forEach((l, i) => { if (l.taxable > lines[biggest].taxable) biggest = i; });
    tax[biggest] += cents(order.gst) - tax.reduce((n, c) => n + c, 0);
  }
  return lines.map((l, i) => ({ ...l, taxPercent: percent, tax: tax[i] / 100, totalWithTax: (cents(l.taxable) + tax[i]) / 100 }));
};

// ---------------------------------------------------------------- the price list

// GET /api/subscriptions/catalog
const catalog = async (req, res) => {
  const prices = await subs.priceList();
  res.json({
    success: true,
    data: {
      addons: prices.map((a) => ({
        key: a.key, label: a.label, kind: a.kind, price: a.price, standardPrice: a.standardPrice, unit: a.unit, noun: a.noun,
        options: a.options, freeMonths: a.freeMonths, description: a.description,
      })),
      userPrice: pricing.PRICING.parkingPerUserMonth, gstPercent: pricing.PRICING.gstPercent, tenures: pricing.PRICING.tenures,
      minUsers: pricing.MIN_USERS, maxUsers: pricing.MAX_USERS, planName: pricing.PLAN_NAME, ...readiness(),
    },
  });
};

// PUT /api/subscriptions/prices   { prices: { pass: 250, ... } }      (Super Admin)
const setPrices = async (req, res) => {
  const wanted = req.body.prices || {};
  const changed = [];
  for (const [key, value] of Object.entries(wanted)) {
    const addon = byKey(key);
    if (!addon) throw new AppError(`Unknown add-on ${key}`, 400);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000000) throw new AppError(`${addon.label}: enter a price from 0 to 1000000`, 400);
    if (value === addon.price) await AddonPrice.deleteOne({ key });
    else await AddonPrice.updateOne({ key }, { $set: { price: value, updatedBy: req.user._id } }, { upsert: true });
    changed.push({ key, price: value });
  }
  await audit.record(req, "ADDON_PRICES_CHANGED", { entity: "AddonPrice", meta: { changed } });
  return catalog(req, res);
};

// ---------------------------------------------------------------- the list

// The subscription that counts now: a bought one that is running, else the trial or earlier plan, else an upcoming one,
// else the one that ended last.
const current = (list, now) => {
  const by = (state, legacy) => list.filter((s) => subs.stateOf(s, now) === state && (legacy === undefined || s.legacy === legacy)).sort((a, b) => b.periodEnd - a.periodEnd)[0];
  return by("ACTIVE", false) || by("ACTIVE") || by("UPCOMING") || list.slice().sort((a, b) => b.periodEnd - a.periodEnd)[0] || null;
};

// GET /api/subscriptions?q=
// One row per location with the subscription that counts now.
const list = async (req, res) => {
  const company = await companyOf(req);
  if (!(await Subscription.exists({ companyId: company._id }))) await subs.grandfather(company);
  const now = new Date();
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60).toLowerCase() : "";
  const [locations, all] = await Promise.all([
    Location.find(req.tenantFilter).sort({ name: 1 }).select("name isActive"),
    Subscription.find(req.tenantFilter),
  ]);
  const rows = locations
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .map((location) => {
      const own = all.filter((s) => String(s.locationId) === String(location._id));
      const chosen = current(own, now);
      return {
        locationId: location._id, locationName: location.name, isActive: location.isActive,
        subscription: chosen ? subView(chosen, now) : null,
        state: chosen ? subs.stateOf(chosen, now) : "NONE",
      };
    });
  res.json({ success: true, data: { rows, ...readiness() } });
};

// ---------------------------------------------------------------- one location

// GET /api/subscriptions/locations/:locationId?q=
const locationDetail = async (req, res) => {
  const company = await companyOf(req);
  const location = await locationOf(req, req.params.locationId);
  if (!(await Subscription.exists({ companyId: company._id }))) await subs.grandfather(company);
  const now = new Date();
  const all = await Subscription.find({ companyId: company._id, locationId: location._id }).sort({ periodEnd: -1 });
  const chosen = current(all, now);
  const orders = await PlanOrder.find({ companyId: company._id, locationId: location._id }).sort({ createdAt: -1 }).limit(500);
  const codeOf = new Map(all.map((s) => [String(s._id), s.code]));
  const entitlement = await subs.entitlement(company._id, location._id, now);
  res.json({
    success: true,
    data: {
      location: { _id: location._id, name: location.name, isActive: location.isActive },
      company: { name: company.name, code: company.code },
      current: chosen ? subView(chosen, now) : null,
      running: all
        .filter((s) => ["ACTIVE", "UPCOMING"].includes(subs.stateOf(s, now)))
        // The trial or earlier plan is not listed once the location has bought a subscription.
        .filter((s, _i, live) => !s.legacy || !live.some((o) => !o.legacy && subs.stateOf(o, now) === "ACTIVE"))
        .map((s) => subView(s, now)),
      orders: orders.map((o) => orderView(o, { subscriptionCode: o.subscriptionId ? codeOf.get(String(o.subscriptionId)) || "" : "", items: (o.lines || []).map((l) => l.label) })),
      usersNow: entitlement.users,
      ...readiness(),
    },
  });
};

// ---------------------------------------------------------------- quotes and orders

// What the body of a quote / purchase must hold; the pieces are checked by the service.
const intOf = (value, name) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new AppError(`${name} must be a whole number`, 400);
  return n;
};

const quoteFor = async (req) => {
  const { kind } = req.body;
  const prices = await subs.priceList();
  if (kind === "PURCHASE") {
    const location = await locationOf(req, req.body.locationId);
    if (!location.isActive) throw new AppError("This location is closed", 409);
    return { kind, location, subscription: null, quote: subs.quoteNew({ users: intOf(req.body.users, "Users"), months: intOf(req.body.months, "Months"), addons: req.body.addons }, prices) };
  }
  const subscription = await Subscription.findOne({ _id: req.body.subscriptionId, ...req.tenantFilter });
  if (!subscription) throw new AppError("Subscription not found", 404);
  if (subscription.legacy) throw new AppError("This is your free trial or earlier plan. Buy a subscription for this location instead.", 409);
  if (subscription.status === "CANCELLED") throw new AppError("This subscription was cancelled", 409);
  const location = await locationOf(req, subscription.locationId);
  if (kind === "RENEWAL") return { kind, location, subscription, quote: subs.quoteRenew(subscription, intOf(req.body.months, "Months"), prices) };
  return { kind, location, subscription, quote: subs.quoteUpdate(subscription, req.body.change || {}, prices) };
};

// POST /api/subscriptions/quote   { kind, locationId | subscriptionId, users, months, addons | change }
const quote = async (req, res) => {
  const { quote: q } = await quoteFor(req);
  res.json({ success: true, data: q });
};

// POST /api/subscriptions/orders   (same body as the quote) -> the order with its payment link
const createOrder = async (req, res) => {
  const company = await companyOf(req);
  const { kind, location, subscription, quote: q } = await quoteFor(req);
  const { order, repeated } = await subs.startOrder({ company, user: req.user, location, kind, subscription, quote: q, req });
  res.status(repeated ? 200 : 201).json({ success: true, data: { order: orderView(order), repeated } });
};

// GET /api/subscriptions/orders/:id    (the order page polls this after the customer pays)
const getOrder = async (req, res) => {
  const order = await PlanOrder.findOne({ _id: req.params.id, ...req.tenantFilter, locationId: { $exists: true } });
  if (!order) throw new AppError("Order not found", 404);
  const company = await companyOf(req);
  const [location, sub, invoice] = await Promise.all([
    Location.findById(order.locationId).select("name"),
    order.subscriptionId ? Subscription.findById(order.subscriptionId).select("code") : null,
    order.invoiceId ? Invoice.findById(order.invoiceId).select("number issuedAt taxType cgst sgst igst total") : null,
  ]);
  res.json({
    success: true,
    data: orderView(order, {
      locationName: location ? location.name : "", subscriptionCode: sub ? sub.code : "", taxLines: withTax(order),
      ...(order.status === "PAID" ? { paymentId: order.gatewayPaymentId || "", gatewayOrderId: order.gatewayRef || "" } : {}),
      invoice: invoice ? { _id: invoice._id, number: invoice.number, issuedAt: invoice.issuedAt, taxType: invoice.taxType, cgst: invoice.cgst, sgst: invoice.sgst, igst: invoice.igst, total: invoice.total } : null,
      seller: billing.sellerDetails(), buyer: billing.buyerDetails(company),
    }),
  });
};

// GET /api/subscriptions/:id    (the renew and update pages)
const getOne = async (req, res) => {
  const sub = await subOf(req);
  const location = await Location.findById(sub.locationId).select("name isActive");
  res.json({ success: true, data: { subscription: subView(sub), location: location ? { _id: location._id, name: location.name, isActive: location.isActive } : null, ...readiness() } });
};

// POST /api/subscriptions/:id/cancel   { reason }
const cancelSubscription = async (req, res) => {
  const sub = await subOf(req);
  if (sub.legacy) throw new AppError("The free trial or earlier plan cannot be cancelled here", 409);
  await subs.cancel({ subscription: sub, user: req.user, reason: String(req.body.reason).trim(), req });
  res.json({ success: true, data: subView(sub) });
};

module.exports = { catalog, setPrices, list, locationDetail, quote, createOrder, getOrder, getOne, cancelSubscription };
