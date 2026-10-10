// Dashboard > My Orders: subscription, earlier plan and hardware orders in one list, with filters and paging,
// and the per-line GST on a subscription order. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ShopOrder = require("../models/ShopOrder");
const mongoose = require("mongoose");

setup();

const s = {};
const pay = (orderId) => api("POST", `/api/billing/orders/${orderId}/simulate`, { token: s.a.token, body: { outcome: "SUCCESS" } });
const orders = (query = "", token = s.a.token) => api("GET", `/api/my-orders${query}`, { token });
const shopOrder = (number, status) =>
  ShopOrder.create({
    companyId: s.a.company._id, number, status, goods: 1000, gst: 180, total: 1180,
    lines: [{ productId: new mongoose.Types.ObjectId(), name: "Boom barrier", qty: 2, unitPrice: 500, gstPercent: 18, taxable: 1000, gst: 180, total: 1180 }],
    shipTo: { name: "Asha", phone: "9876500001", line1: "MG Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
  });

it("setup: a company with a state and a location, plus staff", async () => {
  Object.assign(process.env, {
    PAYMENT_PROVIDER: "simulated", PAYMENT_WEBHOOK_SECRET: "webhook-secret-0123456789abcdef", EMAIL_PROVIDER: "simulated",
    SELLER_NAME: "Example Parking Tech Pvt Ltd", SELLER_GSTIN: "27AAPFU0939F1ZV", SELLER_ADDRESS: "1 MG Road, Pune, Maharashtra 411001",
    SELLER_SAC: "9983", SELLER_EMAIL: "billing@example.com",
  });
  s.a = await registerCompany("mo-a");
  s.b = await registerCompany("mo-b");
  const put = await api("PUT", `/api/companies/${s.a.company._id}`, {
    token: s.a.token, body: { legalName: "Alpha Parking LLP", address: { line1: "5 Station Road", city: "Pune", state: "Maharashtra", pincode: "411001" } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Main", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.main = loc.body.data;
  const staff = await api("POST", "/api/users", { token: s.a.token, body: { name: "Gate", email: "mo-entry@example.com", password: "Password123", role: "ENTRY_OPERATOR", locationIds: [s.main._id] } });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  s.entry = await login("mo-entry@example.com");
});

it("it needs a login, a company and the right to manage it", async () => {
  assert.equal((await api("GET", "/api/my-orders")).status, 401);
  assert.equal((await orders("", s.entry)).status, 403);
  const empty = await orders();
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(empty.body.data.rows, []);
  assert.equal(empty.body.data.total, 0);
});

it("setup: a paid purchase, a waiting renewal, a waiting plan order, and a paid and a waiting hardware order", async () => {
  const made = await api("POST", "/api/subscriptions/orders", {
    token: s.a.token, body: { kind: "PURCHASE", locationId: s.main._id, users: 5, months: 3, addons: { pass: true, photo: true } },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.purchase = made.body.data.order;
  assert.equal((await pay(s.purchase._id)).status, 200);
  const sub = (await api("GET", "/api/subscriptions", { token: s.a.token })).body.data.rows[0].subscription;
  const renewal = await api("POST", "/api/subscriptions/orders", { token: s.a.token, body: { kind: "RENEWAL", subscriptionId: sub._id, months: 1 } });
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
  s.renewal = renewal.body.data.order;
  const plan = await api("POST", "/api/billing/checkout", { token: s.a.token, body: { users: 2, months: 1 } });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  await shopOrder("HW-1001", "PAID");
  await shopOrder("HW-1002", "PENDING");
});

it("the list holds every kind of order, newest first, with the invoice number of paid ones", async () => {
  const res = await orders();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.equal(d.total, 5);
  assert.deepEqual(d.rows.map((r) => r.type).sort(), ["HARDWARE", "HARDWARE", "PLAN", "SUBSCRIPTION", "SUBSCRIPTION"]);
  for (let i = 1; i < d.rows.length; i += 1) assert.ok(new Date(d.rows[i - 1].createdAt) >= new Date(d.rows[i].createdAt), "newest first");
  const bought = d.rows.find((r) => r.number === s.purchase.orderNumber);
  assert.equal(bought.status, "PAID");
  assert.match(bought.invoiceNumber, /^SP\/\d\d-\d\d\/\d{5}$/);
  assert.match(bought.title, /Subscription purchase, Main/);
  assert.equal(bought.link, `/dashboard/subscriptions/orders/${bought.id}`);
  const waiting = d.rows.find((r) => r.number === s.renewal.orderNumber);
  assert.equal(waiting.status, "PENDING");
  assert.equal(waiting.invoiceNumber, "", "no invoice before payment");
  const hardware = d.rows.find((r) => r.number === "HW-1001");
  assert.equal(hardware.quantity, 2);
  assert.equal(hardware.itemCount, 1);
  assert.equal(hardware.amount, 1180);
  assert.equal(hardware.link, `/dashboard/orders/${hardware.id}`);
  assert.equal(d.rows.find((r) => r.type === "PLAN").link, "/dashboard/billing");
});

it("filters: payment status, kind of order and order number", async () => {
  const count = async (query) => (await orders(query)).body.data.total;
  assert.equal(await count("?status=paid"), 2);
  assert.equal(await count("?status=PENDING"), 3);
  assert.equal(await count("?status=failed"), 0);
  assert.equal(await count("?status=whatever"), 5, "an unknown status means all");
  assert.equal(await count("?type=HARDWARE"), 2);
  assert.equal(await count("?type=subscription"), 2);
  assert.equal(await count("?type=PLAN"), 1);
  assert.equal(await count("?type=HARDWARE&status=PAID"), 1);
  assert.equal(await count(`?q=${s.purchase.orderNumber.slice(0, 12)}`), 2, "part of an order number (the purchase and the renewal share the start)");
  assert.equal(await count(`?q=${s.purchase.orderNumber}`), 1, "the whole order number");
  assert.equal(await count("?q=hw-100"), 2, "not case sensitive");
  assert.equal(await count("?q=HW-1002"), 1);
  assert.equal(await count("?q=nothing-like-this"), 0);
  assert.equal(await count("?q=.*"), 0, "typed text is not a pattern");
});

it("paging: Show N entries and the page", async () => {
  const first = (await orders("?limit=10")).body.data;
  assert.equal(first.limit, 10);
  assert.equal(first.rows.length, 5);
  assert.equal((await orders("?limit=3")).body.data.limit, 25, "only the offered sizes");
  assert.equal((await orders("?limit=10&page=2")).body.data.rows.length, 0);
  assert.equal((await orders("?page=0")).body.data.page, 1);
});

it("everything that matches can be fetched for Excel and Print", async () => {
  const res = await api("GET", "/api/my-orders/all?status=PENDING", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.rows.length, 3);
  assert.equal((await api("GET", "/api/my-orders/all", { token: s.entry })).status, 403);
});

it("another company sees none of these orders", async () => {
  const res = await orders("", s.b.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 0);
});

it("a subscription order shows the GST on each line, adding up to the order's GST, and the payment ids once paid", async () => {
  const paid = await api("GET", `/api/subscriptions/orders/${s.purchase._id}`, { token: s.a.token });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const d = paid.body.data;
  assert.ok(d.taxLines.length >= 3);
  const gst = d.taxLines.reduce((n, l) => n + l.tax, 0);
  assert.equal(Math.round(gst * 100), Math.round(d.gst * 100));
  const total = d.taxLines.reduce((n, l) => n + l.totalWithTax, 0);
  assert.equal(Math.round(total * 100), Math.round(d.total * 100));
  assert.ok(d.taxLines.every((l) => l.taxPercent === 18));
  assert.ok(d.paymentId, "the payment id is shown once paid");
  assert.ok(d.gatewayOrderId !== undefined);

  const waiting = await api("GET", `/api/subscriptions/orders/${s.renewal._id}`, { token: s.a.token });
  assert.equal(waiting.body.data.paymentId, undefined);
});
