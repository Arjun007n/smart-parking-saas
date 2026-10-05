// Plan prices, GST, invoice PDF, number words, the daily-report wording. No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const pricing = require("../config/pricing");
const gst = require("../utils/gst");
const { rupeesInWords } = require("../utils/numberWords");
const { buildInvoicePdf } = require("../utils/invoicePdf");
const reports = require("../services/dailyReportService");

test("the server's plan prices match the website's (client/src/data/site.js)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../client/src/data/site.js"), "utf8");
  const read = (name) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(source)[1]);
  assert.equal(read("parkingPerUserMonth"), pricing.PRICING.parkingPerUserMonth);
  assert.equal(read("gstPercent"), pricing.PRICING.gstPercent);
  const tenures = [...source.matchAll(/\{ months: (\d+), discount: (\d+) \}/g)].map((m) => ({ months: Number(m[1]), discount: Number(m[2]) }));
  assert.deepEqual(tenures, pricing.PRICING.tenures.map((t) => ({ months: t.months, discount: t.discount })));
});

test("plan price: users x months x price, less the discount, plus GST (whole rupees)", () => {
  assert.deepEqual(pricing.planPrice({ users: 1, months: 1 }), {
    subtotal: 499, discount: 0, gross: 499, gst: 90, cgst: 45, sgst: 45, total: 589, perMonth: 499, discountPercent: 0,
  });
  const year = pricing.planPrice({ users: 5, months: 12 });
  assert.equal(year.subtotal, 29940);
  assert.equal(year.discount, 5988); // 20%
  assert.equal(year.gross, 23952);
  assert.equal(year.gst, 4311); // 18% of 23952 = 4311.36
  assert.equal(year.cgst + year.sgst, year.gst);
  assert.equal(year.total, year.gross + year.gst);
  assert.throws(() => pricing.planPrice({ users: 1, months: 7 }), /not offered/);
});

test("GSTIN checks and states", () => {
  assert.equal(gst.isGstin("27AAPFU0939F1ZV"), true);
  assert.equal(gst.isGstin("27aapfu0939f1zv"), true, "case does not matter");
  assert.equal(gst.isGstin("99AAPFU0939F1ZV"), false, "no such state code");
  assert.equal(gst.isGstin("27AAPFU0939F1AV"), false, "the 14th character is Z");
  assert.equal(gst.isGstin(""), false);
  assert.deepEqual(gst.stateOf({ gstin: "29AAPFU0939F1ZV" }), { code: "29", name: "Karnataka" });
  assert.deepEqual(gst.stateOf({ name: "  tamil nadu " }), { code: "33", name: "Tamil Nadu" });
  assert.deepEqual(gst.stateOf({ name: "Jammu & Kashmir" }), { code: "01", name: "Jammu and Kashmir" });
  assert.deepEqual(gst.stateOf({ name: "Orissa" }), { code: "21", name: "Odisha" });
  assert.equal(gst.stateOf({ name: "Nowhere" }), null);
  assert.equal(gst.stateOf({}), null);
  // A valid GSTIN wins over a different state name.
  assert.equal(gst.stateOf({ gstin: "27AAPFU0939F1ZV", name: "Kerala" }).name, "Maharashtra");
});

test("GST is split in half inside the seller's state and charged whole (IGST) outside it", () => {
  const mh = { code: "27", name: "Maharashtra" };
  const ka = { code: "29", name: "Karnataka" };
  assert.deepEqual(gst.splitTax({ gst: 4311, sellerState: mh, buyerState: mh }), { taxType: "INTRA", cgst: 2156, sgst: 2155, igst: 0 });
  assert.deepEqual(gst.splitTax({ gst: 4311, sellerState: mh, buyerState: ka }), { taxType: "INTER", cgst: 0, sgst: 0, igst: 4311 });
  assert.equal(gst.splitTax({ gst: 90, sellerState: mh, buyerState: null }).taxType, "INTER");
});

test("the financial year runs April to March", () => {
  assert.equal(gst.financialYear("2026-03-31"), "25-26");
  assert.equal(gst.financialYear("2026-04-01"), "26-27");
  assert.equal(gst.financialYear("2026-12-31"), "26-27");
  assert.equal(gst.financialYear("2027-01-01"), "26-27");
});

test("amounts in words use lakh and crore", () => {
  assert.equal(rupeesInWords(0), "Rupees Zero Only");
  assert.equal(rupeesInWords(589), "Rupees Five Hundred Eighty Nine Only");
  assert.equal(rupeesInWords(28263), "Rupees Twenty Eight Thousand Two Hundred Sixty Three Only");
  assert.equal(rupeesInWords(100000), "Rupees One Lakh Only");
  assert.equal(rupeesInWords(12345678), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
  assert.equal(rupeesInWords(10.5), "Rupees Ten and Fifty Paise Only");
});

const invoice = (extra = {}) => ({
  number: "SP/26-27/00001", issuedAt: new Date("2026-10-05T06:00:00Z"),
  seller: { name: "Example Pvt Ltd", gstin: "27AAPFU0939F1ZV", address: "1 MG Road, Pune", state: "Maharashtra", stateCode: "27", sac: "9983" },
  buyer: { name: "Acme (Parking) LLP", gstin: "", address: "22 Park Street, Kolkata", state: "West Bengal", stateCode: "19" },
  description: "Parking Management plan: 5 users for 12 months", users: 5, months: 12,
  periodStart: new Date("2026-10-05T06:00:00Z"), periodEnd: new Date("2027-10-05T06:00:00Z"),
  subtotal: 29940, discount: 5988, taxable: 23952, gstPercent: 18, taxType: "INTER", cgst: 0, sgst: 0, igst: 4311, total: 28263,
  paymentRef: "pay_123", ...extra,
});

test("the invoice PDF is a real PDF for both tax types, and handles brackets and non-Latin letters", () => {
  const inter = buildInvoicePdf(invoice());
  assert.equal(inter.subarray(0, 5).toString(), "%PDF-");
  assert.match(inter.subarray(-6).toString(), /%%EOF/);
  const intra = buildInvoicePdf(invoice({ taxType: "INTRA", cgst: 2156, sgst: 2155, igst: 0, buyer: { name: "आदित्य (Test) \\ Ltd", address: "x", state: "Maharashtra", stateCode: "27" } }));
  assert.equal(intra.subarray(0, 5).toString(), "%PDF-");
  assert.notDeepEqual(inter, intra);
});

test("daily report: times, wording and escaping", () => {
  assert.equal(reports.textToMinutes("22:00"), 1320);
  assert.equal(reports.textToMinutes("00:05"), 5);
  assert.equal(reports.textToMinutes("24:00"), null);
  assert.equal(reports.textToMinutes("9:30"), null);
  assert.equal(reports.minutesToText(1320), "22:00");
  assert.equal(reports.minutesToText(5), "00:05");

  const summary = {
    dateText: "2026-10-05",
    rows: [{ name: "Main <b>lot</b>", entries: 12, exits: 9, inside: 3, capacity: 50, collected: 1450, refunded: 50 }],
    totals: { entries: 12, exits: 9, inside: 3, capacity: 50, collected: 1450, refunded: 50, passSales: 1000, passCount: 1, failedOnline: 2,
      byMethod: { CASH: 800, UPI: 650, CARD: 0, GATEWAY: 0, FASTAG: 0, COMPLIMENTARY: 0 } },
  };
  const message = reports.renderReport({ companyName: "Acme <script>alert(1)</script>", summary, url: "http://localhost:5173/dashboard" });
  assert.match(message.subject, /^Daily report 5 October 2026: Rs 1,450 collected, 12 in, 9 out$/);
  assert.match(message.text, /By method: Cash Rs 800, UPI Rs 650/);
  assert.match(message.text, /Passes sold or renewed: 1 \(Rs 1,000\)/);
  assert.match(message.text, /Failed online payments: 2/);
  assert.ok(!message.html.includes("<script>"), "company name is escaped");
  assert.ok(!message.html.includes("<b>lot</b>"), "location name is escaped");
  assert.match(message.html, /&lt;script&gt;/);
  const partial = reports.renderReport({ companyName: "Acme", summary, partial: true, url: "http://x" });
  assert.match(partial.subject, /^Report so far 5 October 2026/);
});

test("email: attachments reach the simulated provider as names and sizes only", async () => {
  process.env.EMAIL_PROVIDER = "simulated";
  const email = require("../integrations/email");
  email.outbox.length = 0;
  const result = await email.send({ to: ["a@example.com"], subject: "Invoice", text: "Attached.", attachments: [{ filename: "inv.pdf", content: Buffer.from("%PDF-test") }] });
  assert.equal(result.sent, true);
  assert.deepEqual(email.outbox[0].attachments, [{ filename: "inv.pdf", bytes: 9 }]);
  assert.equal(email.outbox[0].content, undefined);
});
