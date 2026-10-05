const AppError = require("../utils/AppError");
const pricing = require("../config/pricing");
const billing = require("../services/billingService");
const audit = require("../services/auditService");
const gateway = require("../integrations/payment");
const { buildInvoicePdf } = require("../utils/invoicePdf");
const { utcOffsetMinutes } = require("../utils/time");
const Company = require("../models/Company");
const PlanOrder = require("../models/PlanOrder");
const Invoice = require("../models/Invoice");
const User = require("../models/User");

const companyOf = async (req) => {
  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);
  return company;
};

// What the buyer sees of an order. The gateway's own ids stay on the server.
const orderView = (order) => ({
  _id: order._id,
  planName: order.planName,
  users: order.users,
  months: order.months,
  subtotal: order.subtotal,
  discount: order.discount,
  gross: order.gross,
  gst: order.gst,
  total: order.total,
  status: order.status,
  failureReason: order.failureReason,
  payUrl: order.payUrl && !String(order.payUrl).startsWith("simulated://") ? order.payUrl : undefined,
  simulated: order.provider === "simulated",
  expiresAt: order.expiresAt,
  paidAt: order.paidAt,
  periodStart: order.periodStart,
  periodEnd: order.periodEnd,
  invoiceId: order.invoiceId,
  createdAt: order.createdAt,
});

// GET /api/billing
// The plan now, what can be bought, and the latest orders and invoices.
const summary = async (req, res) => {
  const company = await companyOf(req);
  const [activeUsers, orders, invoices] = await Promise.all([
    User.countDocuments({ companyId: company._id, isActive: true }),
    PlanOrder.find({ companyId: company._id }).sort({ createdAt: -1 }).limit(10),
    Invoice.find({ companyId: company._id, kind: { $ne: "SHOP" } }).sort({ issuedAt: -1 }).limit(50).select("number issuedAt description total periodStart periodEnd taxType"),
  ]);
  const provider = gateway.provider();
  res.json({
    success: true,
    data: {
      subscription: {
        status: company.subscriptionStatus,
        planName: company.plan.name,
        maxUsers: company.plan.maxUsers,
        trialEndsAt: company.trialEndsAt,
        currentPeriodEnd: company.subscription && company.subscription.currentPeriodEnd,
        months: company.subscription && company.subscription.months,
      },
      activeUsers,
      pricing: { ...pricing.PRICING, planName: pricing.PLAN_NAME, minUsers: pricing.MIN_USERS, maxUsers: pricing.MAX_USERS },
      // What is missing before a purchase can work, in words an admin can act on.
      ready: billing.billingReady(),
      notReady: billing.billingReady() ? [] : [
        ...(billing.sellerProblems().length ? ["The seller's details are not set up on the server"] : []),
        ...(provider && provider.isConfigured() && provider.hostedPage ? [] : ["Online payment is not set up on the server"]),
      ],
      billTo: (({ name, gstin, state, address }) => ({ name, gstin, state, address }))(billing.buyerDetails(company)),
      orders: orders.map(orderView),
      invoices,
    },
  });
};

// POST /api/billing/checkout   { users, months }
const startCheckout = async (req, res) => {
  const company = await companyOf(req);
  const { order, repeated } = await billing.checkout({ company, user: req.user, users: req.body.users, months: req.body.months, req });
  res.status(repeated ? 200 : 201).json({ success: true, data: { order: orderView(order), repeated } });
};

const ownOrder = async (req) => {
  const order = await PlanOrder.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!order) throw new AppError("Order not found", 404);
  return order;
};

// GET /api/billing/orders/:id    (the page polls this after the customer comes back from paying)
const getOrder = async (req, res) => {
  const order = await ownOrder(req);
  res.json({ success: true, data: orderView(order) });
};

// POST /api/billing/orders/:id/simulate   { outcome }   Plays the customer's side with the simulated gateway.
const simulateOrder = async (req, res) => {
  const chosen = gateway.provider();
  if (!chosen || !chosen.simulated || !chosen.isConfigured()) {
    throw new AppError("Simulated payments are only available with PAYMENT_PROVIDER=simulated (not in production)", 409);
  }
  const order = await ownOrder(req);
  if (order.provider !== "simulated") throw new AppError("Only a simulated order can be simulated", 409);
  const outcome = req.body.outcome || "SUCCESS";
  const result = await billing.settle({
    transactionId: order.transactionId,
    status: outcome,
    gatewayRef: `SIM-${order.transactionId.slice(-8)}`,
    gatewayPaymentId: `simpay-${order.transactionId.slice(-8)}`,
    ...(outcome === "FAILED" ? { reason: "Declined in the simulator" } : {}),
  }, req);
  res.json({ success: true, data: { outcome: result.outcome, order: orderView(result.order || order) } });
};

const ownInvoice = async (req) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!invoice) throw new AppError("Invoice not found", 404);
  return invoice;
};

// GET /api/billing/invoices/:id
const getInvoice = async (req, res) => {
  res.json({ success: true, data: await ownInvoice(req) });
};

// GET /api/billing/invoices/:id/pdf
const invoicePdf = async (req, res) => {
  const invoice = await ownInvoice(req);
  const pdf = buildInvoicePdf(invoice, { offsetMinutes: utcOffsetMinutes() });
  await audit.record(req, "INVOICE_DOWNLOADED", { entity: "Invoice", entityId: invoice._id, companyId: invoice.companyId });
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${String(invoice.number).replace(/[^A-Za-z0-9-]/g, "-")}.pdf"`,
    "Cache-Control": "private, no-store",
  });
  res.send(pdf);
};

module.exports = { summary, startCheckout, getOrder, simulateOrder, getInvoice, invoicePdf };
