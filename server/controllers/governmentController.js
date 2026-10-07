// The government officer's reports: how many vehicles entered and left, and the list of them with vehicle
// numbers and times. No money anywhere. An officer sees only the locations an admin gave them
// (see utils/scope.js), and the request guard in middleware/auth.js keeps them out of everything else.

const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { locationsInScope } = require("../utils/scope");
const { rangeFromQuery, timezoneString } = require("../utils/time");
const { normalizePlate, escapeRegex } = require("../utils/plate");
const { formatOf, buildReportFile } = require("../services/reportExport");
const sessionService = require("../services/sessionService");
const { VEHICLE_TYPES } = require("../models/constants");
const ParkingSession = require("../models/ParkingSession");

// Statuses of a vehicle that left. A cancelled ticket never parked, so it counts as neither an entry nor an exit.
const EXITED = ["COMPLETED", "LOST_TICKET", "PASS_EXIT", "MANUAL_OVERRIDE"];
const PAGE_SIZES = [10, 25, 50, 100, 200];
const EXPORT_LIMIT = 10000;
// A page deep into a long list needs this many rows from each side before they are merged.
const MERGE_LIMIT = 20000;

// What each side of the report is: the time that counts and the extra conditions.
const SIDES = {
  ENTRY: { time: "entryTime", where: { status: { $ne: "CANCELLED" } } },
  EXIT: { time: "exitTime", where: { status: { $in: EXITED }, autoClosed: { $ne: true } } },
};

const scopeOf = async (req) => {
  const locations = await locationsInScope(req);
  const range = rangeFromQuery(req.query, { maxDays: 366 });
  req.reportScopeName = req.query.locationId && locations.length === 1 ? locations[0].name : "All my locations";
  const base = { ...req.tenantFilter, locationId: { $in: locations.map((l) => l._id) } };
  return { locations, range, base };
};

const sideFilter = (side, { base, range }) => ({
  ...base,
  ...SIDES[side].where,
  [SIDES[side].time]: { $gte: range.start, $lt: range.end },
});

// Counts for one side, grouped by local day, vehicle type and location.
const countSide = (side, scope) =>
  ParkingSession.aggregate([
    { $match: sideFilter(side, scope) },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: "%Y-%m-%d", date: `$${SIDES[side].time}`, timezone: timezoneString() } },
          type: "$vehicleType",
          locationId: "$locationId",
        },
        count: { $sum: 1 },
      },
    },
  ]);

// GET /api/government/summary?from=&to=&locationId=
const summary = async (req, res) => {
  const scope = await scopeOf(req);
  const [entries, exits, inside] = await Promise.all([
    countSide("ENTRY", scope),
    countSide("EXIT", scope),
    ParkingSession.aggregate([
      { $match: { ...scope.base, isOpen: true } },
      { $group: { _id: { type: "$vehicleType", locationId: "$locationId" }, count: { $sum: 1 } } },
    ]),
  ]);

  const names = new Map(scope.locations.map((l) => [String(l._id), l.name]));
  const byDay = new Map();
  const byType = new Map(VEHICLE_TYPES.map((type) => [type, { type, entries: 0, exits: 0, inside: 0 }]));
  const byLocation = new Map(scope.locations.map((l) => [String(l._id), { locationId: l._id, name: l.name, entries: 0, exits: 0, inside: 0 }]));
  const totals = { entries: 0, exits: 0, inside: 0 };

  const add = (rows, key) => {
    for (const row of rows) {
      const { day, type, locationId } = row._id;
      if (day) {
        const d = byDay.get(day) || { date: day, entries: 0, exits: 0 };
        d[key] += row.count;
        byDay.set(day, d);
      }
      if (byType.has(type)) byType.get(type)[key] += row.count;
      const place = byLocation.get(String(locationId));
      if (place) place[key] += row.count;
      totals[key] += row.count;
    }
  };
  add(entries, "entries");
  add(exits, "exits");
  add(inside, "inside");

  res.json({
    success: true,
    data: {
      from: scope.range.from, to: scope.range.to, days: scope.range.days,
      locations: scope.locations.map((l) => ({ _id: l._id, name: names.get(String(l._id)) })),
      totals,
      byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      byType: [...byType.values()].filter((t) => t.entries || t.exits || t.inside),
      byLocation: [...byLocation.values()],
    },
  });
};

// A plate prefix/part or a ticket number.
const searchCondition = (q) => {
  const ticket = sessionService.normalizeTicket(q);
  return ticket ? { ticketNumber: ticket } : { vehicleNumber: { $regex: escapeRegex(normalizePlate(q)) } };
};

const directionOf = (req) => {
  const direction = req.query.direction === undefined || req.query.direction === "" ? "ALL" : req.query.direction;
  if (!["ALL", "ENTRY", "EXIT"].includes(direction)) throw new AppError("direction must be ALL, ENTRY or EXIT", 400);
  return direction;
};

const typeFilter = (req) => {
  const { vehicleType } = req.query;
  if (vehicleType === undefined || vehicleType === "") return {};
  if (!VEHICLE_TYPES.includes(vehicleType)) throw new AppError("Unknown vehicle type", 400);
  return { vehicleType };
};

const rowOf = (side, session, names) => ({
  id: `${side}-${session._id}`,
  direction: side,
  time: session[SIDES[side].time],
  vehicleNumber: session.vehicleNumber,
  vehicleType: session.vehicleType,
  ticketNumber: session.ticketNumber,
  locationName: names.get(String(session.locationId)) || "",
  gate: (side === "ENTRY" ? session.entryGate : session.exitGate) || "",
});

const FIELDS = "vehicleNumber vehicleType ticketNumber locationId entryTime exitTime entryGate exitGate";

// The newest `limit` movements of the chosen direction(s), and how many there are in all.
const movements = async (req, scope, { skip, limit }) => {
  const direction = directionOf(req);
  const extra = { ...typeFilter(req), ...(req.query.q ? searchCondition(String(req.query.q)) : {}) };
  const names = new Map(scope.locations.map((l) => [String(l._id), l.name]));
  const sides = direction === "ALL" ? ["ENTRY", "EXIT"] : [direction];

  const parts = await Promise.all(
    sides.map(async (side) => {
      const filter = { ...sideFilter(side, scope), ...extra };
      const [total, docs] = await Promise.all([
        ParkingSession.countDocuments(filter),
        ParkingSession.find(filter).select(FIELDS).sort({ [SIDES[side].time]: -1, _id: -1 }).limit(skip + limit).lean(),
      ]);
      return { total, rows: docs.map((d) => rowOf(side, d, names)) };
    })
  );
  const merged = parts.flatMap((p) => p.rows).sort((a, b) => new Date(b.time) - new Date(a.time));
  return { total: parts.reduce((sum, p) => sum + p.total, 0), rows: merged.slice(skip, skip + limit) };
};

// GET /api/government/movements?from=&to=&locationId=&direction=ALL|ENTRY|EXIT&vehicleType=&q=&page=&pageSize=[&format=]
const list = async (req, res) => {
  const scope = await scopeOf(req);
  const format = formatOf(req);
  const pageSize = PAGE_SIZES.includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

  if (!format && (page - 1) * pageSize + pageSize > MERGE_LIMIT) {
    throw new AppError("That page is too far down. Narrow the dates or search for a vehicle.", 400);
  }
  const { total, rows } = format
    ? await movements(req, scope, { skip: 0, limit: EXPORT_LIMIT })
    : await movements(req, scope, { skip: (page - 1) * pageSize, limit: pageSize });

  if (!format) {
    const first = (page - 1) * pageSize;
    return res.json({
      success: true,
      data: {
        movements: rows.map((row, index) => ({ ...row, sno: first + index + 1 })),
        total, page, pageSize, pageSizes: PAGE_SIZES, from: scope.range.from, to: scope.range.to,
      },
    });
  }

  const columns = [
    { key: "sno", label: "SNo" }, { key: "direction", label: "Entry / Exit" }, { key: "time", label: "Time" },
    { key: "vehicleNumber", label: "Vehicle no" }, { key: "type", label: "Vehicle type" }, { key: "ticketNumber", label: "Ticket" },
    { key: "locationName", label: "Location" }, { key: "gate", label: "Gate" },
  ];
  const fileRows = rows.map((row, index) => ({
    sno: index + 1, direction: row.direction === "ENTRY" ? "Entry" : "Exit", time: new Date(row.time), vehicleNumber: row.vehicleNumber,
    type: row.vehicleType, ticketNumber: row.ticketNumber, locationName: row.locationName, gate: row.gate,
  }));
  const file = buildReportFile({
    format, name: `vehicle-movements-${scope.range.from}-to-${scope.range.to}`, report: "government-movements", columns, rows: fileRows,
    extra: { from: scope.range.from, to: scope.range.to }, company: req.company ? req.company.name : "", scope: req.reportScopeName || "",
  });
  await audit.record(req, "REPORT_EXPORT", {
    entity: "Report", meta: { report: "government-movements", format, rows: fileRows.length, from: scope.range.from, to: scope.range.to },
  });
  res.set({ "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" });
  return res.send(file.buffer);
};

// GET /api/government/locations: the places this officer may see, for the location filter.
const places = async (req, res) => {
  // The list ignores any location filter in the address (req.query is read-only in Express 5).
  const locations = await locationsInScope(Object.create(req, { query: { value: {} } }));
  res.json({ success: true, data: locations.map((l) => ({ _id: l._id, name: l.name })) });
};

module.exports = { summary, list, places, EXITED };
