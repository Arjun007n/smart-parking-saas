const AppError = require("./AppError");

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const utcOffset = () => Number(process.env.APP_UTC_OFFSET_MINUTES ?? 330);

// Start and end (UTC instants) of a local calendar day.
// `dateText` is "YYYY-MM-DD"; when missing, today's local day is used.
const dayRange = (dateText, now = new Date()) => {
  const offset = utcOffset() * MINUTE;
  let year;
  let month;
  let day;

  if (dateText === undefined || dateText === "") {
    const local = new Date(now.getTime() + offset);
    [year, month, day] = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
  } else {
    const match = typeof dateText === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
    if (!match) throw new AppError("date must look like 2026-03-02", 400);
    [year, month, day] = match.slice(1).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new AppError("date is not a real calendar date", 400);
    }
  }

  const start = new Date(Date.UTC(year, month - 1, day) - offset);
  return { start, end: new Date(start.getTime() + DAY) };
};

// "260302" for 2 March 2026, in local time. Used in ticket numbers.
const localDateStamp = (date = new Date()) => {
  const local = new Date(date.getTime() + utcOffset() * MINUTE);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(local.getUTCFullYear() % 100)}${two(local.getUTCMonth() + 1)}${two(local.getUTCDate())}`;
};

// "+05:30" style offset, for MongoDB date operators.
const timezoneString = () => {
  const offset = utcOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const two = (n) => String(n).padStart(2, "0");
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
};

// "2026-03-02" for a moment in time, in local time.
const localDateText = (date = new Date()) =>
  new Date(date.getTime() + utcOffset() * MINUTE).toISOString().slice(0, 10);

// Reads ?from=&to= (local dates, both included). Defaults to today.
// Returns UTC instants: start of `from` up to the end of `to`.
const rangeFromQuery = (query, { maxDays = 92, now = new Date() } = {}) => {
  const from = query.from === undefined || query.from === "" ? localDateText(now) : query.from;
  const to = query.to === undefined || query.to === "" ? from : query.to;
  const { start } = dayRange(from, now);
  const { end } = dayRange(to, now);
  if (end <= start) throw new AppError("The end date must not be before the start date", 400);
  const days = Math.round((end - start) / DAY);
  if (days > maxDays) throw new AppError(`Choose a period of at most ${maxDays} days`, 400);
  return { start, end, days, from, to };
};

// Midnight (a UTC instant) that starts the local day `date` falls on.
const startOfLocalDay = (date = new Date()) => dayRange(localDateText(date)).start;

// `instant` is a local midnight; returns the local midnight `months` calendar
// months later. A day that does not exist in the target month moves to its
// last day (31 January + 1 month = 28 or 29 February).
const addMonthsLocal = (instant, months) => {
  const offset = utcOffset() * MINUTE;
  const local = new Date(instant.getTime() + offset);
  const year = local.getUTCFullYear();
  const target = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, target + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, target, Math.min(local.getUTCDate(), lastDay)) - offset);
};

// `instant` is a local midnight; returns the local midnight `days` days later.
// The offset is fixed (no daylight saving), so whole days are exact.
const addDaysLocal = (instant, days) => new Date(instant.getTime() + days * DAY);

module.exports = {
  dayRange, localDateStamp, timezoneString, localDateText, rangeFromQuery, utcOffsetMinutes: utcOffset, DAY, MINUTE,
  startOfLocalDay, addMonthsLocal, addDaysLocal,
};
