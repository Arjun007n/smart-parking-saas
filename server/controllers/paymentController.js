const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { dayRange } = require("../utils/time");
const { locationScopedFilter, locationIdFromQuery } = require("../utils/scope");
const sessions = require("../services/sessionService");
const gateway = require("../integrations/payment");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const User = require("../models/User");
const Shift = require("../models/Shift");
const { publish, EVENTS } = require("../services/eventBus");
const { notifyPaymentFailed } = require("../services/notificationService");
const { round2 } = require("../services/collectionService");

const PAGE_SIZE = 50;
// A calculated fee is accepted for this long. After that the operator must
// look the vehicle up again so extra time is charged.
const FEE_VALID_MINUTES = 15;

const finalStatusFor = (session) => (session.lostTicket ? "LOST_TICKET" : "COMPLETED");

// Marks the session as exited after its payment succeeded.
const completePaidSession = async (session, payment, operatorId) =>
  sessions.closeSession(session._id, finalStatusFor(session), {
    paymentId: payment._id,
    ...(operatorId ? { exitOperatorId: operatorId, closedBy: operatorId } : {}),
  });

// POST /api/payments
// Step 2 of leaving: record the payment for a session whose fee was calculated
// by POST /api/parking/exit. The amount always comes from the server's own
// calculation; the client only confirms what it showed to the customer.
const createPayment = async (req, res) => {
  const { sessionId, method, amount, transactionId } = req.body;

  const session = await ParkingSession.findOne({ $and: [{ _id: sessionId }, locationScopedFilter(req)] });
  if (!session) throw new AppError("Parking session not found", 404);
  if (!session.isOpen) throw new AppError("This session is already closed", 409);
  if (session.status !== "PAYMENT_PENDING") {
    throw new AppError("Calculate the exit fee first", 409);
  }

  const ageMinutes = (Date.now() - session.exitTime.getTime()) / 60000;
  if (ageMinutes > FEE_VALID_MINUTES) {
    throw new AppError("This fee is out of date. Look the vehicle up again to get the current fee.", 409);
  }
  if (Math.abs(amount - session.fee.total) > 0.005) {
    throw new AppError(`The fee for this session is ${session.fee.total}. Look the vehicle up again.`, 409);
  }

  // Payments taken during the operator's open shift are counted in that shift.
  const shift = await Shift.findOne({ operatorId: req.user._id, locationId: session.locationId, status: "OPEN" });

  const base = {
    ...(shift ? { shiftId: shift._id } : {}),
    companyId: session.companyId,
    locationId: session.locationId,
    sessionId: session._id,
    amount: session.fee.total,
    tax: session.fee.tax,
    method,
    collectedBy: req.user._id,
  };

  if (!gateway.isManual(method)) {
    if (!gateway.isGatewayConfigured()) throw new AppError("Online payment is not set up yet", 503);
    const order = await gateway.createGatewayOrder();
    const payment = await Payment.create({ ...base, status: "PENDING", transactionId: order.transactionId });
    return res.status(202).json({ success: true, data: { payment, session, completed: false } });
  }

  let payment;
  try {
    payment = await Payment.create({
      ...base, status: "SUCCESS", paidAt: new Date(), ...(transactionId ? { transactionId } : {}),
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateReference = error.keyPattern && error.keyPattern.transactionId;
      throw new AppError(
        duplicateReference ? "This payment reference was already used" : "This session has already been paid",
        409
      );
    }
    throw error;
  }

  const closed = await completePaidSession(session, payment, req.user._id);
  await audit.record(req, "PAYMENT_RECEIVED", {
    entity: "Payment", entityId: payment._id, companyId: payment.companyId,
    meta: { sessionId: session._id, ticketNumber: session.ticketNumber, amount: payment.amount, method },
  });
  if (!closed) {
    // Money was taken but the session was closed by someone else in the same
    // moment (for example an admin override). Flag it for reconciliation.
    await audit.record(req, "PAYMENT_WITHOUT_EXIT", {
      entity: "Payment", entityId: payment._id, companyId: payment.companyId, meta: { sessionId: session._id },
    });
    throw new AppError("Payment recorded, but this session was already closed. Tell your admin.", 409);
  }

  publish(EVENTS.PAYMENT_RECEIVED, { companyId: payment.companyId, locationId: payment.locationId, payment });
  publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });

  res.status(201).json({ success: true, data: { payment, session: closed, completed: true } });
};

// POST /api/payments/webhook   (called by the payment gateway, not by users)
const gatewayWebhook = async (req, res) => {
  if (!gateway.isGatewayConfigured()) throw new AppError("Online payment is not set up", 503);
  if (!gateway.verifyWebhookSignature(req.rawBody, req.headers["x-signature"])) {
    throw new AppError("Invalid signature", 401);
  }

  const { transactionId, status, gatewayRef, reason } = req.body || {};
  if (typeof transactionId !== "string" || !["SUCCESS", "FAILED"].includes(status)) {
    throw new AppError("Invalid webhook body", 400);
  }

  // Only a PENDING payment can change, so a repeated webhook does nothing.
  const payment = await Payment.findOneAndUpdate(
    { transactionId, method: "GATEWAY", status: "PENDING" },
    {
      $set: {
        status,
        ...(typeof gatewayRef === "string" ? { gatewayRef: gatewayRef.slice(0, 100) } : {}),
        ...(status === "SUCCESS" ? { paidAt: new Date() } : {}),
        ...(status === "FAILED" && typeof reason === "string" ? { failureReason: reason.slice(0, 200) } : {}),
      },
    },
    { returnDocument: "after" }
  ).catch((error) => {
    // Another payment already succeeded for the same session.
    if (error.code === 11000) return null;
    throw error;
  });

  if (payment && status === "SUCCESS") {
    const session = await ParkingSession.findById(payment.sessionId);
    const closed = session ? await completePaidSession(session, payment, null) : null;
    publish(EVENTS.PAYMENT_RECEIVED, { companyId: payment.companyId, locationId: payment.locationId, payment });
    if (closed) publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });
  }
  if (payment && status === "FAILED") {
    publish(EVENTS.PAYMENT_FAILED, { companyId: payment.companyId, locationId: payment.locationId, payment });
    await notifyPaymentFailed(payment, payment.failureReason);
  }
  if (payment) {
    await audit.record(req, status === "SUCCESS" ? "PAYMENT_RECEIVED" : "PAYMENT_FAILED", {
      entity: "Payment", entityId: payment._id, companyId: payment.companyId,
      meta: { sessionId: payment.sessionId, amount: payment.amount, method: "GATEWAY" },
    });
  }

  res.json({ success: true });
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

// POST /api/payments/:id/refund   (admins)
// Gives the full amount back for a cash, UPI or card payment. The vehicle has
// already left, so the session stays closed; only the money record changes.
const refundPayment = async (req, res) => {
  const payment = await Payment.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!payment) throw new AppError("Payment not found", 404);
  if (payment.status === "REFUNDED") throw new AppError("This payment was already refunded", 409);
  if (payment.status !== "SUCCESS") throw new AppError("Only a successful payment can be refunded", 409);
  if (!gateway.isManual(payment.method)) {
    throw new AppError("Online payments must be refunded through the payment gateway", 409);
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

// GET /api/payments/collection?locationId=&date=
// Money of one day: collected (by the day it was paid), refunded (by the day
// it was given back) and the net. Also split by payment method and operator.
const collectionSummary = async (req, res) => {
  const { conditions, start, end } = paymentFilter(req);
  const sum = { amount: { $sum: "$amount" }, tax: { $sum: "$tax" }, count: { $sum: 1 } };

  const [[result], [refunds]] = await Promise.all([
    Payment.aggregate([
      { $match: { $and: [...conditions, { status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: start, $lt: end } }] } },
      {
        $facet: {
          total: [{ $group: { _id: null, ...sum } }],
          byMethod: [{ $group: { _id: "$method", ...sum } }, { $sort: { _id: 1 } }],
          byOperator: [{ $group: { _id: "$collectedBy", ...sum } }, { $sort: { amount: -1 } }],
        },
      },
    ]),
    Payment.aggregate([
      { $match: { $and: [...conditions, { status: "REFUNDED", "refund.refundedAt": { $gte: start, $lt: end } }] } },
      { $group: { _id: null, amount: { $sum: "$refund.amount" }, count: { $sum: 1 } } },
    ]),
  ]);

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
      byMethod: result.byMethod.map(tidy),
      byOperator: result.byOperator.map((row) => ({
        ...tidy(row),
        name: row._id ? names.get(String(row._id)) || "Unknown" : "Online payment",
      })),
    },
  });
};

module.exports = { createPayment, gatewayWebhook, refundPayment, listPayments, collectionSummary };
