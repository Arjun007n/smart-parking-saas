// The hardware shop through the API with the simulated gateway: catalog (platform side and public), the
// cart, checkout, payment (simulator and signed webhook), stock, GST invoices, delivery updates and who may
// see what. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, bytes, registerCompany, login, send, assert } = require("./helpers");
const payments = require("../integrations/payment");
const email = require("../integrations/email");
const emailService = require("../services/emailService");
const shopService = require("../services/shopService");
const User = require("../models/User");
const Product = require("../models/Product");
const ShopOrder = require("../models/ShopOrder");
const Invoice = require("../models/Invoice");
const Notification = require("../models/Notification");

setup();

const s = {};
const SECRET = "webhook-secret-0123456789abcdef";
const DAY = 24 * 60 * 60 * 1000;

const signedWebhook = (payload) => {
  const text = JSON.stringify(payload);
  return send("POST", "/api/payments/webhook", {
    headers: { "content-type": "application/json", "x-signature": payments.sign(text, SECRET) }, body: text,
  });
};
const addr = (extra = {}) => ({ name: "Ravi Kumar", phone: "9876543210", line1: "5 Station Road", city: "Pune", state: "Maharashtra", pincode: "411001", ...extra });
const buy = (ctx, items, extra = {}) => api("POST", "/api/shop/checkout", { token: ctx.token, body: { items, shipTo: addr(), ...extra } });
const pay = (ctx, orderId, outcome = "SUCCESS") => api("POST", `/api/shop/orders/${orderId}/simulate`, { token: ctx.token, body: { outcome } });
const byName = (name) => s.products.find((p) => p.name === name);
const stockOf = async (name) => (await Product.findById(byName(name)._id)).stock;

it("setup: seller details, a simulated gateway, a platform admin and two companies", async () => {
  Object.assign(process.env, {
    PAYMENT_PROVIDER: "simulated", PAYMENT_WEBHOOK_SECRET: SECRET, EMAIL_PROVIDER: "simulated",
    SELLER_NAME: "Example Parking Tech Pvt Ltd", SELLER_GSTIN: "27AAPFU0939F1ZV", SELLER_ADDRESS: "1 MG Road, Pune, Maharashtra 411001",
    SELLER_SAC: "9983", SELLER_EMAIL: "orders@example.com",
  });
  delete process.env.SHOP_SHIPPING_FLAT;
  delete process.env.SHOP_FREE_SHIPPING_ABOVE;
  await User.create({ name: "Root", email: "root@shop.test", password: "RootPassword123", role: "SUPER_ADMIN" });
  s.root = { token: await login("root@shop.test", "RootPassword123") };
  s.a = await registerCompany("shop-a");
  s.b = await registerCompany("shop-b");
  const a = await api("PUT", `/api/companies/${s.a.company._id}`, {
    token: s.a.token, body: { legalName: "Alpha Parking LLP", address: { line1: "5 Station Road", city: "Pune", state: "Maharashtra", pincode: "411001" } },
  });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  email.outbox.length = 0;
});

it("catalog: only the platform imports the starter list, once; nothing can be bought without a price", async () => {
  const before = await api("GET", "/api/shop/products");
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.data, []);

  assert.equal((await api("POST", "/api/shop/admin/products/import-starter", { token: s.a.token })).status, 403, "a company admin cannot");
  assert.equal((await api("POST", "/api/shop/admin/products/import-starter")).status, 401);
  const imported = await api("POST", "/api/shop/admin/products/import-starter", { token: s.root.token });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.data.length, 8);
  assert.equal((await api("POST", "/api/shop/admin/products/import-starter", { token: s.root.token })).status, 409);

  const list = await api("GET", "/api/shop/products");
  assert.equal(list.body.data.length, 8);
  assert.ok(list.body.data.every((p) => p.price === null && p.canBuy === false));
  s.products = list.body.data;

  const cart = await api("POST", "/api/shop/cart", { body: { items: [{ productId: byName("Boom barrier")._id, qty: 1 }] } });
  assert.equal(cart.status, 200, JSON.stringify(cart.body));
  assert.equal(cart.body.data.lines.length, 0);
  assert.match(cart.body.data.problems[0].problem, /price/i);
});

it("catalog: the platform sets prices, GST, HSN and stock; bad values are refused", async () => {
  const id = byName("Boom barrier")._id;
  const bad = await api("PUT", `/api/shop/admin/products/${id}`, { token: s.root.token, body: { imageUrl: "http://insecure.example/a.png" } });
  assert.equal(bad.status, 400);
  assert.equal((await api("PUT", `/api/shop/admin/products/${id}`, { token: s.root.token, body: { price: -5 } })).status, 400);
  assert.equal((await api("PUT", `/api/shop/admin/products/${id}`, { token: s.root.token, body: { gstPercent: 10 } })).status, 400, "10% is not a GST slab");
  assert.equal((await api("PUT", `/api/shop/admin/products/${id}`, { token: s.root.token, body: { price: 10.005 } })).status, 400, "paise at most");
  assert.equal((await api("PUT", `/api/shop/admin/products/${id}`, { token: s.a.token, body: { price: 1 } })).status, 403);

  const set = async (name, body) => {
    const res = await api("PUT", `/api/shop/admin/products/${byName(name)._id}`, { token: s.root.token, body });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data;
  };
  const barrier = await set("Boom barrier", { price: 12500.5, gstPercent: 18, hsn: "8479", stock: 5, maxPerOrder: 4, imageUrl: "https://example.com/barrier.jpg", highlights: ["3 m arm", "Fast"] });
  assert.equal(barrier.canBuy, true);
  await set("Thermal ticket printer", { price: 8000, gstPercent: 12, hsn: "8443" });
  await set("ANPR camera", { price: 20000, gstPercent: 18, stock: 1 });
  const zero = await set("CCTV integration", { price: 0 });
  assert.equal(zero.price, null, "a price of 0 means no price");

  const created = await api("POST", "/api/shop/admin/products", { token: s.root.token, body: { name: "Gate sign", category: "Signage", price: 300, gstPercent: 5 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await api("POST", "/api/shop/admin/products", { token: s.root.token, body: { category: "x" } })).status, 400);

  const cleared = await set("ANPR camera", { price: null });
  assert.equal(cleared.price, null);
  await set("ANPR camera", { price: 20000 });

  const list = await api("GET", "/api/shop/products");
  s.products = list.body.data;
  assert.equal(list.body.data.length, 9);
  const shown = byName("Boom barrier");
  assert.equal(shown.priceWithGst, 14750.59); // 12500.50 + 18%
  assert.equal(shown.stock, undefined);
  assert.equal(shown.maxPerOrder, 4);
  assert.equal(byName("Thermal ticket printer").canBuy, true);
  assert.equal(byName("Handheld terminal").canBuy, false);

  const hidden = await set("LED availability display", { isActive: false });
  assert.equal(hidden.isActive, false);
  const after = await api("GET", "/api/shop/products");
  assert.equal(after.body.data.length, 8, "an unpublished product disappears");
  assert.equal((await api("GET", `/api/shop/products/${byName("LED availability display")._id}`)).status, 404);
  assert.equal((await api("GET", `/api/shop/products/${byName("Boom barrier")._id}`)).status, 200);
  const admin = await api("GET", "/api/shop/admin/products", { token: s.root.token });
  assert.equal(admin.body.data.length, 9, "the platform still sees it");
  assert.equal((await api("GET", "/api/shop/admin/products", { token: s.a.token })).status, 403);
});

it("cart: priced on the server, problems reported per item, the rest still priced", async () => {
  const barrier = byName("Boom barrier")._id;
  const printer = byName("Thermal ticket printer")._id;
  const res = await api("POST", "/api/shop/cart", {
    body: { items: [{ productId: barrier, qty: 2 }, { productId: printer, qty: 1 }, { productId: byName("Handheld terminal")._id, qty: 1 }, { productId: barrier, qty: 1 }] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.equal(d.lines.length, 2, "the barrier lines were merged");
  const b = d.lines.find((l) => l.name === "Boom barrier");
  assert.equal(b.qty, 3);
  assert.equal(b.taxable, 37501.5);
  assert.equal(b.gst, 6750.27);
  const p = d.lines.find((l) => l.name === "Thermal ticket printer");
  assert.equal(p.gst, 960);
  assert.equal(d.goods, 45501.5);
  assert.equal(d.shippingFee, 0);
  assert.equal(d.gst, 7710.27);
  assert.equal(d.total, 53211.77);
  assert.equal(d.problems.length, 1);

  const tooMany = await api("POST", "/api/shop/cart", { body: { items: [{ productId: barrier, qty: 5 }] } });
  assert.match(tooMany.body.data.problems[0].problem, /At most 4/);
  const tooFew = await api("POST", "/api/shop/cart", { body: { items: [{ productId: byName("ANPR camera")._id, qty: 2 }] } });
  assert.match(tooFew.body.data.problems[0].problem, /Only 1 in stock/);

  assert.equal((await api("POST", "/api/shop/cart", { body: { items: [] } })).status, 400);
  assert.equal((await api("POST", "/api/shop/cart", { body: { items: [{ productId: "nope", qty: 1 }] } })).status, 400);
  assert.equal((await api("POST", "/api/shop/cart", { body: { items: [{ productId: barrier, qty: 0 }] } })).status, 400);
  assert.equal((await api("POST", "/api/shop/cart", { body: { items: [{ productId: barrier, qty: 1, price: 1 }] } })).status, 200, "a price sent by the browser is ignored");
});

it("info: delivery terms and states for the cart page", async () => {
  const res = await api("GET", "/api/shop/info");
  assert.equal(res.status, 200);
  assert.equal(res.body.data.orderingOpen, true);
  assert.ok(res.body.data.states.includes("Maharashtra"));
  assert.equal(res.body.data.shipping.flat, 0);
});

it("checkout: needs a login, the right permission, a good address and a buyable cart", async () => {
  const items = [{ productId: byName("Thermal ticket printer")._id, qty: 1 }];
  assert.equal((await api("POST", "/api/shop/checkout", { body: { items, shipTo: addr() } })).status, 401);
  assert.equal((await api("POST", "/api/shop/checkout", { token: s.root.token, body: { items, shipTo: addr() } })).status, 400, "the platform has no company to buy for");

  for (const [bad, pattern] of [
    [{ pincode: "12" }, /6 digits|at most|PIN/i],
    [{ state: "Atlantis" }, /state/i],
    [{ phone: "12" }, /phone/i],
  ]) {
    const res = await buy(s.a, items, { shipTo: addr(bad) });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(JSON.stringify(res.body), pattern);
  }
  assert.equal((await buy(s.a, items, { gstin: "NOTAGSTIN" })).status, 400);
  const handheld = await buy(s.a, [{ productId: byName("Handheld terminal")._id, qty: 1 }]);
  assert.equal(handheld.status, 409);
  assert.match(handheld.body.message, /Handheld terminal/);
  assert.equal((await ShopOrder.countDocuments({})), 0, "nothing was created by the refused attempts");

  // A gate operator of the company may not buy.
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Main", address: { line1: "MG Road" }, capacity: { car: 10 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  const op = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Gate", email: "gate@shop-a.example.com", password: "Password123", role: "ENTRY_OPERATOR", locationIds: [loc.body.data._id] },
  });
  assert.equal(op.status, 201, JSON.stringify(op.body));
  const opToken = await login("gate@shop-a.example.com");
  assert.equal((await api("POST", "/api/shop/checkout", { token: opToken, body: { items, shipTo: addr() } })).status, 403);
});

it("checkout: an order is made with a number, server prices and a payment link; pressing again reuses it", async () => {
  const items = [{ productId: byName("Boom barrier")._id, qty: 2 }, { productId: byName("Thermal ticket printer")._id, qty: 1 }];
  const res = await buy(s.a, items, { installationRequested: true, notes: "Gate 2 is by the lift" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = res.body.data.order;
  assert.match(order.number, /^HW\/\d\d-\d\d\/0001$/);
  assert.equal(order.status, "PENDING");
  assert.equal(order.fulfilment, "NONE");
  assert.equal(order.goods, 33001); // 2 x 12500.50 + 8000
  assert.equal(order.total, 38461.18); // 33001 + barrier GST 4500.18 (18% of 25001) + printer GST 960
  assert.equal(order.installationRequested, true);
  assert.equal(order.simulated, true);
  assert.equal(order.shipTo.stateCode, "27");
  assert.equal(order.payUrl, undefined, "a simulated link is never shown");
  assert.equal(await stockOf("Boom barrier"), 5, "stock is not counted until it is paid");
  s.order1 = order;

  const again = await buy(s.a, items, { installationRequested: true, notes: "Gate 2 is by the lift" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.repeated, true);
  assert.equal(again.body.data.order._id, order._id);
  assert.equal(await ShopOrder.countDocuments({ companyId: s.a.company._id }), 1);

  const raw = await ShopOrder.findById(order._id);
  assert.ok(raw.transactionId && raw.transactionId.startsWith("ORD-"));
  assert.equal(raw.lines[0].unitPrice, 12500.5);
  assert.equal(raw.history[0].status, "ORDERED");
});

it("a company sees only its own orders", async () => {
  const own = await api("GET", "/api/shop/orders", { token: s.a.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.data.length, 1);
  assert.equal(own.body.data[0].payUrl, undefined);
  assert.equal((await api("GET", "/api/shop/orders", { token: s.b.token })).body.data.length, 0);
  assert.equal((await api("GET", `/api/shop/orders/${s.order1._id}`, { token: s.b.token })).status, 404);
  assert.equal((await api("GET", `/api/shop/orders/${s.order1._id}`, { token: s.a.token })).status, 200);
  assert.equal((await api("GET", "/api/shop/orders")).status, 401);
});

it("paying: the order is confirmed, stock counts down, a GST invoice (CGST + SGST) is issued and emailed", async () => {
  email.outbox.length = 0;
  const res = await pay(s.a, s.order1._id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.outcome, "success");
  const order = res.body.data.order;
  assert.equal(order.status, "PAID");
  assert.equal(order.fulfilment, "PROCESSING");
  assert.ok(order.invoiceId);

  assert.equal(await stockOf("Boom barrier"), 3);
  assert.equal(await stockOf("Thermal ticket printer"), null, "made to order: no count kept");

  const inv = await Invoice.findById(order.invoiceId);
  assert.equal(inv.kind, "SHOP");
  assert.match(inv.number, /^SP\/\d\d-\d\d\/00001$/);
  assert.equal(inv.taxType, "INTRA");
  assert.equal(Math.round((inv.cgst + inv.sgst) * 100) / 100, 5460.18);
  assert.equal(inv.igst, 0);
  assert.equal(inv.taxable, 33001);
  assert.equal(inv.total, order.total);
  assert.equal(inv.lines.length, 2);
  assert.equal(inv.lines[0].hsn, "8479");
  assert.match(inv.shipTo, /Ravi Kumar/);
  assert.equal(inv.buyer.name, "Alpha Parking LLP");
  assert.equal(inv.buyer.stateCode, "27");

  await emailService.flush();
  const mail = email.outbox.find((m) => /Invoice SP\//.test(m.subject));
  assert.ok(mail, "the invoice email was sent");
  assert.match(mail.subject, /hardware order/);
  assert.ok(mail.to.includes("admin-shop-a@example.com"));
  assert.equal(mail.attachments.length, 1);
  const seller = email.outbox.find((m) => /New hardware order HW\//.test(m.subject));
  assert.ok(seller, "the seller was told");
  assert.deepEqual(seller.to, ["orders@example.com"]);

  assert.ok(await Notification.findOne({ companyId: s.a.company._id, title: /^Order HW\/.* is confirmed$/ }));

  // The invoice downloads from the billing endpoint, for the owner only.
  const pdf = await bytes("GET", `/api/billing/invoices/${inv._id}/pdf`, { token: s.a.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await api("GET", `/api/billing/invoices/${inv._id}`, { token: s.b.token })).status, 404);
  s.invoice1 = inv;
});

it("paying the same order again (simulator or webhook) changes nothing", async () => {
  const again = await pay(s.a, s.order1._id);
  assert.equal(again.body.data.outcome, "already");
  const order = await ShopOrder.findById(s.order1._id);
  const hook = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: order.total });
  assert.equal(hook.status, 200);
  assert.equal(await stockOf("Boom barrier"), 3, "stock was counted once");
  assert.equal(await Invoice.countDocuments({ kind: "SHOP" }), 1);
  const failed = await signedWebhook({ transactionId: order.transactionId, status: "FAILED" });
  assert.equal(failed.status, 200);
  assert.equal((await ShopOrder.findById(order._id)).status, "PAID", "a failure message cannot undo a payment");
});

it("a delivery to another state carries IGST", async () => {
  const res = await buy(s.a, [{ productId: byName("Thermal ticket printer")._id, qty: 2 }], { shipTo: addr({ state: "Karnataka", city: "Bengaluru", pincode: "560001" }), gstin: "29AAPFU0939F1ZV" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.order.shipTo.stateCode, "29");
  const paid = await pay(s.a, res.body.data.order._id);
  assert.equal(paid.body.data.outcome, "success");
  const inv = await Invoice.findById(paid.body.data.order.invoiceId);
  assert.equal(inv.taxType, "INTER");
  assert.equal(inv.igst, 1920);
  assert.equal(inv.cgst, 0);
  assert.equal(inv.buyer.gstin, "29AAPFU0939F1ZV");
  assert.equal(inv.buyer.stateCode, "29");
  assert.match(inv.number, /00002$/, "plan and shop invoices share one number series");
  s.order2 = paid.body.data.order;
});

it("a payment with the wrong amount never starts an order; a later right payment still counts", async () => {
  const res = await buy(s.b, [{ productId: byName("Thermal ticket printer")._id, qty: 1 }], { shipTo: addr({ state: "Delhi", city: "New Delhi", pincode: "110001" }) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = await ShopOrder.findById(res.body.data.order._id);
  const bad = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: order.total - 100 });
  assert.equal(bad.status, 200);
  const flagged = await ShopOrder.findById(order._id);
  assert.equal(flagged.status, "FAILED");
  assert.equal(flagged.fulfilment, "NONE");
  assert.equal(await Invoice.countDocuments({ companyId: s.b.company._id }), 0);
  assert.ok(await Notification.findOne({ companyId: s.b.company._id, title: "A shop payment had the wrong amount" }));

  const late = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: order.total });
  assert.equal(late.status, 200);
  const done = await ShopOrder.findById(order._id);
  assert.equal(done.status, "PAID", "the money is truth: the customer really paid");
  assert.equal(done.fulfilment, "PROCESSING");
  assert.equal(await Invoice.countDocuments({ companyId: s.b.company._id }), 1);
  s.order3 = done;
});

it("the last unit: two buyers can both pay, and stock stops at zero", async () => {
  const camera = byName("ANPR camera")._id;
  const first = await buy(s.a, [{ productId: camera, qty: 1 }]);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  // A second buyer is stopped at checkout only once the stock has really gone.
  const second = await buy(s.b, [{ productId: camera, qty: 1 }]);
  assert.equal(second.status, 201, "stock is still 1 until the first order is paid");
  assert.equal((await pay(s.a, first.body.data.order._id)).body.data.outcome, "success");
  assert.equal(await stockOf("ANPR camera"), 0);
  assert.equal((await pay(s.b, second.body.data.order._id)).body.data.outcome, "success", "both paid, both honoured");
  assert.equal(await stockOf("ANPR camera"), 0, "never below zero");
  const third = await buy(s.a, [{ productId: camera, qty: 1 }]);
  assert.equal(third.status, 409);
  assert.match(third.body.message, /Out of stock/);
  assert.equal((await api("GET", "/api/shop/products")).body.data.find((p) => p.name === "ANPR camera").canBuy, false);
  s.cameraOrder = await ShopOrder.findById(first.body.data.order._id);
});

it("delivery charge: flat, free above a limit, taxed, and printed on the invoice", async () => {
  process.env.SHOP_SHIPPING_FLAT = "500";
  process.env.SHOP_FREE_SHIPPING_ABOVE = "10000";
  try {
    const info = await api("GET", "/api/shop/info");
    assert.equal(info.body.data.shipping.flat, 500);
    const small = await buy(s.a, [{ productId: byName("Gate sign")._id, qty: 2 }]);
    assert.equal(small.status, 201, JSON.stringify(small.body));
    assert.equal(small.body.data.order.shippingFee, 500);
    assert.equal(small.body.data.order.shippingGst, 90);
    assert.equal(small.body.data.order.total, 600 + 30 + 500 + 90);
    const paid = await pay(s.a, small.body.data.order._id);
    const inv = await Invoice.findById(paid.body.data.order.invoiceId);
    assert.equal(inv.lines.length, 2);
    assert.equal(inv.lines[1].description, "Delivery charges");
    assert.equal(inv.taxable, 1100);
    assert.equal(inv.cgst + inv.sgst, 120);
    assert.equal(inv.total, 1220);
    const big = await api("POST", "/api/shop/cart", { body: { items: [{ productId: byName("Thermal ticket printer")._id, qty: 2 }] } });
    assert.equal(big.body.data.shippingFee, 0, "free above the limit");
  } finally {
    delete process.env.SHOP_SHIPPING_FLAT;
    delete process.env.SHOP_FREE_SHIPPING_ABOVE;
  }
});

it("delivery: the platform ships and delivers; wrong steps are refused; the buyer is told", async () => {
  const id = s.order1._id;
  assert.equal((await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.a.token, body: { to: "SHIPPED", courier: "X" } })).status, 403);
  assert.equal((await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "DELIVERED" } })).status, 409, "must ship first");
  const noCourier = await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "SHIPPED" } });
  assert.equal(noCourier.status, 400);
  email.outbox.length = 0;
  const shipped = await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "SHIPPED", courier: "BlueDart", trackingNumber: "BD123456" } });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
  assert.equal(shipped.body.data.fulfilment, "SHIPPED");
  assert.equal(shipped.body.data.courier, "BlueDart");
  assert.equal(shipped.body.data.company.name, s.a.company.name);
  await emailService.flush();
  assert.ok(email.outbox.find((m) => /has shipped/.test(m.subject)));
  assert.ok(await Notification.findOne({ companyId: s.a.company._id, title: /has shipped/ }));

  const seen = await api("GET", `/api/shop/orders/${id}`, { token: s.a.token });
  assert.equal(seen.body.data.trackingNumber, "BD123456");
  assert.deepEqual(seen.body.data.history.map((h) => h.status), ["ORDERED", "PAID", "SHIPPED"]);

  const delivered = await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "DELIVERED" } });
  assert.equal(delivered.body.data.fulfilment, "DELIVERED");
  assert.ok(delivered.body.data.deliveredAt);
  assert.equal((await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "CANCELLED", note: "late" } })).status, 409, "delivered is final");
});

it("cancelling a paid order needs a reason and puts the stock back", async () => {
  const id = s.cameraOrder._id;
  assert.equal(await stockOf("ANPR camera"), 0);
  assert.equal((await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "CANCELLED" } })).status, 400);
  const res = await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "CANCELLED", note: "Supplier could not deliver" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.fulfilment, "CANCELLED");
  assert.equal(await stockOf("ANPR camera"), 1, "the unit is back in stock");
  const note = await Notification.findOne({ companyId: s.a.company._id, title: /was cancelled/ });
  assert.match(note.message, /Supplier could not deliver/);
  // Cancelling twice cannot put stock back twice.
  assert.equal((await api("PUT", `/api/shop/admin/orders/${id}/fulfilment`, { token: s.root.token, body: { to: "CANCELLED", note: "again" } })).status, 409);
  assert.equal(await stockOf("ANPR camera"), 1);
  // A repeated payment message for the cancelled order must not take the stock again.
  const hook = await signedWebhook({ transactionId: s.cameraOrder.transactionId, status: "SUCCESS", amount: s.cameraOrder.total });
  assert.equal(hook.status, 200);
  assert.equal(await stockOf("ANPR camera"), 1, "stock stays put");
});

it("hardware invoices stay out of the plan billing page", async () => {
  const res = await api("GET", "/api/billing", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.invoices, []);
});

it("the platform lists and filters orders", async () => {
  const all = await api("GET", "/api/shop/admin/orders", { token: s.root.token });
  assert.equal(all.status, 200);
  assert.ok(all.body.data.length >= 5);
  assert.ok(all.body.data.every((o) => o.company && o.company.name));
  const shipped = await api("GET", "/api/shop/admin/orders?fulfilment=SHIPPED", { token: s.root.token });
  assert.equal(shipped.body.data.length, 0, "the shipped one was delivered");
  const delivered = await api("GET", "/api/shop/admin/orders?fulfilment=DELIVERED", { token: s.root.token });
  assert.equal(delivered.body.data.length, 1);
  const byCompany = await api("GET", `/api/shop/admin/orders?q=${encodeURIComponent(s.b.company.name)}`, { token: s.root.token });
  assert.ok(byCompany.body.data.length >= 1);
  assert.ok(byCompany.body.data.every((o) => o.company.name === s.b.company.name));
  const byNumber = await api("GET", `/api/shop/admin/orders?q=${encodeURIComponent(s.order1.number)}`, { token: s.root.token });
  assert.equal(byNumber.body.data.length, 1);
  assert.equal((await api("GET", "/api/shop/admin/orders", { token: s.a.token })).status, 403);
  assert.equal((await api("GET", `/api/shop/admin/orders/${s.order1._id}`, { token: s.root.token })).body.data.number, s.order1.number);
});

it("a buyer can cancel an order that is still waiting; a failed payment can be retried by ordering again", async () => {
  const items = [{ productId: byName("Gate sign")._id, qty: 1 }];
  const made = await buy(s.a, items);
  const id = made.body.data.order._id;
  const failed = await pay(s.a, id, "FAILED");
  assert.equal(failed.body.data.outcome, "failed");
  assert.equal(failed.body.data.order.status, "FAILED");
  const retry = await buy(s.a, items);
  assert.equal(retry.status, 201, "a failed order is not reused");
  assert.notEqual(retry.body.data.order._id, id);

  const cancelled = await api("POST", `/api/shop/orders/${retry.body.data.order._id}/cancel`, { token: s.a.token });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "CANCELLED");
  assert.equal((await api("POST", `/api/shop/orders/${retry.body.data.order._id}/cancel`, { token: s.a.token })).status, 409);
  assert.equal((await api("POST", `/api/shop/orders/${s.order1._id}/cancel`, { token: s.a.token })).status, 409, "a paid order cannot be cancelled by the buyer");
  assert.equal((await api("POST", `/api/shop/orders/${s.order1._id}/cancel`, { token: s.b.token })).status, 404);
  // Money is truth: a cancelled order that is paid anyway still counts.
  const order = await ShopOrder.findById(retry.body.data.order._id);
  const late = await signedWebhook({ transactionId: order.transactionId, status: "SUCCESS", amount: order.total });
  assert.equal(late.status, 200);
  assert.equal((await ShopOrder.findById(order._id)).status, "PAID");
});

it("the sweep closes orders nobody paid in time", async () => {
  const made = await buy(s.b, [{ productId: byName("Gate sign")._id, qty: 3 }]);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const swept = await shopService.sweep(new Date(Date.now() + 10 * DAY));
  assert.ok(swept.checked >= 1);
  const order = await ShopOrder.findById(made.body.data.order._id);
  assert.equal(order.status, "FAILED");
  assert.equal(order.failureReason, "Not paid in time");
});

it("shop and plan payments find their own orders, and unknown ones are ignored", async () => {
  const unknown = await signedWebhook({ transactionId: "ORD-DOESNOTEXIST", status: "SUCCESS", amount: 10 });
  assert.equal(unknown.status, 200);
  const outcome = await shopService.settle({ transactionId: "ORD-DOESNOTEXIST", status: "SUCCESS" });
  assert.equal(outcome.outcome, "unknown");
});

it("ordering is closed, with a clear message, when the shop is not set up", async () => {
  const old = process.env.SELLER_NAME;
  process.env.SELLER_NAME = "";
  try {
    assert.equal((await api("GET", "/api/shop/info")).body.data.orderingOpen, false);
    const res = await buy(s.a, [{ productId: byName("Gate sign")._id, qty: 1 }]);
    assert.equal(res.status, 503);
    assert.match(res.body.message, /not set up/);
  } finally {
    process.env.SELLER_NAME = old;
  }
});
