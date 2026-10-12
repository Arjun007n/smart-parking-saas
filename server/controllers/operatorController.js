// Gate staff screens: the Home numbers, the day's collection by vehicle type,
// and the Entry and Exit lists (with Excel / CSV / PDF download).
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { dayRange, dateTimeRange } = require("../utils/time");
const { locationsInScope } = require("../utils/scope");
const { normalizePlate, escapeRegex } = require("../utils/plate");
const { formatOf, buildReportFile } = require("../services/reportExport");
const { round2 } = require("../services/collectionService");
const sessionService = require("../services/sessionService");
const { can } = require("../middleware/permission");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");

const PAGE_SIZES = [10, 25, 50, 100, 200];
const EXPORT_LIMIT = 10000;
// Statuses of a vehicle that left (a cancelled entry never parked).
const EXITED = ["COMPLETED", "LOST_TICKET", "PASS_EXIT", "MANUAL_OVERRIDE"];
const KEY_OF_METHOD = { CASH: "cash", GATEWAY: "online", UPI: "upi", CARD: "card", FASTAG: "fastag", WALLET: "wallet" };
const METHOD_KEYS = Object.values(KEY_OF_METHOD);
const TYPE_KEY = Object.fromEntries(VEHICLE_TYPES.map((type) => [type, type.toLowerCase()]));

// Money figures a user was switched off from (Users > Edit > Show entry / exit / total collection).
// Entry = advances taken at entry, Exit = payments at exit, Total = the total and the ways of paying.
const HIDDEN_BY = {
  showEntryCollection: ["entryAmount"],
  showExitCollection: ["exitAmount"],
  showTotalCollection: ["cash", "online", "upi", "card", "fastag", "wallet", "total", "refunded", "net", "payments"],
};
const hiddenKeys = (user) => {
  const access = (user && user.access) || {};
  return Object.entries(HIDDEN_BY).flatMap(([flag, keys]) => (access[flag] === false ? keys : []));
};
const withoutKeys = (row, keys) => {
  if (!row || !keys.length) return row;
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
};
const redact = (user, result) => {
  const keys = hiddenKeys(user);
  if (!result || !keys.length) return { result, keys };
  return { result: { ...result, rows: result.rows.map((r) => withoutKeys(r, keys)), totals: withoutKeys(result.totals, keys) }, keys };
};

const canSeeMoney = (req) => can(req, P.PAYMENT_COLLECT) || can(req, P.REPORT_VIEW);

// Locations the request covers and the filter that keeps queries inside them.
const scopeOf = async (req) => {
  const locations = await locationsInScope(req);
  req.reportScopeName = req.query.locationId && locations.length === 1 ? locations[0].name : "All locations";
  // A day (?date=), or any period from one date and time to another (?from=2026-10-01T09:00&to=2026-10-05T18:00).
  const { from, to } = req.query;
  const period = from !== undefined || to !== undefined;
  const range = period ? dateTimeRange(from, to) : dayRange(req.query.date);
  return {
    locations,
    range,
    date: period ? `${String(from).slice(0, 16).replace(":", "")}-to-${String(to).slice(0, 16).replace(":", "")}` : req.query.date || null,
    inScope: { ...req.tenantFilter, locationId: { $in: locations.map((l) => l._id) } },
  };
};

const emptyRow = (type) => ({
  type, entryAmount: 0, exitAmount: 0, cash: 0, online: 0, upi: 0, card: 0, fastag: 0, wallet: 0, total: 0, refunded: 0, net: 0, payments: 0,
});

// Money of one day by vehicle type. "Entry amount" is advances taken at the
// gate, "exit amount" is what was paid when leaving; the payment-mode columns
// add up both. Refunds are counted on the day they were given back.
const collectionByType = async (inScope, { start, end }) => {
  const sessionsCollection = ParkingSession.collection.name;
  const [paid, refunds] = await Promise.all([
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: start, $lt: end } } },
      { $lookup: { from: sessionsCollection, localField: "sessionId", foreignField: "_id", as: "session" } },
      {
        $group: {
          _id: { type: { $arrayElemAt: ["$session.vehicleType", 0] }, kind: { $ifNull: ["$kind", "FEE"] }, method: "$method" },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": { $gte: start, $lt: end } } },
      { $lookup: { from: sessionsCollection, localField: "sessionId", foreignField: "_id", as: "session" } },
      { $group: { _id: { $arrayElemAt: ["$session.vehicleType", 0] }, amount: { $sum: "$refund.amount" } } },
    ]),
  ]);

  const byType = new Map(VEHICLE_TYPES.map((type) => [type, emptyRow(type)]));
  const rowFor = (type) => {
    const key = type || "OTHER";
    if (!byType.has(key)) byType.set(key, emptyRow(key));
    return byType.get(key);
  };
  for (const { _id, amount, count } of paid) {
    const row = rowFor(_id.type);
    if (_id.kind === "ADVANCE") row.entryAmount += amount;
    else row.exitAmount += amount;
    const column = KEY_OF_METHOD[_id.method];
    if (column) row[column] += amount;
    row.total += amount;
    row.payments += count;
  }
  for (const { _id, amount } of refunds) rowFor(_id).refunded += amount;

  const rows = [...byType.values()].filter((row) => VEHICLE_TYPES.includes(row.type) || row.payments > 0 || row.refunded > 0);
  const totals = emptyRow("TOTAL");
  for (const row of rows) {
    row.net = row.total - row.refunded;
    for (const key of ["entryAmount", "exitAmount", ...METHOD_KEYS, "total", "refunded", "net", "payments"]) totals[key] += row[key];
  }
  const tidy = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "number" ? round2(v) : v]));
  return { rows: rows.map(tidy), totals: tidy(totals) };
};

// GET /api/operator/summary?locationId=&date=
// Everything on the operator Home: licence, money, and how full the parking is.
const summary = async (req, res) => {
  const { locations, range, inScope } = await scopeOf(req);
  const { start, end } = range;

  const [entered, exited] = await Promise.all([
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: { $gte: start, $lt: end }, status: { $ne: "CANCELLED" } } },
      { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, status: { $in: EXITED }, exitTime: { $gte: start, $lt: end } } },
      { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
    ]),
  ]);
  const countOf = (list, type) => (list.find((row) => row._id === type) || { count: 0 }).count;

  const types = VEHICLE_TYPES.map((type) => {
    const key = TYPE_KEY[type];
    const capacity = locations.reduce((sum, l) => sum + ((l.capacity && l.capacity[key]) || 0), 0);
    const parked = locations.reduce((sum, l) => sum + ((l.occupied && l.occupied[key]) || 0), 0);
    return { type, capacity, parked, available: Math.max(0, capacity - parked), entries: countOf(entered, type), exits: countOf(exited, type) };
  }).filter((row) => row.capacity > 0 || row.entries > 0 || row.parked > 0);
  const all = types.reduce(
    (t, r) => ({
      capacity: t.capacity + r.capacity, parked: t.parked + r.parked, available: t.available + r.available,
      entries: t.entries + r.entries, exits: t.exits + r.exits,
    }),
    { capacity: 0, parked: 0, available: 0, entries: 0, exits: 0 }
  );

  const company = req.company || {};
  res.json({
    success: true,
    data: {
      from: start,
      to: end,
      license: {
        plan: company.plan ? company.plan.name : null,
        status: company.subscriptionStatus || null,
        validTill: company.trialEndsAt || null,
      },
      counts: { all, types },
      // Money is for people who collect payments or read reports.
      collection: canSeeMoney(req) ? redact(req.user, await collectionByType(inScope, range)).result : null,
    },
  });
};

// GET /api/operator/collection?locationId=&date=[&format=xlsx|csv|pdf]
const collection = async (req, res) => {
  if (!canSeeMoney(req)) throw new AppError("You do not have permission to do this", 403);
  const { range, inScope, date } = await scopeOf(req);
  const { result, keys: hidden } = redact(req.user, await collectionByType(inScope, range));
  const columns = [
    { key: "type", label: "Vehicle type" },
    { key: "entryAmount", label: "Entry amount (advance)" },
    { key: "exitAmount", label: "Exit amount" },
    { key: "cash", label: "Cash" },
    { key: "online", label: "Online" },
    { key: "upi", label: "UPI" },
    { key: "card", label: "Card" },
    { key: "fastag", label: "FASTag" },
    { key: "wallet", label: "Wallet" },
    { key: "total", label: "Total" },
    { key: "refunded", label: "Refunded" },
    { key: "net", label: "Net" },
  ].filter((c) => c.key === "type" || !hidden.includes(c.key));
  return respond(req, res, "collection-by-type", `collection-by-type-${date || "today"}`, columns, [...result.rows, result.totals], {
    date: date || undefined, rows: result.rows, totals: result.totals,
  });
};

// ------------------------------------------------------------- lists ----

const pageSizeFrom = (req) => {
  const size = Number.parseInt(req.query.pageSize, 10);
  return PAGE_SIZES.includes(size) ? size : 25;
};
const pageFrom = (req) => Math.min(10000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

// Sends JSON, or a file when ?format= is given. `json` is the JSON answer.
const respond = (req, res, report, name, columns, rows, json) => {
  const format = formatOf(req);
  if (!format) return res.json({ success: true, data: json });
  const file = buildReportFile({
    format, name, report, columns, rows, extra: { date: json.date },
    company: req.company ? req.company.name : "", scope: req.reportScopeName || "",
  });
  audit.record(req, "REPORT_EXPORT", { entity: "Report", meta: { report, format, rows: rows.length, locationId: req.query.locationId || undefined } });
  res.set({
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "no-store",
  });
  return res.send(file.buffer);
};

// A plate prefix or a ticket number.
const searchCondition = (q) => {
  const ticket = sessionService.normalizeTicket(q);
  return ticket ? { ticketNumber: ticket } : { vehicleNumber: { $regex: `^${escapeRegex(normalizePlate(q))}` } };
};

// The successful payments of these sessions, by session.
const paymentsBySession = async (sessionIds) => {
  const rows = await Payment.find({ sessionId: { $in: sessionIds }, status: { $in: ["SUCCESS", "REFUNDED"] } }).sort({ paidAt: 1 });
  const map = new Map();
  for (const payment of rows) {
    const entry = map.get(String(payment.sessionId)) || { fee: null, advance: null };
    if (payment.kind === "ADVANCE") entry.advance = payment;
    else entry.fee = payment;
    map.set(String(payment.sessionId), entry);
  }
  return map;
};

const listOf = async (req, res, { kind }) => {
  const { locations, range, inScope, date } = await scopeOf(req);
  const names = new Map(locations.map((l) => [String(l._id), l.name]));
  const entry = kind === "entry";
  const conditions = [
    inScope,
    entry
      ? { entryTime: { $gte: range.start, $lt: range.end }, status: { $ne: "CANCELLED" } }
      : { isOpen: false, status: { $in: EXITED }, exitTime: { $gte: range.start, $lt: range.end } },
  ];
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";
  if (q) conditions.push(searchCondition(q));
  const filter = { $and: conditions };

  const exporting = formatOf(req) !== null;
  const pageSize = pageSizeFrom(req);
  const page = pageFrom(req);
  const sortField = entry ? "entryTime" : "exitTime";
  const [sessions, total] = await Promise.all([
    ParkingSession.find(filter).sort({ [sortField]: -1 })
      .skip(exporting ? 0 : (page - 1) * pageSize).limit(exporting ? EXPORT_LIMIT : pageSize),
    ParkingSession.countDocuments(filter),
  ]);
  const money = await paymentsBySession(sessions.map((s) => s._id));

  const rows = sessions.map((s, index) => {
    const paid = money.get(String(s._id)) || { fee: null, advance: null };
    const advanceTaken = (s.advance && s.advance.amount) || 0;
    const base = {
      id: s._id,
      sno: (exporting ? 0 : (page - 1) * pageSize) + index + 1,
      vehicle: s.vehicleNumber,
      type: s.vehicleType,
      ticket: s.ticketNumber,
      location: names.get(String(s.locationId)) || "",
      inTime: s.entryTime,
      advance: advanceTaken,
    };
    if (entry) {
      return { ...base, method: (s.advance && s.advance.method) || "", status: s.status };
    }
    const feeMethod = paid.fee ? paid.fee.method : s.advance && s.advance.method;
    return {
      ...base,
      method: feeMethod || "",
      outTime: s.exitTime,
      totalMinutes: s.durationMinutes ?? "",
      // Money taken when leaving (after the advance), and what the stay cost.
      paid: paid.fee ? paid.fee.amount : 0,
      payable: s.fee && s.fee.total !== undefined ? s.fee.total : 0,
      status: s.status,
    };
  });

  const columns = entry
    ? [
        { key: "sno", label: "SNo" }, { key: "vehicle", label: "Vehicle no" }, { key: "method", label: "Payment mode" },
        { key: "type", label: "Vehicle type" }, { key: "ticket", label: "Token" }, { key: "inTime", label: "In time" },
        { key: "advance", label: "Advance amount" },
      ]
    : [
        { key: "sno", label: "SNo" }, { key: "vehicle", label: "Vehicle no" }, { key: "method", label: "Payment mode" },
        { key: "type", label: "Vehicle type" }, { key: "ticket", label: "Token" }, { key: "inTime", label: "In time" },
        { key: "outTime", label: "Out time" }, { key: "totalMinutes", label: "Total time (min)" },
        { key: "advance", label: "Advance amount" }, { key: "paid", label: "Paid amount" }, { key: "payable", label: "Payable amount" },
      ];
  const report = entry ? "entry-list" : "exit-list";
  return respond(req, res, report, `${report}-${date || "today"}`, columns, rows, {
    sessions: rows, total, page, pageSize, pageSizes: PAGE_SIZES, date: date || undefined,
  });
};

// GET /api/operator/entries?locationId=&date=&q=&page=&pageSize=[&format=]   (vehicles that came in on a day)
const entryList = (req, res) => listOf(req, res, { kind: "entry" });
// GET /api/operator/exits?...                                                (vehicles that left on a day)
const exitList = (req, res) => listOf(req, res, { kind: "exit" });

module.exports = { summary, collection, entryList, exitList, collectionByType, PAGE_SIZES, EXITED };
