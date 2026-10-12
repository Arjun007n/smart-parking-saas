const AppError = require("../utils/AppError");
const { dayRange, rangeFromQuery, timezoneString, localDateText, DAY } = require("../utils/time");
const { locationsInScope, operatorIdFromQuery } = require("../utils/scope");
const { withPeriodDefaults, checkPeriod } = require("../utils/reportPeriod");
const { normalizePlate, escapeRegex } = require("../utils/plate");
const audit = require("../services/auditService");
const { formatOf, buildReportFile } = require("../services/reportExport");
const { round2 } = require("../services/collectionService");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const User = require("../models/User");
const { SESSION_STATUSES, VEHICLE_TYPES, sumCounts } = require("../models/constants");

const CSV_LIMIT = 10000;
const PAGE_SIZE = 100;
// True for any file download (CSV, Excel or PDF): such answers are not paged.
const wantsExport = (req) => formatOf(req) !== null;
const pageFrom = (req) => Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

// Locations and date range shared by every report.
// Says which locations a report covers (shown on Excel and PDF downloads).
const rememberScope = (req, locations) => {
  req.reportScopeName = req.query.locationId && locations.length === 1 ? locations[0].name : "All locations";
};

const reportScope = async (req, options = {}) => {
  const locations = await locationsInScope(req);
  rememberScope(req, locations);
  // A report can pass its own dates (for example one chosen day) in `options.query`.
  const query = options.query || req.query;
  const range = rangeFromQuery(withPeriodDefaults(query), options);
  // ?period=current|old keeps the dates inside the live or the old period.
  checkPeriod(query, range);
  return {
    locations,
    locationNames: new Map(locations.map((l) => [String(l._id), l.name])),
    // The company is repeated here so the database can use the company-first indexes.
    inScope: { ...req.tenantFilter, locationId: { $in: locations.map((l) => l._id) } },
    range,
  };
};

const userNames = async (ids) => {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }).select("name");
  return new Map(users.map((u) => [String(u._id), u.name]));
};

// Sends the rows as JSON, or as a download when ?format=csv, xlsx or pdf.
// The report is named by the last part of the route (/api/reports/revenue).
const respond = (req, res, name, columns, rows, extra = {}) => {
  const format = formatOf(req);
  if (!format) return res.json({ success: true, data: { columns, rows, ...extra } });

  // A report outside /api/reports names itself (req.reportKey) so its title is its own.
  const report = req.reportKey || req.path.replace(/^\/+|\/+$/g, "");
  const file = buildReportFile({
    format, name, report, columns, rows, extra,
    company: req.company ? req.company.name : "", scope: req.reportScopeName || "",
  });
  // Who downloaded what is part of the audit trail.
  audit.record(req, "REPORT_EXPORT", {
    entity: "Report",
    meta: { report, format, from: extra.from, to: extra.to, locationId: req.query.locationId || undefined, rows: rows.length },
  });
  res.set({
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "no-store",
  });
  return res.send(file.buffer);
};

// GET /api/reports/revenue?from=&to=&groupBy=day|week|month|location&locationId=
const revenueReport = async (req, res) => {
  const groupBy = ["day", "week", "month", "location"].includes(req.query.groupBy) ? req.query.groupBy : "day";
  const { locationNames, inScope, range } = await reportScope(req, { maxDays: 366 });
  const tz = timezoneString();
  const formats = { day: "%Y-%m-%d", week: "%G-W%V", month: "%Y-%m" };
  const keyOf = (field) =>
    groupBy === "location" ? "$locationId" : { $dateToString: { date: field, format: formats[groupBy], timezone: tz } };

  const [paid, passPaid, refunded] = await Promise.all([
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: keyOf("$paidAt"), collected: { $sum: "$amount" }, tax: { $sum: "$tax" }, payments: { $sum: 1 } } },
    ]),
    // Pass sales and renewals (free passes are not money).
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: { $gte: range.start, $lt: range.end } } },
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
    if (!byKey.has(k)) byKey.set(k, { key: k, payments: 0, collected: 0, tax: 0, passes: 0, refunds: 0, refunded: 0 });
    return byKey.get(k);
  };
  for (const p of paid) Object.assign(row(p._id), { payments: p.payments, collected: p.collected, tax: p.tax });
  for (const p of passPaid) {
    const r = row(p._id);
    r.payments += p.payments;
    r.collected += p.collected;
    r.tax += p.tax;
    r.passes += p.collected;
  }
  for (const r of refunded) Object.assign(row(r._id), { refunds: r.refunds, refunded: r.refunded });

  const rows = [...byKey.values()]
    .map((r) => ({
      period: groupBy === "location" ? locationNames.get(r.key) || "Unknown" : r.key,
      payments: r.payments,
      collected: round2(r.collected),
      tax: round2(r.tax),
      passes: round2(r.passes),
      net: round2(r.collected - r.refunded),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const total = rows.reduce(
    (t, r) => ({ payments: t.payments + r.payments, collected: round2(t.collected + r.collected), net: round2(t.net + r.net) }),
    { payments: 0, collected: 0, net: 0 }
  );

  respond(req, res, `revenue-${range.from}-to-${range.to}`, [
    { key: "period", label: groupBy === "location" ? "Location" : groupBy === "day" ? "Date" : groupBy === "week" ? "Week" : "Month" },
    { key: "payments", label: "Payments" },
    { key: "collected", label: "Collected" },
    { key: "passes", label: "Of which passes" },
    { key: "tax", label: "Tax" },
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
  if (["CASH", "UPI", "CARD", "GATEWAY", "FASTAG", "WALLET"].includes(req.query.method)) filter.method = req.query.method;

  const csv = wantsExport(req);
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
  ], rows, { total, page, pageSize: PAGE_SIZE, from: range.from, to: range.to });
};

// GET /api/reports/vehicles?from=&to=&locationId=&q=&status=&vehicleType=&gate=&entryOperatorId=&exitOperatorId=&period=&page=
// Vehicle history: every visit that started in the period.
const vehicleReport = async (req, res) => {
  const { locationNames, inScope, range } = await reportScope(req);
  const filter = { ...inScope, entryTime: { $gte: range.start, $lt: range.end } };
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";
  if (q) filter.vehicleNumber = { $regex: `^${escapeRegex(normalizePlate(q))}` };
  if (SESSION_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (VEHICLE_TYPES.includes(req.query.vehicleType)) filter.vehicleType = req.query.vehicleType;
  // A gate name matches where the vehicle came in or went out.
  if (typeof req.query.gate === "string" && req.query.gate.trim()) {
    const gate = req.query.gate.trim().slice(0, 50);
    filter.$or = [{ entryGate: gate }, { exitGate: gate }];
  }
  const entryBy = operatorIdFromQuery(req, "entryOperatorId");
  const exitBy = operatorIdFromQuery(req, "exitOperatorId");
  if (entryBy) filter.entryOperatorId = entryBy;
  if (exitBy) filter.exitOperatorId = exitBy;

  const csv = wantsExport(req);
  const page = pageFrom(req);
  const [sessions, total] = await Promise.all([
    ParkingSession.find(filter).sort({ entryTime: -1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE),
    ParkingSession.countDocuments(filter),
  ]);
  const [names, payments] = await Promise.all([
    userNames(sessions.flatMap((s) => [s.entryOperatorId, s.exitOperatorId])),
    Payment.find({ sessionId: { $in: sessions.map((s) => s._id) }, status: { $in: ["SUCCESS", "REFUNDED"] } }).select("sessionId kind method amount"),
  ]);
  const feeMethod = new Map();
  for (const p of payments) if (p.kind !== "ADVANCE") feeMethod.set(String(p.sessionId), p.method);

  const rows = sessions.map((s) => ({
    vehicle: s.vehicleNumber,
    type: s.vehicleType,
    ticket: s.ticketNumber,
    location: locationNames.get(String(s.locationId)) || "",
    entryTime: s.entryTime,
    exitTime: s.exitTime || "",
    durationMinutes: s.durationMinutes ?? "",
    status: s.status,
    entryBy: names.get(String(s.entryOperatorId)) || "",
    exitBy: names.get(String(s.exitOperatorId)) || (s.autoClosed ? "Closed automatically" : ""),
    entryGate: s.entryGate || "",
    exitGate: s.exitGate || "",
    reprints: s.reprints || 0,
    advance: s.advance && s.advance.amount ? s.advance.amount : "",
    advanceMethod: s.advance && s.advance.amount ? s.advance.method || "" : "",
    fee: s.fee && s.fee.total !== undefined ? s.fee.total : "",
    payable: s.fee && s.fee.due !== undefined ? s.fee.due : s.fee && s.fee.total !== undefined ? s.fee.total : "",
    method: feeMethod.get(String(s._id)) || "",
    photos: Array.isArray(s.photos) ? s.photos.length : 0,
    edited: s.feeEdit && s.feeEdit.reason ? `Changed from ${s.feeEdit.calculated}: ${s.feeEdit.reason}` : "",
  }));

  respond(req, res, `vehicles-${range.from}-to-${range.to}`, [
    { key: "vehicle", label: "Vehicle" },
    { key: "type", label: "Type" },
    { key: "ticket", label: "Ticket" },
    { key: "location", label: "Location" },
    { key: "entryTime", label: "Entry" },
    { key: "entryBy", label: "Entry by" },
    { key: "entryGate", label: "Entry gate" },
    { key: "exitTime", label: "Exit" },
    { key: "exitBy", label: "Exit by" },
    { key: "exitGate", label: "Exit gate" },
    { key: "durationMinutes", label: "Duration (min)" },
    { key: "status", label: "Status" },
    { key: "reprints", label: "Reprints" },
    { key: "advance", label: "Advance" },
    { key: "advanceMethod", label: "Advance mode" },
    { key: "fee", label: "Fee" },
    { key: "payable", label: "Payable" },
    { key: "method", label: "Paid by" },
    { key: "photos", label: "Photos" },
    { key: "edited", label: "Amount changed" },
  ], rows, { total, page, pageSize: PAGE_SIZE, from: range.from, to: range.to });
};

// GET /api/reports/occupancy?date=&locationId=
// For each hour of one day: how many vehicles were inside at some point in it.
const occupancyReport = async (req, res) => {
  const locations = await locationsInScope(req);
  rememberScope(req, locations);
  const { start, end } = dayRange(req.query.date);
  const date = localDateText(start);
  const capacity = locations.reduce((t, l) => t + sumCounts(l.capacity), 0);

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

  const [entries, exits, overrides, paid, passSold] = await Promise.all([
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
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: between, ...only("collectedBy") } },
      { $group: { _id: "$collectedBy", amount: { $sum: "$amount" }, count: { $sum: 1 }, cash: { $sum: { $cond: [{ $eq: ["$method", "CASH"] }, "$amount", 0] } } } },
    ]),
  ]);

  const byOperator = new Map();
  const row = (id) => {
    const key = String(id);
    if (!byOperator.has(key)) {
      byOperator.set(key, { id, entries: 0, exits: 0, corrections: 0, payments: 0, collected: 0, cash: 0 });
    }
    return byOperator.get(key);
  };
  for (const r of entries) row(r._id).entries = r.count;
  for (const r of exits) row(r._id).exits = r.count;
  for (const r of overrides) row(r._id).corrections = r.count;
  for (const r of paid) Object.assign(row(r._id), { payments: r.count, collected: round2(r.amount), cash: round2(r.cash) });
  for (const r of passSold) {
    const o = row(r._id);
    o.payments += r.count;
    o.collected = round2(o.collected + r.amount);
    o.cash = round2(o.cash + r.cash);
  }

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
  ], rows, { from: range.from, to: range.to });
};

module.exports = {
  CSV_LIMIT, PAGE_SIZE, wantsExport, pageFrom, reportScope, userNames, respond,
  revenueReport, collectionReport, vehicleReport, occupancyReport, operatorReport };
