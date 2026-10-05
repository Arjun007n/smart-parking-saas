// Receipt settings (no database): defaults, cleaning, and what they change on the thermal slips.
process.env.NODE_ENV = "test";
process.env.APP_UTC_OFFSET_MINUTES = "330";

const test = require("node:test");
const assert = require("node:assert/strict");
const printer = require("../integrations/printer");
const { DEFAULTS, resolveReceiptSettings, wantsQr } = require("../utils/receiptSettings");

const session = { ticketNumber: "T-261003-ABC234", vehicleNumber: "MH12AB1234", vehicleType: "CAR", entryTime: new Date("2026-10-03T04:30:00Z") };
const ticketArgs = (settings) => ({
  company: { name: "Acme", gstNumber: "27ABCDE1234F1Z5" },
  location: { name: "Lot", address: { line1: "MG Road", city: "Pune" } },
  session,
  settings,
});
const receipt = (settings) => ({
  receiptNumber: "R-261003-ABC234", reference: "T-261003-ABC234", ticketNumber: "T-261003-ABC234",
  company: { name: "Acme", gstNumber: "27ABCDE1234F1Z5" },
  location: { name: "Lot", address: { line1: "MG Road", city: "Pune" } },
  vehicle: { number: "MH12AB1234", type: "CAR" },
  entryTime: new Date("2026-10-03T04:30:00Z"), exitTime: new Date("2026-10-03T07:05:00Z"), durationMinutes: 155,
  amount: { subtotal: 50, tax: 0, total: 50, taxPercent: 0, taxInclusive: true }, paid: 50, payment: { method: "CASH" },
  settings,
});

test("receipt settings: nothing set means the defaults", () => {
  assert.deepEqual(resolveReceiptSettings(undefined), DEFAULTS);
  assert.deepEqual(resolveReceiptSettings({}), DEFAULTS);
  assert.deepEqual(resolveReceiptSettings({ ticketFooter: "   ", showQr: "SOMETIMES", showGst: "yes" }), DEFAULTS);
});

test("receipt settings: values are trimmed and kept; a header note may be cleared", () => {
  const s = resolveReceiptSettings({ headerNote: "  Open 24 hours ", receiptFooter: " Come again ", showAddress: false, showQr: "ON" });
  assert.equal(s.headerNote, "Open 24 hours");
  assert.equal(s.receiptFooter, "Come again");
  assert.equal(s.showAddress, false);
  assert.equal(s.showGst, true);
  assert.equal(s.showQr, "ON");
  assert.equal(resolveReceiptSettings({ headerNote: "" }).headerNote, "");
});

test("receipt settings: QR follows the printer unless the location decides", () => {
  assert.equal(wantsQr(resolveReceiptSettings({}), true), true);
  assert.equal(wantsQr(resolveReceiptSettings({}), false), false);
  assert.equal(wantsQr(resolveReceiptSettings({ showQr: "ON" }), false), true);
  assert.equal(wantsQr(resolveReceiptSettings({ showQr: "OFF" }), true), false);
});

test("printer: a ticket without settings prints exactly as before", () => {
  const { text } = printer.buildTicket(ticketArgs(undefined));
  assert.match(text, /MG Road, Pune/);
  assert.match(text, /GSTIN: 27ABCDE1234F1Z5/);
  assert.match(text, /Keep this ticket safe/);
  assert.doesNotMatch(text, /\[QR/);
});

test("printer: header note, footers, address, GST and QR follow the location's settings", () => {
  const ticket = printer.buildTicket(ticketArgs({ headerNote: "Open 24 hours", ticketFooter: "No refunds on lost tickets", showAddress: false, showGst: false, showQr: "ON" })).text;
  assert.match(ticket, /Open 24 hours/);
  assert.match(ticket, /No refunds on lost tickets/);
  assert.doesNotMatch(ticket, /Keep this ticket safe/);
  assert.doesNotMatch(ticket, /MG Road/);
  assert.doesNotMatch(ticket, /GSTIN/);
  assert.match(ticket, /\[QR: T-261003-ABC234\]/, "ON prints the QR even when the printer says no");

  const slip = printer.buildReceipt(receipt({ receiptFooter: "See you soon", showQr: "OFF" }), { printQr: true }).text;
  assert.match(slip, /See you soon/);
  assert.doesNotMatch(slip, /Drive safe/);
  assert.doesNotMatch(slip, /\[QR/, "OFF hides the QR even when the printer says yes");
  assert.match(slip, /GSTIN: 27ABCDE1234F1Z5/);
});

test("printer: every line still fits 58 mm paper with a long header note and footer", () => {
  const long = "x".repeat(10) + " " + "word ".repeat(30);
  const text = printer.buildTicket(ticketArgs({ headerNote: long, ticketFooter: long }), { paperWidthMm: 58 }).text;
  assert.equal(text.split("\n").every((line) => line.length <= 32), true, text);
});
