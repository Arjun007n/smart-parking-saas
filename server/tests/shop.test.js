// The hardware shop: pure logic (delivery charge, cart shape, delivery address, GST split with paise,
// the goods invoice PDF, the starter list). No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const shop = require("../services/shopService");
const shopConfig = require("../config/shop");
const { splitTaxExact, splitTax } = require("../utils/gst");
const { buildInvoicePdf } = require("../utils/invoicePdf");
const starter = require("../config/shopStarter");
const Product = require("../models/Product");
const ShopOrder = require("../models/ShopOrder");

const withEnv = (vars, fn) => {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};

test("delivery charge: none by default, flat when set, free above a limit, GST on top", () => {
  withEnv({ SHOP_SHIPPING_FLAT: undefined, SHOP_FREE_SHIPPING_ABOVE: undefined, SHOP_SHIPPING_GST: undefined }, () => {
    assert.deepEqual(shop.shippingFor(5000), { fee: 0, gstPercent: 18, gst: 0 });
  });
  withEnv({ SHOP_SHIPPING_FLAT: "500", SHOP_FREE_SHIPPING_ABOVE: undefined }, () => {
    assert.deepEqual(shop.shippingFor(5000), { fee: 500, gstPercent: 18, gst: 90 });
  });
  withEnv({ SHOP_SHIPPING_FLAT: "500", SHOP_FREE_SHIPPING_ABOVE: "10000", SHOP_SHIPPING_GST: "12" }, () => {
    assert.equal(shop.shippingFor(9999.99).fee, 500);
    assert.equal(shop.shippingFor(9999.99).gst, 60);
    assert.deepEqual(shop.shippingFor(10000), { fee: 0, gstPercent: 12, gst: 0 });
  });
  withEnv({ SHOP_SHIPPING_FLAT: "-5", SHOP_SHIPPING_GST: "7" }, () => {
    assert.equal(shopConfig.shipping().flat, 0, "a negative charge is ignored");
    assert.equal(shopConfig.shipping().gstPercent, 18, "an unknown GST rate falls back to 18");
  });
});

test("cart shape: empty, bad ids, bad quantities, repeated products merged, too many products", () => {
  const id = (n) => String(n).padStart(24, "a");
  assert.throws(() => shop.cleanItems([]), /empty/);
  assert.throws(() => shop.cleanItems(undefined), /empty/);
  assert.throws(() => shop.cleanItems([{ productId: "nope", qty: 1 }]), /recognise/);
  assert.throws(() => shop.cleanItems([{ productId: id(1), qty: 0 }]), /whole numbers/);
  assert.throws(() => shop.cleanItems([{ productId: id(1), qty: 1.5 }]), /whole numbers/);
  assert.deepEqual(shop.cleanItems([{ productId: id(1), qty: 2 }, { productId: id(2), qty: 1 }, { productId: id(1), qty: 3 }]), [
    { productId: id(1), qty: 5 }, { productId: id(2), qty: 1 },
  ]);
  const many = Array.from({ length: shopConfig.MAX_LINES + 1 }, (_, i) => ({ productId: id(i + 1), qty: 1 }));
  assert.throws(() => shop.cleanItems(many), /at most/);
});

test("delivery address: every field, phone, PIN code, and the state decides the GST", () => {
  const good = { name: "Ravi", phone: "+91 98765 43210", line1: "5 Station Road", city: "Pune", state: "maharashtra", pincode: "411001" };
  const clean = shop.cleanShipTo(good);
  assert.equal(clean.state, "Maharashtra");
  assert.equal(clean.stateCode, "27");
  assert.equal(clean.line2, undefined);
  assert.equal(shop.cleanShipTo({ ...good, state: "Orissa", line2: " Near the mall " }).state, "Odisha");
  assert.equal(shop.cleanShipTo({ ...good, line2: " Near the mall " }).line2, "Near the mall");
  assert.throws(() => shop.cleanShipTo({ ...good, name: "" }), /name/);
  assert.throws(() => shop.cleanShipTo({ ...good, pincode: "01234" }), /6 digits/);
  assert.throws(() => shop.cleanShipTo({ ...good, pincode: "12345" }), /6 digits/);
  assert.throws(() => shop.cleanShipTo({ ...good, phone: "12" }), /phone/);
  assert.throws(() => shop.cleanShipTo({ ...good, state: "Atlantis" }), /state/);
  assert.throws(() => shop.cleanShipTo(undefined), /delivery address/);
});

test("GST with paise: halves to the paisa, the odd paisa goes to SGST; other states pay IGST", () => {
  const maha = { code: "27", name: "Maharashtra" };
  const kar = { code: "29", name: "Karnataka" };
  assert.deepEqual(splitTaxExact({ gst: 123.45, sellerState: maha, buyerState: maha }), { taxType: "INTRA", cgst: 61.73, sgst: 61.72, igst: 0 });
  assert.deepEqual(splitTaxExact({ gst: 123.45, sellerState: maha, buyerState: kar }), { taxType: "INTER", cgst: 0, sgst: 0, igst: 123.45 });
  assert.deepEqual(splitTaxExact({ gst: 90, sellerState: maha, buyerState: maha }), { taxType: "INTRA", cgst: 45, sgst: 45, igst: 0 });
  assert.deepEqual(splitTaxExact({ gst: 10, sellerState: null, buyerState: maha }).taxType, "INTER");
  // The plan invoices keep their whole-rupee split.
  assert.deepEqual(splitTax({ gst: 5, sellerState: maha, buyerState: maha }), { taxType: "INTRA", cgst: 3, sgst: 2, igst: 0 });
});

test("a product can be bought only with a price, while published and in stock", () => {
  const base = { name: "Boom barrier", category: "Access control" };
  assert.equal(new Product({ ...base }).canBuy(), false, "no price: ask us");
  assert.equal(new Product({ ...base, price: 12000 }).canBuy(), true);
  assert.equal(new Product({ ...base, price: 12000, stock: 0 }).canBuy(), false);
  assert.equal(new Product({ ...base, price: 12000, stock: 3 }).canBuy(), true);
  assert.equal(new Product({ ...base, price: 12000, isActive: false }).canBuy(), false);
  assert.equal(new Product({ ...base, price: 0 }).canBuy(), false);
  const view = shop.publicProduct(new Product({ ...base, price: 1000, gstPercent: 18, stock: 4, maxPerOrder: 20 }));
  assert.equal(view.priceWithGst, 1180);
  assert.equal(view.maxPerOrder, 4, "never more than the stock");
  assert.equal(view.stock, undefined, "the stock count is private");
  assert.equal(shop.publicProduct(new Product({ ...base })).price, null);
});

test("the order and product models reject nonsense", () => {
  assert.ok(new Product({ name: "x", category: "y", gstPercent: 10 }).validateSync(), "10% is not a GST slab");
  assert.equal(new Product({ name: "x", category: "y", gstPercent: 12 }).validateSync(), undefined);
  const order = new ShopOrder({});
  const errors = Object.keys(order.validateSync().errors);
  for (const field of ["companyId", "lines", "goods", "gst", "total", "shipTo"]) assert.ok(errors.includes(field), field);
});

test("the starter list is the eight website items, without prices", () => {
  assert.equal(starter.length, 8);
  assert.ok(starter.every((p) => p.name && p.category && p.price === undefined));
  assert.equal(new Set(starter.map((p) => p.name)).size, 8);
  assert.equal(starter.filter((p) => !p.worksWithSoftware).length, 2);
});

test("the goods invoice PDF is a valid PDF with one row per item", () => {
  const invoice = {
    kind: "SHOP", number: "SP/26-27/00007", issuedAt: new Date(),
    seller: { name: "Seller Pvt Ltd", address: "1 Road, Pune", gstin: "27AAPFU0939F1ZV", state: "Maharashtra", stateCode: "27" },
    buyer: { name: "Buyer Co", address: "Bengaluru", state: "Karnataka", stateCode: "29" },
    shipTo: "Ravi, 9876543210, 5 Station Road, Bengaluru, Karnataka 560001",
    description: "Hardware order HW/26-27/0001",
    lines: [
      { description: "Boom barrier", hsn: "8479", qty: 2, rate: 12500, taxable: 25000, gstPercent: 18, amount: 29500 },
      { description: "Delivery charges", qty: 1, rate: 500, taxable: 500, gstPercent: 18, amount: 590 },
    ],
    subtotal: 25500, discount: 0, taxable: 25500, taxType: "INTER", igst: 4590, cgst: 0, sgst: 0, total: 30090, paymentRef: "pay_1",
  };
  const pdf = buildInvoicePdf(invoice);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.subarray(-6).toString(), /%%EOF/);
  const mixed = buildInvoicePdf({ ...invoice, lines: [...invoice.lines, { description: "Printer", qty: 1, rate: 100, taxable: 100, gstPercent: 12, amount: 112 }] });
  assert.ok(mixed.length > 500);
  // A plan invoice (no lines) still draws.
  assert.equal(buildInvoicePdf({ ...invoice, kind: "PLAN", lines: undefined, users: 3, months: 12 }).subarray(0, 5).toString(), "%PDF-");
});
