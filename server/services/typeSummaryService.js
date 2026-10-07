// Vehicles and money by vehicle type for some locations over a period: how many came in and went
// out, how many are parked now, and what was collected in each way. The dashboard's type table and
// the day-summary report are the same numbers.

const { round2 } = require("./collectionService");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const Pass = require("../models/Pass");
const { VEHICLE_TYPES } = require("../models/constants");

const METHOD_KEYS = { CASH: "cash", UPI: "upi", CARD: "card", GATEWAY: "online", FASTAG: "fastag", WALLET: "wallet" };

const blank = (type) => ({
  type, entries: 0, exits: 0, parked: 0, cash: 0, upi: 0, card: 0, online: 0, fastag: 0, wallet: 0, passSales: 0, refunded: 0, total: 0,
});

// Money taken from customers, less refunds. Wallet spending is not counted: that money came in
// when the wallet was topped up.
const totalOf = (row) => round2(row.cash + row.upi + row.card + row.online + row.fastag - row.refunded);

// `range` is { start, end } (UTC instants, end not included). `vehicleTypes` are the types the
// locations accept: they are listed even when nothing happened.
const typeSummary = async ({ locationIds, range, vehicleTypes = [] }) => {
  const inScope = { locationId: { $in: locationIds } };
  const between = { $gte: range.start, $lt: range.end };
  const sessionLookup = {
    $lookup: { from: ParkingSession.collection.name, localField: "sessionId", foreignField: "_id", as: "s", pipeline: [{ $project: { vehicleType: 1 } }] },
  };

  const [entries, exits, parked, fees, passPays, refunds] = await Promise.all([
    ParkingSession.aggregate([{ $match: { ...inScope, entryTime: between } }, { $group: { _id: "$vehicleType", count: { $sum: 1 } } }]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, status: { $ne: "CANCELLED" }, exitTime: between } },
      { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([{ $match: { ...inScope, isOpen: true } }, { $group: { _id: "$vehicleType", count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: between } },
      sessionLookup, { $unwind: "$s" },
      { $group: { _id: { t: "$s.vehicleType", m: "$method" }, amount: { $sum: "$amount" } } },
    ]),
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: between } },
      { $lookup: { from: Pass.collection.name, localField: "passId", foreignField: "_id", as: "p", pipeline: [{ $project: { vehicleType: 1 } }] } },
      { $unwind: "$p" },
      { $group: { _id: { t: "$p.vehicleType", m: "$method" }, amount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": between } },
      sessionLookup, { $unwind: "$s" },
      { $group: { _id: "$s.vehicleType", amount: { $sum: "$refund.amount" } } },
    ]),
  ]);

  const byType = new Map();
  const row = (type) => {
    if (!byType.has(type)) byType.set(type, blank(type));
    return byType.get(type);
  };
  for (const t of vehicleTypes) row(t);
  for (const r of entries) row(r._id).entries = r.count;
  for (const r of exits) row(r._id).exits = r.count;
  for (const r of parked) row(r._id).parked = r.count;
  for (const r of [...fees, ...passPays]) {
    const key = METHOD_KEYS[r._id.m];
    const o = row(r._id.t);
    if (key) o[key] = round2(o[key] + r.amount);
  }
  for (const r of passPays) row(r._id.t).passSales = round2(row(r._id.t).passSales + r.amount);
  for (const r of refunds) row(r._id).refunded = round2(r.amount);

  const rows = [...byType.values()]
    .map((r) => ({ ...r, total: totalOf(r) }))
    .sort((a, b) => VEHICLE_TYPES.indexOf(a.type) - VEHICLE_TYPES.indexOf(b.type));

  const total = rows.reduce((t, r) => {
    for (const key of Object.keys(r)) if (typeof r[key] === "number") t[key] = round2((t[key] || 0) + r[key]);
    return t;
  }, blank("TOTAL"));
  return { rows, total };
};

module.exports = { typeSummary, totalOf, METHOD_KEYS };
