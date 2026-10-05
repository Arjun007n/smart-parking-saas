// Buying a plan through the API with the simulated gateway: quote, checkout, payment (simulator and signed
// webhook), activation, renewal, GST invoices, and the plan-ending alerts. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, send, bytes, assert } = require("./helpers");
const payments = require("../integrations/payment");
const email = require("../integrations/email");
const emailService = require("../services/emailService");
const { planPrice } = require("../config/pricing");
const { checkSubscriptions } = require("../services/notificationService");
const Company = require("../models/Company");
const PlanOrder = require("../models/PlanOrder");
const Invoice = require("../models/Invoice");
const Notification = require("../models/Notification");

setup();

const s = {};
const SECRET = "webhook-secret-0123456789abcdef";
const DAY = 24 * 60 * 60 * 1000;

const pay = (token, orderId, outcome = "SUCCESS") => api("POST", `/api/billing/orders/${orderId}/simulate`, { token, body: { outcome } });
const signedWebhook = (payload) => {
  const text = JSON.stringify(payload);
  return send("POST", "/api/payments/webhook", {
    headers: { "content-type": "application/json", "x-signature": payments.sign(text, SECRET) }, body: text,
  });
};
const companyOf = (ctx) => Company.findById(ctx.company._id);

it("setup: seller details, a simulated gateway, and two companies in different states", async () => {
  Object.assign(process.env, {
    PAYMENT_PROVIDER: "simulated", PAYMENT_WEBHOOK_SECRET: SECRET, EMAIL_PROVIDER: "simulated",
    SELLER_NAME: "Example Parking Tech Pvt Ltd", SELLER_GSTIN: "27AAPFU0939F1ZV", SELLER_ADDRESS: "1 MG Road, Pune, Maharashtra 411001",
    SELLER_SAC: "9983", SELLER_EMAIL: "billing@example.com",
  });
  s.a = await registerCompany("bill-a");
  s.b = await registerCompany("bill-b");
  const a = await api("PUT", `/api/companies/${s.a.company._id}`, {
    token: s.a.token, body: { legalName: "Alpha Parking LLP", address: { line1: "5 Station Road", city: "Pune", state: "Maharashtra", pincode: "411001" } },
  });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const b = await api("PUT", `/api/companies/${s.b.company._id}`, {
    token: s.b.token, body: { gstNumber: "29AAPFU0939F1ZV", address: { line1: "9 Brigade Road", city: "Bengaluru" } },
  });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  email.outbox.length = 0;
});

it("billing summary: the plan now, the price list, and what can be bought", async () => {
  const res = await api("GET", "/api/billing", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.equal(d.subscription.status, "TRIAL");
  assert.equal(d.ready, true);
  assert.deepEqual(d.notReady, []);
  assert.equal(d.pricing.parkingPerUserMonth, 499);
  assert.equal(d.billTo.state, "Maharashtra");
  assert.deepEqual(d.orders, []);
  assert.deepEqual(d.invoices, []);
});

it("billing needs a login", async () => {
  const none = await api("GET", "/api/billing");
  assert.equal(none.status, 401);
});

it("checkout is refused for a bad choice, and when the state (for GST) is unknown", async () => {
  assert.equal((await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 0, months: 12 } })).status, 400);
  assert.equal((await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 501, months: 12 } })).status, 400);
  assert.equal((await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 2.5, months: 12 } })).status, 400);
  const oddLength = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 2, months: 7 } });
  assert.equal(oddLength.status, 400, "a plan length that is not offered");
  // Company B has a GSTIN, so its state is known from that. Make a company with neither.
  s.c = await registerCompany("bill-c");
  const noState = await api("POST", "/api/billing/checkout", { token: s.c.token, body: { users: 1, months: 1 } });
  assert.equal(noState.status, 400, JSON.stringify(noState.body));
  assert.match(noState.body.message, /state/i);
});

it("checkout without the seller's details or a gateway is a clear 503, not a crash", async () => {
  const name = process.env.SELLER_NAME;
  process.env.SELLER_NAME = "";
  const noSeller = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 1, months: 1 } });
  assert.equal(noSeller.status, 503);
  assert.equal((await api("GET", "/api/billing", { token: s.a.token })).body.data.ready, false);
  process.env.SELLER_NAME = name;

  process.env.PAYMENT_PROVIDER = "generic";
  const noGateway = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 1, months: 1 } });
  assert.equal(noGateway.status, 503);
  process.env.PAYMENT_PROVIDER = "simulated";
});

it("checkout makes an order at the quoted price, and asking again returns the same order", async () => {
  const price = planPrice({ users: 3, months: 12 });
  const first = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 3, months: 12 } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const order = first.body.data.order;
  assert.equal(order.total, price.total);
  assert.equal(order.gst, price.gst);
  assert.equal(order.discount, price.discount);
  assert.equal(order.status, "PENDING");
  assert.equal(order.simulated, true);
  assert.equal(order.payUrl, undefined, "the practice gateway has no page to send the customer to");
  assert.equal(order.transactionId, undefined, "gateway ids stay on the server");
  s.order1 = order;

  const again = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 3, months: 12 } });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.repeated, true);
  assert.equal(again.body.data.order._id, order._id);
});

it("another company cannot see or pay this order", async () => {
  assert.equal((await api("GET", `/api/billing/orders/${s.order1._id}`, { token: s.b.token })).status, 404);
  assert.equal((await pay(s.b.token, s.order1._id)).status, 404);
  assert.equal((await api("GET", `/api/billing/orders/${s.order1._id}`, { token: s.a.token })).status, 200);
});

it("a failed payment closes the order and changes nothing; a new checkout works", async () => {
  const failed = await pay(s.a.token, s.order1._id, "FAILED");
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal(failed.body.data.outcome, "failed");
  assert.equal(failed.body.data.order.status, "FAILED");
  assert.equal((await companyOf(s.a)).subscriptionStatus, "TRIAL");
  const next = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 3, months: 12 } });
  assert.equal(next.status, 201, "a failed order is not reused");
  s.order2 = next.body.data.order;
  assert.notEqual(s.order2._id, s.order1._id);
});

it("paying activates the plan, issues a CGST + SGST invoice (same state) and emails it with the PDF", async () => {
  email.outbox.length = 0;
  const paid = await pay(s.a.token, s.order2._id);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.outcome, "success");
  assert.equal(paid.body.data.order.status, "PAID");

  const company = await companyOf(s.a);
  assert.equal(company.subscriptionStatus, "ACTIVE");
  assert.equal(company.plan.name, "Parking Management");
  assert.equal(company.plan.maxUsers, 3);
  assert.ok(company.plan.maxLocations >= 1000);
  assert.equal(company.onboarding.planSelected, true);
  const end = company.subscription.currentPeriodEnd.getTime();
  assert.ok(end > Date.now() + 360 * DAY && end < Date.now() + 372 * DAY, "about 12 months");
  s.firstEnd = company.subscription.currentPeriodEnd;

  const invoices = await Invoice.find({ companyId: s.a.company._id });
  assert.equal(invoices.length, 1);
  const inv = invoices[0];
  assert.match(inv.number, /^SP\/\d\d-\d\d\/00001$/);
  assert.equal(inv.taxType, "INTRA");
  const price = planPrice({ users: 3, months: 12 });
  assert.equal(inv.cgst + inv.sgst, price.gst);
  assert.equal(inv.igst, 0);
  assert.equal(inv.taxable, price.gross);
  assert.equal(inv.total, price.total);
  assert.equal(inv.buyer.name, "Alpha Parking LLP");
  assert.equal(inv.seller.gstin, "27AAPFU0939F1ZV");
  assert.equal(inv.seller.sac, "9983");
  s.invoiceA = inv;

  await emailService.flush();
  const mail = email.outbox.find((m) => /Invoice SP\//.test(m.subject));
  assert.ok(mail, "the invoice email was sent");
  assert.ok(mail.to.includes("admin-bill-a@example.com"));
  assert.equal(mail.attachments.length, 1);
  assert.match(mail.attachments[0].filename, /^SP-\d\d-\d\d-00001\.pdf$/);
  assert.ok(mail.attachments[0].bytes > 1000);

  const note = await Notification.findOne({ companyId: s.a.company._id, title: "Your plan is active" });
  assert.ok(note, "an in-app note");
});

it("paying the same order again changes nothing (one invoice, same period)", async () => {
  const again = await pay(s.a.token, s.order2._id);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.outcome, "already");
  assert.equal(await Invoice.countDocuments({ companyId: s.a.company._id }), 1);
  assert.equal((await companyOf(s.a)).subscription.currentPeriodEnd.getTime(), s.firstEnd.getTime());
});

it("the invoice can be listed, read and downloaded as a PDF, by its own company only", async () => {
  const summary = await api("GET", "/api/billing", { token: s.a.token });
  assert.equal(summary.body.data.invoices.length, 1);
  assert.equal(summary.body.data.subscription.status, "ACTIVE");
  const id = String(s.invoiceA._id);
  const one = await api("GET", `/api/billing/invoices/${id}`, { token: s.a.token });
  assert.equal(one.status, 200);
  assert.equal(one.body.data.number, s.invoiceA.number);
  const pdf = await bytes("GET", `/api/billing/invoices/${id}/pdf`, { token: s.a.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /attachment; filename="SP-\d\d-\d\d-00001\.pdf"/);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await api("GET", `/api/billing/invoices/${id}`, { token: s.b.token })).status, 404);
  assert.equal((await bytes("GET", `/api/billing/invoices/${id}/pdf`, { token: s.b.token })).status, 404);
});

it("a purchase cannot be for fewer users than are active", async () => {
  const invited = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Gate Staff", email: "bill-a-staff@example.com", password: "Password123", role: "ENTRY_OPERATOR" },
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  // Gate staff cannot open Billing or buy anything.
  const staffToken = await login("bill-a-staff@example.com");
  assert.equal((await api("GET", "/api/billing", { token: staffToken })).status, 403);
  assert.equal((await api("POST", "/api/billing/checkout", { token: staffToken, body: { users: 3, months: 1 } })).status, 403);
  const low = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 1, months: 1 } });
  assert.equal(low.status, 409, JSON.stringify(low.body));
  assert.match(low.body.message, /2 active users/);
});

it("a renewal starts when the paid period ends, and a signed webhook pays it", async () => {
  const price = planPrice({ users: 3, months: 1 });
  const made = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 3, months: 1 } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const order = await PlanOrder.findById(made.body.data.order._id);

  const hook = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: price.total, gatewayPaymentId: "pay_test_1" });
  assert.equal(hook.status, 200, hook.text);

  const paid = await PlanOrder.findById(order._id);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.gatewayPaymentId, "pay_test_1");
  assert.equal(paid.periodStart.getTime(), s.firstEnd.getTime(), "starts when the first period ends");
  const company = await companyOf(s.a);
  assert.equal(company.subscription.currentPeriodEnd.getTime(), paid.periodEnd.getTime());
  assert.ok(company.subscription.currentPeriodEnd > s.firstEnd);
  assert.equal(await Invoice.countDocuments({ companyId: s.a.company._id }), 2);
  const second = await Invoice.findOne({ orderId: order._id });
  assert.match(second.number, /\/00002$/, "numbers run in order");
  assert.equal(second.paymentRef, "pay_test_1");

  // The gateway repeating its webhook does nothing more.
  const repeat = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: price.total });
  assert.equal(repeat.status, 200);
  assert.equal(await Invoice.countDocuments({ companyId: s.a.company._id }), 2);
});

it("a webhook with a bad signature is refused; an unknown order is ignored politely", async () => {
  const text = JSON.stringify({ transactionId: "ORD-X", status: "SUCCESS" });
  const bad = await send("POST", "/api/payments/webhook", { headers: { "content-type": "application/json", "x-signature": "00" }, body: text });
  assert.equal(bad.status, 401);
  const unknown = await signedWebhook({ transactionId: "ORD-DOESNOTEXIST", status: "SUCCESS", amount: 10 });
  assert.equal(unknown.status, 200);
});

it("a payment for the wrong amount does not activate the plan, and an admin is alerted", async () => {
  const made = await api("POST", "/api/billing/checkout", { token: s.b.token, body: { users: 2, months: 3 } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const order = await PlanOrder.findById(made.body.data.order._id);
  const hook = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: order.total - 100 });
  assert.equal(hook.status, 200);
  const after = await PlanOrder.findById(order._id);
  assert.equal(after.status, "FAILED");
  assert.match(after.failureReason, /reports/);
  assert.equal((await companyOf(s.b)).subscriptionStatus, "TRIAL");
  assert.equal(await Invoice.countDocuments({ companyId: s.b.company._id }), 0);
  assert.ok(await Notification.findOne({ companyId: s.b.company._id, type: "PAYMENT_ISSUE" }));
  // The right amount arriving later for the same order still counts (the money is real).
  const late = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: order.total });
  assert.equal(late.status, 200);
  assert.equal((await PlanOrder.findById(order._id)).status, "PAID");
});

it("a buyer in another state is charged IGST, and the invoice uses the GSTIN's state", async () => {
  const company = await companyOf(s.b);
  assert.equal(company.subscriptionStatus, "ACTIVE");
  const inv = await Invoice.findOne({ companyId: s.b.company._id });
  assert.equal(inv.taxType, "INTER");
  assert.equal(inv.cgst, 0);
  assert.equal(inv.sgst, 0);
  assert.equal(inv.igst, planPrice({ users: 2, months: 3 }).gst);
  assert.equal(inv.buyer.state, "Karnataka");
  assert.equal(inv.buyer.gstin, "29AAPFU0939F1ZV");
  assert.match(inv.number, /\/00003$/, "one numbering for the whole seller");
});

it("an older link that was replaced still activates the plan when it is paid", async () => {
  const one = await api("POST", "/api/billing/checkout", { token: s.b.token, body: { users: 2, months: 1 } });
  assert.equal(one.status, 201, JSON.stringify(one.body));
  const two = await api("POST", "/api/billing/checkout", { token: s.b.token, body: { users: 4, months: 1 } });
  assert.equal(two.status, 201);
  assert.equal((await PlanOrder.findById(one.body.data.order._id)).status, "CANCELLED");
  const late = await pay(s.b.token, one.body.data.order._id);
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.equal(late.body.data.outcome, "success");
  assert.equal((await companyOf(s.b)).plan.maxUsers, 2);
});

it("alerts: a plan ending soon warns, and one past its end becomes past due (the gates keep working)", async () => {
  const company = await Company.findById(s.a.company._id);
  company.subscription.currentPeriodEnd = new Date(Date.now() + 3 * DAY);
  await company.save();
  await checkSubscriptions();
  const warn = await Notification.findOne({ companyId: s.a.company._id, type: "SUBSCRIPTION_EXPIRY" });
  assert.ok(warn);
  assert.match(warn.title, /Your plan ends in 3 days/);
  assert.equal(warn.severity, "warning");

  await Notification.deleteMany({ companyId: s.a.company._id, type: "SUBSCRIPTION_EXPIRY" });
  company.subscription.currentPeriodEnd = new Date(Date.now() - DAY);
  await company.save();
  await checkSubscriptions();
  assert.equal((await companyOf(s.a)).subscriptionStatus, "PAST_DUE");
  const overdue = await Notification.findOne({ companyId: s.a.company._id, type: "SUBSCRIPTION_EXPIRY" });
  assert.equal(overdue.severity, "critical");
  const still = await api("GET", "/api/billing", { token: s.a.token });
  assert.equal(still.status, 200, "past due does not lock the admin out");

  // Paying again brings it back, starting now (the old period is over).
  const renew = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 3, months: 3 } });
  assert.equal(renew.status, 201, JSON.stringify(renew.body));
  assert.equal((await pay(s.a.token, renew.body.data.order._id)).body.data.outcome, "success");
  const back = await companyOf(s.a);
  assert.equal(back.subscriptionStatus, "ACTIVE");
  assert.ok(back.subscription.currentPeriodEnd > new Date(Date.now() + 80 * DAY));
});

it("the simulator is refused with a real gateway; the sweep leaves unpaid orders alone", async () => {
  process.env.PAYMENT_PROVIDER = "generic";
  const refused = await pay(s.a.token, s.order1._id);
  assert.equal(refused.status, 409);
  process.env.PAYMENT_PROVIDER = "simulated";
  const swept = await require("../services/billingService").sweep(new Date(Date.now() + 10 * DAY));
  assert.ok(swept.checked >= 0);
});
