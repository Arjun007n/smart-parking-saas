process.env.APP_UTC_OFFSET_MINUTES = "330";
const test = require("node:test");
const assert = require("node:assert/strict");
const { dailyOccupancy, weekdayCounts, DURATION_BOUNDARIES, durationBucketLabel, percent } = require("../services/reportMath");
const { dayRange, DAY } = require("../utils/time");

const { start } = dayRange("2026-03-02"); // a Monday
const at = (day, hour, minute = 0) => new Date(start.getTime() + day * DAY + (hour * 60 + minute) * 60000);
const visit = (day, hour, leaveDay, leaveHour, extra = {}) => ({
  entryTime: at(day, hour),
  ...(leaveDay === null ? { isOpen: true } : { exitTime: at(leaveDay, leaveHour), isOpen: false }),
  ...extra,
});

test("occupancy trend: peak is the most vehicles inside at once, not the number of visits", () => {
  const rows = dailyOccupancy({
    start, days: 1, now: at(5, 0), capacity: 10,
    sessions: [
      visit(0, 9, 0, 10), visit(0, 9, 0, 12), visit(0, 11, 0, 13), // 9:00-10:00 two inside, 11:00-12:00 two inside
      visit(0, 14, 0, 15),
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entries, 4);
  assert.equal(rows[0].exits, 4);
  assert.equal(rows[0].peakInside, 2);
  assert.equal(rows[0].peakUtilization, 20);
});

test("occupancy trend: vehicles inside at midnight count towards the next day, and stay counts are by exit day", () => {
  const rows = dailyOccupancy({
    start, days: 3, now: at(5, 0), capacity: 4,
    sessions: [
      visit(-1, 22, 1, 8, { durationMinutes: 600 }), // came the night before, left on day 2
      visit(0, 10, 0, 11, { durationMinutes: 60 }),
      visit(1, 9, null), // still inside
    ],
  });
  assert.deepEqual(rows.map((r) => r.peakInside), [2, 1, 1]);
  assert.deepEqual(rows.map((r) => r.entries), [1, 1, 0]);
  assert.deepEqual(rows.map((r) => r.exits), [1, 1, 0]);
  assert.equal(rows[0].averageStayMinutes, 60);
  assert.equal(rows[1].averageStayMinutes, 600);
  assert.equal(rows[2].averageStayMinutes, 0);
});

test("occupancy trend: nothing before the period or after it is counted; future days are left out", () => {
  const rows = dailyOccupancy({
    start, days: 5, now: at(1, 12), capacity: 0,
    sessions: [visit(-3, 9, -2, 9), visit(4, 9, 4, 10)],
  });
  assert.equal(rows.length, 2, "only days that have started");
  assert.ok(rows.every((r) => r.peakInside === 0 && r.entries === 0 && r.peakUtilization === 0));
});

test("occupancy trend: arriving and leaving in the same instant never makes the count negative", () => {
  const same = { entryTime: at(0, 9), exitTime: at(0, 9), isOpen: false };
  const rows = dailyOccupancy({ start, days: 1, now: at(2, 0), sessions: [same, visit(0, 9, 0, 9)] });
  assert.equal(rows[0].peakInside, 2);
  assert.equal(rows[0].entries, 2);
  assert.equal(rows[0].exits, 2);
});

test("weekday counts: a week and a bit", () => {
  // 2026-03-02 is a Monday; 9 days = Mon Tue Wed Thu Fri Sat Sun Mon Tue
  assert.deepEqual(weekdayCounts(start, 9), [1, 2, 2, 1, 1, 1, 1]);
  assert.equal(weekdayCounts(start, 0).reduce((a, b) => a + b, 0), 0);
});

test("duration buckets cover every length and have readable names", () => {
  assert.deepEqual(DURATION_BOUNDARIES, [0, 30, 60, 120, 240, 480, 1440, 1e9]);
  assert.equal(durationBucketLabel(0), "Under 30 min");
  assert.equal(durationBucketLabel(1440), "Over 24 h");
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(5, 0), 0);
});
