// Manage Subscriptions (a subscription for each location): the price list, buying, paying with the simulated
// gateway, GST invoices, renewing, adding users and add-ons, cancelling, what each add-on unlocks, and the
// Super Admin's prices. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const Company = require("../models/Company");
const Hardware = require("../models/Hardware");
const Invoice = require("../models/Invoice");
const Location = require("../models/Location");
const PlanOrder = require("../models/PlanOrder");
const Subscription = require("../models/Subscription");
const User = require("../models/User");

setup();

const s = {};
const DAY = 86400000;

const pay = (token, orderId, outcome = "SUCCESS") => api("POST", `/api/billing/orders/${orderId}/simulate`, { token, body: { outcome } });
const order = (body, token = s.a.token) => api("POST", "/api/subscriptions/orders", { token, body });
const quote = (body, token = s.a.token) => api("POST", "/api/subscriptions/quote", { token, body });
const sellPass = (locationId, vehicleNumber, token = s.a.token) =>
  api("POST", "/api/passes", { token, body: { locationId, vehicleType: "CAR", holderName: "Asha Rao", months: 1, amount: 1000, method: "CASH", vehicleNumber } });
const camera = (locationId, name, type = "ANPR_CAMERA") =>
  api("POST", "/api/hardware", { token: s.a.token, body: { locationId, name, type, direction: "BOTH" } });

// Buys and pays for a subscription; returns the subscription row from the list.
const buy = async (locationId, body) => {
  const made = await order({ kind: "PURCHASE", locationId, ...body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const paid = await pay(s.a.token, made.body.data.order._id);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.order.status, "PAID");
  const list = await api("GET", "/api/subscriptions", { token: s.a.token });
  return { order: made.body.data.order, row: list.body.data.rows.find((r) => r.locationId === locationId) };
};

it("setup: seller details, a simulated gateway, two companies, two locations, staff and a Super Admin", async () => {
  Object.assign(process.env, {
    PAYMENT_PROVIDER: "simulated", PAYMENT_WEBHOOK_SECRET: "webhook-secret-0123456789abcdef", EMAIL_PROVIDER: "simulated",
    SELLER_NAME: "Example Parking Tech Pvt Ltd", SELLER_GSTIN: "27AAPFU0939F1ZV", SELLER_ADDRESS: "1 MG Road, Pune, Maharashtra 411001",
    SELLER_SAC: "9983", SELLER_EMAIL: "billing@example.com",
  });
  s.a = await registerCompany("sub-a");
  s.b = await registerCompany("sub-b");
  const put = await api("PUT", `/api/companies/${s.a.company._id}`, {
    token: s.a.token, body: { legalName: "Alpha Parking LLP", address: { line1: "5 Station Road", city: "Pune", state: "Maharashtra", pincode: "411001" } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const make = async (name) => {
    const res = await api("POST", "/api/locations", { token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
  };
  s.main = await make("Main");
  s.annex = await make("Annex");
  s.other = (await api("POST", "/api/locations", { token: s.b.token, body: { name: "Elsewhere", address: { line1: "Ring Road" }, capacity: { car: 5 } } })).body.data;
  const staff = (name, email, role, locationIds) => api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds } });
  assert.equal((await staff("Gate", "sub-entry@example.com", "ENTRY_OPERATOR", [s.main._id])).status, 201);
  assert.equal((await staff("Site", "sub-site@example.com", "LOCATION_ADMIN", [s.main._id])).status, 201);
  s.entry = await login("sub-entry@example.com");
  s.site = await login("sub-site@example.com");
  await User.create({ name: "Root", email: "root-sub@platform.test", password: "RootPassword123", role: "SUPER_ADMIN" });
  s.root = await login("root-sub@platform.test", "RootPassword123");
});

it("the price list: seven add-ons for the company's managers and the Super Admin, nobody else", async () => {
  const res = await api("GET", "/api/subscriptions/catalog", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.deepEqual(d.addons.map((a) => a.key), ["pass", "photo", "anpr", "fastag", "gateway", "dataBackup", "photoBackup"]);
  assert.equal(d.userPrice, 499);
  assert.equal(d.gstPercent, 18);
  assert.equal(d.ready, true);
  assert.equal(d.addons.find((a) => a.key === "photoBackup").price, 800);
  assert.equal((await api("GET", "/api/subscriptions/catalog", { token: s.root })).status, 200);
  assert.equal((await api("GET", "/api/subscriptions/catalog", { token: s.entry })).status, 403, "gate staff");
  assert.equal((await api("GET", "/api/subscriptions/catalog", { token: s.site })).status, 403, "a location admin does not buy");
  assert.equal((await api("GET", "/api/subscriptions/catalog")).status, 401);
});

it("the list: each location shows the free trial as a subscription that includes everything", async () => {
  const res = await api("GET", "/api/subscriptions", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.rows.map((r) => r.locationName), ["Annex", "Main"]);
  for (const row of res.body.data.rows) {
    assert.equal(row.state, "ACTIVE");
    assert.equal(row.subscription.legacy, true);
  }
  assert.equal((await api("GET", "/api/subscriptions?q=ann", { token: s.a.token })).body.data.rows.length, 1);
  const b = await api("GET", "/api/subscriptions", { token: s.b.token });
  assert.deepEqual(b.body.data.rows.map((r) => r.locationName), ["Elsewhere"], "only the company's own locations");
});

it("a quote: totals, and every bad choice is refused", async () => {
  const ok = await quote({ kind: "PURCHASE", locationId: s.main._id, users: 10, months: 1, addons: { pass: true, photo: true, photoBackup: 1 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.subtotal, 6540);
  assert.equal(ok.body.data.gst, 1177.2);
  assert.equal(ok.body.data.total, 7717.2);
  const bad = (body) => quote({ kind: "PURCHASE", locationId: s.main._id, users: 5, months: 1, addons: {}, ...body });
  assert.equal((await bad({ users: 0 })).status, 400);
  assert.equal((await bad({ users: 501 })).status, 400);
  assert.equal((await bad({ months: 7 })).status, 400, "a length that is not offered");
  assert.equal((await bad({ addons: { dataBackup: 2 } })).status, 400);
  assert.equal((await bad({ addons: { anpr: -1 } })).status, 400);
  assert.equal((await bad({ kind: "SOMETHING" })).status, 400);
  assert.equal((await bad({ locationId: s.other._id })).status, 404, "another company's location");
  assert.equal((await quote({ kind: "PURCHASE", locationId: s.main._id, users: 5, months: 1, addons: {} }, s.entry)).status, 403);
  assert.equal((await quote({ kind: "PURCHASE", locationId: s.main._id, users: 5, months: 1, addons: {} }, s.site)).status, 403);
});

it("buying: a company without a state cannot be taxed, so the order is refused with a clear message", async () => {
  const none = await api("POST", "/api/locations", { token: s.b.token, body: { name: "Second", address: { line1: "Ring Road" }, capacity: { car: 5 } } });
  const res = await api("POST", "/api/subscriptions/orders", {
    token: s.b.token, body: { kind: "PURCHASE", locationId: none.body.data._id, users: 2, months: 1, addons: {} },
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.message, /state/i);
});

it("buying a subscription for Main: pay, then the subscription, licence, company plan and GST invoice are made", async () => {
  const body = { kind: "PURCHASE", locationId: s.main._id, users: 5, months: 3, addons: { pass: true, anpr: 1 } };
  const made = await order(body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const o = made.body.data.order;
  s.mainOrder = o;
  assert.equal(o.status, "PENDING");
  assert.equal(o.subtotal, 9735, "(5 x 499 + 250 + 500) x 3");
  assert.equal(o.discount, 486.75, "5% for three months");
  assert.equal(o.gross, 9248.25);
  assert.ok(o.orderNumber.startsWith("ORN"));
  assert.ok(o.lines.length >= 3);

  const again = await order(body);
  assert.equal(again.status, 200, "the same choice gives the same open order");
  assert.equal(again.body.data.repeated, true);
  assert.equal(again.body.data.order._id, o._id);

  assert.equal((await api("GET", `/api/subscriptions/orders/${o._id}`, { token: s.b.token })).status, 404, "another company's order");
  const failed = await pay(s.a.token, o._id, "FAILED");
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal(await Subscription.countDocuments({ companyId: s.a.company._id, legacy: false }), 0, "a failed payment buys nothing");

  const retry = await order(body);
  const paid = await pay(s.a.token, retry.body.data.order._id);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.order.status, "PAID");
  s.mainOrder = paid.body.data.order;

  const view = await api("GET", `/api/subscriptions/orders/${s.mainOrder._id}`, { token: s.a.token });
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.data.status, "PAID");
  assert.equal(view.body.data.locationName, "Main");
  assert.ok(view.body.data.invoice, "an invoice was issued");
  assert.equal(view.body.data.invoice.taxType, "INTRA", "seller and buyer are both in Maharashtra");
  assert.ok(view.body.data.invoice.cgst > 0 && view.body.data.invoice.sgst > 0);
  assert.equal(view.body.data.invoice.igst || 0, 0);
  const invoice = await Invoice.findById(view.body.data.invoice._id);
  assert.ok(invoice.lines.length >= 3, "the invoice lists the items");
  assert.match(invoice.number, /^SP\/\d\d-\d\d\/\d{5}$/);

  const sub = await Subscription.findOne({ companyId: s.a.company._id, locationId: s.main._id, legacy: false });
  assert.ok(sub);
  s.sub = sub;
  assert.equal(sub.users, 5);
  assert.equal(sub.addons.pass, true);
  assert.equal(sub.addons.anpr, 1);
  assert.equal(sub.addons.photo, false);
  assert.ok(sub.periodEnd - sub.periodStart > 85 * DAY && sub.periodEnd - sub.periodStart < 93 * DAY, "three months");
  assert.equal((await Location.findById(s.main._id)).userLicence.limit, 5, "the location's user licence follows");
  assert.equal((await Company.findById(s.a.company._id)).subscriptionStatus, "ACTIVE");
});

it("paying twice, or a repeated notice from the gateway, does not make a second subscription", async () => {
  const again = await pay(s.a.token, s.mainOrder._id);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(await Subscription.countDocuments({ companyId: s.a.company._id, locationId: s.main._id, legacy: false }), 1);
  assert.equal(await Invoice.countDocuments({ companyId: s.a.company._id }), 1);
  assert.equal(await PlanOrder.countDocuments({ companyId: s.a.company._id, locationId: s.main._id, status: "PAID" }), 1);
});

it("the list and the location page show the bought subscription, not the trial, with its order", async () => {
  const list = await api("GET", "/api/subscriptions", { token: s.a.token });
  const main = list.body.data.rows.find((r) => r.locationName === "Main");
  assert.equal(main.subscription.legacy, false);
  assert.equal(main.subscription.users, 5);
  assert.equal(main.state, "ACTIVE");
  const annex = list.body.data.rows.find((r) => r.locationName === "Annex");
  assert.equal(annex.subscription.legacy, true, "Annex still has its trial");

  const detail = await api("GET", `/api/subscriptions/locations/${s.main._id}`, { token: s.a.token });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.data.running.length, 1, "the trial is hidden once something is bought");
  assert.equal(detail.body.data.running[0].code, s.sub.code);
  assert.deepEqual(detail.body.data.running[0].items, ["Vehicle Pass Management", "ANPR Camera Service (ANPR cameras: 1)", "Parking Data Backup (1 month)"]);
  assert.equal(detail.body.data.orders.length, 2, "the failed try and the paid order");
  assert.equal((await api("GET", `/api/subscriptions/locations/${s.other._id}`, { token: s.a.token })).status, 404);
  assert.equal((await api("GET", `/api/subscriptions/${s.sub._id}`, { token: s.b.token })).status, 404, "another company's subscription");
});

it("the company-wide billing page no longer lists location orders", async () => {
  const res = await api("GET", "/api/billing", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.orders, []);
});

it("add-ons unlock features: Main has a pass and one ANPR camera, nothing else", async () => {
  assert.equal((await sellPass(s.main._id, "RJ14SB0001")).status, 201, "the pass add-on is on");
  const first = await camera(s.main._id, "cam-1");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await camera(s.main._id, "cam-2");
  assert.equal(second.status, 403, JSON.stringify(second.body));
  assert.match(second.body.message, /includes 1 ANPR cameras/);
  const lane = await camera(s.main._id, "fastag-1", "FASTAG_READER");
  assert.equal(lane.status, 403, "no FASTag service bought");
  assert.match(lane.body.message, /Manage Subscriptions/);
  assert.equal(await Hardware.countDocuments({ locationId: s.main._id }), 1);
});

it("Annex still has the free trial, so everything works there", async () => {
  assert.equal((await sellPass(s.annex._id, "RJ14SB0002")).status, 201);
  assert.equal((await camera(s.annex._id, "annex-cam-1")).status, 201);
  assert.equal((await camera(s.annex._id, "annex-cam-2")).status, 201);
  assert.equal((await camera(s.annex._id, "annex-fastag", "FASTAG_READER")).status, 201);
});

it("a subscription without the pass add-on cannot sell passes, and one that has ended cannot do anything", async () => {
  const bought = await buy(s.annex._id, { users: 3, months: 1, addons: { photo: true } });
  assert.equal(bought.row.subscription.legacy, false);
  s.annexSub = await Subscription.findById(bought.row.subscription._id);

  const noPass = await sellPass(s.annex._id, "RJ14SB0003");
  assert.equal(noPass.status, 403, JSON.stringify(noPass.body));
  assert.match(noPass.body.message, /Vehicle Pass Management is not in this location's subscription/);

  await Subscription.updateMany({ companyId: s.a.company._id, locationId: s.annex._id }, { $set: { periodStart: new Date(Date.now() - 60 * DAY), periodEnd: new Date(Date.now() - DAY) } });
  const ended = await sellPass(s.annex._id, "RJ14SB0004");
  assert.equal(ended.status, 403, JSON.stringify(ended.body));
  assert.match(ended.body.message, /has ended/);
  const row = (await api("GET", "/api/subscriptions", { token: s.a.token })).body.data.rows.find((r) => r.locationName === "Annex");
  assert.equal(row.state, "EXPIRED");
});

it("renewing an ended subscription starts today; renewing one that is running adds to the end", async () => {
  const before = Date.now();
  const made = await order({ kind: "RENEWAL", subscriptionId: String(s.annexSub._id), months: 1 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal((await pay(s.a.token, made.body.data.order._id)).status, 200);
  const renewed = await Subscription.findById(s.annexSub._id);
  assert.ok(renewed.periodEnd - before > 27 * DAY && renewed.periodEnd - before < 32 * DAY, "a month from now");
  assert.equal((await sellPass(s.annex._id, "RJ14SB0005")).status, 403, "still without the pass add-on");

  const end = s.sub.periodEnd.getTime();
  const next = await order({ kind: "RENEWAL", subscriptionId: String(s.sub._id), months: 1 });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.equal((await pay(s.a.token, next.body.data.order._id)).status, 200);
  const longer = await Subscription.findById(s.sub._id);
  assert.ok(longer.periodEnd - end > 27 * DAY && longer.periodEnd - end < 32 * DAY, "a month after the old end");
  assert.equal(longer.periodStart.getTime(), s.sub.periodStart.getTime(), "the start does not move");
  assert.equal(await Subscription.countDocuments({ companyId: s.a.company._id, locationId: s.main._id, legacy: false }), 1);
  s.sub = longer;
});

it("adding users and add-ons part-way: priced for the days left, then applied", async () => {
  const q = await quote({ kind: "UPDATE", subscriptionId: String(s.sub._id), change: { addUsers: 2, gateway: true } });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.data.users, 7);
  assert.equal(q.body.data.discount, 0);
  assert.ok(q.body.data.daysLeft > 100);
  assert.ok(q.body.data.subtotal > 1000);

  assert.equal((await quote({ kind: "UPDATE", subscriptionId: String(s.sub._id), change: {} })).status, 400, "nothing chosen");
  assert.equal((await quote({ kind: "UPDATE", subscriptionId: String(s.sub._id), change: { pass: true } })).status, 400, "already has the pass");
  assert.equal((await quote({ kind: "UPDATE", subscriptionId: String(s.sub._id), change: { addUsers: 1000 } })).status, 400);

  const made = await order({ kind: "UPDATE", subscriptionId: String(s.sub._id), change: { addUsers: 2, gateway: true, addAnpr: 1 } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal((await pay(s.a.token, made.body.data.order._id)).status, 200);
  const updated = await Subscription.findById(s.sub._id);
  assert.equal(updated.users, 7);
  assert.equal(updated.addons.gateway, true);
  assert.equal(updated.addons.anpr, 2);
  assert.equal(updated.periodEnd.getTime(), s.sub.periodEnd.getTime(), "the dates do not change");
  assert.equal((await Location.findById(s.main._id)).userLicence.limit, 7);
  assert.equal((await camera(s.main._id, "cam-2")).status, 201, "the second camera is now allowed");
  assert.equal((await camera(s.main._id, "cam-3")).status, 403);
  s.sub = updated;
});

it("the trial or an earlier plan cannot be renewed, updated or cancelled; buy a subscription instead", async () => {
  const legacy = await Subscription.findOne({ companyId: s.a.company._id, locationId: s.annex._id, legacy: true });
  assert.ok(legacy);
  assert.equal((await quote({ kind: "RENEWAL", subscriptionId: String(legacy._id), months: 1 })).status, 409);
  assert.equal((await quote({ kind: "UPDATE", subscriptionId: String(legacy._id), change: { addUsers: 1 } })).status, 409);
  assert.equal((await api("POST", `/api/subscriptions/${legacy._id}/cancel`, { token: s.a.token, body: { reason: "No longer needed" } })).status, 409);
});

it("cancelling needs a reason, works once, and ends what the subscription unlocked", async () => {
  const url = `/api/subscriptions/${s.annexSub._id}/cancel`;
  assert.equal((await api("POST", url, { token: s.a.token, body: { reason: "no" } })).status, 400, "reason too short");
  assert.equal((await api("POST", url, { token: s.a.token, body: {} })).status, 400);
  assert.equal((await api("POST", url, { token: s.b.token, body: { reason: "Not ours to cancel" } })).status, 404);
  assert.equal((await api("POST", url, { token: s.site, body: { reason: "Not allowed to cancel" } })).status, 403);
  const done = await api("POST", url, { token: s.a.token, body: { reason: "Closing this location" } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.state, "CANCELLED");
  assert.equal((await api("POST", url, { token: s.a.token, body: { reason: "Closing this location" } })).status, 409, "only once");
  assert.equal((await quote({ kind: "RENEWAL", subscriptionId: String(s.annexSub._id), months: 1 })).status, 409, "a cancelled one is not renewed");
  const row = (await api("GET", "/api/subscriptions", { token: s.a.token })).body.data.rows.find((r) => r.locationName === "Annex");
  assert.equal(row.state, "CANCELLED");
});

it("Super Admin prices: change one, see it in the quote, set it back to the standard price", async () => {
  const body = { kind: "PURCHASE", locationId: s.main._id, users: 1, months: 1, addons: { pass: true } };
  assert.equal((await quote(body)).body.data.subtotal, 749);

  assert.equal((await api("PUT", "/api/subscriptions/prices", { token: s.a.token, body: { prices: { pass: 300 } } })).status, 403, "a company cannot set prices");
  assert.equal((await api("PUT", "/api/subscriptions/prices", { token: s.root, body: { prices: { pass: -1 } } })).status, 400);
  assert.equal((await api("PUT", "/api/subscriptions/prices", { token: s.root, body: { prices: { pass: "free" } } })).status, 400);

  const set = await api("PUT", "/api/subscriptions/prices", { token: s.root, body: { prices: { pass: 300 } } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const pass = set.body.data.addons.find((a) => a.key === "pass");
  assert.equal(pass.price, 300);
  assert.equal(pass.standardPrice, 250);
  assert.equal((await quote(body)).body.data.subtotal, 799, "the new price is used");
  assert.equal((await api("GET", "/api/subscriptions/catalog", { token: s.a.token })).body.data.addons.find((a) => a.key === "pass").price, 300);

  const back = await api("PUT", "/api/subscriptions/prices", { token: s.root, body: { prices: { pass: 250 } } });
  assert.equal(back.status, 200);
  assert.equal(back.body.data.addons.find((a) => a.key === "pass").price, 250);
  assert.equal((await quote(body)).body.data.subtotal, 749);
});

it("an order made at the old price keeps its price", async () => {
  const body = { kind: "PURCHASE", locationId: s.annex._id, users: 1, months: 1, addons: { pass: true } };
  await api("PUT", "/api/subscriptions/prices", { token: s.root, body: { prices: { pass: 400 } } });
  const made = await order(body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.order.subtotal, 899);
  await api("PUT", "/api/subscriptions/prices", { token: s.root, body: { prices: { pass: 250 } } });
  const view = await api("GET", `/api/subscriptions/orders/${made.body.data.order._id}`, { token: s.a.token });
  assert.equal(view.body.data.subtotal, 899);
});
