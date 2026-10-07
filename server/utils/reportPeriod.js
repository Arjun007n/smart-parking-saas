// "Current" and "Old" reports. Recent days are the live period that staff look at every day;
// everything before it is the old period. Asking for one or the other keeps a report fast and
// stops a daily screen from drifting into last year's data by accident.
//
// ?period=current   dates inside the live period (the last REPORT_CURRENT_DAYS days, default 90)
// ?period=old       dates before it (defaults to the month just before the live period)
// no ?period        no limit, as before

const AppError = require("./AppError");
const { startOfLocalDay, localDateText, addDaysLocal } = require("./time");

const PERIODS = ["current", "old"];
const currentDays = () => Math.min(3650, Math.max(7, Number(process.env.REPORT_CURRENT_DAYS) || 90));

// The first moment of the live period (a local midnight).
const currentSince = (now = new Date()) => addDaysLocal(startOfLocalDay(now), -currentDays());

const periodOf = (query) => {
  const period = query && query.period;
  if (period === undefined || period === "") return null;
  if (!PERIODS.includes(period)) throw new AppError("period must be current or old", 400);
  return period;
};

// Fills in the dates a report would use when none were given. For the old period that is the
// month just before the live period, not today.
const withPeriodDefaults = (query, now = new Date()) => {
  if (periodOf(query) !== "old") return query;
  if ((query.from !== undefined && query.from !== "") || (query.to !== undefined && query.to !== "")) return query;
  const last = addDaysLocal(currentSince(now), -1);
  return { ...query, from: localDateText(addDaysLocal(last, -29)), to: localDateText(last) };
};

// Checks the dates a report was asked for against its period.
const checkPeriod = (query, range, now = new Date()) => {
  const period = periodOf(query);
  if (!period) return;
  const since = currentSince(now);
  if (period === "current" && range.start < since) {
    throw new AppError(`Current reports cover the last ${currentDays()} days (from ${localDateText(since)}). Choose Old for earlier dates.`, 400);
  }
  if (period === "old" && range.end > since) {
    throw new AppError(`Old reports cover dates before ${localDateText(since)}. Choose Current for recent dates.`, 400);
  }
};

module.exports = { PERIODS, currentDays, currentSince, periodOf, withPeriodDefaults, checkPeriod };
