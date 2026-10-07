const { dayRange, timezoneString, localDateText, rangeFromQuery, DAY, MINUTE } = require("../utils/time");
const { locationsInScope } = require("../utils/scope");
const { capacityLevel } = require("../services/notificationService");
const { round2 } = require("../services/collectionService");
const ParkingSession = require("../models/ParkingSession");
const ParkingSlot = require("../models/ParkingSlot");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const { mergeGroups } = require("../services/collectionService");
const User = require("../models/User");
const Pass = require("../models/Pass");
const { typeSummary } = require("../services/typeSummaryService");
const { validUpto } = require("../services/licenceService");
const { VEHICLE_KEYS } = require("../models/constants");

const TYPES = VEHICLE_KEYS;
const PENDING_TOO_LONG_MINUTES = 30;
const sumTypes = (counts) => TYPES.reduce((total, key) => total + (counts[key] || 0), 0);
// When the plan (or the trial) ends, for the "renew" banner.
const subscriptionView = (company, now) => {
  if (!company) return null;
  const upto = validUpto(company);
  if (!upto) return { status: company.subscriptionStatus, validUpto: null, daysLeft: null, expired: false };
  const daysLeft = Math.ceil((upto - now) / DAY);
  return { status: company.subscriptionStatus, validUpto: upto, daysLeft, expired: upto < now };
};
// A location is "expiring" when its plan ends within this many days.
const EXPIRING_DAYS = 30;

// What the "Individual Location Summary" shows for each location. One plan is bought for the whole company,
// so every location runs to the same date: this lists them one by one the way a location-wise plan would.
const locationPlans = (company, locations, now) => {
  const upto = company ? validUpto(company) : null;
  const paid = company && company.subscriptionStatus === "ACTIVE" && company.subscription && company.subscription.currentPeriodEnd;
  const from = company ? (paid ? company.subscription.currentPeriodStart : company.createdAt) || null : null;
  const daysLeft = upto ? Math.ceil((upto - now) / DAY) : null;
  const status = !upto ? "NO_PLAN" : upto < now ? "EXPIRED" : daysLeft <= EXPIRING_DAYS ? "EXPIRING" : "RUNNING";
  return locations.map((l) => ({
    _id: l._id,
    name: l.name,
    parkingType: l.parkingType || "NORMAL",
    status,
    daysLeft: upto && upto >= now ? daysLeft : null,
    expiresOn: upto,
    package: status === "EXPIRED" || status === "NO_PLAN" ? null : company.plan.name,
    validFrom: status === "EXPIRED" || status === "NO_PLAN" ? null : from,
    validTo: status === "EXPIRED" || status === "NO_PLAN" ? null : upto,
  }));
};

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// GET /api/dashboard?locationId=&from=&to=
// One call with everything the operations dashboard shows. All figures are
// limited to the locations the user may see. `from` and `to` (a local date each, up to 92 days apart) set
// the period of the day figures, the hourly charts and the type table; they start on today. What is
// parked now, the month tiles, the last 7 days and the plans do not depend on them.
const getDashboard = async (req, res) => {
  const locations = await locationsInScope(req, { activeOnly: true });
  const locationIds = locations.map((l) => l._id);
  const inScope = { locationId: { $in: locationIds } };
  const tz = timezoneString();
  const now = new Date();
  const today = dayRange(undefined, now);
  const todayText = localDateText(now);
  const period = rangeFromQuery(req.query, { maxDays: 92, now });
  const isToday = period.from === todayText && period.to === todayText;
  const weekStart = new Date(today.start.getTime() - 6 * DAY);
  const monthStart = dayRange(`${todayText.slice(0, 7)}-01`).start;
  const first = monthStart < weekStart ? monthStart : weekStart;
  const since = period.start < first ? period.start : first;
  const until = period.end > today.end ? period.end : today.end;
  const dayOf = (field) => ({ $dateToString: { date: field, format: "%Y-%m-%d", timezone: tz } });
  const hourOf = (field) => ({ $hour: { date: field, timezone: tz } });

  const [
    entriesByHour, exitsByHour, entriesByLocation, inside, pendingLong, closedByStatus,
    paidByDay, refundedByDay, todayMoney, failedPayments, reserved,
    entriesByOperator, exitsByOperator, passPaidByDay, passToday,
    paidByHour, passPaidByHour, refundedByHour, activePassMoney,
  ] = await Promise.all([
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: hourOf("$entryTime"), count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, status: { $ne: "CANCELLED" }, exitTime: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: hourOf("$exitTime"), count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: "$locationId", count: { $sum: 1 } } },
    ]),
    ParkingSession.countDocuments({ ...inScope, isOpen: true }),
    ParkingSession.countDocuments({
      ...inScope, status: "PAYMENT_PENDING", exitTime: { $lt: new Date(now.getTime() - PENDING_TOO_LONG_MINUTES * MINUTE) },
    }),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, exitTime: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: since, $lt: until } } },
      { $group: { _id: dayOf("$paidAt"), amount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": { $gte: since, $lt: until } } },
      { $group: { _id: dayOf("$refund.refundedAt"), amount: { $sum: "$refund.amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: period.start, $lt: period.end } } },
      {
        $facet: {
          byMethod: [{ $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          byLocation: [{ $group: { _id: "$locationId", amount: { $sum: "$amount" }, count: { $sum: 1 } } }],
          byOperator: [{ $group: { _id: "$collectedBy", amount: { $sum: "$amount" }, count: { $sum: 1 } } }],
        },
      },
    ]),
    Payment.countDocuments({ ...inScope, status: "FAILED", createdAt: { $gte: period.start, $lt: period.end } }),
    ParkingSlot.countDocuments({ ...inScope, type: "RESERVED" }),
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: "$entryOperatorId", count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, exitTime: { $gte: period.start, $lt: period.end }, exitOperatorId: { $ne: null } } },
      { $group: { _id: "$exitOperatorId", count: { $sum: 1 } } },
    ]),
    // Pass sales and renewals count as revenue too.
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: { $gte: since, $lt: until } } },
      { $group: { _id: dayOf("$paidAt"), amount: { $sum: "$amount" } } },
    ]),
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: { $gte: period.start, $lt: period.end } } },
      {
        $facet: {
          byMethod: [{ $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } }],
          byLocation: [{ $group: { _id: "$locationId", amount: { $sum: "$amount" }, count: { $sum: 1 } } }],
          byOperator: [{ $group: { _id: "$collectedBy", amount: { $sum: "$amount" }, count: { $sum: 1 } } }],
        },
      },
    ]),
    // Money by hour of the day over the period, for "Revenue Overview – Full Day".
    Payment.aggregate([
      { $match: { ...inScope, status: { $in: ["SUCCESS", "REFUNDED"] }, paidAt: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: hourOf("$paidAt"), amount: { $sum: "$amount" } } },
    ]),
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 }, paidAt: { $gte: period.start, $lt: period.end } } },
      { $group: { _id: hourOf("$paidAt"), amount: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...inScope, status: "REFUNDED", "refund.refundedAt": { $gte: period.start, $lt: period.end } } },
      { $group: { _id: hourOf("$refund.refundedAt"), amount: { $sum: "$refund.amount" } } },
    ]),
    // What the passes that are valid now were paid: "Current Active Passes Revenue".
    PassPayment.aggregate([
      { $match: { ...inScope, amount: { $gt: 0 } } },
      {
        $lookup: {
          from: Pass.collection.name, localField: "passId", foreignField: "_id", as: "p",
          pipeline: [{ $match: { status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now } } }, { $project: { _id: 1 } }],
        },
      },
      { $unwind: "$p" },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]),
  ]);

  // ---- by vehicle type (today and this month), the day's inside-count by hour, passes, reprints
  const vehicleTypes = [...new Set(locations.flatMap((l) => l.vehicleTypes))];
  const [todayByType, monthByType, closedByHour, reprintRows, activePasses, endingPasses, allPasses] = await Promise.all([
    typeSummary({ locationIds, range: period, vehicleTypes }),
    typeSummary({ locationIds, range: { start: monthStart, end: today.end }, vehicleTypes }),
    // Every ticket that closed today, cancelled ones too: they all leave the car park.
    ParkingSession.aggregate([
      { $match: { ...inScope, isOpen: false, exitTime: { $gte: today.start, $lt: today.end } } },
      { $group: { _id: hourOf("$exitTime"), count: { $sum: 1 } } },
    ]),
    ParkingSession.aggregate([
      { $match: { ...inScope, entryTime: { $gte: period.start, $lt: period.end }, reprints: { $gt: 0 } } },
      { $group: { _id: null, count: { $sum: "$reprints" } } },
    ]),
    Pass.countDocuments({ ...req.tenantFilter, status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now } }),
    Pass.countDocuments({ ...req.tenantFilter, status: "ACTIVE", startDate: { $lte: now }, endDate: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY) } }),
    Pass.countDocuments({ ...req.tenantFilter, isCurrent: true }),
  ]);

  // Vehicles inside at the end of each hour so far today, worked back from the number inside now.
  const closedAt = new Array(24).fill(0);
  for (const row of closedByHour) closedAt[row._id] = row.count;
  const enteredAt = new Array(24).fill(0);
  for (const row of entriesByHour) enteredAt[row._id] = row.count;
  const nowHour = Math.floor((now.getTime() - today.start.getTime()) / 3600000);
  const momentum = [];
  let insideAfter = inside;
  for (let hour = Math.min(23, nowHour); hour >= 0; hour -= 1) {
    momentum.unshift({ hour, inside: Math.max(0, insideAfter) });
    insideAfter -= enteredAt[hour] - closedAt[hour];
  }

  // ---- occupancy
  const capacity = Object.fromEntries(TYPES.map((k) => [k, locations.reduce((t, l) => t + l.capacity[k], 0)]));
  const occupied = Object.fromEntries(TYPES.map((k) => [k, locations.reduce((t, l) => t + l.occupied[k], 0)]));
  const totalCapacity = sumTypes(capacity);
  const totalOccupied = sumTypes(occupied);

  // ---- traffic (24 local hours)
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0, exits: 0 }));
  for (const row of entriesByHour) hourly[row._id].entries = row.count;
  for (const row of exitsByHour) hourly[row._id].exits = row.count;
  const entriesToday = hourly.reduce((t, h) => t + h.entries, 0);
  const exitsToday = hourly.reduce((t, h) => t + h.exits, 0);

  // ---- revenue (collected on the day paid, minus refunds on the day refunded)
  const netByDay = new Map();
  for (const row of [...paidByDay, ...passPaidByDay]) netByDay.set(row._id, (netByDay.get(row._id) || 0) + row.amount);
  for (const row of refundedByDay) netByDay.set(row._id, (netByDay.get(row._id) || 0) - row.amount);
  const netSince = (start) => {
    const from = localDateText(start);
    let total = 0;
    for (const [day, amount] of netByDay) if (day >= from) total += amount;
    return round2(total);
  };
  // The period chosen on the page (inclusive local dates), and its money hour by hour.
  const netInPeriod = () => {
    let total = 0;
    for (const [day, amount] of netByDay) if (day >= period.from && day <= period.to) total += amount;
    return round2(total);
  };
  const revenueByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0 }));
  for (const row of [...paidByHour, ...passPaidByHour]) revenueByHour[row._id].amount += row.amount;
  for (const row of refundedByHour) revenueByHour[row._id].amount -= row.amount;
  for (const row of revenueByHour) row.amount = round2(row.amount);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = localDateText(new Date(weekStart.getTime() + i * DAY));
    return { date, amount: round2(netByDay.get(date) || 0) };
  });

  const parkingToday = todayMoney[0];
  const passesToday = passToday[0];
  const money = {
    byMethod: mergeGroups(parkingToday.byMethod, passesToday.byMethod).sort((a, b) => String(a._id).localeCompare(String(b._id))),
    byLocation: mergeGroups(parkingToday.byLocation, passesToday.byLocation),
    byOperator: mergeGroups(parkingToday.byOperator, passesToday.byOperator),
  };
  const moneyByLocation = new Map(money.byLocation.map((r) => [String(r._id), r]));
  const entriesAt = new Map(entriesByLocation.map((r) => [String(r._id), r.count]));

  // ---- operators
  const activity = new Map();
  const touch = (id) => {
    const key = String(id);
    if (!activity.has(key)) activity.set(key, { operatorId: id, entries: 0, exits: 0, payments: 0, collected: 0 });
    return activity.get(key);
  };
  for (const row of entriesByOperator) if (row._id) touch(row._id).entries = row.count;
  for (const row of exitsByOperator) if (row._id) touch(row._id).exits = row.count;
  for (const row of money.byOperator) {
    if (!row._id) continue;
    Object.assign(touch(row._id), { payments: row.count, collected: round2(row.amount) });
  }
  const users = await User.find({ _id: { $in: [...activity.values()].map((a) => a.operatorId) } }).select("name role");
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const operators = [...activity.values()]
    .map((a) => ({ ...a, name: userById.get(String(a.operatorId))?.name || "Unknown", role: userById.get(String(a.operatorId))?.role }))
    .sort((a, b) => b.entries + b.exits - (a.entries + a.exits));

  // ---- exceptions and alerts
  const statusCount = (status) => (closedByStatus.find((r) => r._id === status) || { count: 0 }).count;
  const exceptions = {
    overrides: statusCount("MANUAL_OVERRIDE"),
    cancelled: statusCount("CANCELLED"),
    lostTickets: statusCount("LOST_TICKET"),
    paymentPendingTooLong: pendingLong,
    failedPayments,
  };

  const alerts = [];
  for (const location of locations) {
    for (const key of TYPES) {
      const level = capacityLevel(location.occupied[key], location.capacity[key]);
      if (level) {
        alerts.push({
          type: "CAPACITY",
          severity: level === "full" ? "critical" : "warning",
          message: `${location.name}: ${key} parking is ${level === "full" ? "full" : "almost full"} (${location.occupied[key]} of ${location.capacity[key]})`,
          locationId: location._id,
        });
      }
    }
  }
  if (pendingLong > 0) {
    alerts.push({
      type: "PAYMENT_PENDING", severity: "warning",
      message: `${pendingLong} vehicle${pendingLong === 1 ? " has" : "s have"} been waiting for payment for over ${PENDING_TOO_LONG_MINUTES} minutes`,
    });
  }
  if (failedPayments > 0) {
    alerts.push({ type: "PAYMENT_FAILED", severity: "warning", message: `${failedPayments} online payment${failedPayments === 1 ? "" : "s"} failed today` });
  }
  if (exceptions.overrides > 0) {
    alerts.push({ type: "OVERRIDE", severity: "info", message: `${exceptions.overrides} exit${exceptions.overrides === 1 ? "" : "s"} without payment today` });
  }
  const company = req.company;
  if (company && company.subscriptionStatus === "TRIAL" && company.trialEndsAt) {
    const daysLeft = Math.ceil((company.trialEndsAt - now) / DAY);
    if (daysLeft <= 7) {
      alerts.push({
        type: "SUBSCRIPTION_EXPIRY",
        severity: daysLeft <= 0 ? "critical" : "warning",
        message: daysLeft <= 0 ? "Your trial has ended" : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      });
    }
  }
  if (company && company.subscriptionStatus === "PAST_DUE") {
    alerts.push({ type: "SUBSCRIPTION_EXPIRY", severity: "critical", message: "Subscription payment is overdue" });
  }

  res.json({
    success: true,
    data: {
      generatedAt: now,
      date: todayText,
      period: { from: period.from, to: period.to, days: period.days, isToday },
      occupancy: {
        capacity, occupied,
        totalCapacity, totalOccupied,
        available: totalCapacity - totalOccupied,
        reserved,
        utilization: percent(totalOccupied, totalCapacity),
      },
      traffic: { entriesToday, exitsToday, currentVehicles: inside, hourly },
      revenue: {
        today: round2(netByDay.get(todayText) || 0),
        inPeriod: netInPeriod(),
        byHour: revenueByHour,
        week: netSince(weekStart),
        month: netSince(monthStart),
        last7Days,
        byMethod: money.byMethod.map((r) => ({ method: r._id, amount: round2(r.amount), count: r.count })),
      },
      operators,
      exceptions,
      alerts,
      byVehicleType: todayByType,
      month: { from: localDateText(monthStart), ...monthByType },
      // Vehicles inside through the day only make sense for today.
      momentum: isToday ? momentum : [],
      reprintsToday: reprintRows[0] ? reprintRows[0].count : 0,
      passes: {
        active: activePasses, endingSoon: endingPasses, total: allPasses,
        activeRevenue: round2(activePassMoney[0] ? activePassMoney[0].amount : 0),
      },
      subscription: subscriptionView(company, now),
      locationPlans: locationPlans(company, locations, now),
      locations: locations.map((l) => {
        const cap = sumTypes(l.capacity);
        const occ = sumTypes(l.occupied);
        const paid = moneyByLocation.get(String(l._id));
        return {
          _id: l._id,
          name: l.name,
          capacity: cap,
          occupied: occ,
          available: cap - occ,
          utilization: percent(occ, cap),
          entriesToday: entriesAt.get(String(l._id)) || 0,
          collectedToday: paid ? round2(paid.amount) : 0,
        };
      }),
    },
  });
};

module.exports = { getDashboard };
