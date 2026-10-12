// "Collection by operator": for each person who worked at the gate in the period, what they
// issued, what they took in each way, and how it compares with the cash they counted when they
// closed their shifts (system collection against actual collection).

const { reportScope, userNames, respond, wantsExport } = require("./reportController");
const { operatorIdFromQuery } = require("../utils/scope");
const { round2 } = require("../services/collectionService");
const { typeSummary } = require("../services/typeSummaryService");
const { currentSince, periodOf } = require("../utils/reportPeriod");
const { localDateText, addDaysLocal } = require("../utils/time");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const Shift = require("../models/Shift");
const { VEHICLE_TYPES } = require("../models/constants");

const METHOD_KEYS = { CASH: "cash", UPI: "upi", CARD: "card", GATEWAY: "online", FASTAG: "fastag", WALLET: "wallet" };

const blank = (id) => ({
  id, entries: 0, reprints: 0, passEntries: 0, paidEntries: 0, entryAmount: 0,
  exits: 0, passExits: 0, paidExits: 0, exitAmount: 0,
  cash: 0, upi: 0, card: 0, online: 0, fastag: 0, wallet: 0, passSales: 0,
  refunded: 0, shifts: 0, shiftDifference: 0,
});

// What the system says was collected: everything taken from customers except wallet spending
// (that money was collected when the wallet was topped up), less what was given back.
const systemTotal = (row) =>
  round2(row.cash + row.upi + row.card + row.online + row.fastag + row.passSales - row.refunded);

// Keeps only the rows whose ticket is of one vehicle class (payments and refunds point at their ticket).
const ofVehicleType = (vehicleType) =>
  vehicleType
    ? [
        { $lookup: { from: ParkingSession.collection.name, localField: "sessionId", foreignField: "_id", pipeline: [{ $project: { vehicleType: 1 } }], as: "ticket" } },
        { $match: { "ticket.vehicleType": vehicleType } },
      ]
    : [];

// GET /api/reports/operator-collection?from=&to=&locationId=&operatorId=&vehicleType=&period=
// With a vehicleType only tickets of that class are counted. Pass sales and the cash found short or over
// belong to a person, not a vehicle class, so they are left out of such a report.
const operatorCollectionReport = async (req, res) => {
  const { inScope, range } = await reportScope(req, { maxDays: 366 });
  const vehicleType = VEHICLE_TYPES.includes(req.query.vehicleType) ? req.query.vehicleType : "";
  const between = { $gte: range.start, $lt: range.end };
  const operatorId = operatorIdFromQuery(req);
  const only = (field) => (operatorId ? { [field]: operatorId } : { [field]: { $ne: null } });

  const [entries, exits, paidByKind, passSold, refunds, shifts] = await Promise.all([
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: between, ...only("entryOperatorId"), ...(vehicleType ? { vehicleType } : {}) } },
      {
        $group: {
          _id: "$entryOperatorId",
          count: { $sum: 1 },
          reprints: { $sum: { $ifNull: ["$reprints", 0] } },
          passEntries: { $sum: { $cond: [{ $ifNull: ["$passId", false] }, 1, 0] } },
        },
      },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, exitTime: between, ...only("exitOperatorId"), ...(vehicleType ? { vehicleType } : {}) } },
      { $group: { _id: "$exitOperatorId", count: { $sum: 1 }, passExits: { $sum: { $cond: [{ $eq: ["$status", "PASS_EXIT"] }, 1, 0] } } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: between, ...only("collectedBy") } },
      ...ofVehicleType(vehicleType),
      {
        $group: {
          _id: { operator: "$collectedBy", kind: { $ifNull: ["$kind", "FEE"] }, method: "$method" },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: between, ...only("collectedBy"), ...(vehicleType ? { _id: null } : {}) } },
      { $group: { _id: "$collectedBy", amount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": between, ...only("refund.refundedBy") } },
      ...ofVehicleType(vehicleType),
      { $group: { _id: "$refund.refundedBy", amount: { $sum: "$refund.amount" } } },
    ]),
    // Shifts closed in the period: how far the counted cash was from what the system expected.
    Shift.aggregate([
      { $match: { ...inScope, status: "CLOSED", closedAt: between, ...only("operatorId"), ...(vehicleType ? { _id: null } : {}) } },
      { $group: { _id: "$operatorId", shifts: { $sum: 1 }, difference: { $sum: { $ifNull: ["$difference", 0] } } } },
    ]),
  ]);

  const byOperator = new Map();
  const row = (id) => {
    const key = String(id);
    if (!byOperator.has(key)) byOperator.set(key, blank(id));
    return byOperator.get(key);
  };

  for (const r of entries) Object.assign(row(r._id), { entries: r.count, reprints: r.reprints, passEntries: r.passEntries });
  for (const r of exits) Object.assign(row(r._id), { exits: r.count, passExits: r.passExits });
  for (const r of paidByKind) {
    const o = row(r._id.operator);
    const key = METHOD_KEYS[r._id.method];
    if (key) o[key] = round2(o[key] + r.amount);
    if (r._id.kind === "ADVANCE") {
      o.paidEntries += r.count;
      o.entryAmount = round2(o.entryAmount + r.amount);
    } else {
      o.paidExits += r.count;
      o.exitAmount = round2(o.exitAmount + r.amount);
    }
  }
  for (const r of passSold) row(r._id).passSales = round2(r.amount);
  for (const r of refunds) row(r._id).refunded = round2(r.amount);
  for (const r of shifts) Object.assign(row(r._id), { shifts: r.shifts, shiftDifference: round2(r.difference) });

  const names = await userNames([...byOperator.values()].map((r) => r.id));
  const rows = [...byOperator.values()]
    .map(({ id, ...rest }) => {
      const system = systemTotal(rest);
      // Without a closed shift there is no counted cash to compare with: actual follows the system.
      const actual = round2(system + rest.shiftDifference);
      return { operator: names.get(String(id)) || "Unknown", ...rest, systemCollection: system, actualCollection: actual, difference: round2(actual - system) };
    })
    .sort((a, b) => a.operator.localeCompare(b.operator));

  const total = rows.reduce((t, r) => {
    for (const key of Object.keys(r)) if (typeof r[key] === "number") t[key] = round2((t[key] || 0) + r[key]);
    return t;
  }, {});

  respond(req, res, `operator-collection-${range.from}-to-${range.to}`, [
    { key: "operator", label: "Operator" },
    { key: "entries", label: "Entries" },
    { key: "reprints", label: "Reprints" },
    { key: "passEntries", label: "Pass entries" },
    { key: "paidEntries", label: "Paid entries" },
    { key: "entryAmount", label: "Entry amount" },
    { key: "exits", label: "Exits" },
    { key: "passExits", label: "Pass exits" },
    { key: "paidExits", label: "Paid exits" },
    { key: "exitAmount", label: "Exit amount" },
    { key: "cash", label: "Cash" },
    { key: "upi", label: "UPI" },
    { key: "card", label: "Card" },
    { key: "online", label: "Online" },
    { key: "fastag", label: "FASTag" },
    { key: "wallet", label: "Wallet (not counted)" },
    { key: "passSales", label: "Pass sales" },
    { key: "systemCollection", label: "System collection" },
    { key: "shifts", label: "Shifts closed" },
    { key: "actualCollection", label: "Actual collection" },
    { key: "difference", label: "Short / over" },
  ], rows, { total, vehicleType: vehicleType || null, from: range.from, to: range.to });
};

// GET /api/reports/day-summary?date=&locationId=&period=
// One day at the chosen locations, by vehicle type: the page people download as a PDF to keep.
const daySummaryReport = async (req, res) => {
  let date = req.query.date;
  if (!date && periodOf(req.query) === "old") date = localDateText(addDaysLocal(currentSince(), -1));
  const { locations, range } = await reportScope(req, { maxDays: 1, query: { ...req.query, from: date || undefined, to: date || undefined } });

  const vehicleTypes = [...new Set(locations.flatMap((l) => l.vehicleTypes))];
  const { rows, total } = await typeSummary({ locationIds: locations.map((l) => l._id), range, vehicleTypes });

  const exportRows = wantsExport(req) ? [...rows, { ...total, type: "Total" }] : rows;
  respond(req, res, `day-summary-${range.from}`, [
    { key: "type", label: "Vehicle type" },
    { key: "entries", label: "Entries" },
    { key: "exits", label: "Exits" },
    { key: "parked", label: "Parked now" },
    { key: "cash", label: "Cash" },
    { key: "upi", label: "UPI" },
    { key: "card", label: "Card" },
    { key: "online", label: "Online" },
    { key: "fastag", label: "FASTag" },
    { key: "passSales", label: "Of which passes" },
    { key: "total", label: "Total" },
  ], exportRows, { total, date: range.from, from: range.from, to: range.from });
};

module.exports = { operatorCollectionReport, daySummaryReport, systemTotal };
