// A period from one date and time to another (the operator Home filter). No database needed.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";
process.env.APP_UTC_OFFSET_MINUTES = "330";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dateTimeRange, dayRange } = require("../utils/time");

test("a date-time period is read in local time and includes the last minute", () => {
  const { start, end } = dateTimeRange("2026-10-01T09:00", "2026-10-05T18:00");
  assert.equal(start.toISOString(), "2026-10-01T03:30:00.000Z"); // 09:00 at +05:30
  assert.equal(end.toISOString(), "2026-10-05T12:31:00.000Z"); // up to and including 18:00
});

test("a whole day as a period matches the day's own range", () => {
  const day = dayRange("2026-10-12");
  const period = dateTimeRange("2026-10-12T00:00", "2026-10-12T23:59");
  assert.equal(period.start.getTime(), day.start.getTime());
  assert.equal(period.end.getTime(), day.end.getTime());
});

test("bad or backwards periods are refused", () => {
  assert.throws(() => dateTimeRange("2026-10-01", "2026-10-02T10:00"), /from must look like/);
  assert.throws(() => dateTimeRange("2026-10-01T09:00", undefined), /to must look like/);
  assert.throws(() => dateTimeRange("2026-02-30T09:00", "2026-03-01T09:00"), /not a real/);
  assert.throws(() => dateTimeRange("2026-10-01T25:00", "2026-10-02T09:00"), /not a real/);
  assert.throws(() => dateTimeRange("2026-10-05T18:00", "2026-10-05T09:00"), /after the start/);
  assert.throws(() => dateTimeRange("2026-01-01T00:00", "2026-06-01T00:00"), /92 days/);
});
