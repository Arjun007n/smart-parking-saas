const { rangeFromQuery } = require("../utils/time");
const { sendCsv } = require("../utils/csv");
const AuditLog = require("../models/AuditLog");

const PAGE_SIZE = 100;
const CSV_LIMIT = 10000;

// GET /api/audit-logs?from=&to=&action=&actor=&page=&format=csv
// Read-only. There is no API to change or delete audit entries.
const listAuditLogs = async (req, res) => {
  const range = rangeFromQuery(req.query);
  const filter = { ...req.tenantFilter, createdAt: { $gte: range.start, $lt: range.end } };

  if (typeof req.query.action === "string" && /^[A-Z_]{2,50}$/.test(req.query.action)) {
    filter.action = req.query.action;
  }
  if (typeof req.query.actor === "string" && req.query.actor.trim()) {
    filter.actorEmail = req.query.actor.trim().toLowerCase().slice(0, 254);
  }

  const csv = req.query.format === "csv";
  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const [logs, total, actions] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(csv ? 0 : (page - 1) * PAGE_SIZE).limit(csv ? CSV_LIMIT : PAGE_SIZE).lean(),
    AuditLog.countDocuments(filter),
    AuditLog.distinct("action", req.tenantFilter),
  ]);

  if (csv) {
    return sendCsv(res, `audit-${range.from}-to-${range.to}.csv`, [
      { key: "createdAt", label: "When" },
      { key: "actorEmail", label: "Who" },
      { key: "action", label: "Action" },
      { key: "entity", label: "Record type" },
      { key: "entityId", label: "Record id" },
      { key: "details", label: "Details" },
      { key: "ip", label: "IP address" },
    ], logs.map((log) => ({ ...log, details: log.meta ? JSON.stringify(log.meta) : "" })));
  }

  res.json({ success: true, data: { logs, total, page, pageSize: PAGE_SIZE, actions: actions.sort(), from: range.from, to: range.to } });
};

module.exports = { listAuditLogs };
