// Phase 2 reports: when it is busy, how full it gets, what went wrong, how
// people pay, how long they stay, pass renewals, and how the gate hardware does.
// Every report takes ?from=&to=&locationId= like the basic ones and ?format=csv.
const AppError = require("../utils/AppError");
const { timezoneString, localDateText, DAY } = require("../utils/time");
const { round2 } = require("../services/collectionService");
const reports = require("./reportController");
const math = require("../services/reportMath");
const passService = require("../services/passService");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const Pass = require("../models/Pass");
const Hardware = require("../models/Hardware");
const HardwareCommand = require("../models/HardwareCommand");
const HardwareEvent = require("../models/HardwareEvent");
const AnprDetection = require("../models/AnprDetection");
const AuditLog = require("../models/AuditLog");
const mongoose = require("mongoose");
const { normalizePlate, escapeRegex } = require("../utils/plate");
const { sumCounts } = require("../models/constants");
const { can } = require("../middleware/permission");
const { PERMISSIONS } = require("../config/permissions");
const { operatorIdFromQuery } = require("../utils/scope");
const reprintService = require("../services/reprintService");

const { reportScope, respond, userNames, wantsExport, pageFrom, CSV_LIMIT, PAGE_SIZE } = reports;
const SESSION_LIMIT = 50000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// GET /api/reports/peak-hours?by=hour|weekday
// Entries and exits by hour of the day (or day of the week) across the period.
const peakHoursReport = async (req, res) => {
  const { inScope, range } = await reportScope(req);
  const by = req.query.by === "weekday" ? "weekday" : "hour";
  const tz = timezoneString();
  const keyOf = (field) => (by === "hour" ? { $hour: { date: field, timezone: tz } } : { $dayOfWeek: { date: field, timezone: tz } });
  const between = { $gte: range.start, $lt: range.end };

  const [entries, exits] = await Promise.all([
    ParkingSession.aggregate([
      { $match: { ...inScope, status: { $ne: "CANCELLED" }, entryTime: between } },
      { $group: { _id: keyOf("$entryTime"), count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, status: { $ne: "CANCELLED" }, exitTime: between } },
      { $group: { _id: keyOf("$exitTime"), count: { $sum: 1 } } },
    ]),
  ]);
  const entered = new Map(entries.map((r) => [r._id, r.count]));
  const left = new Map(exits.map((r) => [r._id, r.count]));

  // $dayOfWeek counts Sunday as 1.
  const slots = by === "hour" ? Array.from({ length: 24 }, (_, h) => h) : [1, 2, 3, 4, 5, 6, 7];
  const dayCounts = math.weekdayCounts(range.start, range.days);
  const rows = slots.map((slot) => {
    const divisor = by === "hour" ? range.days : dayCounts[slot - 1];
    const count = entered.get(slot) || 0;
    return {
      slot: by === "hour" ? `${String(slot).padStart(2, "0")}:00` : WEEKDAYS[slot - 1],
      entries: count,
      exits: left.get(slot) || 0,
      averageEntries: divisor > 0 ? Math.round((count / divisor) * 10) / 10 : 0,
    };
  });
  const busiest = rows.reduce((best, r) => (r.entries > (best ? best.entries : 0) ? r : best), null);
  const total = rows.reduce((t, r) => t + r.entries, 0);

  respond(req, res, `peak-${by}-${range.from}-to-${range.to}`, [
    { key: "slot", label: by === "hour" ? "Hour" : "Day" },
    { key: "entries", label: "Entries" },
    { key: "exits", label: "Exits" },
    { key: "averageEntries", label: by === "hour" ? "Average entries per day" : "Average entries per such day" },
  ], rows, { by, busiest, totalEntries: total, from: range.from, to: range.to });
};

// GET /api/reports/occupancy-trend
// For each day: entries, exits, the most vehicles inside at once, and the average stay.
const occupancyTrendReport = async (req, res) => {
  const { locations, inScope, range } = await reportScope(req, { maxDays: 92 });
  const capacity = locations.reduce((t, l) => t + sumCounts(l.capacity), 0);

  const sessions = await ParkingSession.find({
    ...inScope,
    status: { $ne: "CANCELLED" },
    entryTime: { $lt: range.end },
    $or: [{ isOpen: true }, { exitTime: { $gte: range.start } }],
  })
    .select("entryTime exitTime isOpen durationMinutes")
    .limit(SESSION_LIMIT + 1)
    .lean();
  if (sessions.length > SESSION_LIMIT) throw new AppError("Too much data for one request. Choose a single location or a shorter period.", 400);

  const rows = math
    .dailyOccupancy({ sessions, start: range.start, days: range.days, capacity })
    .map(({ from, ...day }) => ({ date: localDateText(new Date(from)), ...day }));
  const busiest = rows.reduce((best, r) => (r.peakInside > (best ? best.peakInside : 0) ? r : best), null);

  respond(req, res, `occupancy-trend-${range.from}-to-${range.to}`, [
    { key: "date", label: "Date" },
    { key: "entries", label: "Entries" },
    { key: "exits", label: "Exits" },
    { key: "peakInside", label: "Most vehicles inside" },
    { key: "capacity", label: "Capacity" },
    { key: "peakUtilization", label: "Peak utilization %" },
    { key: "averageStayMinutes", label: "Average stay (min)" },
  ], rows, { capacity, busiest, from: range.from, to: range.to });
};

// ---------------------------------------------------------------- re-entries

// GET /api/reports/re-entries?from=&to=&locationId=&operatorId=&page=
// Every ticket an operator replaced with "Re-entry": who did it, when, for which vehicle, and the old and new
// ticket. Admins only: the operators and supervisors never see these counts.
const reEntriesReport = async (req, res) => {
  if (!can(req, PERMISSIONS.LOCATION_MANAGE)) throw new AppError("Only an admin can see re-entries", 403);
  const { locationNames, inScope, range } = await reportScope(req);
  const operatorId = operatorIdFromQuery(req);
  const filter = {
    ...inScope, reEntry: true, entryTime: { $gte: range.start, $lt: range.end },
    ...(operatorId ? { entryOperatorId: operatorId } : {}),
  };
  const csv = wantsExport(req);
  const page = pageFrom(req);
  const [docs, total, perOperator] = await Promise.all([
    ParkingSession.find(filter).sort({ entryTime: -1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE).lean(),
    ParkingSession.countDocuments(filter),
    ParkingSession.aggregate([
      { $match: filter },
      { $group: { _id: "$entryOperatorId", count: { $sum: 1 }, last: { $max: "$entryTime" } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  // The new ticket remembers which one it replaced in its request key ("reentry-<old ticket id>").
  const oldIdOf = (doc) => {
    const key = typeof doc.idempotencyKey === "string" ? doc.idempotencyKey : "";
    const id = key.startsWith("reentry-") ? key.slice(8) : "";
    return mongoose.isValidObjectId(id) ? id : "";
  };
  const [oldTickets, names] = await Promise.all([
    ParkingSession.find({ _id: { $in: docs.map(oldIdOf).filter(Boolean) } }).select("ticketNumber entryTime").lean(),
    userNames([...docs.map((d) => d.entryOperatorId), ...perOperator.map((r) => r._id)]),
  ]);
  const oldById = new Map(oldTickets.map((t) => [String(t._id), t]));

  const rows = docs.map((d) => {
    const old = oldById.get(oldIdOf(d));
    return {
      when: d.entryTime,
      location: locationNames.get(String(d.locationId)) || "",
      operator: names.get(String(d.entryOperatorId)) || "Unknown",
      vehicle: d.vehicleNumber,
      type: d.vehicleType,
      oldTicket: old ? old.ticketNumber : "",
      ticket: d.ticketNumber,
      gate: d.entryGate || "",
      // How long the replaced ticket had been open when it was swapped.
      durationMinutes: old ? Math.max(0, Math.round((new Date(d.entryTime) - new Date(old.entryTime)) / 60000)) : "",
    };
  });

  respond(req, res, `re-entries-${range.from}-to-${range.to}`, [
    { key: "when", label: "When" },
    { key: "location", label: "Location" },
    { key: "operator", label: "Operator" },
    { key: "vehicle", label: "Vehicle" },
    { key: "type", label: "Vehicle type" },
    { key: "oldTicket", label: "Old ticket" },
    { key: "ticket", label: "New ticket" },
    { key: "gate", label: "Gate" },
    { key: "durationMinutes", label: "Old ticket was open (min)" },
  ], rows, {
    total, page, pageSize: PAGE_SIZE,
    byOperator: perOperator.map((r) => ({ operator: names.get(String(r._id)) || "Unknown", count: r.count, last: r.last })),
    from: range.from, to: range.to,
  });
};

// ---------------------------------------------------------------- reprints

// GET /api/reports/reprints?from=&to=&locationId=&operatorId=&page=
// Every time a ticket or receipt was printed again: who, when, which ticket and vehicle. Admins only.
// There is no limit on reprinting; this is only the count.
const reprintsReport = async (req, res) => {
  if (!can(req, PERMISSIONS.LOCATION_MANAGE)) throw new AppError("Only an admin can see reprints", 403);
  const { locationNames, inScope, range } = await reportScope(req);
  const operatorId = operatorIdFromQuery(req);
  const match = reprintService.matchFor({
    tenantFilter: req.tenantFilter, locationIds: inScope.locationId.$in, start: range.start, end: range.end, operatorId,
  });
  const csv = wantsExport(req);
  const page = pageFrom(req);
  const [docs, total, perOperator] = await Promise.all([
    AuditLog.find(match).sort({ createdAt: -1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE).lean(),
    AuditLog.countDocuments(match),
    reprintService.byOperator(match),
  ]);
  const names = await userNames([...docs.map((d) => d.actorId), ...perOperator.map((r) => r._id)]);

  const rows = docs.map((d) => ({
    when: d.createdAt,
    location: locationNames.get(String(d.meta && d.meta.locationId)) || "",
    operator: names.get(String(d.actorId)) || d.actorEmail || "Unknown",
    ticket: (d.meta && d.meta.ticketNumber) || "",
    vehicle: (d.meta && d.meta.vehicleNumber) || "",
    printed: d.meta && d.meta.kind === "receipt" ? "Receipt" : "Ticket",
  }));

  respond(req, res, `reprints-${range.from}-to-${range.to}`, [
    { key: "when", label: "When" },
    { key: "location", label: "Location" },
    { key: "operator", label: "Operator" },
    { key: "ticket", label: "Ticket" },
    { key: "vehicle", label: "Vehicle" },
    { key: "printed", label: "Printed" },
  ], rows, {
    total, page, pageSize: PAGE_SIZE,
    byOperator: perOperator.map((r) => ({ operator: names.get(String(r._id)) || "Unknown", count: r.count, last: r.last })),
    from: range.from, to: range.to,
  });
};

// ---------------------------------------------------------------- exceptions

const EXCEPTION_TYPES = {
  CANCELLED: "Entry cancelled",
  OVERRIDE: "Released by admin",
  LOST_TICKET: "Lost ticket",
  PAYMENT_FAILED: "Online payment failed",
  PAYMENT_PROBLEM: "Payment problem",
  STILL_INSIDE: "Inside for over 24 hours",
};
const PER_SOURCE = 500;
const PAYMENT_PROBLEM_ACTIONS = {
  PAYMENT_WITHOUT_EXIT: "Paid after the vehicle was released",
  PAYMENT_DUPLICATE: "Customer paid twice",
  PAYMENT_AMOUNT_MISMATCH: "Wrong amount received",
  PAYMENT_UNMATCHED: "Money for a closed payment",
};

// GET /api/reports/exceptions?type=
// Everything unusual in one list: cancellations, releases by an admin, lost
// tickets, failed online payments, money that does not match the
// records, and vehicles that have been inside for over a day.
const exceptionsReport = async (req, res) => {
  const { locationNames, inScope, range } = await reportScope(req);
  const between = { $gte: range.start, $lt: range.end };
  const only = req.query.type;
  if (only !== undefined && only !== "" && !EXCEPTION_TYPES[only]) throw new AppError("Unknown type", 400);
  const wants = (type) => !only || only === type;
  const now = Date.now();

  const found = []; // { when, type, locationId, vehicle, ticket, amount, by, detail }
  const sessionQuery = (filter, sort) => ParkingSession.find({ ...inScope, ...filter }).sort(sort).limit(PER_SOURCE).lean();

  const [closedByAdmin, lost, failedOnline, stuck, problemLogs] = await Promise.all([
    wants("CANCELLED") || wants("OVERRIDE")
      ? sessionQuery({ status: { $in: ["CANCELLED", "MANUAL_OVERRIDE"] }, exitTime: between }, { exitTime: -1 })
      : [],
    wants("LOST_TICKET") ? sessionQuery({ status: "LOST_TICKET", exitTime: between }, { exitTime: -1 }) : [],
    wants("PAYMENT_FAILED")
      ? Payment.find({ ...inScope, method: "GATEWAY", status: "FAILED", createdAt: between }).sort({ createdAt: -1 }).limit(PER_SOURCE).lean()
      : [],
    // Only meaningful for "now": include when the period reaches the present.
    wants("STILL_INSIDE") && range.end.getTime() >= now
      ? sessionQuery({ isOpen: true, entryTime: { $lt: new Date(now - DAY) } }, { entryTime: 1 })
      : [],
    wants("PAYMENT_PROBLEM")
      ? AuditLog.find({ ...req.tenantFilter, action: { $in: Object.keys(PAYMENT_PROBLEM_ACTIONS) }, createdAt: between })
          .sort({ createdAt: -1 }).limit(PER_SOURCE).lean()
      : [],
  ]);

  // Payments behind the problem entries (also keeps them inside the user's locations).
  const problemPayments = await Payment.find({
    ...inScope,
    _id: { $in: problemLogs.map((l) => l.entityId).filter((id) => mongoose.isValidObjectId(id)) },
  }).lean();
  const problemById = new Map(problemPayments.map((p) => [String(p._id), p]));

  const wantedSessionIds = [
    ...failedOnline.map((p) => p.sessionId), ...problemPayments.map((p) => p.sessionId),
  ];
  const [sessionDocs, names] = await Promise.all([
    ParkingSession.find({ _id: { $in: wantedSessionIds } }).select("ticketNumber vehicleNumber").lean(),
    userNames([
      ...closedByAdmin.map((s) => s.closedBy), ...lost.map((s) => s.exitOperatorId),
    ]),
  ]);
  const sessionById = new Map(sessionDocs.map((s) => [String(s._id), s]));
  const ofSession = (id) => sessionById.get(String(id)) || {};

  for (const s of closedByAdmin) {
    const type = s.status === "CANCELLED" ? "CANCELLED" : "OVERRIDE";
    if (!wants(type)) continue;
    found.push({
      when: s.exitTime, type, locationId: s.locationId, vehicle: s.vehicleNumber, ticket: s.ticketNumber,
      amount: "", by: names.get(String(s.closedBy)) || "", detail: s.overrideReason || "",
    });
  }
  for (const s of lost) {
    found.push({
      when: s.exitTime, type: "LOST_TICKET", locationId: s.locationId, vehicle: s.vehicleNumber, ticket: s.ticketNumber,
      amount: s.fee && s.fee.total !== undefined ? s.fee.total : "", by: names.get(String(s.exitOperatorId)) || "", detail: "",
    });
  }
  for (const p of failedOnline) {
    found.push({
      when: p.createdAt, type: "PAYMENT_FAILED", locationId: p.locationId, vehicle: ofSession(p.sessionId).vehicleNumber || "",
      ticket: ofSession(p.sessionId).ticketNumber || "", amount: p.amount, by: "", detail: p.failureReason || "",
    });
  }
  for (const s of stuck) {
    found.push({
      when: s.entryTime, type: "STILL_INSIDE", locationId: s.locationId, vehicle: s.vehicleNumber, ticket: s.ticketNumber,
      amount: "", by: "", detail: `${Math.floor((now - s.entryTime.getTime()) / 3600000)} hours so far`,
    });
  }
  for (const log of problemLogs) {
    const p = problemById.get(String(log.entityId));
    if (!p) continue; // not at one of the user's locations
    found.push({
      when: log.createdAt, type: "PAYMENT_PROBLEM", locationId: p.locationId, vehicle: ofSession(p.sessionId).vehicleNumber || "",
      ticket: ofSession(p.sessionId).ticketNumber || "", amount: p.amount, by: "", detail: PAYMENT_PROBLEM_ACTIONS[log.action],
    });
  }

  found.sort((a, b) => new Date(b.when) - new Date(a.when));
  const csv = wantsExport(req);
  const page = pageFrom(req);
  const slice = csv ? found.slice(0, CSV_LIMIT) : found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rows = slice.map(({ locationId, type, ...rest }) => ({
    ...rest, type: EXCEPTION_TYPES[type], location: locationNames.get(String(locationId)) || "",
  }));

  const counts = {};
  for (const e of found) counts[e.type] = (counts[e.type] || 0) + 1;
  respond(req, res, `exceptions-${range.from}-to-${range.to}`, [
    { key: "when", label: "When" },
    { key: "type", label: "What" },
    { key: "location", label: "Location" },
    { key: "vehicle", label: "Vehicle" },
    { key: "ticket", label: "Ticket" },
    { key: "amount", label: "Amount" },
    { key: "by", label: "By" },
    { key: "detail", label: "Details" },
  ], rows, {
    total: found.length, page, pageSize: PAGE_SIZE, counts, types: EXCEPTION_TYPES,
    // Each source shows at most this many; narrow the dates to see older ones.
    perSourceLimit: PER_SOURCE, from: range.from, to: range.to,
  });
};

// ------------------------------------------------------------------ payments

// GET /api/reports/payments
// How people pay: share by method and how often online payments fail.
const paymentsReport = async (req, res) => {
  const { inScope, range } = await reportScope(req, { maxDays: 366 });
  const between = { $gte: range.start, $lt: range.end };
  const sum = { count: { $sum: 1 }, amount: { $sum: "$amount" } };

  const [paid, passPaid, failed, reasons] = await Promise.all([
    Payment.aggregate([{ $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: between } }, { $group: { _id: "$method", ...sum } }]),
    PassPayment.aggregate([{ $match: { ...inScope, amount: { $gt: 0 }, paidAt: between } }, { $group: { _id: "$method", ...sum } }]),
    Payment.aggregate([{ $match: { ...inScope, status: "FAILED", createdAt: between } }, { $group: { _id: "$method", count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { ...inScope, status: "FAILED", createdAt: between } },
      { $group: { _id: "$failureReason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const byMethod = new Map();
  const row = (method) => {
    if (!byMethod.has(method)) byMethod.set(method, { method, payments: 0, amount: 0, passAmount: 0, failed: 0 });
    return byMethod.get(method);
  };
  for (const r of paid) Object.assign(row(r._id), { payments: r.count, amount: r.amount });
  for (const r of passPaid) {
    const m = row(r._id);
    m.payments += r.count;
    m.amount += r.amount;
    m.passAmount = r.amount;
  }
  for (const r of failed) row(r._id).failed = r.count;

  const totalAmount = [...byMethod.values()].reduce((t, r) => t + r.amount, 0);
  const totalPayments = [...byMethod.values()].reduce((t, r) => t + r.payments, 0);
  const rows = [...byMethod.values()]
    .map((r) => ({
      method: r.method,
      payments: r.payments,
      amount: round2(r.amount),
      share: math.percent(r.amount, totalAmount),
      average: r.payments ? round2(r.amount / r.payments) : 0,
      failed: r.failed,
      // Only online payments can fail in a way worth measuring; at the counter the operator confirms the money.
      successRate: r.method === "GATEWAY" ? math.percent(r.payments, r.payments + r.failed) : "",
    }))
    .sort((a, b) => b.amount - a.amount);

  respond(req, res, `payments-${range.from}-to-${range.to}`, [
    { key: "method", label: "Method" },
    { key: "payments", label: "Payments" },
    { key: "amount", label: "Amount" },
    { key: "share", label: "Share of money %" },
    { key: "average", label: "Average payment" },
    { key: "failed", label: "Failed" },
    { key: "successRate", label: "Success rate %" },
  ], rows, {
    total: { payments: totalPayments, amount: round2(totalAmount) },
    failureReasons: reasons.filter((r) => r._id).map((r) => ({ reason: r._id, count: r.count })),
    from: range.from, to: range.to,
  });
};

// ----------------------------------------------------------------- durations

// GET /api/reports/durations
// How long vehicles stay, in bands, with the fees they were charged.
const durationsReport = async (req, res) => {
  const { inScope, range } = await reportScope(req, { maxDays: 366 });
  const buckets = await ParkingSession.aggregate([
    {
      $match: {
        ...inScope, isOpen: false, status: { $in: ["COMPLETED", "LOST_TICKET", "PASS_EXIT"] },
        exitTime: { $gte: range.start, $lt: range.end }, durationMinutes: { $type: "number" },
      },
    },
    {
      $bucket: {
        groupBy: "$durationMinutes",
        boundaries: math.DURATION_BOUNDARIES,
        default: "other",
        output: {
          vehicles: { $sum: 1 },
          averageMinutes: { $avg: "$durationMinutes" },
          fees: { $sum: { $ifNull: ["$fee.total", 0] } },
          passVisits: { $sum: { $cond: [{ $eq: ["$status", "PASS_EXIT"] }, 1, 0] } },
        },
      },
    },
  ]);
  const byFrom = new Map(buckets.map((b) => [b._id, b]));
  const totalVehicles = buckets.reduce((t, b) => t + b.vehicles, 0);
  const rows = math.DURATION_BUCKETS.map(({ from, label }) => {
    const b = byFrom.get(from);
    return {
      band: label,
      vehicles: b ? b.vehicles : 0,
      share: math.percent(b ? b.vehicles : 0, totalVehicles),
      averageMinutes: b ? Math.round(b.averageMinutes) : 0,
      passVisits: b ? b.passVisits : 0,
      fees: b ? round2(b.fees) : 0,
    };
  });
  const weighted = buckets.reduce((t, b) => t + b.averageMinutes * b.vehicles, 0);

  respond(req, res, `durations-${range.from}-to-${range.to}`, [
    { key: "band", label: "Stay" },
    { key: "vehicles", label: "Vehicles" },
    { key: "share", label: "Share %" },
    { key: "averageMinutes", label: "Average stay (min)" },
    { key: "passVisits", label: "Of which pass holders" },
    { key: "fees", label: "Fees charged" },
  ], rows, {
    totalVehicles, averageMinutes: totalVehicles ? Math.round(weighted / totalVehicles) : 0, from: range.from, to: range.to,
  });
};

// -------------------------------------------------------------------- passes

const DUE_CHOICES = [7, 14, 30, 60, 90];

// GET /api/reports/passes?due=30
// Pass holders to follow up (ending soon, or ended in the last 30 days), plus
// pass numbers: how many are active, and what was sold in the period.
const passesReport = async (req, res) => {
  const { locations, inScope, range } = await reportScope(req, { maxDays: 366 });
  const due = DUE_CHOICES.includes(Number(req.query.due)) ? Number(req.query.due) : 30;
  const now = new Date();

  // The same passes the user may manage; with a location chosen, only passes that work there.
  const scope = [passService.scopeFilter(req)];
  if (req.query.locationId) {
    scope.push({ $or: [{ locationIds: { $size: 0 } }, { locationIds: locations[0]._id }] });
  }
  const mine = { $and: [...scope, { isCurrent: true }] };
  const soon = new Date(now.getTime() + 7 * DAY);

  const followUp = {
    $and: [...scope, { isCurrent: true, status: "ACTIVE", endDate: { $gt: new Date(now.getTime() - 30 * DAY), $lte: new Date(now.getTime() + due * DAY) } }],
  };
  const csv = wantsExport(req);
  const page = pageFrom(req);

  const [list, listTotal, active, expiring, upcoming, expired, suspended, sales, visits] = await Promise.all([
    Pass.find(followUp).sort({ endDate: 1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE).lean(),
    Pass.countDocuments(followUp),
    Pass.countDocuments({ $and: [mine, { status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now } }] }),
    Pass.countDocuments({ $and: [mine, { status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now, $lte: soon } }] }),
    Pass.countDocuments({ $and: [mine, { status: "ACTIVE", startDate: { $gt: now } }] }),
    Pass.countDocuments({ $and: [mine, { status: "ACTIVE", endDate: { $lte: now } }] }),
    Pass.countDocuments({ $and: [mine, { status: "SUSPENDED" }] }),
    PassPayment.aggregate([
      // A location admin only sees sales at their own locations (inScope), whatever pass they were for.
      { $match: { ...inScope, paidAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: { kind: "$kind", free: { $eq: ["$amount", 0] } }, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    ParkingSession.countDocuments({ ...inScope, status: "PASS_EXIT", exitTime: { $gte: range.start, $lt: range.end } }),
  ]);

  const rows = list.map((p) => {
    const daysLeft = Math.ceil((p.endDate.getTime() - now.getTime()) / DAY);
    return {
      passNumber: p.passNumber,
      vehicle: p.vehicleNumber,
      holder: p.holderName,
      phone: p.phone || "",
      lastDay: localDateText(new Date(p.endDate.getTime() - 1)),
      daysLeft,
      state: daysLeft > 0 ? "Ending soon" : "Ended",
    };
  });
  const soldOf = (kind, free) => sales.filter((s) => s._id.kind === kind && s._id.free === free).reduce((t, s) => ({ count: t.count + s.count, amount: t.amount + s.amount }), { count: 0, amount: 0 });
  const paidNew = soldOf("NEW", false);
  const paidRenewals = soldOf("RENEWAL", false);

  respond(req, res, `passes-${range.from}-to-${range.to}`, [
    { key: "passNumber", label: "Pass" },
    { key: "vehicle", label: "Vehicle" },
    { key: "holder", label: "Holder" },
    { key: "phone", label: "Phone" },
    { key: "lastDay", label: "Last day" },
    { key: "daysLeft", label: "Days left" },
    { key: "state", label: "Status" },
  ], rows, {
    total: listTotal, page, pageSize: PAGE_SIZE, due,
    summary: { active, endingWithin7Days: expiring, startsLater: upcoming, expired, suspended },
    sales: {
      newPasses: paidNew.count, renewals: paidRenewals.count, amount: round2(paidNew.amount + paidRenewals.amount),
      freePasses: soldOf("NEW", true).count + soldOf("RENEWAL", true).count,
    },
    passVisits: visits,
    from: range.from, to: range.to,
  });
};

// ------------------------------------------------------------ repeat vehicles

const MIN_VISIT_CHOICES = [2, 3, 5, 10, 20];

// GET /api/reports/frequent-vehicles?min=2&q=
// Vehicles that came back: how often, how long they stay, what they paid,
// and whether they hold a pass (a regular without a pass is a pass to sell).
const frequentVehiclesReport = async (req, res) => {
  const { locationNames, inScope, range } = await reportScope(req, { maxDays: 366 });
  const min = MIN_VISIT_CHOICES.includes(Number(req.query.min)) ? Number(req.query.min) : 2;
  const csv = wantsExport(req);
  const page = pageFrom(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";

  const match = { ...inScope, status: { $ne: "CANCELLED" }, entryTime: { $gte: range.start, $lt: range.end } };
  if (q) match.vehicleNumber = { $regex: `^${escapeRegex(normalizePlate(q))}` };

  const [result] = await ParkingSession.aggregate(
    [
      { $match: match },
      { $sort: { entryTime: -1 } },
      {
        $group: {
          _id: "$vehicleNumber",
          type: { $first: "$vehicleType" },
          visits: { $sum: 1 },
          lastVisit: { $first: "$entryTime" },
          firstVisit: { $last: "$entryTime" },
          locations: { $addToSet: "$locationId" },
          averageMinutes: { $avg: "$durationMinutes" },
          fees: { $sum: { $ifNull: ["$fee.total", 0] } },
          passVisits: { $sum: { $cond: [{ $eq: ["$status", "PASS_EXIT"] }, 1, 0] } },
          lostTickets: { $sum: { $cond: [{ $eq: ["$status", "LOST_TICKET"] }, 1, 0] } },
        },
      },
      {
        $facet: {
          rows: [
            { $match: { visits: { $gte: min } } },
            { $sort: { visits: -1, fees: -1, _id: 1 } },
            { $skip: csv ? 0 : (page - 1) * PAGE_SIZE },
            { $limit: csv ? CSV_LIMIT : PAGE_SIZE },
          ],
          summary: [
            {
              $group: {
                _id: null,
                vehicles: { $sum: 1 },
                visits: { $sum: "$visits" },
                repeatVehicles: { $sum: { $cond: [{ $gte: ["$visits", min] }, 1, 0] } },
                repeatVisits: { $sum: { $cond: [{ $gte: ["$visits", min] }, "$visits", 0] } },
                repeatFees: { $sum: { $cond: [{ $gte: ["$visits", min] }, "$fees", 0] } },
              },
            },
          ],
        },
      },
    ],
    { allowDiskUse: true }
  );
  const found = result.rows;
  const totals = result.summary[0] || { vehicles: 0, visits: 0, repeatVehicles: 0, repeatVisits: 0, repeatFees: 0 };

  // Which of these vehicles hold a current pass (as the main or an extra vehicle).
  const plates = found.map((r) => r._id);
  const passes = plates.length
    ? await Pass.find({
        $and: [passService.scopeFilter(req), { isCurrent: true, $or: [{ "vehicles.number": { $in: plates } }, { vehicleNumber: { $in: plates } }] }],
      })
        .select("passNumber vehicleNumber vehicles status endDate")
        .lean()
    : [];
  const passOf = new Map();
  for (const pass of passes) for (const v of passService.passVehicles(pass)) passOf.set(v.number, pass);

  const rows = found.map((r) => ({
    vehicle: r._id,
    type: r.type,
    visits: r.visits,
    locationCount: r.locations.length,
    lastVisit: r.lastVisit,
    averageStayMinutes: r.averageMinutes != null ? Math.round(r.averageMinutes) : "",
    fees: round2(r.fees),
    passVisits: r.passVisits,
    lostTickets: r.lostTickets,
    pass: passOf.has(r._id) ? passOf.get(r._id).passNumber : "",
  }));

  respond(req, res, `repeat-vehicles-${range.from}-to-${range.to}`, [
    { key: "vehicle", label: "Vehicle" },
    { key: "type", label: "Type" },
    { key: "visits", label: "Visits" },
    { key: "locationCount", label: "Locations used" },
    { key: "lastVisit", label: "Last visit" },
    { key: "averageStayMinutes", label: "Average stay (min)" },
    { key: "fees", label: "Fees paid" },
    { key: "passVisits", label: "Free pass visits" },
    { key: "lostTickets", label: "Lost tickets" },
    { key: "pass", label: "Pass" },
  ], rows, {
    min,
    // Without a page of rows the full count is the number of vehicles that met the limit.
    total: totals.repeatVehicles, page, pageSize: PAGE_SIZE,
    summary: {
      vehicles: totals.vehicles,
      visits: totals.visits,
      repeatVehicles: totals.repeatVehicles,
      repeatVisits: totals.repeatVisits,
      repeatShare: math.percent(totals.repeatVisits, totals.visits),
      repeatFees: round2(totals.repeatFees),
    },
    from: range.from, to: range.to,
  });
};

// ------------------------------------------------------------------ locations

// GET /api/reports/locations
// Every location side by side for the period: traffic, stay, money, how full it is now.
const locationsReport = async (req, res) => {
  const { locations, inScope, range } = await reportScope(req, { maxDays: 366 });
  const between = { $gte: range.start, $lt: range.end };
  const cancelled = { status: { $ne: "CANCELLED" } };

  const [entries, exits, inside, paid, passPaid, refunded] = await Promise.all([
    ParkingSession.aggregate([
      { $match: { ...inScope, ...cancelled, entryTime: between } },
      { $group: { _id: "$locationId", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, ...cancelled, isOpen: false, exitTime: between } },
      {
        $group: {
          _id: "$locationId",
          count: { $sum: 1 },
          averageMinutes: { $avg: "$durationMinutes" },
          passVisits: { $sum: { $cond: [{ $eq: ["$status", "PASS_EXIT"] }, 1, 0] } },
          lostTickets: { $sum: { $cond: [{ $eq: ["$status", "LOST_TICKET"] }, 1, 0] } },
        },
      },
    ]),
    ParkingSession.aggregate([{ $match: { ...inScope, isOpen: true } }, { $group: { _id: "$locationId", count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: between } },
      { $group: { _id: "$locationId", amount: { $sum: "$amount" } } },
    ]),
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: between } },
      { $group: { _id: "$locationId", amount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": between } },
      { $group: { _id: "$locationId", amount: { $sum: "$refund.amount" } } },
    ]),
  ]);
  const by = (list) => new Map(list.map((r) => [String(r._id), r]));
  const entered = by(entries);
  const left = by(exits);
  const here = by(inside);
  const parking = by(paid);
  const passMoney = by(passPaid);
  const back = by(refunded);

  const rows = locations
    .map((l) => {
      const id = String(l._id);
      const capacity = sumCounts(l.capacity);
      const insideNow = here.get(id) ? here.get(id).count : 0;
      const gone = left.get(id);
      const collected = (parking.get(id) ? parking.get(id).amount : 0) + (passMoney.get(id) ? passMoney.get(id).amount : 0);
      const net = collected - (back.get(id) ? back.get(id).amount : 0);
      const entryCount = entered.get(id) ? entered.get(id).count : 0;
      return {
        location: l.isActive ? l.name : `${l.name} (closed)`,
        capacity,
        insideNow,
        utilization: capacity > 0 ? Math.round((insideNow / capacity) * 100) : 0,
        entries: entryCount,
        exits: gone ? gone.count : 0,
        averageStayMinutes: gone && gone.averageMinutes != null ? Math.round(gone.averageMinutes) : "",
        passVisits: gone ? gone.passVisits : 0,
        lostTickets: gone ? gone.lostTickets : 0,
        collected: round2(collected),
        passSales: round2(passMoney.get(id) ? passMoney.get(id).amount : 0),
        net: round2(net),
        perEntry: entryCount ? round2(net / entryCount) : "",
      };
    })
    .sort((a, b) => b.net - a.net || a.location.localeCompare(b.location));

  const sum = (key) => round2(rows.reduce((t, r) => t + (Number(r[key]) || 0), 0));
  respond(req, res, `locations-${range.from}-to-${range.to}`, [
    { key: "location", label: "Location" },
    { key: "capacity", label: "Capacity" },
    { key: "insideNow", label: "Inside now" },
    { key: "utilization", label: "Full now %" },
    { key: "entries", label: "Entries" },
    { key: "exits", label: "Exits" },
    { key: "averageStayMinutes", label: "Average stay (min)" },
    { key: "passVisits", label: "Free pass visits" },
    { key: "lostTickets", label: "Lost tickets" },
    { key: "collected", label: "Collected" },
    { key: "passSales", label: "Of which passes" },
    { key: "net", label: "Net" },
    { key: "perEntry", label: "Net per entry" },
  ], rows, {
    total: { entries: sum("entries"), exits: sum("exits"), collected: sum("collected"), net: sum("net") },
    best: rows.length > 1 && rows[0].net > 0 ? rows[0].location : null,
    from: range.from, to: range.to,
  });
};

// ------------------------------------------------------------------ hardware

// GET /api/reports/hardware
// For each device: how many commands worked, how fast, outages, and for
// cameras how often the plate was read and whether operators had to correct it.
const hardwareReport = async (req, res) => {
  const { locationNames, inScope, range } = await reportScope(req);
  const between = { $gte: range.start, $lt: range.end };
  const devices = await Hardware.find(inScope).sort({ locationId: 1, name: 1 }).limit(500).lean();
  const ids = devices.map((d) => d._id);

  const [commands, outages, detections] = await Promise.all([
    HardwareCommand.aggregate([
      { $match: { hardwareId: { $in: ids }, createdAt: between, type: { $ne: "PRINT_TEST" } } },
      {
        $group: {
          _id: "$hardwareId",
          total: { $sum: 1 },
          acked: { $sum: { $cond: [{ $eq: ["$status", "ACKED"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ["$status", ["FAILED", "EXPIRED"]] }, 1, 0] } },
          avgMs: { $avg: { $cond: [{ $eq: ["$status", "ACKED"] }, { $subtract: ["$completedAt", "$createdAt"] }, null] } },
        },
      },
    ]),
    HardwareEvent.aggregate([
      { $match: { hardwareId: { $in: ids }, type: "OFFLINE", createdAt: between } },
      { $group: { _id: "$hardwareId", count: { $sum: 1 } } },
    ]),
    AnprDetection.aggregate([
      { $match: { hardwareId: { $in: ids }, createdAt: between } },
      {
        $group: {
          _id: "$hardwareId",
          total: { $sum: 1 },
          confirmed: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, 1, 0] } },
          corrected: { $sum: { $cond: ["$corrected", 1, 0] } },
          read: { $sum: { $cond: [{ $ne: ["$plate", ""] }, 1, 0] } },
          avgConfidence: { $avg: "$confidence" },
        },
      },
    ]),
  ]);
  const byId = (list) => new Map(list.map((r) => [String(r._id), r]));
  const cmd = byId(commands);
  const out = byId(outages);
  const cam = byId(detections);

  const rows = devices.map((d) => {
    const c = cmd.get(String(d._id));
    const a = cam.get(String(d._id));
    return {
      device: d.name,
      type: d.type,
      location: locationNames.get(String(d.locationId)) || "",
      commands: c ? c.total : 0,
      acked: c ? c.acked : 0,
      failed: c ? c.failed : 0,
      successRate: c ? math.percent(c.acked, c.acked + c.failed) : "",
      averageSeconds: c && c.avgMs != null ? Math.round(c.avgMs / 100) / 10 : "",
      outages: out.get(String(d._id))?.count || 0,
      detections: a ? a.total : "",
      readRate: a ? math.percent(a.read, a.total) : "",
      corrected: a ? a.corrected : "",
      averageConfidence: a && a.avgConfidence != null ? Math.round(a.avgConfidence * 100) : "",
    };
  });

  respond(req, res, `hardware-${range.from}-to-${range.to}`, [
    { key: "device", label: "Device" },
    { key: "type", label: "Type" },
    { key: "location", label: "Location" },
    { key: "commands", label: "Commands" },
    { key: "acked", label: "Worked" },
    { key: "failed", label: "Failed or timed out" },
    { key: "successRate", label: "Success rate %" },
    { key: "averageSeconds", label: "Average time (s)" },
    { key: "outages", label: "Times offline" },
    { key: "detections", label: "Plates seen" },
    { key: "readRate", label: "Plate read %" },
    { key: "corrected", label: "Corrected by operator" },
    { key: "averageConfidence", label: "Average confidence %" },
  ], rows, { from: range.from, to: range.to });
};

module.exports = {
  peakHoursReport, occupancyTrendReport, exceptionsReport, paymentsReport, durationsReport, passesReport, hardwareReport,
  frequentVehiclesReport, locationsReport, reEntriesReport, reprintsReport,
};
