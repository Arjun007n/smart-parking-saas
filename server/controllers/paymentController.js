const subscriptions = require("../services/subscriptionService");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { dayRange } = require("../utils/time");
const { locationScopedFilter, locationIdFromQuery } = require("../utils/scope");
const { isCompanyWide } = require("../config/permissions");
const gateway = require("../integrations/payment");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const User = require("../models/User");
const Shift = require("../models/Shift");
const { publish, EVENTS } = require("../services/eventBus");
const { notifyPaymentFailed } = require("../services/notificationService");
const { round2, mergeGroups } = require("../services/collectionService");
const PassPayment = require("../models/PassPayment");
const hardware = require("../services/hardwareService");
const payments = require("../services/paymentService");
const advances = require("../services/advanceService");
const onlineBookings = require("../services/onlineBookingService");
const billing = require("../services/billingService");
const shop = require("../services/shopService");
const messageService = require("../services/messageService");
const wallets = require("../services/walletService");
const fastagService = require("../services/fastagService");
const fastagProvider = require("../integrations/fastag");
const WalletTxn = require("../models/WalletTxn");
const { FEE_VALID_MINUTES, completePaidSession } = payments;

const PAGE_SIZE = 50;

// Closes the session a payment just paid for, raises the barrier and answers the request.
// Shared by every way of paying at the exit.
const finishPayment = async (req, res, session, payment) => {
  const closed = await completePaidSession(session, payment, req.user._id);
  await audit.record(req, "PAYMENT_RECEIVED", {
    entity: "Payment", entityId: payment._id, companyId: payment.companyId,
    meta: { sessionId: session._id, ticketNumber: session.ticketNumber, amount: payment.amount, method: payment.method },
  });
  if (!closed) {
    // Two requests for the same payment at once: the other one closed it, which is fine.
    const current = await ParkingSession.findById(session._id);
    if (current && !current.isOpen && String(current.paymentId) === String(payment._id)) {
      return res.json({ success: true, data: { payment, session: current, completed: true, repeated: true } });
    }
    // Money was taken but the session was closed by someone else in the same
    // moment (for example an admin override). Flag it for reconciliation.
    await audit.record(req, "PAYMENT_WITHOUT_EXIT", {
      entity: "Payment", entityId: payment._id, companyId: payment.companyId, meta: { sessionId: session._id },
    });
    throw new AppError("Payment recorded, but this session was already closed. Tell your admin.", 409);
  }

  publish(EVENTS.PAYMENT_RECEIVED, { companyId: payment.companyId, locationId: payment.locationId, payment });
  publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });

  // Raise the exit barrier and print the receipt. Never fails the payment.
  const devices = await hardware.afterExit({ session: closed, requestedBy: req.user._id });
  messageService.sendVisitNotice({ session: closed, kind: "EXIT" });

  res.status(201).json({ success: true, data: { payment, session: closed, completed: true, hardware: devices } });
};

// POST /api/payments
// Step 2 of leaving: record the payment for a session whose fee was calculated
// by POST /api/parking/exit. The amount always comes from the server's own
// calculation; the client only confirms what it showed to the customer.
const createPayment = async (req, res) => {
  const { sessionId, method, amount, transactionId, walletId, tagId } = req.body;

  const session = await ParkingSession.findOne({ $and: [{ _id: sessionId }, locationScopedFilter(req)] });
  if (!session) throw new AppError("Parking session not found", 404);
  if (session.isOpen && (method === "GATEWAY" || method === "FASTAG")) {
    await subscriptions.assertAddon(session.companyId, session.locationId, method === "GATEWAY" ? "gateway" : "fastag");
  }
  if (!session.isOpen) {
    // The same operator sending the same payment again (for example a retry
    // after a lost connection) gets the original result, not an error, and
    // nothing is charged twice.
    const original = await Payment.findOne({
      sessionId: session._id, status: "SUCCESS", collectedBy: req.user._id, method, kind: { $ne: "ADVANCE" },
    });
    if (original && Math.abs(original.amount - amount) <= 0.005) {
      return res.json({ success: true, data: { payment: original, session, completed: true, repeated: true } });
    }
    throw new AppError("This session is already closed", 409);
  }
  if (session.status !== "PAYMENT_PENDING") {
    throw new AppError("Calculate the exit fee first", 409);
  }

  const chargingFastag = method === "FASTAG" && fastagProvider.isConfigured();
  // A tag that was charged (or may have been) is finished from that charge, however old the fee is now.
  const liveCharge = chargingFastag ? await fastagService.unsettled(session._id) : null;
  const ageMinutes = (Date.now() - session.exitTime.getTime()) / 60000;
  if (ageMinutes > FEE_VALID_MINUTES && !(liveCharge && liveCharge.status !== "FAILED")) {
    throw new AppError("This fee is out of date. Look the vehicle up again to get the current fee.", 409);
  }
  // What is owed is the fee less any advance taken at entry.
  const owed = advances.amountDue(session);
  if (Math.abs(amount - owed) > 0.005) {
    throw new AppError(`The amount to pay for this session is ${owed}. Look the vehicle up again.`, 409);
  }

  // Payments taken during the operator's open shift are counted in that shift.
  const shift = await Shift.findOne({ operatorId: req.user._id, locationId: session.locationId, status: "OPEN" });

  const base = {
    ...(shift ? { shiftId: shift._id } : {}),
    companyId: session.companyId,
    locationId: session.locationId,
    sessionId: session._id,
    amount: owed,
    tax: session.fee.tax,
    kind: "FEE",
    method,
    collectedBy: req.user._id,
  };

  // A FASTag attempt that is not settled blocks every other way of paying (online included): if it turns
  // out the tag was charged, taking another payment as well would charge the customer twice.
  if (!chargingFastag) {
    const pending = await fastagService.unsettled(session._id);
    if (pending && pending.status !== "FAILED") {
      throw new AppError(
        !fastagProvider.isConfigured()
          ? "A FASTag charge exists for this vehicle but FASTag charging is switched off. Tell your admin."
          : pending.status === "SUCCESS"
            ? "This vehicle's FASTag was already charged. Choose FASTag to finish the exit."
            : "A FASTag charge for this vehicle is still being confirmed. Choose FASTag and check again before taking another payment.",
        409
      );
    }
  }

  if (!gateway.isManual(method)) {
    const { payment, repeated } = await payments.startOnlinePayment({ session, base });
    return res.status(202).json({
      success: true,
      data: { payment, session, completed: false, repeated, simulated: Boolean(gateway.provider()?.simulated) },
    });
  }

  if (chargingFastag) {
    if (transactionId) throw new AppError("A FASTag charge has no payment reference", 400);
    // An online payment link that is still open could be paid as well: close it first.
    if (!liveCharge && await Payment.exists({ sessionId: session._id, method: "GATEWAY", status: "PENDING", expiresAt: { $gt: new Date() } })) {
      throw new AppError("An online payment is waiting for this vehicle. Cancel it before charging the FASTag.", 409);
    }
    const { charge: attempt } = await fastagService.charge({
      session, tagId, amount: owed, by: req.user._id, shiftId: shift ? shift._id : undefined,
    });
    if (attempt.status === "FAILED") {
      await audit.record(req, "FASTAG_DECLINED", {
        entity: "FastagCharge", entityId: attempt._id, companyId: attempt.companyId,
        meta: { sessionId: session._id, tagId: attempt.tagId, amount: attempt.amount, reason: attempt.failureReason },
      });
      throw new AppError(`The FASTag was not charged: ${attempt.failureReason || "declined"}. Try another tag or another payment mode.`, 422);
    }
    if (attempt.status !== "SUCCESS") {
      return res.status(202).json({
        success: true,
        data: {
          completed: false,
          fastag: { status: "UNKNOWN", chargeId: attempt._id, tagId: attempt.tagId, message: "The FASTag partner has not confirmed the charge yet. Check again in a moment. Nothing is charged twice." },
        },
      });
    }
    const payment = await fastagService.paymentFor({ charge: attempt, session, base, req });
    const current = await ParkingSession.findById(session._id);
    if (current && !current.isOpen) {
      return res.json({ success: true, data: { payment, session: current, completed: true, repeated: true } });
    }
    await audit.record(req, "FASTAG_CHARGED", {
      entity: "FastagCharge", entityId: attempt._id, companyId: attempt.companyId,
      meta: { sessionId: session._id, tagId: attempt.tagId, amount: attempt.amount, providerReference: attempt.providerReference },
    });
    return finishPayment(req, res, session, payment);
  }

  // Paying from a wallet: take the money first (one atomic step that also checks the
  // balance), then record the payment. If recording fails the debit is undone.
  let walletDebit = null;
  if (method === "WALLET") {
    if (!walletId) throw new AppError("Choose the wallet to pay from", 400);
    if (transactionId) throw new AppError("A wallet payment has no payment reference", 400);
    walletDebit = await wallets.debitForSession({
      walletId, companyId: session.companyId, session, amount: owed, by: req.user._id, shiftId: shift ? shift._id : undefined,
    });
  }
  const undoWalletDebit = async (why) => {
    if (walletDebit) {
      await wallets.reverseDebit({ txn: walletDebit.txn, reason: why, by: req.user._id }).catch((e) =>
        console.error("Wallet debit could not be undone:", walletDebit.txn._id, e.message));
    }
  };

  let payment;
  try {
    payment = await Payment.create({
      ...base, status: "SUCCESS", paidAt: new Date(),
      ...(walletDebit ? { walletId: walletDebit.txn.walletId, transactionId: `WALLET:${walletDebit.txn._id}` } : {}),
      ...(!walletDebit && transactionId ? { transactionId } : {}),
    });
  } catch (error) {
    // The same wallet payment was recorded a moment ago (a double tap, or a retry after the session
    // failed to close). That payment owns this debit, so the debit must NOT be undone: finish its job.
    const mine = walletDebit && error.code === 11000
      ? await Payment.findOne({ transactionId: `WALLET:${walletDebit.txn._id}`, status: "SUCCESS" })
      : null;
    if (mine) {
      const current = await ParkingSession.findById(session._id);
      if (current && !current.isOpen) {
        return res.json({ success: true, data: { payment: mine, session: current, completed: true, repeated: true } });
      }
      payment = mine;
    } else {
      await undoWalletDebit("Payment could not be recorded");
      if (error.code === 11000) {
        const duplicateReference = error.keyPattern && error.keyPattern.transactionId;
        throw new AppError(
          duplicateReference ? "This payment reference was already used" : "This session has already been paid",
          409
        );
      }
      throw error;
    }
  }

  if (walletDebit && !walletDebit.repeated) {
    await WalletTxn.updateOne({ _id: walletDebit.txn._id }, { $set: { paymentId: payment._id } }).catch(() => {});
  }
  return finishPayment(req, res, session, payment);
};

// POST /api/payments/webhook   (called by the payment gateway, not by users)
// The chosen provider checks the call is genuine and turns it into a result;
// the shared `settle` applies it. Events we do not act on still get a 200 so
// the gateway stops resending them.
const gatewayWebhook = async (req, res) => {
  const chosen = gateway.provider();
  if (!chosen || !chosen.isConfigured()) throw new AppError("Online payment is not set up", 503);
  const event = chosen.parseWebhook(req);
  if (!event) return res.json({ success: true, ignored: true });
  const result = await payments.settle(event, req);
  // Not an exit payment: it may be the fee of an online booking, or the price of a plan.
  if (result && result.outcome === "unknown") {
    const booked = await onlineBookings.settle(event, req);
    if (!booked || booked.outcome === "unknown") {
      const planned = await billing.settle(event, req);
      if (!planned || planned.outcome === "unknown") await shop.settle(event, req);
    }
  }
  res.json({ success: true });
};

// GET /api/payments/options
// What the payment screen may offer: online payment only when a gateway is set up.
const paymentOptions = (req, res) => {
  const chosen = gateway.provider();
  const online = Boolean(chosen && chosen.isConfigured());
  const tags = fastagProvider.isConfigured();
  res.json({
    success: true,
    data: {
      online, provider: online ? chosen.name : null, simulated: online && Boolean(chosen.simulated),
      // FASTag: true when the tag is really charged (the operator then enters the tag number instead of just recording).
      fastag: tags, fastagSimulated: tags && Boolean(fastagProvider.provider().simulated),
    },
  });
};

// GET /api/payments/:id
// For the screen waiting on an online payment: where it stands, and once it is
// paid, what the barrier and printer did.
const getPayment = async (req, res) => {
  const payment = await Payment.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!payment) throw new AppError("Payment not found", 404);
  const session = await ParkingSession.findById(payment.sessionId);
  // Finished means this very payment released the vehicle (not an admin, or another payment).
  const completed = Boolean(session && !session.isOpen && String(session.paymentId) === String(payment._id));
  const devices = completed ? await hardware.summaryForSession(payment.sessionId) : null;
  res.json({ success: true, data: { payment, session, completed, hardware: devices } });
};

// POST /api/payments/:id/simulate   { outcome: "SUCCESS" | "FAILED" }
// Plays the customer's side with the simulated gateway. It goes through the
// same code as a real webhook. Not available with a real gateway or in production.
const simulatePayment = async (req, res) => {
  const chosen = gateway.provider();
  if (!chosen || !chosen.simulated || !chosen.isConfigured()) {
    throw new AppError("Simulated payments are only available with PAYMENT_PROVIDER=simulated (not in production)", 409);
  }
  const payment = await Payment.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.method !== "GATEWAY" || payment.provider !== "simulated") {
    throw new AppError("Only a simulated online payment can be simulated", 409);
  }
  const outcome = req.body.outcome || "SUCCESS";
  const result = await payments.settle(
    {
      transactionId: payment.transactionId,
      status: outcome,
      gatewayRef: `SIM-${payment.transactionId.slice(-8)}`,
      gatewayPaymentId: `simpay-${payment.transactionId.slice(-8)}`,
      ...(outcome === "FAILED" ? { reason: "Declined in the simulator" } : {}),
    },
    req
  );
  res.json({ success: true, data: { outcome: result.outcome, payment: result.payment } });
};

// POST /api/payments/:id/cancel
// The customer will pay another way: stop waiting for the online payment.
// (If they pay it anyway, the money is not lost: an admin is alerted.)
const cancelPayment = async (req, res) => {
  const payment = await Payment.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.method !== "GATEWAY") throw new AppError("Only an online payment can be cancelled", 409);
  const cancelled = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "PENDING" },
    { $set: { status: "FAILED", failureReason: `Cancelled by ${req.user.name}` } },
    { returnDocument: "after" }
  );
  if (!cancelled) throw new AppError("This payment is no longer waiting", 409);
  const owner = gateway.PROVIDERS[cancelled.provider];
  if (owner && owner.cancel) await owner.cancel(cancelled).catch((error) => console.error("Gateway cancel failed:", error.message));
  await audit.record(req, "PAYMENT_CANCELLED", {
    entity: "Payment", entityId: cancelled._id, companyId: cancelled.companyId, meta: { sessionId: cancelled.sessionId },
  });
  res.json({ success: true, data: cancelled });
};

// Filter shared by the payment list and the collection summary.
const paymentFilter = (req) => {
  const conditions = [locationScopedFilter(req)];
  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId: new mongoose.Types.ObjectId(locationId) });
  const { start, end } = dayRange(req.query.date);
  return { conditions, start, end };
};

// GET /api/payments?locationId=&date=&page=
const listPayments = async (req, res) => {
  const { conditions, start, end } = paymentFilter(req);
  const filter = { $and: [...conditions, { createdAt: { $gte: start, $lt: end } }] };
  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    Payment.countDocuments(filter),
  ]);
  res.json({ success: true, data: { payments, total, page, pageSize: PAGE_SIZE } });
};

// Refunds an online payment through its gateway. The payment is claimed first
// (REFUNDED, marked "gateway pending") so two requests cannot both refund; if
// the gateway refuses, the claim is undone and the payment is SUCCESS again.
const refundOnline = async (req, res, payment) => {
  const owner = gateway.PROVIDERS[payment.provider] || gateway.provider();
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "SUCCESS" },
    {
      $set: {
        status: "REFUNDED",
        refund: { amount: payment.amount, reason: req.body.reason, refundedBy: req.user._id, refundedAt: new Date(), gatewayPending: true },
      },
    },
    { returnDocument: "after" }
  );
  if (!claimed) throw new AppError("This payment was already refunded", 409);

  let answer;
  try {
    answer = await owner.refund(payment, req.body.reason);
  } catch (error) {
    // Undo the claim only when the gateway certainly did not refund. After a
    // timeout the refund may have gone through: the payment stays marked
    // "refund pending" so an admin can check it in the gateway.
    if (error.outcomeUnknown) {
      await audit.record(req, "PAYMENT_REFUND_UNCERTAIN", {
        entity: "Payment", entityId: payment._id, companyId: payment.companyId,
        meta: { sessionId: payment.sessionId, amount: payment.amount, reason: req.body.reason },
      });
      throw new AppError("The gateway did not confirm the refund. It may have gone through: check it in the gateway before trying again.", 502);
    }
    try {
      await Payment.updateOne({ _id: payment._id, status: "REFUNDED", "refund.gatewayPending": true }, { $set: { status: "SUCCESS" }, $unset: { refund: "" } });
    } catch (rollbackError) {
      // Cannot put it back (for example another payment already succeeded for the session): leave it flagged.
      console.error(`Could not undo the refund claim on ${payment._id}:`, rollbackError.message);
    }
    throw error;
  }
  const refunded = await Payment.findOneAndUpdate(
    { _id: payment._id },
    { $set: { "refund.gatewayRefundId": answer.refundId }, $unset: { "refund.gatewayPending": "" } },
    { returnDocument: "after" }
  );
  await audit.record(req, "PAYMENT_REFUNDED", {
    entity: "Payment", entityId: payment._id, companyId: payment.companyId,
    meta: { sessionId: payment.sessionId, amount: payment.amount, method: "GATEWAY", reason: req.body.reason, gatewayRefundId: answer.refundId },
  });
  res.json({ success: true, data: refunded });
};

// POST /api/payments/:id/refund   (admins)
// Gives the full amount back for a cash, UPI or card payment. The vehicle has
// already left, so the session stays closed; only the money record changes.
const refundPayment = async (req, res) => {
  const payment = await Payment.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.status === "REFUNDED") throw new AppError("This payment was already refunded", 409);
  if (payment.status !== "SUCCESS") throw new AppError("Only a successful payment can be refunded", 409);
  if (payment.kind === "ADVANCE") {
    // While the vehicle is inside the advance belongs to its ticket: cancelling the
    // entry gives it back, and leaving sets it against the fee.
    const open = await ParkingSession.exists({ _id: payment.sessionId, isOpen: true });
    if (open) throw new AppError("This advance is for a vehicle that is still inside. Cancel the entry to give it back.", 409);
  }
  if (!gateway.isManual(payment.method)) return refundOnline(req, res, payment);
  // A tag that was really charged is given back by the FASTag partner, not from a cash drawer.
  if (payment.fastagChargeId) {
    throw new AppError(`This was charged to FASTag ${payment.tagId || ""} (reference ${(payment.transactionId || "").replace("FASTAG:", "")}). Ask your FASTag partner to reverse it; it cannot be refunded from here.`, 409);
  }

  // A wallet payment goes back into the wallet (not out of a cash drawer). The credit
  // carries a key made from the payment, so repeating the request cannot pay it twice.
  if (payment.method === "WALLET") {
    if (!payment.walletId) throw new AppError("This wallet payment has no wallet on record. Correct it by hand with a wallet adjustment.", 409);
    await wallets.refundPayment({ payment, reason: req.body.reason, by: req.user._id });
    const refunded = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "SUCCESS" },
      { $set: { status: "REFUNDED", refund: { amount: payment.amount, reason: req.body.reason, refundedBy: req.user._id, refundedAt: new Date() } } },
      { returnDocument: "after" }
    );
    if (!refunded) throw new AppError("This payment was already refunded", 409);
    await audit.record(req, "PAYMENT_REFUNDED", {
      entity: "Payment", entityId: refunded._id, companyId: refunded.companyId,
      meta: { sessionId: refunded.sessionId, amount: refunded.amount, method: "WALLET", reason: req.body.reason, walletId: payment.walletId },
    });
    return res.json({ success: true, data: refunded });
  }

  // The refund comes out of a cash drawer: the shift that took the payment if
  // it is still open, otherwise the open shift of the person refunding.
  const shift =
    (payment.shiftId && (await Shift.findOne({ _id: payment.shiftId, status: "OPEN" }))) ||
    (await Shift.findOne({ operatorId: req.user._id, locationId: payment.locationId, status: "OPEN" }));

  // Guarded on status so two refund requests cannot both succeed.
  const refunded = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "SUCCESS" },
    {
      $set: {
        status: "REFUNDED",
        refund: {
          amount: payment.amount,
          reason: req.body.reason,
          refundedBy: req.user._id,
          refundedAt: new Date(),
          ...(shift ? { shiftId: shift._id } : {}),
        },
      },
    },
    { returnDocument: "after" }
  );
  if (!refunded) throw new AppError("This payment was already refunded", 409);

  await audit.record(req, "PAYMENT_REFUNDED", {
    entity: "Payment", entityId: refunded._id, companyId: refunded.companyId,
    meta: { sessionId: refunded.sessionId, amount: refunded.amount, method: refunded.method, reason: req.body.reason },
  });

  res.json({ success: true, data: refunded });
};

// Same location scope as the payments, for wallet top-ups (they carry locationId).
const walletTopupFilter = (req) => {
  const filter = { ...req.tenantFilter };
  const locationId = locationIdFromQuery(req);
  const mine = isCompanyWide(req.user.role) ? null : Array.from(req.user.locationIds);
  if (locationId) {
    // Someone limited to some locations only sees those, even when asking for another one.
    const allowed = !mine || mine.some((id) => String(id) === String(locationId));
    filter.locationId = allowed ? new mongoose.Types.ObjectId(locationId) : { $in: [] };
  } else if (mine) {
    filter.locationId = { $in: mine };
  }
  return filter;
};

// GET /api/payments/collection?locationId=&date=
// Money of one day: collected (by the day it was paid), refunded (by the day
// it was given back) and the net. Also split by payment method and operator.
const collectionSummary = async (req, res) => {
  const { conditions, start, end } = paymentFilter(req);
  const sum = { amount: { $sum: "$amount" }, tax: { $sum: "$tax" }, count: { $sum: 1 } };

  const facets = {
    total: [{ $group: { _id: null, ...sum } }],
    byMethod: [{ $group: { _id: "$method", ...sum } }, { $sort: { _id: 1 } }],
    byOperator: [{ $group: { _id: "$collectedBy", ...sum } }, { $sort: { amount: -1 } }],
  };

  const [[parking], [passes], [refunds], topups] = await Promise.all([
    Payment.aggregate([
      { $match: { $and: [...conditions, { status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: start, $lt: end } }] } },
      { $facet: facets },
    ]),
    // Pass sales and renewals are money too (free passes are left out).
    PassPayment.aggregate([
      { $match: { $and: [...conditions, { amount: { $gt: 0 }, paidAt: { $gte: start, $lt: end } }] } },
      { $facet: facets },
    ]),
    Payment.aggregate([
      { $match: { $and: [...conditions, { status: "REFUNDED", "refund.refundedAt": { $gte: start, $lt: end } }] } },
      { $group: { _id: null, amount: { $sum: "$refund.amount" }, count: { $sum: 1 } } },
    ]),
    // Money put into wallets is not income yet (it becomes income when a fee is paid from the
    // wallet), so it is shown on its own and not added to the total.
    WalletTxn.aggregate([
      { $match: { ...walletTopupFilter(req), type: "TOPUP", createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: "$method", deltaPaise: { $sum: "$deltaPaise" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const result = {
    total: mergeGroups(parking.total, passes.total),
    byMethod: mergeGroups(parking.byMethod, passes.byMethod).sort((a, b) => String(a._id).localeCompare(String(b._id))),
    byOperator: mergeGroups(parking.byOperator, passes.byOperator).sort((a, b) => b.amount - a.amount),
  };

  const tidy = ({ _id, amount, tax, count }) => ({ key: _id, amount: round2(amount), tax: round2(tax), count });

  const operators = await User.find({ _id: { $in: result.byOperator.map((o) => o._id).filter(Boolean) } }).select("name");
  const names = new Map(operators.map((u) => [String(u._id), u.name]));

  const total = result.total[0] ? tidy(result.total[0]) : { key: null, amount: 0, tax: 0, count: 0 };
  const refunded = { amount: refunds ? round2(refunds.amount) : 0, count: refunds ? refunds.count : 0 };

  res.json({
    success: true,
    data: {
      from: start,
      to: end,
      total,
      refunded,
      net: round2(total.amount - refunded.amount),
      walletTopups: {
        amount: round2(topups.reduce((t, r) => t + r.deltaPaise, 0) / 100),
        count: topups.reduce((t, r) => t + r.count, 0),
        byMethod: topups.map((r) => ({ key: r._id, amount: round2(r.deltaPaise / 100), count: r.count })),
      },
      passes: passes.total[0] ? tidy(passes.total[0]) : { key: null, amount: 0, tax: 0, count: 0 },
      byMethod: result.byMethod.map(tidy),
      byOperator: result.byOperator.map((row) => ({
        ...tidy(row),
        name: row._id ? names.get(String(row._id)) || "Unknown" : "Online payment",
      })),
    },
  });
};

module.exports = {
  paymentOptions, getPayment, simulatePayment, cancelPayment, createPayment, gatewayWebhook, refundPayment, listPayments, collectionSummary };
