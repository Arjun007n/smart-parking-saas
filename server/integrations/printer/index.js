// Thermal printer adapter layer (plan, section 22).
//
// Turns a ticket or a receipt into printer bytes. The result goes to the
// gate agent as a PRINT_* command; the agent only forwards the bytes.

const { EscPos, columnsFor } = require("./escpos");
const { utcOffsetMinutes } = require("../../utils/time");
const { resolveOperations } = require("../../utils/operations");
const { resolveReceiptSettings, wantsQr } = require("../../utils/receiptSettings");

const COMMAND_DEFAULTS = Object.freeze({
  PRINT_TICKET: { ttlSeconds: 300, ackTimeoutSeconds: 15, maxAttempts: 2 },
  PRINT_RECEIPT: { ttlSeconds: 600, ackTimeoutSeconds: 15, maxAttempts: 2 },
  PRINT_TEST: { ttlSeconds: 120, ackTimeoutSeconds: 15, maxAttempts: 2 },
});

// "02 Mar 2026, 14:35" in the business's local time.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const localStamp = (date) => {
  if (!date) return "-";
  const local = new Date(new Date(date).getTime() + utcOffsetMinutes() * 60000);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(local.getUTCDate())} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`;
};

const duration = (minutes) => {
  if (minutes === undefined || minutes === null) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

const money = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;

const header = (printer, company, location, settings) => {
  printer.align("center").bold(true).size(2).line(company.name).size(1).bold(false);
  if (location && location.name) printer.line(location.name);
  const address = location && location.address;
  if (settings.showAddress && address && address.line1) printer.wrap([address.line1, address.city].filter(Boolean).join(", "));
  if (settings.showGst && company.gstNumber) printer.line(`GSTIN: ${company.gstNumber}`);
  if (settings.headerNote) printer.wrap(settings.headerNote);
  printer.align("left").rule();
};

// What goes on the slip handed to the driver at the entry gate.
const buildTicket = ({ company, location, session, settings: rawSettings, operations: rawOperations }, { paperWidthMm = 80, printQr = false } = {}) => {
  const settings = resolveReceiptSettings(rawSettings);
  const p = new EscPos({ columns: columnsFor(paperWidthMm) });
  header(p, company, location, settings);
  p.align("center").line("PARKING TICKET");
  // A location may keep the number off the paper (the QR code still carries it).
  if (resolveOperations(rawOperations).printTicketNumber) p.bold(true).size(2).line(session.ticketNumber).size(1).bold(false);
  p.align("left");
  p.rule();
  p.pair("Vehicle", session.vehicleNumber);
  p.pair("Type", session.vehicleType);
  p.pair("Entry", localStamp(session.entryTime));
  if (session.entryGate) p.pair("Gate", session.entryGate);
  p.rule();
  p.align("center");
  if (wantsQr(settings, printQr)) p.qr(session.ticketNumber).feed(1);
  p.wrap(settings.ticketFooter).line("Thank you!").align("left");
  p.feed(3).cut();
  return { buffer: p.toBuffer(), text: p.toText() };
};

// `receipt` is the object made by services/receiptService.js.
const buildReceipt = (receipt, { paperWidthMm = 80, printQr = false } = {}) => {
  const settings = resolveReceiptSettings(receipt.settings);
  const p = new EscPos({ columns: columnsFor(paperWidthMm) });
  header(p, receipt.company, receipt.location, settings);
  p.align("center").bold(true).line("PARKING RECEIPT").bold(false).align("left");
  p.pair("Receipt", receipt.receiptNumber);
  p.pair("Ticket", receipt.ticketNumber);
  p.rule();
  p.pair("Vehicle", receipt.vehicle.number);
  p.pair("Entry", localStamp(receipt.entryTime));
  p.pair("Exit", localStamp(receipt.exitTime));
  p.pair("Duration", duration(receipt.durationMinutes));
  p.rule();
  const amount = receipt.amount;
  p.pair("Subtotal", money(amount.subtotal));
  if (amount.tax) p.pair(`Tax (${amount.taxPercent}%${amount.taxInclusive ? " incl." : ""})`, money(amount.tax));
  p.bold(true).pair("TOTAL", money(amount.total)).bold(false);
  if (receipt.advance) {
    p.pair("Advance paid", money(receipt.advance.amount));
    if (receipt.advance.refunded) p.pair("Advance returned", money(receipt.advance.refunded));
  }
  p.pair("Paid", money(receipt.paid));
  if (receipt.payment) p.pair("Method", receipt.payment.method);
  if (receipt.pass) p.pair("Pass", receipt.pass.passNumber);
  if (receipt.note) p.rule().wrap(`Note: ${receipt.note}`);
  p.rule();
  p.align("center");
  if (wantsQr(settings, printQr)) p.qr(receipt.reference).feed(1);
  p.wrap(settings.receiptFooter).align("left");
  p.feed(3).cut();
  return { buffer: p.toBuffer(), text: p.toText() };
};

const buildTest = (device, { paperWidthMm = 80 } = {}) => {
  const p = new EscPos({ columns: columnsFor(paperWidthMm) });
  p.align("center").bold(true).line("PRINTER TEST").bold(false).align("left").rule();
  p.pair("Device", device.name);
  p.pair("Paper", `${paperWidthMm} mm`);
  p.pair("Time", localStamp(new Date()));
  p.rule().line("0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, p.columns));
  p.align("center").line("If you can read this,").line("the printer works.").align("left");
  p.feed(3).cut();
  return { buffer: p.toBuffer(), text: p.toText() };
};

// The payload sent to the gate agent.
const toPayload = ({ buffer, text }) => ({ format: "escpos", dataBase64: buffer.toString("base64"), text });

module.exports = { COMMAND_DEFAULTS, buildTicket, buildReceipt, buildTest, toPayload, localStamp, duration, money };
