const { escapeRegex } = require("../services/shopService");
const PlanOrder = require("../models/PlanOrder");
const ShopOrder = require("../models/ShopOrder");
const Invoice = require("../models/Invoice");
const Location = require("../models/Location");
const Subscription = require("../models/Subscription");

const STATUSES = ["PAID", "PENDING", "FAILED", "CANCELLED"];
const KIND_TEXT = { PURCHASE: "Subscription purchase", RENEWAL: "Subscription renewal", UPDATE: "License update" };
const MOST = 2000; // of each kind

// Every order of the company that matches the filters, newest first. Subscription orders (one per location),
// the earlier company-wide plan orders and hardware shop orders are listed together. Orders that were never paid
// are included; the status filter separates them.
const collect = async (req) => {
  const companyId = req.companyId;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  const type = typeof req.query.type === "string" ? req.query.type.toUpperCase() : "";
  const byStatus = STATUSES.includes(status) ? { status } : {};
  const pattern = q ? new RegExp(escapeRegex(q), "i") : null;

  const wantLocated = !type || type === "SUBSCRIPTION";
  const wantPlan = (!type || type === "PLAN") && !pattern; // the earlier plan orders have no order number to search
  const wantShop = !type || type === "HARDWARE";

  const [located, plans, shops] = await Promise.all([
    wantLocated ? PlanOrder.find({ companyId, ...byStatus, locationId: { $exists: true }, ...(pattern ? { orderNumber: pattern } : {}) }).sort({ createdAt: -1 }).limit(MOST) : [],
    wantPlan ? PlanOrder.find({ companyId, ...byStatus, locationId: { $exists: false } }).sort({ createdAt: -1 }).limit(MOST) : [],
    wantShop ? ShopOrder.find({ companyId, ...byStatus, number: pattern || { $exists: true } }).sort({ createdAt: -1 }).limit(MOST) : [],
  ]);

  const [invoices, locations, subs] = await Promise.all([
    Invoice.find({ _id: { $in: [...located, ...plans, ...shops].map((o) => o.invoiceId).filter(Boolean) } }).select("number"),
    Location.find({ _id: { $in: located.map((o) => o.locationId) } }).select("name"),
    Subscription.find({ _id: { $in: located.map((o) => o.subscriptionId).filter(Boolean) } }).select("code"),
  ]);
  const invoiceNo = new Map(invoices.map((i) => [String(i._id), i.number]));
  const locationName = new Map(locations.map((l) => [String(l._id), l.name]));
  const subCode = new Map(subs.map((s) => [String(s._id), s.code]));
  const invoiceOf = (o) => ({ invoiceId: o.invoiceId || null, invoiceNumber: o.invoiceId ? invoiceNo.get(String(o.invoiceId)) || "" : "" });

  return [
    ...located.map((o) => ({
      id: o._id, type: "SUBSCRIPTION", number: o.orderNumber || "", createdAt: o.createdAt, status: o.status, amount: o.total, ...invoiceOf(o),
      title: `${KIND_TEXT[o.kind] || "Subscription"}, ${locationName.get(String(o.locationId)) || "Location"}`,
      subscription: o.subscriptionId ? subCode.get(String(o.subscriptionId)) || "" : "",
      items: (o.lines || []).map((l) => l.label), itemCount: 1, quantity: 1, link: `/dashboard/subscriptions/orders/${o._id}`,
    })),
    ...plans.map((o) => ({
      id: o._id, type: "PLAN", number: "", createdAt: o.createdAt, status: o.status, amount: o.total, ...invoiceOf(o),
      title: `${o.planName}, ${o.users} users, ${o.months} month${o.months === 1 ? "" : "s"}`, subscription: "",
      items: [o.planName], itemCount: 1, quantity: 1, link: "/dashboard/billing",
    })),
    ...shops.map((o) => ({
      id: o._id, type: "HARDWARE", number: o.number, createdAt: o.createdAt, status: o.status, amount: o.total, ...invoiceOf(o),
      title: o.lines.map((l) => `${l.qty} × ${l.name}`).join(", "), subscription: "",
      items: o.lines.map((l) => `${l.qty} × ${l.name}`), itemCount: o.lines.length, quantity: o.lines.reduce((n, l) => n + l.qty, 0),
      fulfilment: o.fulfilment, link: `/dashboard/orders/${o._id}`,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);
};

// GET /api/my-orders?q=&status=&type=&page=&limit=
const list = async (req, res) => {
  const limit = [10, 25, 50, 100, 200].includes(Number(req.query.limit)) ? Number(req.query.limit) : 25;
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const rows = await collect(req);
  res.json({ success: true, data: { rows: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit } });
};

// GET /api/my-orders/all?q=&status=&type=     everything that matches, for the Excel and Print buttons
const everything = async (req, res) => {
  const rows = await collect(req);
  res.json({ success: true, data: { rows } });
};

module.exports = { list, everything };
