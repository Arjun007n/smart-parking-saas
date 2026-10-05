// Advance payments: money an operator takes when a vehicle ENTERS.
//
//   entry   ──► Payment row (kind ADVANCE, status SUCCESS)   + copy on session.advance
//   exit    ──► fee is worked out as usual, then split:
//                 advance covers the fee   → nothing more to pay, any excess is given back
//                 advance is less than fee → the customer pays only what is left (session.fee.due)
//   cancel  ──► the whole advance is given back
//
// Why a Payment row: shifts, the day's collection, reports and the dashboard
// already add up Payment rows by method, operator and shift, so an advance is
// counted in the right drawer on the day it was taken with no extra code there.
//
// An advance given back (all of it, or the part above the fee) is the same row
// marked REFUNDED with refund.amount = what was given back. The amount stays as
// taken, so "collected" and "refunded" on the reports both show the movement
// and the net is right. A REFUNDED advance with refund.amount < amount was
// partly refunded: the rest paid the fee.

const AppError = require("../utils/AppError");
const audit = require("./auditService");
const { notifyPaymentIssue } = require("./notificationService");
const Payment = require("../models/Payment");
const ParkingSession = require("../models/ParkingSession");
const Shift = require("../models/Shift");
const fastag = require("../integrations/fastag");

// An advance is cash, UPI, card or FASTag at the counter. (An online link is for the
// exit fee; nobody is "paying online" at the gate while the barrier is down.)
const ADVANCE_METHODS = Object.freeze(["CASH", "UPI", "CARD", "FASTAG"]);
const MAX_ADVANCE = 100000;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Pure: how an advance is shared between the fee and the customer.
//   total   the parking fee (tax included)
//   advance what was taken at entry (0 when none)
// applied = the part of the advance that pays the fee, due = what is still to
// pay, excess = what must be given back.
const split = (total, advance = 0) => {
  const fee = Math.max(0, Number(total) || 0);
  const taken = Math.max(0, Number(advance) || 0);
  const applied = round2(Math.min(fee, taken));
  return { applied, due: round2(fee - applied), excess: round2(taken - applied) };
};

// What the customer still has to pay for a session whose fee was calculated.
const amountDue = (session) => {
  const fee = (session && session.fee) || {};
  return Number.isFinite(fee.due) ? fee.due : fee.total;
};

// Looks at a request's advance and returns { amount, method, transactionId }, or
// null when there is none. Throws a clear 400 / 403 otherwise.
const checkAdvance = (advance, canCollect) => {
  if (advance === undefined || advance === null) return null;
  const amount = round2(Number(advance.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null; // "0" means no advance
  if (!canCollect) throw new AppError("You are not allowed to take a payment", 403);
  if (amount > MAX_ADVANCE) throw new AppError(`An advance cannot be more than ${MAX_ADVANCE}`, 400);
  const method = advance.method || "CASH";
  if (!ADVANCE_METHODS.includes(method)) {
    throw new AppError(`An advance can be taken by ${ADVANCE_METHODS.join(", ")}`, 400);
  }
  // With a FASTag partner set up, FASTag means "really charge the tag", which the entry screen cannot do.
  if (method === "FASTAG" && fastag.isConfigured()) {
    throw new AppError("An advance cannot be taken by FASTag. Use cash, UPI or card; the fee itself can be charged to the FASTag at the exit.", 400);
  }
  const transactionId = typeof advance.transactionId === "string" ? advance.transactionId.trim().slice(0, 100) : "";
  return { amount, method, ...(transactionId ? { transactionId } : {}) };
};

// The open shift of this operator at this location, if any (cash is counted there).
const openShiftOf = (userId, locationId) => Shift.findOne({ operatorId: userId, locationId, status: "OPEN" });

// A payment reference may be used once. Checked before the ticket is made so
// the entry is not created for nothing.
const assertReferenceFree = async (transactionId) => {
  if (transactionId && (await Payment.exists({ transactionId }))) {
    throw new AppError("This payment reference was already used", 409);
  }
};

// Records the advance for a session that was just created and copies it onto the session.
const recordAdvance = async (req, session, { amount, method, transactionId }) => {
  const shift = await openShiftOf(req.user._id, session.locationId);
  const payment = await Payment.create({
    companyId: session.companyId,
    locationId: session.locationId,
    sessionId: session._id,
    kind: "ADVANCE",
    amount,
    tax: 0,
    method,
    status: "SUCCESS",
    paidAt: new Date(),
    collectedBy: req.user._id,
    ...(shift ? { shiftId: shift._id } : {}),
    ...(transactionId ? { transactionId } : {}),
  });
  const updated = await ParkingSession.findOneAndUpdate(
    { _id: session._id },
    { $set: { advance: { amount, method, paymentId: payment._id, at: payment.paidAt } } },
    { returnDocument: "after" }
  );
  await audit.record(req, "ADVANCE_RECEIVED", {
    entity: "Payment", entityId: payment._id, companyId: session.companyId,
    meta: { sessionId: session._id, ticketNumber: session.ticketNumber, amount, method },
  });
  return { payment, session: updated || session };
};

// Marks the advance of a session as given back (all of it, or `amount`).
// `retainedTax` is the tax of the fee that the kept part paid, so the day's tax
// total is complete when no separate fee payment is ever made.
// Guarded on status, so asking twice gives the money back once. Returns the
// updated payment, or null when there was nothing to give back.
const giveBack = async (req, session, { amount, reason, retainedTax }) => {
  if (!session.advance || !session.advance.paymentId) return null;
  const refundAmount = round2(amount === undefined ? session.advance.amount : amount);
  if (refundAmount <= 0 && retainedTax === undefined) return null;

  // An advance that came from an online booking was paid to the gateway, not into a cash drawer:
  // its refund is made by an admin in the gateway, so it is marked pending and an alert is raised.
  const online = session.advance.method === "GATEWAY";
  const shift = online ? null : await openShiftOf(req.user._id, session.locationId);
  const payment = await Payment.findOneAndUpdate(
    { _id: session.advance.paymentId, kind: "ADVANCE", status: "SUCCESS" },
    {
      $set: {
        ...(refundAmount > 0
          ? {
              status: "REFUNDED",
              refund: {
                amount: refundAmount,
                reason,
                refundedBy: req.user._id,
                refundedAt: new Date(),
                ...(online ? { gatewayPending: true } : {}),
                ...(shift ? { shiftId: shift._id } : {}),
              },
            }
          : {}),
        ...(retainedTax !== undefined ? { tax: retainedTax } : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (payment && refundAmount > 0) {
    await audit.record(req, "ADVANCE_REFUNDED", {
      entity: "Payment", entityId: payment._id, companyId: payment.companyId,
      meta: { sessionId: session._id, ticketNumber: session.ticketNumber, amount: refundAmount, method: payment.method, reason },
    });
    if (online) {
      await notifyPaymentIssue(payment, "Refund an online booking fee",
        `Ticket ${session.ticketNumber} (${session.vehicleNumber}): Rs ${refundAmount} of the fee paid online must go back to the customer. Refund it in the gateway (transaction ${payment.transactionId}).`)
        .catch((error) => console.error("Could not raise the refund alert:", error.message));
    }
  }
  return payment;
};

// Called after a session was closed with its fee fully covered by the advance:
// gives back what is above the fee and books the fee's tax on the advance row.
// Returns what was given back.
const finishAtExit = async (req, session, { applied, excess, tax }) => {
  const payment = await giveBack(req, session, {
    amount: excess,
    reason: excess > 0 ? "Advance was more than the parking fee" : undefined,
    retainedTax: applied > 0 ? round2(tax || 0) : undefined,
  });
  return payment ? excess : 0;
};

// Old databases have the unique index "one success per session", which would
// stop a session having both an advance and a fee. Drops it (the model creates
// its replacement). Safe to run every start.
const migrateIndexes = async () => {
  let indexes;
  try {
    indexes = await Payment.collection.indexes();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return false; // collection not created yet
    throw error;
  }
  if (!indexes.some((index) => index.name === "one_success_per_session")) return false;
  await Payment.collection.dropIndex("one_success_per_session");
  await Payment.createIndexes();
  return true;
};

module.exports = {
  ADVANCE_METHODS, MAX_ADVANCE, split, amountDue, checkAdvance, assertReferenceFree,
  recordAdvance, giveBack, finishAtExit, migrateIndexes, round2,
};
