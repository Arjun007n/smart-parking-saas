// Gate rules, report periods and the vehicle-type totals: the parts that need no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, resolveOperations, editedFee, MAX_AUTO_EXIT_HOURS } = require("../utils/operations");
const period = require("../utils/reportPeriod");
const { totalOf } = require("../services/typeSummaryService");
const { systemTotal } = require("../controllers/collectionReportController");
const { localDateText, startOfLocalDay, addDaysLocal } = require("../utils/time");

test("a location with nothing set behaves as before", () => {
  const ops = resolveOperations(undefined);
  assert.equal(ops.allowReEntry, true);
  assert.equal(ops.exitAmountEdit, false);
  assert.equal(ops.autoExitHours, 0);
  assert.equal(ops.printTicketNumber, true);
  assert.equal(ops.printPhoto, false);
  assert.equal(ops.photoAutoCapture, false);
  assert.equal(ops.printPassReceipt, true);
  assert.deepEqual(resolveOperations({}), resolveOperations(null));
  assert.equal(Object.keys(ops).length, Object.keys(DEFAULTS).length);
});

test("switches that are set are used, junk is ignored", () => {
  const ops = resolveOperations({ allowReEntry: false, exitAmountEdit: true, printPhoto: "yes", autoExitHours: 12.9 });
  assert.equal(ops.allowReEntry, false);
  assert.equal(ops.exitAmountEdit, true);
  assert.equal(ops.printPhoto, false, "a string is not a switch");
  assert.equal(ops.autoExitHours, 12);
  assert.equal(resolveOperations({ autoExitHours: -3 }).autoExitHours, 0);
  assert.equal(resolveOperations({ autoExitHours: "x" }).autoExitHours, 0);
  assert.equal(resolveOperations({ autoExitHours: 99999 }).autoExitHours, MAX_AUTO_EXIT_HOURS);
});

test("a changed exit amount keeps tax right, tax included in the price", () => {
  const fee = { total: 100, subtotal: 84.75, tax: 15.25, taxPercent: 18, taxInclusive: true, reason: "CHARGED", breakdown: { base: 100 } };
  const edited = editedFee(fee, 59);
  assert.equal(edited.total, 59);
  assert.equal(edited.tax, 9.0, "18% included in 59 is 9.00");
  assert.equal(edited.subtotal, 50);
  assert.equal(edited.reason, "EDITED");
  assert.deepEqual(edited.breakdown, fee.breakdown);
  assert.equal(fee.total, 100, "the original is untouched");
});

test("a changed exit amount when tax is added on top: the amount is what the customer pays", () => {
  const fee = { total: 118, subtotal: 100, tax: 18, taxPercent: 18, taxInclusive: false };
  const edited = editedFee(fee, 59);
  assert.equal(edited.total, 59);
  assert.equal(edited.subtotal, 50);
  assert.equal(edited.tax, 9);
});

test("free is allowed, a negative amount is not", () => {
  const fee = { total: 100, subtotal: 100, tax: 0, taxPercent: 0, taxInclusive: true };
  const free = editedFee(fee, 0);
  assert.equal(free.total, 0);
  assert.equal(free.reason, "EDITED_FREE");
  assert.throws(() => editedFee(fee, -1), RangeError);
  assert.throws(() => editedFee(fee, "abc"), RangeError);
});

test("report periods: no period means no limit", () => {
  assert.equal(period.periodOf({}), null);
  assert.equal(period.periodOf({ period: "" }), null);
  const query = { from: "2020-01-01", to: "2020-01-05" };
  assert.deepEqual(period.withPeriodDefaults(query), query);
  assert.doesNotThrow(() => period.checkPeriod(query, { start: new Date("2020-01-01"), end: new Date("2020-01-06") }));
});

test("report periods: current covers the last days only, old covers before", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const since = period.currentSince(now);
  assert.equal(localDateText(since), localDateText(addDaysLocal(startOfLocalDay(now), -period.currentDays())));
  const inside = { start: addDaysLocal(since, 1), end: addDaysLocal(since, 2) };
  const before = { start: addDaysLocal(since, -10), end: addDaysLocal(since, -9) };
  const straddle = { start: addDaysLocal(since, -1), end: addDaysLocal(since, 1) };

  assert.doesNotThrow(() => period.checkPeriod({ period: "current" }, inside, now));
  assert.throws(() => period.checkPeriod({ period: "current" }, before, now), /Current reports cover/);
  assert.throws(() => period.checkPeriod({ period: "current" }, straddle, now), /Current reports cover/);
  assert.doesNotThrow(() => period.checkPeriod({ period: "old" }, before, now));
  assert.throws(() => period.checkPeriod({ period: "old" }, inside, now), /Old reports cover/);
  assert.throws(() => period.checkPeriod({ period: "old" }, straddle, now), /Old reports cover/);
  assert.throws(() => period.periodOf({ period: "ancient" }), /current or old/);
});

test("old reports default to the month before the live period", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const q = period.withPeriodDefaults({ period: "old" }, now);
  const since = period.currentSince(now);
  assert.equal(q.to, localDateText(addDaysLocal(since, -1)));
  assert.equal(q.from, localDateText(addDaysLocal(since, -30)));
  // Dates the person chose are left alone.
  assert.deepEqual(period.withPeriodDefaults({ period: "old", from: "2020-01-01" }, now), { period: "old", from: "2020-01-01" });
  // The default itself passes the old-period check.
  assert.doesNotThrow(() => period.checkPeriod(q, { start: addDaysLocal(since, -30), end: since }, now));
});

test("totals: wallet spending is not new money, refunds come off", () => {
  const row = { cash: 100, upi: 50, card: 25, online: 10, fastag: 15, wallet: 999, refunded: 20 };
  assert.equal(totalOf(row), 180);
  assert.equal(systemTotal({ ...row, passSales: 40 }), 220);
  assert.equal(systemTotal({ cash: 0, upi: 0, card: 0, online: 0, fastag: 0, passSales: 0, refunded: 0 }), 0);
});
