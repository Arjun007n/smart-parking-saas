// Online (gateway) payments: starting one, settling its result, and catching
// the ones whose result never arrived.
//
//   createOrder ─► PENDING ─► SUCCESS   gateway webhook (or the sweep asked the gateway)
//                     │  └───► FAILED    gateway said it failed, the operator cancelled, or it expired
//                     └ A FAILED-by-expiry payment can still become SUCCESS: if the customer
//                       really paid late, the money is real and must not be ignored.
//
// Rules this file keeps:
//  * The money is truth. If the gateway says it took money, we never lose track
//    of it: either the payment becomes SUCCESS, or an alert (PAYMENT_ISSUE)
//    tells an admin exactly what to refund or reconcile.
//  * Results can arrive twice, late or out of order. Every change is guarded by
//    the payment's current status, so repeating one changes nothing.

const AppError = require("../utils/AppError");
const audit = require("./auditService");
const sessions = require("./sessionService");
const hardware = require("./hardwareService");
const { publish, EVENTS } = require("./eventBus");
const { notifyPaymentFailed, notifyPaymentIssue } = require("./notificationService");
const gateway = require("../integrations/payment");
const { amountDue } = require("./advanceService");
const Payment = require("../models/Payment");
const ParkingSession = require("../models/ParkingSession");
const messageService = require("./messageService");

// A calculated fee is accepted for this long (also: how long after starting an
// online payment the barrier may still open by itself).
const FEE_VALID_MINUTES = 15;
const EXPIRED_REASON = "Expired without payment";
const DUPLICATE_REASON = "The session was already paid. This customer was charged twice: refund this payment.";
// Used when the sweep runs without a request (nobody is logged in).
const SYSTEM_REQ = Object.freeze({ headers: {}, ip: "system" });

const paymentMinutes = () => Math.min(120, Math.max(5, Number(process.env.GATEWAY_PAYMENT_MINUTES) || 20));
const sameAmount = (a, b) => Math.abs(a - b) <= 0.005;

const finalStatusFor = (session) => (session.lostTicket ? "LOST_TICKET" : "COMPLETED");

// Marks the session as exited after its payment succeeded.
const completePaidSession = (session, payment, operatorId) =>
  sessions.closeSession(session._id, finalStatusFor(session), {
    paymentId: payment._id,
    ...(operatorId ? { exitOperatorId: operatorId, closedBy: operatorId } : {}),
  });

// Starts an online payment for a session whose fee was just calculated.
// A payment already waiting for the same amount is returned again, so a double
// tap or a second operator cannot create two payment links for one fee.
const startOnlinePayment = async ({ session, base }) => {
  const chosen = gateway.provider();
  if (!chosen || !chosen.isConfigured()) throw new AppError("Online payment is not set up yet", 503);

  const waiting = await Payment.findOne({
    sessionId: session._id, method: "GATEWAY", status: "PENDING",
    expiresAt: { $gt: new Date() }, amount: amountDue(session),
  });
  if (waiting) return { payment: waiting, repeated: true };

  const expiresAt = new Date(Date.now() + paymentMinutes() * 60000);
  const order = await chosen.createOrder({ amount: amountDue(session), session, expiresAt });
  const payment = await Payment.create({
    ...base,
    status: "PENDING",
    provider: chosen.name,
    transactionId: order.transactionId,
    ...(order.gatewayRef ? { gatewayRef: order.gatewayRef } : {}),
    ...(order.payUrl ? { payUrl: order.payUrl } : {}),
    expiresAt: order.expiresAt || expiresAt,
  });
  return { payment, repeated: false };
};

// Applies a result reported by the gateway (webhook, simulator or sweep).
// event: { transactionId, status: "SUCCESS" | "FAILED", gatewayRef?, gatewayPaymentId?, reason?, amount? }
// Returns { outcome, payment?, closed?, hardware? }.
const settle = async (event, req = SYSTEM_REQ) => {
  const { transactionId, status, gatewayRef, gatewayPaymentId, reason, amount } = event;
  const existing = await Payment.findOne({ transactionId, method: "GATEWAY" });
  if (!existing) return { outcome: "unknown" };
  // A result we already applied (the gateway retried its webhook).
  if (["SUCCESS", "REFUNDED"].includes(existing.status) && status === "SUCCESS") {
    // If we stopped half way last time (paid, but the session was not closed),
    // the retry finishes the job. A session that is already closed is left alone.
    let closed = null;
    if (existing.status === "SUCCESS") {
      const open = await ParkingSession.findOne({ _id: existing.sessionId, isOpen: true, paymentId: { $exists: false } });
      if (open) closed = await completePaidSession(open, existing, null);
    }
    return { outcome: "already", payment: existing, ...(closed ? { closed } : {}) };
  }

  const refs = {
    ...(gatewayRef ? { gatewayRef } : {}),
    ...(gatewayPaymentId ? { gatewayPaymentId } : {}),
  };
  const meta = { sessionId: existing.sessionId, amount: existing.amount, method: "GATEWAY", provider: existing.provider };

  if (status === "FAILED") {
    const failed = await Payment.findOneAndUpdate(
      { _id: existing._id, status: "PENDING" },
      { $set: { status: "FAILED", failureReason: (reason || "Payment failed").slice(0, 200), ...refs } },
      { returnDocument: "after" }
    );
    if (!failed) return { outcome: "ignored", payment: existing };
    publish(EVENTS.PAYMENT_FAILED, { companyId: failed.companyId, locationId: failed.locationId, payment: failed });
    await notifyPaymentFailed(failed, failed.failureReason);
    await audit.record(req, "PAYMENT_FAILED", { entity: "Payment", entityId: failed._id, companyId: failed.companyId, meta });
    return { outcome: "failed", payment: failed };
  }

  // SUCCESS. First check the gateway took what we asked for.
  const closable = { _id: existing._id, $or: [{ status: "PENDING" }, { status: "FAILED", failureReason: EXPIRED_REASON }] };
  // The amount must match what we asked for AND what is owed now: a fee that
  // was calculated again later (a longer stay) makes an older payment link stale.
  const owing = await ParkingSession.findOne({ _id: existing.sessionId, isOpen: true }).select("fee");
  const feeNow = owing ? amountDue(owing) : undefined;
  const wrongAmount = amount !== undefined && !sameAmount(amount, existing.amount);
  const staleFee = !wrongAmount && feeNow !== undefined && !sameAmount(feeNow, existing.amount);
  if (wrongAmount || staleFee) {
    const reasonText = wrongAmount
      ? `The gateway reports ${amount}, but the fee was ${existing.amount}`
      : `The fee was calculated again and is now ${feeNow}, but this payment was for ${existing.amount}`;
    const flagged = await Payment.findOneAndUpdate(
      closable,
      { $set: { status: "FAILED", failureReason: reasonText, ...refs } },
      { returnDocument: "after" }
    );
    if (!flagged) return { outcome: "ignored", payment: existing };
    await notifyPaymentIssue(flagged, wrongAmount ? "An online payment had the wrong amount" : "An online payment was for an out-of-date fee",
      `Payment ${flagged.transactionId}: ${reasonText}. The vehicle was not released. Refund it in the gateway and take the fee again.`);
    await audit.record(req, "PAYMENT_AMOUNT_MISMATCH", {
      entity: "Payment", entityId: flagged._id, companyId: flagged.companyId, meta: { ...meta, reported: wrongAmount ? amount : existing.amount, ...(staleFee ? { feeNow } : {}) },
    });
    return { outcome: "mismatch", payment: flagged };
  }

  let payment;
  try {
    payment = await Payment.findOneAndUpdate(
      closable,
      { $set: { status: "SUCCESS", paidAt: new Date(), ...refs }, $unset: { failureReason: "" } },
      { returnDocument: "after" }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Another payment already succeeded for this session: this customer paid twice.
    const doubled = await Payment.findOneAndUpdate(
      closable,
      { $set: { status: "FAILED", failureReason: DUPLICATE_REASON, ...refs } },
      { returnDocument: "after" }
    );
    if (doubled) {
      await notifyPaymentIssue(doubled, "A customer paid twice",
        `Payment ${doubled.transactionId} of ${doubled.amount} arrived after the session was already paid. Refund it in the gateway.`);
      await audit.record(req, "PAYMENT_DUPLICATE", { entity: "Payment", entityId: doubled._id, companyId: doubled.companyId, meta });
    }
    return { outcome: "duplicate", payment: doubled || existing };
  }

  if (!payment) {
    // The gateway took money for a payment we had already closed (cancelled by
    // the operator, or failed). Never lose sight of it.
    if (Object.keys(refs).length) await Payment.updateOne({ _id: existing._id }, { $set: refs });
    await notifyPaymentIssue(existing, "Money arrived for a payment that was closed",
      `Payment ${existing.transactionId} of ${existing.amount} was ${String(existing.status).toLowerCase()} here, but the gateway took the money. Check the session and refund it if it was not needed.`);
    await audit.record(req, "PAYMENT_UNMATCHED", { entity: "Payment", entityId: existing._id, companyId: existing.companyId, meta });
    return { outcome: "unmatched", payment: existing };
  }

  const session = await ParkingSession.findById(payment.sessionId);
  const closed = session ? await completePaidSession(session, payment, null) : null;
  publish(EVENTS.PAYMENT_RECEIVED, { companyId: payment.companyId, locationId: payment.locationId, payment });

  let devices = null;
  let barrierSkipped = false;
  if (closed) {
    publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });
    // Paid online: nobody is at the counter, so the barrier opens by itself.
    // But a payment confirmed long after it was started (the driver may have
    // given up and left) must not lift a barrier for whoever is there now.
    const ageMinutes = (Date.now() - new Date(payment.createdAt).getTime()) / 60000;
    if (ageMinutes <= FEE_VALID_MINUTES) devices = await hardware.afterExit({ session: closed });
    else barrierSkipped = true;
    messageService.sendVisitNotice({ session: closed, kind: "EXIT" });
  } else {
    await notifyPaymentIssue(payment, "Payment received but the vehicle was already released",
      `Payment ${payment.transactionId} of ${payment.amount} succeeded, but its session was no longer waiting for payment (closed by an admin or by a pass). Refund it if it was not needed.`);
    await audit.record(req, "PAYMENT_WITHOUT_EXIT", { entity: "Payment", entityId: payment._id, companyId: payment.companyId, meta: { sessionId: payment.sessionId } });
  }
  await audit.record(req, "PAYMENT_RECEIVED", {
    entity: "Payment", entityId: payment._id, companyId: payment.companyId,
    meta: { ...meta, ...(barrierSkipped ? { barrier: "not opened: payment confirmed too late" } : {}) },
  });
  return { outcome: "success", payment, closed, hardware: devices };
};

// Housekeeping, run every minute. For online payments still waiting:
//  * ask the gateway what happened (the webhook may have been lost),
//  * close the ones past their deadline so nobody waits for them any more.
const sweepPending = async (now = new Date()) => {
  const waiting = await Payment.find({
    method: "GATEWAY", status: "PENDING", createdAt: { $lte: new Date(now.getTime() - 90 * 1000) },
  }).sort({ createdAt: 1 }).limit(100);

  let settled = 0;
  let expired = 0;
  for (const payment of waiting) {
    const owner = gateway.PROVIDERS[payment.provider] || gateway.provider();
    let known = null;
    try {
      known = owner ? await owner.fetchStatus(payment) : null;
    } catch (error) {
      console.error(`Could not ask the gateway about ${payment.transactionId}:`, error.message);
    }
    if (known) {
      const result = await settle({ transactionId: payment.transactionId, ...known });
      if (["success", "failed", "mismatch", "duplicate"].includes(result.outcome)) settled += 1;
      continue;
    }
    const deadline = payment.expiresAt || new Date(payment.createdAt.getTime() + 24 * 3600 * 1000);
    if (deadline > now) continue;
    const closed = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "PENDING" },
      { $set: { status: "FAILED", failureReason: EXPIRED_REASON } },
      { returnDocument: "after" }
    );
    if (closed) expired += 1;
  }
  return { checked: waiting.length, settled, expired };
};

module.exports = {
  FEE_VALID_MINUTES, EXPIRED_REASON, DUPLICATE_REASON, SYSTEM_REQ,
  paymentMinutes, completePaidSession, startOnlinePayment, settle, sweepPending,
};
