// The Pass Charges maths: months and leftover days from two dates. No database needed.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";

const test = require("node:test");
const assert = require("node:assert/strict");
const { breakdown, priceFor } = require("../services/passChargeService");

const rate = { monthlyRate: 1500, dailyRate: 60 };

test("a calendar month counts as one month: 1 to 31 October 2026", () => {
  assert.deepEqual(breakdown("2026-10-01", "2026-10-31"), { months: 1, days: 0, totalDays: 31 });
  assert.equal(priceFor(rate, "2026-10-01", "2026-10-31").amount, 1500);
});

test("a month that starts mid month ends the day before the same day next month", () => {
  assert.deepEqual(breakdown("2026-01-15", "2026-02-14"), { months: 1, days: 0, totalDays: 31 });
  assert.deepEqual(breakdown("2026-01-31", "2026-02-27"), { months: 0, days: 28, totalDays: 28 });
  assert.deepEqual(breakdown("2026-01-31", "2026-02-28"), { months: 1, days: 0, totalDays: 29 });
});

test("a pass that starts on a month end counts to the end of the month", () => {
  assert.deepEqual(breakdown("2026-02-28", "2026-03-31"), { months: 1, days: 0, totalDays: 32 });
  assert.deepEqual(breakdown("2026-04-30", "2026-05-31"), { months: 1, days: 0, totalDays: 32 });
});

test("months and leftover days are added up", () => {
  assert.deepEqual(breakdown("2026-10-01", "2026-12-10"), { months: 2, days: 10, totalDays: 71 });
  assert.equal(priceFor(rate, "2026-10-01", "2026-12-10").amount, 2 * 1500 + 10 * 60);
});

test("a year, and a single day", () => {
  assert.deepEqual(breakdown("2026-01-01", "2026-12-31"), { months: 12, days: 0, totalDays: 365 });
  assert.deepEqual(breakdown("2026-10-05", "2026-10-05"), { months: 0, days: 1, totalDays: 1 });
  assert.equal(priceFor(rate, "2026-10-05", "2026-10-05").amount, 60);
});

test("a leap year February is one month", () => {
  assert.deepEqual(breakdown("2028-02-01", "2028-02-29"), { months: 1, days: 0, totalDays: 29 });
});

test("bad dates are refused", () => {
  assert.throws(() => breakdown("2026-10-10", "2026-10-09"), /cannot end before/);
  assert.throws(() => breakdown("2026-02-30", "2026-03-01"), /does not exist/);
  assert.throws(() => breakdown("10/10/2026", "2026-10-11"), /look like/);
  assert.throws(() => breakdown("2026-01-01", "2040-01-01"), /10 years/);
});

test("rates of 0 give a free pass; amounts are kept to paise", () => {
  assert.equal(priceFor({ monthlyRate: 0, dailyRate: 0 }, "2026-10-01", "2026-10-31").amount, 0);
  assert.equal(priceFor({ monthlyRate: 100, dailyRate: 3.331 }, "2026-10-01", "2026-11-03").amount, 109.99);
});
