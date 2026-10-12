// Works out what a pass costs from its dates and the Pass Charges table.
//
// A pass runs from its first day to its last day, both included. The period is counted in calendar months from
// the first day (1 Oct to 31 Oct is exactly one month; 15 Jan to 14 Feb too), and the days that do not fill another
// month are charged one by one:  total = months x monthly rate + leftover days x daily rate.
// Dates are plain "YYYY-MM-DD" text, so the time zone never changes the answer.

const AppError = require("../utils/AppError");

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_DAYS = 3660;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const parse = (text) => {
  const match = DATE.exec(String(text || ""));
  if (!match) throw new AppError("Dates must look like 2026-10-01", 400);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new AppError("That date does not exist", 400);
  return { y, m, d };
};
const dayNumber = ({ y, m, d }) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// The same day of the month `n` months later (the last day of a shorter month: 31 Jan + 1 month = 28/29 Feb).
const addMonths = ({ y, m, d }, n) => {
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysIn(ny, nm)) };
};

// { months, days, totalDays } for a pass from `start` to `end` (both days included).
// A pass that starts on the last day of a month (31 Jan, 30 Apr) counts to the end of month: 31 Jan to 28 Feb is one month.
const breakdown = (start, end) => {
  const from = parse(start);
  const last = dayNumber(parse(end));
  const first = dayNumber(from);
  if (last < first) throw new AppError("A pass cannot end before it starts", 400);
  const after = last + 1; // the day after the last day
  const totalDays = after - first;
  if (totalDays > MAX_DAYS) throw new AppError("A pass can be at most 10 years long", 400);
  const startsOnMonthEnd = from.d === daysIn(from.y, from.m);
  // The first day that is NOT inside the first n months.
  const boundary = (n) => {
    if (n === 0) return first;
    const target = addMonths(from, n);
    return startsOnMonthEnd ? dayNumber({ ...target, d: daysIn(target.y, target.m) }) + 1 : dayNumber(target);
  };
  let months = 0;
  while (boundary(months + 1) <= after) months += 1;
  return { months, days: after - boundary(months), totalDays };
};

// The charge for the period at a rate row ({ monthlyRate, dailyRate }).
const priceFor = (rate, start, end) => {
  const parts = breakdown(start, end);
  const monthlyRate = Number(rate.monthlyRate) || 0;
  const dailyRate = Number(rate.dailyRate) || 0;
  return { ...parts, monthlyRate, dailyRate, amount: round2(parts.months * monthlyRate + parts.days * dailyRate) };
};

module.exports = { breakdown, priceFor, addMonths, parse, round2, MAX_DAYS };
