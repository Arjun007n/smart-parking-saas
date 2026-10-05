// Charging a FASTag for a parking fee, safely.
//
// The partner call is the dangerous step: it can succeed, fail, or leave us not knowing
// (timeout). The rules this file keeps:
//  * The attempt (FastagCharge) is saved BEFORE the partner is called.
//  * The attempt's id is the partner's idempotency key. We never start a second attempt
//    for a session while an earlier one is PENDING, UNKNOWN or SUCCESS.
//  * "Not known" is settled by asking the partner (by reference), never by guessing.
//    Only a partner that says it never saw the reference (and only after a safe wait)
//    lets us treat the attempt as failed.
//  * A SUCCESS attempt always becomes a Payment (and closes the session), even if the
//    first request died half way: asking again finishes the job.

const AppError = require("../utils/AppError");
const fastag = require("../integrations/fastag");
const FastagCharge = require("../models/FastagCharge");
const Payment = require("../models/Payment");
const audit = require("./auditService");
const { amountDue } = require("./advanceService");
const { cleanTag } = require("../utils/tag");

const sameAmount = (a, b) => Math.abs(a - b) <= 0.005;
const isDuplicateKey = (error) => error && error.code === 11000;
const OPEN = ["PENDING", "UNKNOWN"];
// A partner that has no record of a reference is believed only after the original call could not still be running.
const safeWaitMs = () => (fastag.provider().simulated ? 0 : 90 * 1000);

const referenceOf = (charge) => `FT-${charge._id}`;
const paymentReference = (charge) => `FASTAG:${charge.providerReference}`;

const active = (sessionId) => FastagCharge.findOne({ sessionId, active: true });

// Applies what the partner said. Every change is guarded by the current status, so
// asking twice (or two operators at once) cannot apply a result twice.
const apply = async (charge, outcome) => {
  const guard = { _id: charge._id, status: { $in: OPEN } };
  const checkedAt = new Date();
  let update;
  if (outcome.status === "SUCCESS") {
    update = { $set: { status: "SUCCESS", providerReference: outcome.providerReference, checkedAt }, $unset: { failureReason: 1 } };
  } else if (outcome.status === "FAILED") {
    update = { $set: { status: "FAILED", active: false, failureReason: outcome.reason, checkedAt } };
  } else {
    update = { $set: { status: "UNKNOWN", ...(outcome.reason ? { failureReason: outcome.reason } : {}), checkedAt } };
  }
  const updated = await FastagCharge.findOneAndUpdate(guard, update, { returnDocument: "after" });
  return updated || (await FastagCharge.findById(charge._id));
};

// Asks the partner what became of an attempt that is not settled.
const refresh = async (charge) => {
  if (!OPEN.includes(charge.status) || !fastag.isConfigured()) return charge;
  const answer = await fastag.provider().status({ reference: referenceOf(charge), tagId: charge.tagId });
  if (answer.status === "NOT_FOUND") {
    const age = Date.now() - new Date(charge.createdAt).getTime();
    if (age < safeWaitMs()) return charge;
    return apply(charge, { status: "FAILED", reason: "The FASTag partner has no record of this charge. Nothing was taken." });
  }
  return apply(charge, answer);
};

// The attempt the partner has to settle before anything else may be charged or recorded.
const unsettled = async (sessionId) => {
  const charge = await active(sessionId);
  if (!charge) return null;
  return OPEN.includes(charge.status) ? refresh(charge) : charge;
};

// Starts (or continues) charging a FASTag for a session. Returns { charge }; the caller looks at charge.status.
//   SUCCESS  money taken: make the payment
//   UNKNOWN  not confirmed: the caller asks again in a moment (same call, nothing is charged twice)
//   FAILED   declined: charge.failureReason says why
const charge = async ({ session, tagId, amount, by, shiftId }) => {
  let created;
  if (!fastag.isConfigured()) throw new AppError("FASTag charging is not set up", 503);
  const tag = cleanTag(tagId);
  if (!tag) throw new AppError("Enter the FASTag number (4 to 48 letters and digits)", 400);

  for (let round = 0; round < 2; round += 1) {
    // An earlier attempt for this session comes first.
    const earlier = await unsettled(session._id);
    if (earlier && earlier.status !== "FAILED") {
      if (earlier.tagId !== tag) {
        throw new AppError(`This vehicle's FASTag charge was started with tag ${earlier.tagId}. Use that tag to check or finish it.`, 409);
      }
      return { charge: earlier, repeated: true };
    }

    try {
      created = await FastagCharge.create({
        companyId: session.companyId, locationId: session.locationId, sessionId: session._id,
        tagId: tag, vehicleNumber: session.vehicleNumber, amount, provider: fastag.providerName(),
        by, ...(shiftId ? { shiftId } : {}),
      });
      break;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another request began an attempt at the same moment: the next round reports on that one.
    }
  }
  if (!created) throw new AppError("Another FASTag charge for this vehicle is in progress. Try again in a moment.", 409);

  let outcome;
  try {
    outcome = await fastag.provider().charge({
      reference: referenceOf(created), tagId: tag, vehicleNumber: session.vehicleNumber,
      amount, description: `Parking ${session.ticketNumber}`,
    });
  } catch (error) {
    console.error("FASTag partner call failed:", error.message);
    outcome = { status: "UNKNOWN", reason: "The FASTag partner call failed" };
  }
  return { charge: await apply(created, outcome), repeated: false };
};

// Marks an attempt for an admin to reconcile and leaves a trail in the audit log.
const flag = async (done, req, action, meta) => {
  await FastagCharge.updateOne({ _id: done._id }, { $set: { needsReview: true } });
  await audit.record(req, action, { entity: "FastagCharge", entityId: done._id, companyId: done.companyId, meta });
};

// A session is being closed by another route (admin override, cancelled entry) while a tag may have been
// charged for it and no payment exists. The closing is allowed (the admin may have to), but the money
// can't be lost: the attempt is flagged. Returns the flagged attempt, or null.
const flagIfCharged = async (session, req, why) => {
  const charge = await FastagCharge.findOne({ sessionId: session._id, active: true, paymentId: { $exists: false } });
  if (!charge) return null;
  await flag(charge, req, "FASTAG_CHARGE_ON_CLOSED_SESSION", { sessionId: session._id, status: charge.status, tagId: charge.tagId, amount: charge.amount, why });
  return charge;
};

// Housekeeping, run every minute: ask the partner about attempts that were never confirmed, so a late
// "success" is not lost. A charged tag whose vehicle has already left without this payment is flagged
// and an admin is alerted.
const sweep = async (now = new Date()) => {
  if (!fastag.isConfigured()) return { checked: 0, settled: 0, flagged: 0 };
  const waiting = await FastagCharge.find({
    active: true, status: { $in: OPEN }, createdAt: { $lte: new Date(now.getTime() - 90 * 1000) },
  }).sort({ createdAt: 1 }).limit(100);
  const ParkingSession = require("../models/ParkingSession");
  const { notifyPaymentIssue } = require("./notificationService");
  let settled = 0;
  let flagged = 0;
  for (const charge of waiting) {
    let result;
    try {
      result = await refresh(charge);
    } catch (error) {
      console.error(`Could not ask the FASTag partner about ${charge._id}:`, error.message);
      continue;
    }
    if (result.status !== "SUCCESS") { if (result.status === "FAILED") settled += 1; continue; }
    settled += 1;
    const open = await ParkingSession.exists({ _id: result.sessionId, isOpen: true });
    if (open) continue; // the operator finishes it by pressing the button again
    await FastagCharge.updateOne({ _id: result._id }, { $set: { needsReview: true } });
    flagged += 1;
    await notifyPaymentIssue(
      { _id: result._id, companyId: result.companyId, locationId: result.locationId, sessionId: result.sessionId, transactionId: `FASTAG:${result.providerReference}` },
      "FASTag charged for a vehicle that already left",
      `Tag ${result.tagId} was charged ${result.amount} (partner reference ${result.providerReference}), but the vehicle left without this payment. Reconcile it with your FASTag partner.`
    );
  }
  return { checked: waiting.length, settled, flagged };
};

// Makes the Payment for a charge that succeeded (once). Returns the payment.
// Throws 409 when the fee changed since the tag was charged: the money is real, so the
// attempt is flagged for an admin instead of being turned into a wrong payment.
const paymentFor = async ({ charge: done, session, base, req }) => {
  const reference = paymentReference(done);
  const existing = await Payment.findOne({ transactionId: reference });
  if (existing) return existing;

  const owed = amountDue(session);
  if (!sameAmount(owed, done.amount)) {
    await flag(done, req, "FASTAG_AMOUNT_MISMATCH", { sessionId: session._id, charged: done.amount, owed, providerReference: done.providerReference });
    throw new AppError(
      `The FASTag was charged ${done.amount} but the fee is now ${owed}. Do not take another payment: tell your admin (reference ${done.providerReference}).`,
      409
    );
  }
  let payment;
  try {
    payment = await Payment.create({
      ...base, amount: done.amount, status: "SUCCESS", paidAt: new Date(),
      transactionId: reference, fastagChargeId: done._id, tagId: done.tagId,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // The session already has a paid fee (or this reference was just recorded): use what is there.
    const found = await Payment.findOne({ transactionId: reference });
    if (found) return found;
    await flag(done, req, "FASTAG_CHARGED_BUT_PAID_ELSEWHERE", { sessionId: session._id, amount: done.amount, providerReference: done.providerReference });
    throw new AppError("This session has already been paid. The FASTag was charged too: tell your admin to reverse it.", 409);
  }
  await FastagCharge.updateOne({ _id: done._id }, { $set: { paymentId: payment._id } });
  return payment;
};

module.exports = { charge, unsettled, paymentFor, refresh, referenceOf, flagIfCharged, sweep, OPEN };
