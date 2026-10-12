// Reprints: every time a ticket or receipt is printed again, an audit entry "PARKING_REPRINT" records who did it,
// for which ticket and at which location. This adds them up per operator for the admin's dashboard and report.
// There is no limit on reprinting; this only counts.

const AuditLog = require("../models/AuditLog");

// The audit entries of reprints in these locations during a period (optionally one operator's).
const matchFor = ({ tenantFilter, locationIds, start, end, operatorId }) => ({
  ...(tenantFilter && tenantFilter.companyId ? { companyId: tenantFilter.companyId } : {}),
  action: "PARKING_REPRINT",
  "meta.locationId": { $in: locationIds },
  createdAt: { $gte: start, $lt: end },
  ...(operatorId ? { actorId: operatorId } : {}),
});

// [{ _id: actorId, count, last }] biggest first.
const byOperator = (match) =>
  AuditLog.aggregate([
    { $match: match },
    { $group: { _id: "$actorId", count: { $sum: 1 }, last: { $max: "$createdAt" } } },
    { $sort: { count: -1 } },
  ]);

module.exports = { matchFor, byOperator };
