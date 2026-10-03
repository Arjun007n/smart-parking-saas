const AppError = require("../utils/AppError");
const { dayRange, rangeFromQuery, timezoneString, localDateText, DAY } = require("../utils/time");
const { locationsInScope, operatorIdFromQuery } = require("../utils/scope");
const { normalizePlate, escapeRegex } = require("../utils/plate");
const { sendCsv } = require("../utils/csv");
const { round2 } = require("../services/collectionService");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const User = require("../models/User");
const { SESSION_STATUSES } = require("../models/constants");

const CSV_LIMIT = 10000;
const PAGE_SIZE = 100;
const wantsCsv = (req) => req.query.format === "csv";
const pageFrom = (req) => Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

// Locations and date range shared by every report.
const reportScope = async (req, options) => {
  const locations = await locationsInScope(req);
  return {
    locations,
    locationNames: new Map(locations.map((l) => [String(l._id), l.name])),
    inScope: { locationId: { $in: locations.map((l) => l._id) } },
    range: rangeFromQuery(req.query, options),
  };
};

const userNames = async (ids) => {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }).select("name");
  return new Map(users.map((u) => [String(u._id), u.name]));
};

// Sends the rows as JSON, or as a CSV download when ?format=csv.
const respond = (req, res, name, columns, rows, extra = {}) => {
  if (wantsCsv(req)) return sendCsv(res, `${name}.csv`, columns, rows);
  return res.json({ success: true, data: { columns, rows, ...extra } });
};

// GET /api/reports/revenue?from=&to=&groupBy=day|week|month|location&locationId=
const revenueReport = async (req, res) => {
  const groupBy = ["day", "week", "month", "location"].includes(req.query.groupBy) ? req.query.groupBy : "day";
  const { locationNames, inScope, range } = await reportScope(req, { maxDays: 366 });
  const tz = timezoneString();
  const formats = { day: "%Y-%m-%d", week: "%G-W%V", month: "%Y-%m" };
  const keyOf = (field) =>
    groupBy === "location" ? "$locationId" : { $dateToString: { date: field, format: formats[groupBy], timezone: tz } };

  const [paid, refunded] = await Promise.all([
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: keyOf("$paidAt"), collected: { $sum: "$amount" }, tax: { $sum: "$tax" }, payments: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": { $gte: range.start, $lt: range.end } } },
      { $group: { _id: keyOf("$refund.refundedAt"), refunded: { $sum: "$refund.amount" }, refunds: { $sum: 1 } } },
    ]),
  ]);

  const byKey = new Map();
  const row = (key) => {
    const k = String(key);
    if (!byKey.has(k)) byKey.set(k, { key: k, payments: 0, collected: 0, tax: 0, refunds: 0, refunded: 0 });
    return byKey.get(k);
  };
  for (const p of paid) Object.assign(row(p._id), { payments: p.payments, collected: p.collected, tax: p.tax });
  for (const r of refunded) Object.assign(row(r._id), { refunds: r.refunds, refunded: r.refunded });

  const rows = [...byKey.values()]
    .map((r) => ({
      period: groupBy === "location" ? locationNames.get(r.key) || "Unknown" : r.key,
      payments: r.payments,
      collected: round2(r.collected),
      tax: round2(r.tax),
      refunds: r.refunds,
      refunded: round2(r.refunded),
      net: round2(r.collected - r.refunded),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const total = rows.reduce(
    (t, r) => ({ payments: t.payments + r.payments, collected: round2(t.collected + r.collected), refunded: round2(t.refunded + r.refunded), net: round2(t.net + r.net) }),
    { payments: 0, collected: 0, refunded: 0, net: 0 }
  );

  respond(req, res, `revenue-${range.from}-to-${range.to}`, [
    { key: "period", label: groupBy === "location" ? "Location" : groupBy === "day" ? "Date" : groupBy === "week" ? "Week" : "Month" },
    { key: "payments", label: "Payments" },
    { key: "collected", label: "Collected" },
    { key: "tax", label: "Tax" },
    { key: "refunds", label: "Refunds" },
    { key: "refunded", label: "Refunded" },
    { key: "net", label: "Net" },
  ], rows, { total, groupBy, from: range.from, to: range.to });
};

// GET /api/reports/collection?from=&to=&locationId=&operatorId=&method=&page=
// Every payment in the period, one row each.
const collectionReport = async (req, res) => {
  const { locationNames, inScope, range } = await reportScope(req);
  const filter = { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: range.start, $lt: range.end } };
  const operatorId = operatorIdFromQuery(req);
  if (operatorId) filter.collectedBy = operatorId;
  if (["CASH", "UPI", "CARD", "GATEWAY"].includes(req.query.method)) filter.method = req.query.method;

  const csv = wantsCsv(req);
  const page = pageFrom(req);
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ paidAt: -1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE),
    Payment.countDocuments(filter),
  ]);
  const [sessions, names] = await Promise.all([
    ParkingSession.find({ _id: { $in: payments.map((p) => p.sessionId) } }).select("ticketNumber vehicleNumber"),
    userNames(payments.map((p) => p.collectedBy)),
  ]);
  const sessionById = new Map(sessions.map((s) => [String(s._id), s]));

  const rows = payments.map((p) => {
    const session = sessionById.get(String(p.sessionId));
    return {
      paidAt: p.paidAt,
      location: locationNames.get(String(p.locationId)) || "",
      ticket: session ? session.ticketNumber : "",
      vehicle: session ? session.vehicleNumber : "",
      method: p.method,
      amount: p.amount,
      tax: p.tax,
      status: p.status,
      operator: names.get(String(p.collectedBy)) || "",
      reference: p.transactionId || "",
      refundReason: p.refund && p.refund.reason ? p.refund.reason : "",
    };
  });

  respond(req, res, `collection-${range.from}-to-${range.to}`, [
    { key: "paidAt", label: "Paid at" },
    { key: "location", label: "Location" },
    { key: "ticket", label: "Ticket" },
    { key: "vehicle", label: "Vehicle" },
    { key: "method", label: "Method" },
    { key: "amount", label: "Amount" },
    { key: "tax", label: "Tax" },
    { key: "status", label: "Status" },
    { key: "operator", label: "Collected by" },
    { key: "reference", label: "Reference" },
    { key: "refundReason", label: "Refund reason" },
  ], rows, { total, page, pageSize: PAGE_SIZE, from: range.from, to: range.to });
};

// GET /api/reports/vehicles?from=&to=&locationId=&q=&status=&page=
// Vehicle history: every visit that started in the period.
const vehicleReport = async (req, res) => {
  const { locationNames, inScope, range } = await reportScope(req);
  const filter = { ...inScope, entryTime: { $gte: range.start, $lt: range.end } };
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";
  if (q) filter.vehicleNumber = { $regex: `^${escapeRegex(normalizePlate(q))}` };
  if (SESSION_STATUSES.includes(req.query.status)) filter.status = req.query.status;

  const csv = wantsCsv(req);
  const page = pageFrom(req);
  const [sessions, total] = await Promise.all([
    ParkingSession.find(filter).sort({ entryTime: -1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE),
    ParkingSession.countDocuments(filter),
  ]);

  const rows = sessions.map((s) => ({
    vehicle: s.vehicleNumber,
    type: s.vehicleType,
    ticket: s.ticketNumber,
    location: locationNames.get(String(s.locationId)) || "",
    entryTime: s.entryTime,
    exitTime: s.exitTime || "",
    durationMinutes: s.durationMinutes ?? "",
    status: s.status,
    fee: s.fee && s.fee.total !== undefined ? s.fee.total : "",
  }));

  respond(req, res, `vehicles-${range.from}-to-${range.to}`, [
    { key: "vehicle", label: "Vehicle" },
    { key: "type", label: "Type" },
    { key: "ticket", label: "Ticket" },
    { key: "location", label: "Location" },
    { key: "entryTime", label: "Entry" },
    { key: "exitTime", label: "Exit" },
    { key: "durationMinutes", label: "Duration (min)" },
    { key: "status", label: "Status" },
    { key: "fee", label: "Fee" },
  ], rows, { total, page, pageSize: PAGE_SIZE, from: range.from, to: range.to });
};

// GET /api/reports/occupancy?date=&locationId=
// For each hour of one day: how many vehicles were inside at some point in it.
const occupancyReport = async (req, res) => {
  const locations = await locationsInScope(req);
  const { start, end } = dayRange(req.query.date);
  const date = localDateText(start);
  const capacity = locations.reduce((t, l) => t + l.capacity.car + l.capacity.bike + l.capacity.heavy, 0);

  const sessions = await ParkingSession.find({
    locationId: { $in: locations.map((l) => l._id) },
    status: { $ne: "CANCELLED" },
    entryTime: { $lt: end },
    $or: [{ isOpen: true }, { exitTime: { $gt: start } }],
  })
    .select("entryTime exitTime isOpen")
    .limit(50000)
    .lean();
  if (sessions.length === 50000) throw new AppError("Too much data for one request. Choose a single location.", 400);

  const now = Date.now();
  const HOUR = DAY / 24;
  const rows = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const from = start.getTime() + hour * HOUR;
    const to = from + HOUR;
    if (from > now) break; // hours that have not started yet
    const vehicles = sessions.filter(
      (s) => s.entryTime.getTime() < to && (s.isOpen || !s.exitTime || s.exitTime.getTime() > from)
    ).length;
    rows.push({
      hour: `${String(hour).padStart(2, "0")}:00`,
      vehicles,
      capacity,
      utilization: capacity > 0 ? Math.round((vehicles / capacity) * 100) : 0,
    });
  }

  const peak = rows.reduce((best, r) => (r.vehicles > (best ? best.vehicles : -1) ? r : best), null);
  respond(req, res, `occupancy-${date}`, [
    { key: "hour", label: "Hour" },
    { key: "vehicles", label: "Vehicles inside" },
    { key: "capacity", label: "Capacity" },
    { key: "utilization", label: "Utilization %" },
  ], rows, { date, capacity, peak });
};

// GET /api/reports/operators?from=&to=&locationId=&operatorId=
const operatorReport = async (req, res) => {
  const { inScope, range } = await reportScope(req);
  const between = { $gte: range.start, $lt: range.end };
  const operatorId = operatorIdFromQuery(req);
  const only = (field) => (operatorId ? { [field]: operatorId } : { [field]: { $ne: null } });

  const [entries, exits, overrides, paid, refunds] = await Promise.all([
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: between, ...only("entryOperatorId") } },
      { $group: { _id: "$entryOperatorId", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, exitTime: between, ...only("exitOperatorId") } },
      { $group: { _id: "$exitOperatorId", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, status: { $in: ["MANUAL_OVERRIDE", "CANCELLED"] }, exitTime: between, ...only("closedBy") } },
      { $group: { _id: "$closedBy", count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: between, ...only("collectedBy") } },
      { $group: { _id: "$collectedBy", amount: { $sum: "$amount" }, count: { $sum: 1 }, cash: { $sum: { $cond: [{ $eq: ["$method", "CASH"] }, "$amount", 0] } } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": between, ...only("refund.refundedBy") } },
      { $group: { _id: "$refund.refundedBy", amount: { $sum: "$refund.amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const byOperator = new Map();
  const row = (id) => {
    const key = String(id);
    if (!byOperator.has(key)) {
      byOperator.set(key, { id, entries: 0, exits: 0, corrections: 0, payments: 0, collected: 0, cash: 0, refunds: 0, refunded: 0 });
    }
    return byOperator.get(key);
  };
  for (const r of entries) row(r._id).entries = r.count;
  for (const r of exits) row(r._id).exits = r.count;
  for (const r of overrides) row(r._id).corrections = r.count;
  for (const r of paid) Object.assign(row(r._id), { payments: r.count, collected: round2(r.amount), cash: round2(r.cash) });
  for (const r of refunds) Object.assign(row(r._id), { refunds: r.count, refunded: round2(r.amount) });

  const names = await userNames([...byOperator.values()].map((r) => r.id));
  const rows = [...byOperator.values()]
    .map(({ id, ...rest }) => ({ operator: names.get(String(id)) || "Unknown", ...rest }))
    .sort((a, b) => a.operator.localeCompare(b.operator));

  respond(req, res, `operators-${range.from}-to-${range.to}`, [
    { key: "operator", label: "Operator" },
    { key: "entries", label: "Entries" },
    { key: "exits", label: "Exits" },
    { key: "payments", label: "Payments" },
    { key: "collected", label: "Collected" },
    { key: "cash", label: "Of which cash" },
    { key: "corrections", label: "Cancels and overrides" },
    { key: "refunds", label: "Refunds" },
    { key: "refunded", label: "Refunded" },
  ], rows, { from: range.from, to: range.to });
};

module.exports = { revenueReport, collectionReport, vehicleReport, occupancyReport, operatorReport };
