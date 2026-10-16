// Subscriptions of a location (Manage Subscriptions): what one costs, what it allows, and how an order changes it.
//
//   buy      PURCHASE  a new subscription for a location: users, length, add-ons
//   renew    RENEWAL   more months on the same subscription (same users and add-ons)
//   update   UPDATE    more users, more cameras or lanes, or a new add-on for the rest of the period (part-month charge)
//
// Payment, the GST invoice and the "money is truth" rules are those of billingService; this file keeps what is
// specific to a location: the price, the dates, the add-ons a location may use and the old company-wide plan.
//
// Add-ons are checked where they matter (selling a pass, taking a photo, charging online or by FASTag, adding
// a camera). Gates keep working when a subscription ends: only those extra features stop.

const AppError = require("../utils/AppError");
const env = require("../config/env");
const pricing = require("../config/pricing");
const { ADDONS, KEYS, byKey, DAYS_PER_MONTH } = require("../config/addons");
const { isGstin, splitTaxExact, round2 } = require("../utils/gst");
const { addMonthsLocal, DAY } = require("../utils/time");
const audit = require("./auditService");
const { notify } = require("./notificationService");
const gateway = require("../integrations/payment");
const Company = require("../models/Company");
const Location = require("../models/Location");
const User = require("../models/User");
const PlanOrder = require("../models/PlanOrder");
const Subscription = require("../models/Subscription");
const AddonPrice = require("../models/AddonPrice");
const Invoice = require("../models/Invoice");

const OPEN = ["PENDING", "FAILED", "CANCELLED"];
const SYSTEM_REQ = Object.freeze({ headers: {}, ip: "system" });
const linkHours = () => Math.min(72, Math.max(1, Number(process.env.BILLING_LINK_HOURS) || 24));
const billing = () => require("./billingService"); // loaded when used: billingService calls back into this file

// ---- the price list ----------------------------------------------------------------------------

// Every add-on with its price now (a changed price from the Super Admin wins over config/addons.js).
const priceList = async () => {
  const rows = await AddonPrice.find({}).lean();
  const changed = new Map(rows.map((r) => [r.key, r.price]));
  return ADDONS.map((a) => ({ ...a, price: changed.has(a.key) ? changed.get(a.key) : a.price, standardPrice: a.price }));
};
const priceMap = (list) => Object.fromEntries(list.map((a) => [a.key, a]));

// ---- the choice of add-ons ---------------------------------------------------------------------

const whole = (value, name, max) => {
  const n = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new AppError(`${name} must be a whole number from 0 to ${max}`, 400);
  return n;
};

// The add-ons as the form sent them, checked and complete.
const cleanAddons = (input = {}) => {
  const out = {};
  for (const a of ADDONS) {
    const value = input[a.key];
    if (a.kind === "FLAG") out[a.key] = value === true || value === "true" || value === 1;
    else if (a.kind === "COUNT") out[a.key] = whole(value, a.noun, 100);
    else {
      const months = whole(value === undefined ? a.options[0] : value, a.label, 60);
      if (!a.options.includes(months)) throw new AppError(`${a.label}: choose ${a.options.join(", ")} months`, 400);
      out[a.key] = months;
    }
  }
  return out;
};

// Months charged for a backup that keeps data `kept` months.
const chargedMonths = (addon, kept) => Math.max(0, kept - (addon.freeMonths || 0));

const addonLabel = (a, value) => {
  if (a.kind === "COUNT") return `${a.label} (${a.noun}: ${value})`;
  if (a.kind === "RETENTION") return `${a.label} (${value} month${value === 1 ? "" : "s"})`;
  return a.label;
};

// The rows of a price: users first, then the add-ons that are on. `months` multiplies every row.
const rowsFor = ({ users, addons }, prices, months) => {
  const rows = [];
  if (users > 0) rows.push({ key: "users", label: "Users", qty: users, rate: pricing.PRICING.parkingPerUserMonth, months, amount: round2(users * pricing.PRICING.parkingPerUserMonth * months) });
  for (const a of prices) {
    const value = addons[a.key];
    let qty = 0;
    if (a.kind === "FLAG") qty = value ? 1 : 0;
    else if (a.kind === "COUNT") qty = value;
    else qty = chargedMonths(a, value);
    // A backup with no charge (data kept the free month) is still listed when it is part of the plan.
    const listed = qty > 0 || (a.kind === "RETENTION" && value > 0);
    if (listed) rows.push({ key: a.key, label: addonLabel(a, value), qty, rate: a.price, months, amount: round2(qty * a.price * months) });
  }
  return rows;
};

// Adds tenure discount, GST and the totals. The discount is shared out over the rows so each row has its taxable value.
const totals = (rows, discountPercent, gstPercent = pricing.PRICING.gstPercent) => {
  const subtotal = round2(rows.reduce((sum, r) => sum + r.amount, 0));
  const discount = round2((subtotal * discountPercent) / 100);
  const gross = round2(subtotal - discount);
  let left = discount;
  const lines = rows.map((r, i) => {
    const share = i === rows.length - 1 ? left : round2(subtotal ? (discount * r.amount) / subtotal : 0);
    left = round2(left - share);
    return { ...r, discount: share, taxable: round2(r.amount - share) };
  });
  const gst = round2((gross * gstPercent) / 100);
  const cgst = round2(gst / 2);
  return { lines, subtotal, discount, discountPercent, gross, gst, cgst, sgst: round2(gst - cgst), total: round2(gross + gst), gstPercent };
};

const tenureOf = (months) => {
  const tenure = pricing.PRICING.tenures.find((t) => t.months === months);
  if (!tenure) throw new AppError("Choose one of the plan lengths offered", 400);
  return tenure;
};

// ---- quotes ------------------------------------------------------------------------------------

const quoteNew = ({ users, months, addons }, prices) => {
  if (!Number.isInteger(users) || users < pricing.MIN_USERS || users > pricing.MAX_USERS) {
    throw new AppError(`Choose between ${pricing.MIN_USERS} and ${pricing.MAX_USERS} users`, 400);
  }
  const tenure = tenureOf(months);
  const clean = cleanAddons(addons);
  return { users, months, addons: clean, ...totals(rowsFor({ users, addons: clean }, prices, months), tenure.discount) };
};

const quoteRenew = (sub, months, prices) => {
  const tenure = tenureOf(months);
  const addons = cleanAddons(sub.addons && sub.addons.toObject ? sub.addons.toObject() : sub.addons);
  return { users: sub.users, months, addons, ...totals(rowsFor({ users: sub.users, addons }, prices, months), tenure.discount) };
};

const daysLeft = (sub, now = new Date()) => Math.max(0, Math.ceil((sub.periodEnd - now) / DAY));

// What it costs to add users and add-ons for the rest of the period. Nothing can be taken away here.
// `change`: { addUsers, pass, photo, gateway (turn on), addAnpr, addFastag, dataBackup, photoBackup (keep longer) }.
const quoteUpdate = (sub, change, prices, now = new Date()) => {
  const left = daysLeft(sub, now);
  if (sub.status !== "ACTIVE" || left <= 0) throw new AppError("This subscription has ended. Renew it first.", 409);
  if (sub.periodStart > now) throw new AppError("This subscription has not started yet. You can add to it once it starts.", 409);
  const fraction = left / DAYS_PER_MONTH;
  const have = cleanAddons(sub.addons && sub.addons.toObject ? sub.addons.toObject() : sub.addons);
  const addUsers = whole(change.addUsers, "Users to add", pricing.MAX_USERS);
  if (sub.users + addUsers > pricing.MAX_USERS) throw new AppError(`A subscription can have at most ${pricing.MAX_USERS} users`, 400);

  const next = { ...have };
  const extra = { users: addUsers };
  for (const a of ADDONS) {
    if (a.kind === "FLAG") {
      if (change[a.key] === true && !have[a.key]) { next[a.key] = true; extra[a.key] = true; }
    } else if (a.kind === "COUNT") {
      const more = whole(change[a.key === "anpr" ? "addAnpr" : "addFastag"], a.noun, 100);
      if (more > 0) { next[a.key] = have[a.key] + more; extra[a.key] = more; }
    } else if (change[a.key] !== undefined && change[a.key] !== null && change[a.key] !== "") {
      const kept = whole(change[a.key], a.label, 60);
      if (!a.options.includes(kept)) throw new AppError(`${a.label}: choose ${a.options.join(", ")} months`, 400);
      if (kept < have[a.key]) throw new AppError(`${a.label} cannot be shortened in the middle of a period`, 400);
      if (kept > have[a.key]) { next[a.key] = kept; extra[a.key] = kept; }
    }
  }

  const rows = [];
  const part = (key, label, qty, rate) => {
    const amount = round2(qty * rate * fraction);
    rows.push({ key, label, qty, rate, months: round2(fraction), amount });
  };
  if (addUsers > 0) part("users", "Users", addUsers, pricing.PRICING.parkingPerUserMonth);
  for (const a of prices) {
    if (a.kind === "FLAG" && extra[a.key]) part(a.key, a.label, 1, a.price);
    if (a.kind === "COUNT" && extra[a.key]) part(a.key, addonLabel(a, `+${extra[a.key]}`), extra[a.key], a.price);
    if (a.kind === "RETENTION" && extra[a.key]) {
      const more = chargedMonths(a, next[a.key]) - chargedMonths(a, have[a.key]);
      if (more > 0) part(a.key, addonLabel(a, next[a.key]), more, a.price);
    }
  }
  if (rows.length === 0) throw new AppError("Choose something to add", 400);
  return { users: sub.users + addUsers, months: 0, daysLeft: left, addons: next, extra, ...totals(rows, 0) };
};

// ---- what a location may use -------------------------------------------------------------------

const EVERYTHING = Object.freeze({ pass: true, photo: true, anpr: Infinity, fastag: Infinity, gateway: true, dataBackup: 12, photoBackup: 12 });
const NOTHING = Object.freeze({ pass: false, photo: false, anpr: 0, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 });

const mergeAddons = (list) => {
  const out = { ...NOTHING };
  for (const s of list) {
    const a = s.addons || {};
    for (const key of KEYS) {
      if (typeof NOTHING[key] === "boolean") out[key] = out[key] || Boolean(a[key]);
      else out[key] = Math.max(out[key], Number(a[key]) || 0);
    }
  }
  return out;
};

// The subscriptions of a location that are running now (not cancelled, inside their dates).
const running = (companyId, locationId, now = new Date()) =>
  Subscription.find({ companyId, locationId, status: "ACTIVE", periodStart: { $lte: now }, periodEnd: { $gt: now } });

// A location that has no subscription of its own follows the company: the free trial or the old company-wide
// plan allows everything until it ends. Once a company has bought a subscription anywhere, that stops (a
// location added later needs its own).
const companyAllows = (company, now) => {
  if (!company) return false;
  if (company.subscriptionStatus === "TRIAL") return !company.trialEndsAt || company.trialEndsAt > now;
  if (company.subscriptionStatus === "ACTIVE") return Boolean(company.subscription && company.subscription.currentPeriodEnd && company.subscription.currentPeriodEnd > now);
  return false;
};

// What the old company-wide paid plan (POST /api/billing/checkout) includes: the users, and none of the paid add-ons
// (those are bought per location under Manage Subscriptions). Orders made before this rule carry no `addons`; a
// company with such a paid order keeps every add-on, exactly as before. Returns null for "every add-on".
const legacyPlanAddons = async (companyId) => {
  const paid = { companyId, locationId: { $exists: false }, status: "PAID" };
  if (await PlanOrder.exists({ ...paid, addons: { $exists: false } })) return null;
  if (await PlanOrder.exists(paid)) return { ...NOTHING };
  return null;
};

// { state: ACTIVE | ENDED | NONE, addons, users, source }
const entitlement = async (companyId, locationId, now = new Date()) => {
  const all = await running(companyId, locationId, now);
  // A subscription that was bought replaces the free trial or earlier plan of its location.
  const bought = all.filter((s) => !s.legacy);
  const subs = bought.length ? bought : all;
  if (subs.length) {
    return { state: "ACTIVE", addons: mergeAddons(subs), users: Math.max(...subs.map((s) => s.users)), source: "SUBSCRIPTION" };
  }
  if (await Subscription.exists({ companyId, locationId })) return { state: "ENDED", addons: { ...NOTHING }, users: 0, source: "SUBSCRIPTION" };
  if (await Subscription.exists({ companyId, legacy: false })) return { state: "NONE", addons: { ...NOTHING }, users: 0, source: "NONE" };
  const company = await Company.findById(companyId).select("subscriptionStatus trialEndsAt subscription").lean();
  if (companyAllows(company, now)) {
    const limited = company.subscriptionStatus === "ACTIVE" ? await legacyPlanAddons(companyId) : null;
    return { state: "ACTIVE", addons: limited || { ...EVERYTHING }, users: 0, source: "COMPANY" };
  }
  return { state: "ENDED", addons: { ...NOTHING }, users: 0, source: "COMPANY" };
};

const reason = (ent, a) => {
  if (ent.state === "ACTIVE") return `${a.label} is not in this location's subscription. Add it under Manage Subscriptions > View & Add More Addons.`;
  if (ent.state === "NONE") return `This location has no subscription. Buy one under Manage Subscriptions to use ${a.label}.`;
  return `This location's subscription has ended. Renew it under Manage Subscriptions to use ${a.label}.`;
};

// Throws when `locationId` may not use add-on `key`. `need` is how many of a counted add-on will be in use.
const assertAddon = async (companyId, locationId, key, need = 1) => {
  const a = byKey(key);
  const ent = await entitlement(companyId, locationId);
  const have = ent.addons[key];
  const ok = typeof have === "boolean" ? have : have >= need;
  if (ok) return ent;
  if (a.kind === "COUNT" && ent.state === "ACTIVE") {
    throw new AppError(`This location's subscription includes ${have} ${a.noun}. Add more under Manage Subscriptions > View & Add More Addons.`, 403);
  }
  throw new AppError(reason(ent, a), 403);
};

// ---- the old company-wide plan and the trial: one subscription per location ------------------------

const nextCode = async (company) => {
  const count = await Subscription.countDocuments({ companyId: company._id });
  return `${company.code || "CO"}-S${count + 1}`;
};

const createSub = async (company, fields) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await Subscription.create({ companyId: company._id, code: await nextCode(company), ...fields });
    } catch (error) {
      if (error.code !== 11000) throw error;
      if (fields.createdByOrderId) {
        const same = await Subscription.findOne({ createdByOrderId: fields.createdByOrderId });
        if (same) return same;
      }
    }
  }
  throw new Error("Could not choose a subscription code");
};

// Turns the trial or the company-wide paid plan into one subscription per location (every add-on included), so the
// company keeps what it has until it ends. Safe to repeat: a location that has a subscription is left alone.
const grandfather = async (company, now = new Date()) => {
  let start;
  let end;
  let planName;
  if (company.subscriptionStatus === "TRIAL") {
    start = company.createdAt || now;
    end = company.trialEndsAt || new Date(now.getTime() + 14 * DAY);
    planName = "Free trial";
  } else if (company.subscriptionStatus === "ACTIVE" && company.subscription && company.subscription.currentPeriodEnd) {
    start = company.subscription.currentPeriodStart || company.createdAt || now;
    end = company.subscription.currentPeriodEnd;
    planName = company.plan.name || pricing.PLAN_NAME;
  } else {
    return 0;
  }
  if (end <= now) return 0;
  const locations = await Location.find({ companyId: company._id }).select("name userLicence").lean();
  // The trial has every add-on; a paid company-wide plan only what it includes (see legacyPlanAddons).
  const included = company.subscriptionStatus === "ACTIVE" ? await legacyPlanAddons(company._id) : null;
  const addons = included || { pass: true, photo: true, anpr: 1000, fastag: 1000, gateway: true, dataBackup: 12, photoBackup: 12 };
  let made = 0;
  for (const location of locations) {
    if (await Subscription.exists({ companyId: company._id, locationId: location._id })) continue;
    const limit = location.userLicence && typeof location.userLicence.limit === "number" ? location.userLicence.limit : company.plan.maxUsers;
    await createSub(company, {
      locationId: location._id, planName, users: limit || 0, months: company.subscription && company.subscription.months ? company.subscription.months : 0,
      periodStart: start, periodEnd: end, legacy: true,
      addons: { ...addons },
    });
    made += 1;
  }
  return made;
};

// ---- orders ------------------------------------------------------------------------------------

const orderNumber = () => `ORN${Date.now()}${Math.floor(Math.random() * 1000)}`;

// The dates an order buys. A purchase or renewal starts when the subscription's running time ends, or now.
const periodForOrder = async (order, now = new Date()) => {
  if (order.kind === "PURCHASE") {
    const others = await Subscription.find({ companyId: order.companyId, locationId: order.locationId, status: "ACTIVE", legacy: false, periodEnd: { $gt: now } }).sort({ periodEnd: -1 }).limit(1);
    const start = others[0] ? others[0].periodEnd : now;
    return { periodStart: start, periodEnd: addMonthsLocal(start, order.months) };
  }
  const sub = await Subscription.findById(order.subscriptionId).lean();
  if (!sub) return {};
  if (order.kind === "RENEWAL") {
    const start = sub.status === "ACTIVE" && sub.periodEnd > now ? sub.periodEnd : now;
    return { periodStart: start, periodEnd: addMonthsLocal(start, order.months) };
  }
  return { periodStart: sub.periodStart, periodEnd: sub.periodEnd };
};

const summaryFor = (kind, location, quote) => {
  if (kind === "RENEWAL") return `Renewal, ${quote.months} month${quote.months === 1 ? "" : "s"}`;
  if (kind === "UPDATE") return "License update";
  return `Subscription purchase, ${quote.months} month${quote.months === 1 ? "" : "s"}`;
};

// Makes the order and its payment link. `quote` comes from quoteNew / quoteRenew / quoteUpdate.
const startOrder = async ({ company, user, location, kind, subscription, quote, req }) => {
  const b = billing();
  if (b.sellerProblems().length) throw new AppError("Plan purchase is not set up yet. Please contact support.", 503);
  const chosen = gateway.provider();
  if (!chosen || !chosen.isConfigured() || !chosen.hostedPage) throw new AppError("Online payment is not set up yet. Please contact support.", 503);
  if (company.gstNumber && !isGstin(company.gstNumber)) {
    throw new AppError("The GSTIN on your company page does not look right. Fix it, or clear it, then try again.", 400);
  }
  const buyer = b.buyerDetails(company);
  if (!buyer.state) throw new AppError("Add your company's state (or a GSTIN) on the Company page first, so the GST can be worked out.", 400);
  if (quote.total <= 0) throw new AppError("There is nothing to pay for", 400);

  // Paying the same quote twice in a row gives the same link back.
  const same = await PlanOrder.findOne({
    companyId: company._id, locationId: location._id, kind, subscriptionId: subscription ? subscription._id : { $exists: false },
    status: "PENDING", total: quote.total, months: quote.months, payUrl: { $exists: true }, expiresAt: { $gt: new Date() },
    ...(kind === "UPDATE" && subscription ? { quotedPeriodEnd: subscription.periodEnd } : {}),
  });
  if (same && JSON.stringify(same.addons || null) === JSON.stringify(quote.addons || null)) return { order: same, repeated: true };

  const order = new PlanOrder({
    companyId: company._id, createdBy: user._id, planName: pricing.PLAN_NAME, kind, locationId: location._id,
    ...(subscription ? { subscriptionId: subscription._id } : {}),
    orderNumber: orderNumber(), users: quote.users, months: kind === "UPDATE" ? 0 : quote.months,
    subtotal: quote.subtotal, discount: quote.discount, discountPercent: quote.discountPercent, gross: quote.gross, gst: quote.gst, total: quote.total,
    lines: quote.lines, addons: kind === "UPDATE" ? { ...quote.extra, resulting: quote.addons } : quote.addons,
    ...(kind === "UPDATE" && subscription ? { quotedPeriodEnd: subscription.periodEnd } : {}),
    buyerState: buyer.state, buyerStateCode: buyer.stateCode,
  });
  const expiresAt = new Date(Date.now() + linkHours() * 3600 * 1000);
  const made = await chosen.createOrder({
    amount: quote.total, expiresAt,
    description: `${pricing.PLAN_NAME}, ${location.name}: ${summaryFor(kind, location, quote)}`,
    returnUrl: `${env.clientUrl}/dashboard/subscriptions/orders/${order._id}`,
    notes: { plan: pricing.PLAN_NAME, order: String(order._id), kind },
  });
  Object.assign(order, {
    provider: chosen.name, transactionId: made.transactionId,
    ...(made.gatewayRef ? { gatewayRef: made.gatewayRef } : {}), ...(made.payUrl ? { payUrl: made.payUrl } : {}), expiresAt: made.expiresAt || expiresAt,
  });
  await order.save();

  const older = await PlanOrder.find({
    companyId: company._id, locationId: location._id, kind, status: "PENDING", _id: { $ne: order._id },
    ...(subscription ? { subscriptionId: subscription._id } : {}),
  });
  for (const old of older) {
    await PlanOrder.updateOne({ _id: old._id, status: "PENDING" }, { $set: { status: "CANCELLED", failureReason: "Replaced by a newer order" } });
    const owner = gateway.PROVIDERS[old.provider];
    if (owner && owner.cancel && old.gatewayRef) owner.cancel(old).catch(() => {});
  }
  await audit.record(req, "SUBSCRIPTION_ORDER_STARTED", {
    entity: "PlanOrder", entityId: order._id, companyId: company._id, meta: { kind, location: location.name, total: quote.total, orderNumber: order.orderNumber },
  });
  return { order, repeated: false };
};

// ---- after a payment ---------------------------------------------------------------------------

// The company-level numbers other parts of the site read: status, paid-until date and the user cap.
const refreshCompany = async (companyId, now = new Date()) => {
  const company = await Company.findById(companyId).select("subscriptionStatus plan subscription").lean();
  if (!company) return;
  const live = await Subscription.find({ companyId, status: "ACTIVE", periodEnd: { $gt: now }, legacy: false }).select("users periodStart periodEnd").lean();
  if (!live.length) return;
  const sumUsers = live.reduce((sum, s) => sum + s.users, 0);
  const set = {
    "plan.name": pricing.PLAN_NAME,
    "plan.maxUsers": Math.max(company.plan.maxUsers || 0, sumUsers),
    "plan.maxLocations": Math.max(company.plan.maxLocations || 0, pricing.PAID_MAX_LOCATIONS),
    "onboarding.planSelected": true,
    "subscription.currentPeriodStart": new Date(Math.min(...live.map((s) => s.periodStart.getTime()))),
    "subscription.currentPeriodEnd": new Date(Math.max(...live.map((s) => s.periodEnd.getTime()))),
    "subscription.users": sumUsers,
    "subscription.lastPaidAt": now,
  };
  if (["TRIAL", "PAST_DUE"].includes(company.subscriptionStatus)) set.subscriptionStatus = "ACTIVE";
  await Company.updateOne({ _id: companyId }, { $set: set });
};

// The seats of a location follow its subscription's users.
const setLicence = (locationId, users) => Location.updateOne({ _id: locationId }, { $set: { "userLicence.limit": users } });

// An UPDATE order is priced for the rest of the period it was quoted in. True when it was paid after that period
// changed (a renewal moved the end date), so its absolute add-on numbers must not be applied.
const isStaleUpdate = (order, sub) => {
  if (!order || order.kind !== "UPDATE" || !order.quotedPeriodEnd || !sub) return false;
  const applied = (sub.appliedOrders || []).some((id) => String(id) === String(order._id));
  return !applied && new Date(order.quotedPeriodEnd).getTime() !== new Date(sub.periodEnd).getTime();
};

// Marks a paid order as not applied and tells the admins, so the money can be refunded in the gateway.
const supersedeOrder = async (order, req) => {
  const why = "The subscription was renewed or changed after this update was quoted, so it was not applied.";
  const marked = await PlanOrder.updateOne({ _id: order._id, superseded: { $ne: true } }, { $set: { superseded: true, failureReason: why } });
  if (marked.modifiedCount > 0) {
    await audit.record(req, "SUBSCRIPTION_ORDER_SUPERSEDED", { entity: "PlanOrder", entityId: order._id, companyId: order.companyId, meta: { orderNumber: order.orderNumber, total: order.total } });
  }
  await notify({
    companyId: order.companyId, locationId: order.locationId, type: "PAYMENT_ISSUE", severity: "critical",
    title: "A subscription update was paid but not applied",
    message: `Order ${order.orderNumber} was paid after the subscription was renewed, so the update was not applied. Make a new update, and ask support to refund order ${order.orderNumber}.`,
    dedupeKey: `plan-superseded:${order._id}`,
  });
};

// A renewal is applied: payment links for updates quoted in the old period are closed.
const cancelOpenUpdates = async (subscriptionId) => {
  const open = await PlanOrder.find({ subscriptionId, kind: "UPDATE", status: "PENDING" });
  for (const old of open) {
    await PlanOrder.updateOne({ _id: old._id, status: "PENDING" }, { $set: { status: "CANCELLED", failureReason: "The subscription was renewed. Make a new update." } });
    const owner = gateway.PROVIDERS[old.provider];
    if (owner && owner.cancel && old.gatewayRef) owner.cancel(old).catch(() => {});
  }
};

// Applies a paid order to the location's subscription. Safe to repeat. Returns { superseded: true } when an UPDATE
// order was not applied because the subscription's period changed since the quote.
const applyOrder = async (order, company, req = SYSTEM_REQ) => {
  if (order.kind === "PURCHASE") {
    await grandfather(company);
    let sub = await Subscription.findOne({ createdByOrderId: order._id });
    if (!sub) {
      const a = order.addons || {};
      sub = await createSub(company, {
        locationId: order.locationId, planName: order.planName, users: order.users, months: order.months,
        periodStart: order.periodStart, periodEnd: order.periodEnd, createdByOrderId: order._id, appliedOrders: [order._id],
        addons: { pass: !!a.pass, photo: !!a.photo, anpr: a.anpr || 0, fastag: a.fastag || 0, gateway: !!a.gateway, dataBackup: a.dataBackup ?? 1, photoBackup: a.photoBackup || 0 },
      });
      await setLicence(order.locationId, order.users);
    }
    if (!order.subscriptionId || String(order.subscriptionId) !== String(sub._id)) {
      await PlanOrder.updateOne({ _id: order._id }, { $set: { subscriptionId: sub._id } });
    }
  } else if (order.kind === "RENEWAL") {
    const sub = await Subscription.findById(order.subscriptionId);
    if (sub) {
      const set = { periodEnd: order.periodEnd, months: order.months };
      // A subscription that had already ended starts again at the order's first day.
      if (order.periodStart > sub.periodEnd) set.periodStart = order.periodStart;
      const renewed = await Subscription.updateOne({ _id: sub._id, appliedOrders: { $ne: order._id } }, { $set: set, $push: { appliedOrders: order._id } });
      if (renewed.modifiedCount > 0) await cancelOpenUpdates(sub._id);
    }
  } else if (order.kind === "UPDATE") {
    const current = await Subscription.findById(order.subscriptionId).select("+appliedOrders periodEnd").lean();
    if (isStaleUpdate(order, current)) {
      await supersedeOrder(order, req);
      return { superseded: true };
    }
    const result = (order.addons && order.addons.resulting) || {};
    const set = { users: order.users };
    for (const key of KEYS) if (result[key] !== undefined) set[`addons.${key}`] = result[key];
    const changed = await Subscription.updateOne({ _id: order.subscriptionId, appliedOrders: { $ne: order._id } }, { $set: set, $push: { appliedOrders: order._id } });
    if (changed.modifiedCount > 0) {
      const sub = await Subscription.findById(order.subscriptionId).select("locationId").lean();
      if (sub) await setLicence(sub.locationId, order.users);
    }
  }
  await refreshCompany(order.companyId);
};

// The GST invoice of a paid location order: one row per item.
const invoiceFor = async (order, company) => {
  const b = billing();
  const location = await Location.findById(order.locationId).select("name").lean();
  const seller = b.sellerDetails();
  const buyer = b.buyerDetails(company);
  const sellerState = seller.state ? { code: seller.stateCode, name: seller.state } : null;
  const buyerState = order.buyerStateCode ? { code: order.buyerStateCode, name: order.buyerState } : (buyer.state ? { code: buyer.stateCode, name: buyer.state } : null);
  const tax = splitTaxExact({ gst: order.gst, sellerState, buyerState });
  const sub = order.subscriptionId ? await Subscription.findById(order.subscriptionId).select("code").lean() : null;
  const what = { PURCHASE: "subscription", RENEWAL: "subscription renewal", UPDATE: "subscription update" }[order.kind];
  return b.issueInvoice({
    orderId: order._id,
    companyId: order.companyId,
    kind: "PLAN",
    fields: {
      seller, buyer: { ...buyer, state: buyerState && buyerState.name, stateCode: buyerState && buyerState.code },
      description: `${order.planName} ${what}${sub ? ` ${sub.code}` : ""}: ${location ? location.name : "location"}`,
      lines: (order.lines || []).map((l) => ({
        description: l.label, qty: l.qty, rate: l.rate, taxable: l.taxable, gstPercent: pricing.PRICING.gstPercent,
        amount: round2(l.taxable + (l.taxable * pricing.PRICING.gstPercent) / 100),
      })),
      users: order.users, months: order.months, periodStart: order.periodStart, periodEnd: order.periodEnd,
      subtotal: order.subtotal, discount: order.discount, taxable: order.gross, gstPercent: pricing.PRICING.gstPercent, ...tax,
      total: round2(order.gross + order.gst), paymentRef: order.gatewayPaymentId || order.gatewayRef || order.transactionId,
    },
  });
};

// Everything that follows a paid location order (called by billingService.finalize). Safe to repeat.
const finalize = async (order, req) => {
  const company = await Company.findById(order.companyId);
  if (!company) return { company: null };
  const applied = await applyOrder(order, company, req);
  // Paid but not applied (see isStaleUpdate): no invoice for something that was not supplied; the money is refunded.
  if (applied && applied.superseded) return { company, applied: false };
  const { invoice, created } = await invoiceFor(order, company);
  if (!order.invoiceId || String(order.invoiceId) !== String(invoice._id)) {
    await PlanOrder.updateOne({ _id: order._id }, { $set: { invoiceId: invoice._id } });
  }
  if (created) {
    await audit.record(req, "SUBSCRIPTION_PAID", {
      actor: undefined, entity: "PlanOrder", entityId: order._id, companyId: company._id,
      meta: { kind: order.kind, total: order.total, invoice: invoice.number, orderNumber: order.orderNumber },
    });
    await notify({
      companyId: company._id, type: "GENERAL", severity: "info", title: "Your subscription is updated",
      message: `Order ${order.orderNumber} is paid. Invoice ${invoice.number} is in Manage Subscriptions.`, dedupeKey: `plan-paid:${order._id}`,
    });
    await billing().sendInvoiceEmail({ invoice, company });
  }
  return { company, invoice, applied: created };
};

// ---- cancelling --------------------------------------------------------------------------------

const cancel = async ({ subscription, user, reason: why, req }) => {
  if (subscription.status === "CANCELLED") throw new AppError("This subscription is already cancelled", 409);
  Object.assign(subscription, { status: "CANCELLED", cancelReason: why, cancelledBy: user._id, cancelledAt: new Date() });
  await subscription.save();
  await audit.record(req, "SUBSCRIPTION_CANCELLED", {
    entity: "Subscription", entityId: subscription._id, companyId: subscription.companyId, meta: { code: subscription.code, reason: why },
  });
  return subscription;
};

// How a subscription stands now: ACTIVE, UPCOMING, EXPIRED or CANCELLED.
const stateOf = (sub, now = new Date()) => {
  if (sub.status === "CANCELLED") return "CANCELLED";
  if (sub.periodEnd <= now) return "EXPIRED";
  if (sub.periodStart > now) return "UPCOMING";
  return "ACTIVE";
};

module.exports = {
  OPEN, priceList, priceMap, cleanAddons, chargedMonths, rowsFor, totals, quoteNew, quoteRenew, quoteUpdate, daysLeft,
  entitlement, assertAddon, grandfather, periodForOrder, startOrder, finalize, applyOrder, refreshCompany, cancel, stateOf, running, mergeAddons, companyAllows, createSub, legacyPlanAddons, isStaleUpdate,
};
