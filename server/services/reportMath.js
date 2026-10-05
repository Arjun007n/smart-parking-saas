// The calculations behind the advanced reports, kept apart from the database
// so they can be tested with plain numbers.

const { DAY, MINUTE, utcOffsetMinutes } = require("../utils/time");

// Day by day: how many vehicles came, left, and the most that were inside at
// the same moment. `sessions` need entryTime, and exitTime / isOpen / durationMinutes
// once they left. `start` is the local midnight that starts the first day.
const dailyOccupancy = ({ sessions, start, days, now = new Date(), capacity = 0 }) => {
  const first = start.getTime();
  const last = first + days * DAY;
  const ENTER = 0;
  const LEAVE = 1;

  let inside = 0;
  const events = [];
  for (const s of sessions) {
    const entry = s.entryTime.getTime();
    const open = s.isOpen || !s.exitTime;
    const exit = open ? Infinity : Math.max(s.exitTime.getTime(), entry);
    if (entry < first) {
      if (exit >= first) inside += 1;
    } else if (entry < last) {
      events.push({ at: entry, kind: ENTER });
    } else {
      continue; // starts after the period
    }
    if (exit >= first && exit < last) events.push({ at: exit, kind: LEAVE, minutes: s.durationMinutes });
  }
  // A vehicle that arrives and leaves at the same instant counts as inside for that instant.
  events.sort((a, b) => a.at - b.at || a.kind - b.kind);

  const rows = [];
  let next = 0;
  for (let d = 0; d < days; d += 1) {
    const from = first + d * DAY;
    const to = from + DAY;
    if (from > now.getTime()) break; // days that have not started yet
    let peak = inside;
    let entries = 0;
    let exits = 0;
    let stayTotal = 0;
    let stayCount = 0;
    while (next < events.length && events[next].at < to) {
      const e = events[next];
      next += 1;
      if (e.kind === ENTER) {
        inside += 1;
        entries += 1;
        if (inside > peak) peak = inside;
      } else {
        inside -= 1;
        exits += 1;
        if (typeof e.minutes === "number") {
          stayTotal += e.minutes;
          stayCount += 1;
        }
      }
    }
    rows.push({
      from,
      entries,
      exits,
      peakInside: peak,
      capacity,
      peakUtilization: capacity > 0 ? Math.round((peak / capacity) * 100) : 0,
      averageStayMinutes: stayCount ? Math.round(stayTotal / stayCount) : 0,
    });
  }
  return rows;
};

// How many of each weekday (0 = Sunday) the period has, so "average per
// Monday" divides by the number of Mondays, not by the number of days.
const weekdayCounts = (start, days) => {
  const counts = Array(7).fill(0);
  for (let d = 0; d < days; d += 1) {
    const local = new Date(start.getTime() + d * DAY + utcOffsetMinutes() * MINUTE);
    counts[local.getUTCDay()] += 1;
  }
  return counts;
};

// Stay lengths for the "how long do vehicles stay" report (minutes).
const DURATION_BUCKETS = [
  { from: 0, label: "Under 30 min" },
  { from: 30, label: "30 min to 1 h" },
  { from: 60, label: "1 to 2 h" },
  { from: 120, label: "2 to 4 h" },
  { from: 240, label: "4 to 8 h" },
  { from: 480, label: "8 to 24 h" },
  { from: 1440, label: "Over 24 h" },
];
const DURATION_BOUNDARIES = [...DURATION_BUCKETS.map((b) => b.from), 1e9];
const durationBucketLabel = (from) => (DURATION_BUCKETS.find((b) => b.from === from) || {}).label || String(from);

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

module.exports = { dailyOccupancy, weekdayCounts, DURATION_BUCKETS, DURATION_BOUNDARIES, durationBucketLabel, percent };
