// "Close forgotten tickets": a location can ask for tickets that are still open after a number of
// hours (Location.operations.autoExitHours) to be closed by the system. Typical cases are a vehicle
// that left without being exited, or a ticket made by mistake and never cancelled.
//
// The ticket is closed as MANUAL_OVERRIDE with `autoClosed` set and a plain reason, so reports show
// it apart from a normal exit. No money is taken: the amount is not guessed. The company is told
// (one alert per location per day) so a missed payment can be followed up.

const sessions = require("./sessionService");
const audit = require("./auditService");
const { notify } = require("./notificationService");
const { publish, EVENTS } = require("./eventBus");
const { localDateText } = require("../utils/time");
const Location = require("../models/Location");
const ParkingSession = require("../models/ParkingSession");

const SYSTEM_REQ = Object.freeze({ headers: {}, ip: "system" });
const MAX_PER_LOCATION = 500;
const HOUR = 60 * 60 * 1000;

const DAY = 24 * HOUR;

// Closes the open tickets of one location that are older than `cutoff` (optionally one vehicle type
// only). Returns how many were closed. `why` is written on every ticket.
const closeOlderThan = async (location, cutoff, { vehicleType, why, hours, days, amount } = {}) => {
  // Only tickets that were never quoted a fee: one with a payment under way is left alone.
  const filter = { locationId: location._id, isOpen: true, status: "ACTIVE", entryTime: { $lt: cutoff } };
  if (vehicleType) filter.vehicleType = vehicleType;
  const old = await ParkingSession.find(filter).sort({ entryTime: 1 }).limit(MAX_PER_LOCATION).select("_id");

  let closedCount = 0;
  for (const { _id } of old) {
    const closed = await sessions.closeSession(_id, "MANUAL_OVERRIDE", {
      exitTime: new Date(), autoClosed: true, overrideReason: why,
    });
    if (!closed) continue;
    closedCount += 1;
    await audit.record(SYSTEM_REQ, "PARKING_AUTO_CLOSED", {
      entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
      meta: { ticketNumber: closed.ticketNumber, hours, days, amount, vehicleType: closed.vehicleType },
    });
    publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });
  }
  return closedCount;
};

const tellCompany = (location, count, text, key, now, extra = {}) =>
  notify({
    companyId: location.companyId,
    locationId: location._id,
    type: "AUTO_CLOSED_TICKETS",
    severity: "warning",
    title: `${count} forgotten ticket${count === 1 ? "" : "s"} closed at ${location.name}`,
    message: `${text} Check the Exceptions report if a fee was missed.`,
    data: { count, ...extra },
    dedupeKey: `auto-closed:${location._id}:${key}:${localDateText(now)}`,
  });

// One vehicle type of one location: tickets still open after `days` days.
const runRule = async (location, rule, now = new Date()) => {
  const owes = rule.amount > 0 ? ` ₹${rule.amount} is still owed on each.` : "";
  const count = await closeOlderThan(location, new Date(now.getTime() - rule.days * DAY), {
    vehicleType: rule.vehicleType,
    why: `Closed automatically: ${rule.vehicleType} still open after ${rule.days} days.${owes}`.trim(),
    days: rule.days, amount: rule.amount,
  });
  if (count > 0) {
    await tellCompany(location, count, `These ${rule.vehicleType} tickets were still open after ${rule.days} days and were closed without a payment.${owes}`, rule.vehicleType, now, { days: rule.days, vehicleType: rule.vehicleType, amount: rule.amount });
  }
  return count;
};

// Returns the number of tickets closed, per location name.
const closeForgottenTickets = async (now = new Date()) => {
  const locations = await Location.find({
    isActive: true,
    $or: [{ "operations.autoExitHours": { $gt: 0 } }, { "operations.autoExitRules.active": true }],
  }).select("companyId name operations");
  const result = [];
  for (const location of locations) {
    let closedCount = 0;
    // A vehicle type with its own active rule follows that rule; the others follow the location-wide hours.
    const rules = (location.operations.autoExitRules || []).filter((r) => r.active);
    for (const rule of rules) closedCount += await runRule(location, rule, now);

    const hours = location.operations.autoExitHours;
    if (hours > 0) {
      const ruled = rules.map((r) => r.vehicleType);
      const count = await closeOlderThan(location, new Date(now.getTime() - hours * HOUR), {
        vehicleType: ruled.length ? { $nin: ruled } : undefined,
        why: `Closed automatically: still open after ${hours} hours`, hours,
      });
      if (count > 0) await tellCompany(location, count, `These tickets were still open after ${hours} hours and were closed without a payment.`, "hours", now, { hours });
      closedCount += count;
    }
    result.push({ location: location.name, closed: closedCount });
  }
  return result;
};

module.exports = { closeForgottenTickets, runRule };
