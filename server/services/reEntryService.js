// The re-entry counter: how many tickets each gate operator replaced today at a location.
// An admin sets the daily limit (Gate rules) and can see and reset the count. Operators never see it.

const ParkingSession = require("../models/ParkingSession");
const User = require("../models/User");
const { dayRange } = require("../utils/time");
const { resolveOperations } = require("../utils/operations");

// Where counting starts: the start of today, or the admin's last reset if that is later.
const countingFrom = (location, now = new Date()) => {
  const { start } = dayRange(undefined, now);
  const reset = location.operations && location.operations.reEntryCountFrom;
  return reset && new Date(reset).getTime() > start.getTime() ? new Date(reset) : start;
};

// Re-entries one operator made today at this location.
const countFor = (location, userId, now = new Date()) =>
  ParkingSession.countDocuments({
    companyId: location.companyId, locationId: location._id, entryOperatorId: userId,
    reEntry: true, entryTime: { $gte: countingFrom(location, now) },
  });

// True when this operator has used up the day's re-entries. A limit of 0 means there is none.
const limitReached = async (location, userId, now = new Date()) => {
  const limit = resolveOperations(location.operations).reEntryLimit;
  return limit > 0 && (await countFor(location, userId, now)) >= limit;
};

// What the admin sees: the limit, since when it is counted, and each operator's count.
const overview = async (location, now = new Date()) => {
  const since = countingFrom(location, now);
  const rows = await ParkingSession.aggregate([
    { $match: { companyId: location.companyId, locationId: location._id, reEntry: true, entryTime: { $gte: since } } },
    { $group: { _id: "$entryOperatorId", count: { $sum: 1 }, last: { $max: "$entryTime" } } },
    { $sort: { count: -1 } },
  ]);
  const users = await User.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }).select("name loginId").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const limit = resolveOperations(location.operations).reEntryLimit;
  return {
    limit,
    since,
    total: rows.reduce((sum, r) => sum + r.count, 0),
    operators: rows.map((r) => {
      const user = byId.get(String(r._id));
      return {
        userId: r._id, name: user ? user.name : "Unknown", loginId: user ? user.loginId : undefined,
        count: r.count, last: r.last, atLimit: limit > 0 && r.count >= limit,
      };
    }),
  };
};

module.exports = { countingFrom, countFor, limitReached, overview };
