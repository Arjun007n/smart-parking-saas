const Payment = require("../models/Payment");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Works out what the cash drawer should hold and how far the count is off.
// difference > 0 means extra cash, < 0 means cash is short.
const reconcile = ({ openingCash = 0, cashCollected = 0, cashRefunded = 0, adjustments = 0, closingCash }) => {
  const expectedCash = round2(openingCash + cashCollected - cashRefunded + adjustments);
  const result = { expectedCash };
  if (closingCash !== undefined && closingCash !== null) result.difference = round2(closingCash - expectedCash);
  return result;
};

// Money facts of a shift: collections by method, cash refunds, adjustments.
const shiftTotals = async (shift) => {
  const [byMethod, refunds] = await Promise.all([
    Payment.aggregate([
      { $match: { shiftId: shift._id, status: { $in: ["SUCCESS", "REFUNDED"] } } },
      { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: { "refund.shiftId": shift._id, status: "REFUNDED", method: "CASH" } },
      { $group: { _id: null, amount: { $sum: "$refund.amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const methods = byMethod.map((row) => ({ method: row._id, amount: round2(row.amount), count: row.count }));
  const cashCollected = (methods.find((m) => m.method === "CASH") || { amount: 0 }).amount;
  const cashRefunded = refunds[0] ? round2(refunds[0].amount) : 0;
  const adjustments = round2(shift.adjustments.reduce((sum, a) => sum + a.amount, 0));

  return {
    byMethod: methods,
    collected: round2(methods.reduce((sum, m) => sum + m.amount, 0)),
    payments: methods.reduce((sum, m) => sum + m.count, 0),
    cashCollected,
    cashRefunded,
    refundCount: refunds[0] ? refunds[0].count : 0,
    adjustments,
    ...reconcile({ openingCash: shift.openingCash, cashCollected, cashRefunded, adjustments }),
  };
};

module.exports = { reconcile, shiftTotals, round2 };
