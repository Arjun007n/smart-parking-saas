// "FASTag & Online transactions": every attempt to take money by FASTag or by the online gateway,
// including the ones that did not succeed, so an admin can follow a payment that is stuck or declined.
// This is what our own system recorded. It is not a bank settlement statement.

const { reportScope, respond, wantsExport, pageFrom, PAGE_SIZE, CSV_LIMIT } = require("./reportController");
const { round2 } = require("../services/collectionService");
const { timezoneString } = require("../utils/time");
const { normalizePlate, escapeRegex } = require("../utils/plate");
const AppError = require("../utils/AppError");
const Payment = require("../models/Payment");
const FastagCharge = require("../models/FastagCharge");
const ParkingSession = require("../models/ParkingSession");

const KINDS = ["fastag", "online"];

// What the screen calls each state, and which group it counts in on the tiles.
const GROUPS = {
  ACCEPTED: ["SUCCESS", "REFUNDED"],
  IN_PROGRESS: ["PENDING", "UNKNOWN"],
  DECLINED: ["FAILED"],
};
const groupOf = (status) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(status)) || "IN_PROGRESS";

// GET /api/reports/transactions?kind=fastag|online&from=&to=&locationId=&status=&q=&view=list|daily&page=&period=
const transactionsReport = async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : "fastag";
  const view = req.query.view === "daily" ? "daily" : "list";
  const { locationNames, inScope, range } = await reportScope(req, { maxDays: 366 });

  const isFastag = kind === "fastag";
  const Model = isFastag ? FastagCharge : Payment;
  const dateField = "createdAt";
  const base = { ...inScope, [dateField]: { $gte: range.start, $lt: range.end } };
  if (!isFastag) base.method = "GATEWAY";

  const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
  const known = isFastag ? ["PENDING", "UNKNOWN", "SUCCESS", "FAILED"] : ["PENDING", "SUCCESS", "FAILED"];
  if (status && status !== "ALL" && !known.includes(status)) throw new AppError("Unknown status", 400);
  const filter = { ...base };
  if (status && status !== "ALL") filter.status = status;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";
  if (q && isFastag) filter.vehicleNumber = { $regex: `^${escapeRegex(normalizePlate(q))}` };

  // The three tiles always cover the whole period and location, whatever status is picked.
  const tileRows = await Model.aggregate([
    { $match: base },
    { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const tiles = { accepted: 0, inProgress: 0, declined: 0, count: 0 };
  for (const r of tileRows) {
    const group = groupOf(r._id);
    const key = { ACCEPTED: "accepted", IN_PROGRESS: "inProgress", DECLINED: "declined" }[group];
    tiles[key] = round2(tiles[key] + r.amount);
    tiles.count += r.count;
  }

  if (view === "daily") {
    // Money that went through, day by day: what to expect in the bank. Only successful attempts count.
    const days = await Model.aggregate([
      { $match: { ...base, status: "SUCCESS" } },
      { $group: { _id: { $dateToString: { date: `$${dateField}`, format: "%Y-%m-%d", timezone: timezoneString() } }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const rows = days.map((d) => ({ day: d._id, transactions: d.count, amount: round2(d.amount) }));
    return respond(req, res, `${kind}-daily-${range.from}-to-${range.to}`, [
      { key: "day", label: "Date" }, { key: "transactions", label: "Successful transactions" }, { key: "amount", label: "Amount" },
    ], rows, { tiles, kind, view, from: range.from, to: range.to });
  }

  const exporting = wantsExport(req);
  const page = pageFrom(req);
  const [docs, total] = await Promise.all([
    Model.find(filter).sort({ [dateField]: -1 }).skip(exporting ? 0 : (page - 1) * PAGE_SIZE).limit(exporting ? CSV_LIMIT : PAGE_SIZE),
    Model.countDocuments(filter),
  ]);
  const sessions = isFastag
    ? new Map()
    : new Map((await ParkingSession.find({ _id: { $in: docs.map((d) => d.sessionId) } }).select("ticketNumber vehicleNumber")).map((s) => [String(s._id), s]));

  const rows = docs.map((d) => {
    const session = sessions.get(String(d.sessionId));
    return {
      date: d.createdAt,
      location: locationNames.get(String(d.locationId)) || "",
      vehicle: isFastag ? d.vehicleNumber || "" : session ? session.vehicleNumber : "",
      ticket: session ? session.ticketNumber : "",
      reference: (isFastag ? d.providerReference : d.transactionId) || "",
      tag: isFastag ? d.tagId || "" : "",
      provider: d.provider || "",
      status: d.status,
      amount: d.amount,
      reason: d.failureReason || "",
    };
  });
  const columns = [
    { key: "date", label: "Date" },
    { key: "location", label: "Location" },
    { key: "vehicle", label: "Vehicle" },
    ...(isFastag ? [{ key: "tag", label: "FASTag" }] : [{ key: "ticket", label: "Ticket" }]),
    { key: "reference", label: "Transaction no." },
    { key: "provider", label: "Provider" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount" },
    { key: "reason", label: "Reason (if not accepted)" },
  ];
  return respond(req, res, `${kind}-transactions-${range.from}-to-${range.to}`, columns, rows,
    { tiles, kind, view, total, page, pageSize: PAGE_SIZE, from: range.from, to: range.to });
};

module.exports = { transactionsReport, groupOf };
