const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const WalletTxn = require("../models/WalletTxn");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Works out what the cash drawer should hold and how far the count is off.
// difference > 0 means extra cash, < 0 means cash is short.
// Adds up rows of { _id, amount, tax, count } that share a key.
const mergeGroups = (...lists) => {
  const byKey = new Map();
  for (const list of lists) {
    for (const row of list) {
      const key = String(row._id);
      const have = byKey.get(key) || { _id: row._id, amount: 0, tax: 0, count: 0 };
      have.amount += row.amount || 0;
      have.tax += row.tax || 0;
      have.count += row.count || 0;
      byKey.set(key, have);
    }
  }
  return [...byKey.values()];
};

const reconcile = ({ openingCash = 0, cashCollected = 0, cashRefunded = 0, adjustments = 0, closingCash }) => {
  const expectedCash = round2(openingCash + cashCollected - cashRefunded + adjustments);
  const result = { expectedCash };
  if (closingCash !== undefined && closingCash !== null) result.difference = round2(closingCash - expectedCash);
  return result;
};

// Money facts of a shift: collections by method, cash refunds, adjustments.
const shiftTotals = async (shift) => {
  const [parkingByMethod, passByMethod, refunds, topupsByMethod] = await Promise.all([
    Payment.aggregate([
      { $match: { shiftId: shift._id, status: { $in: ["SUCCESS", "REFUNDED"] } } },
      { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Pass sales and renewals taken during the shift are in the same drawer.
    PassPayment.aggregate([
      { $match: { shiftId: shift._id, amount: { $gt: 0 } } },
      { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { "refund.shiftId": shift._id, status: "REFUNDED", method: "CASH" } },
      { $group: { _id: null, amount: { $sum: "$refund.amount" }, count: { $sum: 1 } } },
    ]),
    // Money put into wallets during the shift is in the same drawer (cash) or account (UPI, card).
    WalletTxn.aggregate([
      { $match: { shiftId: shift._id, type: "TOPUP" } },
      { $group: { _id: "$method", amount: { $sum: { $divide: ["$deltaPaise", 100] } }, count: { $sum: 1 } } },
    ]),
  ]);

  const methods = mergeGroups(parkingByMethod, passByMethod, topupsByMethod)
    .map((row) => ({ method: row._id, amount: round2(row.amount), count: row.count }))
    .sort((a, b) => a.method.localeCompare(b.method));
  const passes = passByMethod.reduce((t, r) => ({ amount: round2(t.amount + r.amount), count: t.count + r.count }), { amount: 0, count: 0 });
  const walletTopups = topupsByMethod.reduce((t, r) => ({ amount: round2(t.amount + r.amount), count: t.count + r.count }), { amount: 0, count: 0 });
  // Fees paid from a wallet were collected when the wallet was topped up, not now.
  const walletSpent = methods.find((m) => m.method === "WALLET") || { amount: 0, count: 0 };
  const cashCollected = (methods.find((m) => m.method === "CASH") || { amount: 0 }).amount;
  const cashRefunded = refunds[0] ? round2(refunds[0].amount) : 0;
  const adjustments = round2(shift.adjustments.reduce((sum, a) => sum + a.amount, 0));

  return {
    passes,
    walletTopups,
    walletSpent: { amount: walletSpent.amount, count: walletSpent.count },
    byMethod: methods,
    collected: round2(methods.filter((m) => m.method !== "WALLET").reduce((sum, m) => sum + m.amount, 0)),
    payments: methods.reduce((sum, m) => sum + m.count, 0),
    cashCollected,
    cashRefunded,
    refundCount: refunds[0] ? refunds[0].count : 0,
    adjustments,
    ...reconcile({ openingCash: shift.openingCash, cashCollected, cashRefunded, adjustments }),
  };
};

module.exports = { reconcile, shiftTotals, mergeGroups, round2 };
