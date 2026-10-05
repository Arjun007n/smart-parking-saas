const Company = require("../models/Company");
const Location = require("../models/Location");
const Payment = require("../models/Payment");
const Pass = require("../models/Pass");
const User = require("../models/User");
const { resolveReceiptSettings } = require("../utils/receiptSettings");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Everything a printed or digital receipt needs, for a session that has exited.
// Used by the receipt API and by the thermal printer.
const buildReceipt = async (session) => {
  const [company, location, rows, entryOperator, exitOperator, pass] = await Promise.all([
    Company.findById(session.companyId).select("name legalName gstNumber address logoUrl"),
    Location.findById(session.locationId).select("name address contact receiptSettings"),
    Payment.find({ sessionId: session._id, status: { $in: ["SUCCESS", "REFUNDED"] } }).sort({ paidAt: 1 }),
    session.entryOperatorId ? User.findById(session.entryOperatorId).select("name") : null,
    session.exitOperatorId ? User.findById(session.exitOperatorId).select("name") : null,
    session.passId ? Pass.findById(session.passId).select("passNumber holderName") : null,
  ]);

  const fee = session.fee || {};
  // The fee payment, and the advance taken at entry (if any).
  const payment = rows.find((row) => row.kind !== "ADVANCE") || null;
  const advanceRow = rows.find((row) => row.kind === "ADVANCE") || null;
  const advanceKept = advanceRow ? Math.max(0, advanceRow.amount - ((advanceRow.refund && advanceRow.refund.amount) || 0)) : 0;
  const shownPayment = payment || advanceRow;
  return {
    // How this location wants its receipt to look (header note, footer, what to show).
    settings: resolveReceiptSettings(location.receiptSettings),
    receiptNumber: `R-${session.ticketNumber.slice(2)}`,
    // What a QR code on the receipt should contain.
    reference: session.ticketNumber,
    status: session.status,
    company: {
      name: company.name, legalName: company.legalName, gstNumber: company.gstNumber, address: company.address,
    },
    location: { name: location.name, address: location.address, phone: location.contact && location.contact.phone },
    vehicle: { number: session.vehicleNumber, type: session.vehicleType },
    ticketNumber: session.ticketNumber,
    entryTime: session.entryTime,
    exitTime: session.exitTime,
    durationMinutes: session.durationMinutes,
    entryGate: session.entryGate,
    exitGate: session.exitGate,
    amount: {
      subtotal: fee.subtotal || 0,
      tax: fee.tax || 0,
      total: fee.total || 0,
      // What the customer paid at the counter after the advance.
      due: Number.isFinite(fee.due) ? fee.due : fee.total || 0,
      taxPercent: fee.taxPercent || 0,
      taxInclusive: fee.taxInclusive !== false,
      breakdown: fee.breakdown || {},
    },
    // Money actually received for the stay (fee payment plus the part of any advance
    // that was kept). Zero for free exits and cancellations.
    paid: round2((payment ? payment.amount : 0) + advanceKept),
    payment: shownPayment
      ? { method: shownPayment.method, status: shownPayment.status, transactionId: shownPayment.transactionId, paidAt: shownPayment.paidAt }
      : null,
    // Set when money was taken at entry: what, how, and how much went back.
    advance: advanceRow
      ? {
          amount: advanceRow.amount,
          method: advanceRow.method,
          applied: fee.advanceApplied || 0,
          refunded: (advanceRow.refund && advanceRow.refund.amount) || 0,
        }
      : null,
    pass: pass ? { passNumber: pass.passNumber, holderName: pass.holderName } : null,
    // Pictures taken at the gate (ids only; the file is fetched with its own request).
    photos: (session.photos || []).map((p) => ({ _id: p._id, kind: p.kind, takenAt: p.takenAt })),
    note: session.overrideReason,
    operators: { entry: entryOperator && entryOperator.name, exit: exitOperator && exitOperator.name },
  };
};

module.exports = { buildReceipt };
