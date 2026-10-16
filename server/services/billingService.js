// Buying a plan: quote, online payment, activation and the GST invoice.
//
//   checkout ─► PlanOrder PENDING + a Razorpay payment link
//                  │
//   paid (webhook, or the sweep asked the gateway) ─► order PAID ─► company plan ACTIVE for the bought
//                  │                                               months ─► invoice issued and emailed
//                  └─► FAILED (the gateway said so)
//
// Rules this file keeps (the same as for parking payments):
//  * The money is truth. A payment that arrives for an order we had given up on (failed, cancelled)
//    still activates the plan: the customer really paid.
//  * Results can arrive twice, late or out of order. The order only moves out of a waiting state once,
//    and every step after it (apply to the company, issue the invoice) is safe to repeat.
//  * A payment for the wrong amount never activates anything; an admin is alerted to refund it.
//
// A new purchase starts when the current paid period ends (a renewal), or now for a trial or an
// expired plan. The number of users bought applies at once.

const AppError = require("../utils/AppError");
const env = require("../config/env");
const pricing = require("../config/pricing");
const { stateOf, isGstin, splitTax, financialYear, round2 } = require("../utils/gst");
const { localDateText, addMonthsLocal } = require("../utils/time");
const audit = require("./auditService");
const { notify } = require("./notificationService");
const emailService = require("./emailService");
const { buildInvoicePdf } = require("../utils/invoicePdf");
const gateway = require("../integrations/payment");
const Company = require("../models/Company");
const User = require("../models/User");
const PlanOrder = require("../models/PlanOrder");
const Invoice = require("../models/Invoice");

const SYSTEM_REQ = Object.freeze({ headers: {}, ip: "system" });
const sameAmount = (a, b) => Math.abs(a - b) <= 0.005;
const linkHours = () => Math.min(72, Math.max(1, Number(process.env.BILLING_LINK_HOURS) || 24));
// An order can still be paid, and counted, in these states.
const OPEN = ["PENDING", "FAILED", "CANCELLED"];

// ---- who sells and who buys -------------------------------------------------------------------

// Details printed on every invoice. Set these in server/.env (see docs/billing.md).
const sellerDetails = () => {
  const value = (key) => String(process.env[key] || "").trim();
  const gstin = value("SELLER_GSTIN").toUpperCase();
  const state = stateOf({ gstin, name: value("SELLER_STATE") });
  return {
    name: value("SELLER_NAME"),
    gstin,
    address: value("SELLER_ADDRESS"),
    state: state && state.name,
    stateCode: state && state.code,
    sac: value("SELLER_SAC"),
    email: value("SELLER_EMAIL"),
  };
};

// Billing can run only when the seller is known well enough to decide the GST: a name and a state.
const sellerProblems = () => {
  const seller = sellerDetails();
  const list = [];
  if (!seller.name) list.push("SELLER_NAME");
  if (!seller.state) list.push("SELLER_STATE (or a valid SELLER_GSTIN)");
  if (seller.gstin && !isGstin(seller.gstin)) list.push("SELLER_GSTIN is not a valid GSTIN");
  return list;
};
const billingReady = () => sellerProblems().length === 0 && Boolean(gateway.provider() && gateway.provider().isConfigured() && gateway.provider().hostedPage);

const buyerDetails = (company) => {
  const a = company.address || {};
  const state = stateOf({ gstin: company.gstNumber, name: a.state });
  return {
    name: company.legalName || company.name,
    gstin: company.gstNumber || "",
    address: [a.line1, a.city, a.state, a.pincode, a.country].filter(Boolean).join(", "),
    state: state && state.name,
    stateCode: state && state.code,
    email: company.billingContact && company.billingContact.email,
    phone: company.billingContact && company.billingContact.phone,
  };
};

// ---- the price ---------------------------------------------------------------------------------

const validateChoice = ({ users, months }) => {
  if (!Number.isInteger(users) || users < pricing.MIN_USERS || users > pricing.MAX_USERS) {
    throw new AppError(`Choose between ${pricing.MIN_USERS} and ${pricing.MAX_USERS} users`, 400);
  }
  if (!pricing.PRICING.tenures.some((t) => t.months === months)) throw new AppError("Choose one of the plan lengths offered", 400);
};

// ---- checkout ----------------------------------------------------------------------------------

const checkout = async ({ company, user, users, months, req }) => {
  validateChoice({ users, months });
  const problems = sellerProblems();
  if (problems.length) throw new AppError("Plan purchase is not set up yet. Please contact support.", 503);
  const chosen = gateway.provider();
  if (!chosen || !chosen.isConfigured() || !chosen.hostedPage) throw new AppError("Online payment is not set up yet. Please contact support.", 503);

  const active = await User.countDocuments({ companyId: company._id, isActive: true, role: { $ne: "GOVERNMENT_OFFICER" } });
  if (active > users) {
    throw new AppError(`You have ${active} active users. Choose at least ${active} users, or deactivate some users first.`, 409);
  }
  if (company.gstNumber && !isGstin(company.gstNumber)) {
    throw new AppError("The GSTIN on your company page does not look right. Fix it, or clear it, then try again.", 400);
  }
  const buyer = buyerDetails(company);
  if (!buyer.state) {
    throw new AppError("Add your company's state (or a GSTIN) on the Company page first, so the GST can be worked out.", 400);
  }

  const price = pricing.planPrice({ users, months });
  const waiting = await PlanOrder.findOne({
    companyId: company._id, locationId: { $exists: false }, status: "PENDING", users, months, total: price.total, payUrl: { $exists: true }, expiresAt: { $gt: new Date() },
    addons: { $exists: true },
  });
  if (waiting) return { order: waiting, repeated: true };

  const order = new PlanOrder({
    companyId: company._id,
    createdBy: user._id,
    planName: pricing.PLAN_NAME,
    users,
    months,
    subtotal: price.subtotal,
    discount: price.discount,
    discountPercent: price.discountPercent,
    gross: price.gross,
    gst: price.gst,
    total: price.total,
    // This plan is priced by users only, so it includes none of the paid add-ons (they are bought per location).
    // The mark also tells subscriptionService.legacyPlanAddons that this order is not one of the older all-inclusive ones.
    addons: { pass: false, photo: false, anpr: 0, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 },
    buyerState: buyer.state,
    buyerStateCode: buyer.stateCode,
  });
  const expiresAt = new Date(Date.now() + linkHours() * 3600 * 1000);
  const made = await chosen.createOrder({
    amount: price.total,
    expiresAt,
    description: `${pricing.PLAN_NAME}: ${users} user${users === 1 ? "" : "s"}, ${months} month${months === 1 ? "" : "s"}`,
    returnUrl: `${env.clientUrl}/dashboard/billing?order=${order._id}`,
    notes: { plan: pricing.PLAN_NAME, order: String(order._id) },
  });
  Object.assign(order, {
    provider: chosen.name,
    transactionId: made.transactionId,
    ...(made.gatewayRef ? { gatewayRef: made.gatewayRef } : {}),
    ...(made.payUrl ? { payUrl: made.payUrl } : {}),
    expiresAt: made.expiresAt || expiresAt,
  });
  await order.save();

  // An older link the buyer is no longer using is closed. (If they pay it anyway it still counts.)
  const older = await PlanOrder.find({ companyId: company._id, locationId: { $exists: false }, status: "PENDING", _id: { $ne: order._id } });
  for (const old of older) {
    await PlanOrder.updateOne({ _id: old._id, status: "PENDING" }, { $set: { status: "CANCELLED", failureReason: "Replaced by a newer order" } });
    const owner = gateway.PROVIDERS[old.provider];
    if (owner && owner.cancel && old.gatewayRef) owner.cancel(old).catch(() => {});
  }
  await audit.record(req, "PLAN_CHECKOUT_STARTED", {
    entity: "PlanOrder", entityId: order._id, companyId: company._id, meta: { users, months, total: price.total },
  });
  return { order, repeated: false };
};

// ---- settling a payment ------------------------------------------------------------------------

// The days an order adds: from the end of the current paid period, or from now.
const periodFor = (company, months, now = new Date()) => {
  const current = company.subscription && company.subscription.currentPeriodEnd;
  const start = company.subscriptionStatus === "ACTIVE" && current && current > now ? current : now;
  return { periodStart: start, periodEnd: addMonthsLocal(start, months) };
};

// Gives an invoice the next number of the financial year and saves it. `fields` is everything printed on it
// except the number and date. One invoice per order: asking again returns the first one.
const issueInvoice = async ({ orderId, companyId, kind = "PLAN", fields }) => {
  const existing = await Invoice.findOne({ orderId });
  if (existing) return { invoice: existing, created: false };

  const now = new Date();
  const fy = financialYear(localDateText(now));
  const prefix = String(process.env.INVOICE_PREFIX || "SP").replace(/[^A-Za-z0-9-]/g, "").slice(0, 6) || "SP";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const last = await Invoice.findOne({ financialYear: fy }).sort({ sequence: -1 }).select("sequence").lean();
    const sequence = (last ? last.sequence : 0) + 1;
    try {
      const invoice = await Invoice.create({
        companyId,
        orderId,
        kind,
        number: `${prefix}/${fy}/${String(sequence).padStart(5, "0")}`,
        financialYear: fy,
        sequence,
        issuedAt: now,
        ...fields,
      });
      return { invoice, created: true };
    } catch (error) {
      if (error.code !== 11000) throw error;
      const again = await Invoice.findOne({ orderId });
      if (again) return { invoice: again, created: false };
      // Another invoice took this number a moment ago: look again.
    }
  }
  throw new Error("Could not choose an invoice number");
};

const nextInvoice = async (order, company) => {
  const seller = sellerDetails();
  const buyer = buyerDetails(company);
  const sellerState = seller.state ? { code: seller.stateCode, name: seller.state } : null;
  // The state fixed when the order was made wins over later edits to the company page.
  const buyerState = order.buyerStateCode ? { code: order.buyerStateCode, name: order.buyerState } : (buyer.state ? { code: buyer.stateCode, name: buyer.state } : null);
  const tax = splitTax({ gst: order.gst, sellerState, buyerState });
  return issueInvoice({
    orderId: order._id,
    companyId: order.companyId,
    kind: "PLAN",
    fields: {
      seller,
      buyer: { ...buyer, state: buyerState && buyerState.name, stateCode: buyerState && buyerState.code },
      description: `${order.planName} plan: ${order.users} user${order.users === 1 ? "" : "s"} for ${order.months} month${order.months === 1 ? "" : "s"}`,
      users: order.users,
      months: order.months,
      periodStart: order.periodStart,
      periodEnd: order.periodEnd,
      subtotal: order.subtotal,
      discount: order.discount,
      taxable: order.gross,
      gstPercent: pricing.PRICING.gstPercent,
      ...tax,
      total: round2(order.gross + order.gst),
      paymentRef: order.gatewayPaymentId || order.gatewayRef || order.transactionId,
    },
  });
};

// Everything that follows a paid order. Safe to repeat.
const finalize = async (order, req) => {
  // An order for one location's subscription is applied there (services/subscriptionService.js).
  if (order.locationId) return require("./subscriptionService").finalize(order, req);
  const company = await Company.findById(order.companyId);
  if (!company) return { company: null };

  const applied = await Company.updateOne(
    { _id: company._id, "subscription.appliedOrders": { $ne: order._id } },
    {
      $set: {
        subscriptionStatus: "ACTIVE",
        "plan.name": order.planName,
        "plan.maxUsers": order.users,
        "plan.maxLocations": Math.max(company.plan.maxLocations || 0, pricing.PAID_MAX_LOCATIONS),
        "onboarding.planSelected": true,
        "subscription.currentPeriodStart": order.periodStart,
        "subscription.currentPeriodEnd": order.periodEnd,
        "subscription.users": order.users,
        "subscription.months": order.months,
        "subscription.lastPaidAt": order.paidAt || new Date(),
      },
      $push: { "subscription.appliedOrders": { $each: [order._id], $slice: -50 } },
    }
  );

  const { invoice, created } = await nextInvoice(order, company);
  if (!order.invoiceId || String(order.invoiceId) !== String(invoice._id)) {
    await PlanOrder.updateOne({ _id: order._id }, { $set: { invoiceId: invoice._id } });
  }

  if (applied.modifiedCount > 0) {
    await audit.record(req, "PLAN_PURCHASED", {
      actor: undefined, entity: "PlanOrder", entityId: order._id, companyId: company._id,
      meta: { users: order.users, months: order.months, total: order.total, invoice: invoice.number },
    });
    await notify({
      companyId: company._id, type: "GENERAL", severity: "info",
      title: "Your plan is active",
      message: `${order.planName}: ${order.users} users until ${localDateText(new Date(order.periodEnd.getTime() - 1))}. Invoice ${invoice.number} is in Billing.`,
      dedupeKey: `plan-paid:${order._id}`,
    });
  }
  if (created) await sendInvoiceEmail({ invoice, company });
  return { company, invoice, applied: applied.modifiedCount > 0 };
};

// To the billing contact and the company admins, with the PDF attached. Background: never fails the payment.
const invoiceRecipients = async (company) => {
  const admins = await User.find({ companyId: company._id, role: "COMPANY_ADMIN", isActive: true }).select("email").lean();
  return [...new Set([company.billingContact && company.billingContact.email, ...admins.map((a) => a.email)].filter(Boolean))];
};
const sendInvoiceEmail = async ({ invoice, company }) => {
  try {
    // Looking up the addresses is awaited; the sending itself runs in the background (and is never allowed to fail the payment).
    emailService.sendInvoice({ to: await invoiceRecipients(company), invoice, company, pdf: buildInvoicePdf(invoice) });
  } catch (error) {
    console.error("Invoice email failed:", error.message);
  }
};

// event: { transactionId, status: "SUCCESS" | "FAILED", gatewayRef?, gatewayPaymentId?, reason?, amount? }
// Returns { outcome: "unknown" | "failed" | "ignored" | "mismatch" | "already" | "success", order?, invoice? }.
const settle = async (event, req = SYSTEM_REQ) => {
  const { transactionId, status, gatewayRef, gatewayPaymentId, reason, amount } = event || {};
  if (typeof transactionId !== "string") return { outcome: "unknown" };
  const existing = await PlanOrder.findOne({ transactionId });
  if (!existing) return { outcome: "unknown" };
  const refs = { ...(gatewayRef ? { gatewayRef } : {}), ...(gatewayPaymentId ? { gatewayPaymentId } : {}) };

  if (status === "FAILED") {
    const failed = await PlanOrder.findOneAndUpdate(
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
    const flagged = await PlanOrder.findOneAndUpdate(
      { _id: existing._id, status: { $in: OPEN } },
      { $set: { status: "FAILED", failureReason: `The gateway reports ${amount}, but the order was for ${existing.total}`, ...refs } },
      { returnDocument: "after" }
    );
    if (flagged) {
      await notify({
        companyId: flagged.companyId, type: "PAYMENT_ISSUE", severity: "critical",
        title: "A plan payment had the wrong amount",
        message: `Order ${flagged.transactionId}: the gateway took ${amount} but the plan costs ${flagged.total}. The plan was not activated. Refund it in the gateway and buy again.`,
        dedupeKey: `plan-mismatch:${flagged._id}`,
      });
      await audit.record(req, "PLAN_PAYMENT_MISMATCH", { entity: "PlanOrder", entityId: flagged._id, companyId: flagged.companyId, meta: { reported: amount, expected: flagged.total } });
    }
    return { outcome: "mismatch", order: flagged || existing };
  }

  const company = await Company.findById(existing.companyId).select("subscriptionStatus subscription").lean();
  const period = !company ? {} : existing.locationId ? await require("./subscriptionService").periodForOrder(existing) : periodFor(company, existing.months);
  const paid = await PlanOrder.findOneAndUpdate(
    { _id: existing._id, status: { $in: OPEN } },
    { $set: { status: "PAID", paidAt: new Date(), ...refs, ...period }, $unset: { failureReason: "" } },
    { returnDocument: "after" }
  );
  if (!paid) {
    // Another call paid it a moment ago.
    const latest = await PlanOrder.findById(existing._id);
    if (latest && latest.status === "PAID") {
      const done = await finalize(latest, req);
      if (done.invoice) latest.invoiceId = done.invoice._id;
      return { outcome: "already", order: latest, invoice: done.invoice };
    }
    return { outcome: "ignored", order: existing };
  }
  if (!company) {
    console.error(`Plan order ${paid._id} was paid but its company no longer exists`);
    return { outcome: "unmatched", order: paid };
  }
  const done = await finalize(paid, req);
  if (done.invoice) paid.invoiceId = done.invoice._id; // finalize saved it; the copy we hand back must show it too
  return { outcome: "success", order: paid, invoice: done.invoice };
};

// Every minute: ask the gateway about links whose result never arrived.
const sweep = async (now = new Date()) => {
  const waiting = await PlanOrder.find({ status: "PENDING", createdAt: { $lte: new Date(now.getTime() - 90 * 1000) } }).sort({ createdAt: 1 }).limit(50);
  let settled = 0;
  for (const order of waiting) {
    const owner = gateway.PROVIDERS[order.provider];
    let known = null;
    try {
      known = owner ? await owner.fetchStatus(order) : null;
    } catch (error) {
      console.error(`Could not ask the gateway about plan order ${order.transactionId}:`, error.message);
    }
    if (known) {
      const result = await settle({ transactionId: order.transactionId, ...known });
      if (["success", "failed", "mismatch"].includes(result.outcome)) settled += 1;
      continue;
    }
    if (order.expiresAt && order.expiresAt <= now) {
      await PlanOrder.updateOne({ _id: order._id, status: "PENDING" }, { $set: { status: "FAILED", failureReason: "Not paid in time" } });
    }
  }
  return { checked: waiting.length, settled };
};

module.exports = {
  OPEN, sellerDetails, sellerProblems, billingReady, buyerDetails, validateChoice, checkout, periodFor, settle, sweep, finalize, nextInvoice, issueInvoice, sendInvoiceEmail,
};
