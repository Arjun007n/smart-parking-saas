// Unit tests for monthly passes: dates, validity, renewal periods. No database.
process.env.APP_UTC_OFFSET_MINUTES = "330";
const test = require("node:test");
const assert = require("node:assert/strict");
const passes = require("../services/passService");
const { addMonthsLocal, startOfLocalDay, dayRange, localDateText } = require("../utils/time");

// Local (UTC+5:30) midnight of a date, as an instant.
const midnight = (text) => dayRange(text).start;
const text = (instant) => localDateText(instant);

test("months are added in local calendar months and clamp short months", () => {
  assert.equal(text(addMonthsLocal(midnight("2026-01-15"), 1)), "2026-02-15");
  assert.equal(text(addMonthsLocal(midnight("2026-01-31"), 1)), "2026-02-28");
  assert.equal(text(addMonthsLocal(midnight("2028-01-31"), 1)), "2028-02-29", "leap year");
  assert.equal(text(addMonthsLocal(midnight("2026-11-30"), 3)), "2027-02-28");
  assert.equal(text(addMonthsLocal(midnight("2026-03-02"), 12)), "2027-03-02");
  assert.equal(text(addMonthsLocal(midnight("2026-12-01"), 1)), "2027-01-01");
  // The result is again a local midnight.
  assert.equal(addMonthsLocal(midnight("2026-01-15"), 1).getTime(), midnight("2026-02-15").getTime());
});

test("startOfLocalDay uses the local day, not the UTC day", () => {
  // 20:00 UTC on 1 March is 01:30 on 2 March in India.
  const lateUtc = new Date("2026-03-01T20:00:00Z");
  assert.equal(text(startOfLocalDay(lateUtc)), "2026-03-02");
  assert.equal(startOfLocalDay(lateUtc).getTime(), midnight("2026-03-02").getTime());
});

const make = (over = {}) => ({
  status: "ACTIVE", startDate: midnight("2026-03-01"), endDate: midnight("2026-04-01"), locationIds: [], ...over,
});

test("a pass is valid from its first day up to, not including, the end date", () => {
  const pass = make();
  assert.equal(passes.passState(pass, new Date(midnight("2026-03-01").getTime() - 1)), "UPCOMING");
  assert.equal(passes.passState(pass, midnight("2026-03-01")), "ACTIVE");
  assert.equal(passes.passState(pass, new Date(midnight("2026-04-01").getTime() - 1)), "ACTIVE", "all of 31 March");
  assert.equal(passes.passState(pass, midnight("2026-04-01")), "EXPIRED");
  assert.equal(passes.passState(make({ status: "SUSPENDED" }), midnight("2026-03-10")), "SUSPENDED");
  assert.equal(passes.passState(make({ status: "CANCELLED" }), midnight("2026-03-10")), "CANCELLED");
});

test("a pass is valid only in the locations it covers", () => {
  const here = "665f1f77bcf86cd799439011";
  const elsewhere = "665f1f77bcf86cd799439012";
  const now = midnight("2026-03-10");
  assert.equal(passes.isValidAt(make({ locationIds: [] }), here, now), true, "empty means every location");
  assert.equal(passes.isValidAt(make({ locationIds: [here] }), here, now), true);
  assert.equal(passes.isValidAt(make({ locationIds: [elsewhere] }), here, now), false);
  assert.equal(passes.isValidAt(make({ status: "SUSPENDED" }), here, now), false);
  assert.equal(passes.isValidAt(null, here, now), false);
});

test("summaries say what the gate needs to know", () => {
  const now = new Date(midnight("2026-03-30").getTime() + 3600000);
  const s = passes.summarize({ ...make({ _id: "p1", passNumber: "P-1", vehicleNumber: "RJ14AB1234", holderName: "A" }) }, "x", now);
  assert.equal(s.state, "ACTIVE");
  assert.equal(s.validHere, true);
  assert.equal(s.daysLeft, 2);
  assert.equal(passes.summarize(null, "x"), null);
  const expired = passes.summarize(make({ passNumber: "P-1" }), "x", midnight("2026-05-01"));
  assert.equal(expired.state, "EXPIRED");
  assert.equal(expired.validHere, false);
  assert.equal(expired.daysLeft, 0);
});

test("a new pass runs for whole months from the chosen day", () => {
  const p = passes.newPeriod({ startText: "2026-03-02", months: 1 });
  assert.equal(text(p.start), "2026-03-02");
  assert.equal(text(p.end), "2026-04-02");
  const today = passes.newPeriod({ months: 3, now: new Date("2026-03-10T05:00:00Z") });
  assert.equal(text(today.start), "2026-03-10");
  assert.equal(text(today.end), "2026-06-10");
  assert.throws(() => passes.newPeriod({ months: 0 }), /Months must be/);
  assert.throws(() => passes.newPeriod({ months: 37 }), /Months must be/);
  assert.throws(() => passes.newPeriod({ months: 1.5 }), /Months must be/);
  assert.throws(() => passes.newPeriod({ startText: "2026-02-31", months: 1 }), /real calendar date/);
});

test("renewing extends a running pass, and restarts one that has ended (no free gap)", () => {
  const running = make({ endDate: midnight("2026-04-01") });
  const early = passes.renewalPeriod(running, 1, new Date("2026-03-20T06:00:00Z"));
  assert.equal(early.continues, true);
  assert.equal(text(early.start), "2026-04-01");
  assert.equal(text(early.end), "2026-05-01");

  const ended = passes.renewalPeriod(running, 1, new Date("2026-04-10T06:00:00Z"));
  assert.equal(ended.continues, false);
  assert.equal(text(ended.start), "2026-04-10");
  assert.equal(text(ended.end), "2026-05-10");

  // Renewing on the very day it ends: the old period is over, so it restarts today.
  const sameDay = passes.renewalPeriod(running, 1, new Date("2026-03-31T20:00:00Z")); // 1 April, local
  assert.equal(sameDay.continues, false);
  assert.equal(text(sameDay.start), "2026-04-01");
});

test("tax is taken out of the amount paid", () => {
  assert.equal(passes.taxIncluded(1180, 18), 180);
  assert.equal(passes.taxIncluded(1000, 0), 0);
  assert.equal(passes.taxIncluded(0, 18), 0);
  assert.equal(passes.taxIncluded(500), 0);
});

test("pass numbers look like P-YYMMDD-XXXXXX and never repeat", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const number = passes.generatePassNumber(new Date("2026-03-02T05:00:00Z"));
    assert.match(number, passes.PASS_PATTERN);
    assert.ok(number.startsWith("P-260302-"));
    seen.add(number);
  }
  assert.equal(seen.size, 200);
});

test("a pass can be bought for days, weeks or months", () => {
  const day = passes.newPeriod({ startText: "2026-03-02", unit: "DAY", count: 10 });
  assert.equal(text(day.end), "2026-03-12");
  assert.deepEqual([day.unit, day.count], ["DAY", 10]);
  const week = passes.newPeriod({ startText: "2026-03-02", unit: "WEEK", count: 2 });
  assert.equal(text(week.end), "2026-03-16");
  const oneDay = passes.newPeriod({ startText: "2026-03-02", unit: "DAY", count: 1 });
  assert.equal(text(oneDay.end), "2026-03-03", "a one-day pass is valid the whole of that day");
  const month = passes.newPeriod({ startText: "2026-01-31", unit: "MONTH", count: 1 });
  assert.equal(text(month.end), "2026-02-28");
  // The older way of asking still works.
  const old = passes.newPeriod({ startText: "2026-03-02", months: 2 });
  assert.equal(text(old.end), "2026-05-02");
  assert.equal(old.unit, "MONTH");
  // Defaults to one month.
  assert.equal(text(passes.newPeriod({ startText: "2026-03-02" }).end), "2026-04-02");
});

test("terms are limited per unit and cannot be mixed", () => {
  assert.throws(() => passes.newPeriod({ unit: "DAY", count: 0 }), /Days must be/);
  assert.throws(() => passes.newPeriod({ unit: "DAY", count: 367 }), /Days must be/);
  assert.throws(() => passes.newPeriod({ unit: "WEEK", count: 157 }), /Weeks must be/);
  assert.throws(() => passes.newPeriod({ unit: "WEEK", count: 1.5 }), /Weeks must be/);
  assert.throws(() => passes.newPeriod({ unit: "YEAR", count: 1 }), /Unit must be/);
  assert.throws(() => passes.newPeriod({ months: 1, unit: "DAY", count: 3 }), /either months/);
  assert.equal(passes.newPeriod({ startText: "2026-03-02", unit: "DAY", count: 366 }).count, 366);
});

test("renewals work in any unit and keep the no-gap rule", () => {
  const running = make({ endDate: midnight("2026-04-01") });
  const early = passes.renewalPeriod(running, { unit: "WEEK", count: 1 }, new Date("2026-03-20T06:00:00Z"));
  assert.equal(early.continues, true);
  assert.equal(text(early.end), "2026-04-08");
  const ended = passes.renewalPeriod(running, { unit: "DAY", count: 5 }, new Date("2026-04-10T06:00:00Z"));
  assert.equal(ended.continues, false);
  assert.equal(text(ended.start), "2026-04-10");
  assert.equal(text(ended.end), "2026-04-15");
});

test("a pass lists its vehicles, also when it is an old pass with one plate", () => {
  const old = make({ vehicleNumber: "RJ14AB1234", vehicleType: "CAR" });
  assert.deepEqual(passes.passVehicles(old).map((v) => v.number), ["RJ14AB1234"]);
  const many = make({ vehicleNumber: "A1", vehicles: [{ number: "A1", type: "CAR" }, { number: "B2", type: "BIKE" }] });
  assert.deepEqual(passes.passVehicles(many).map((v) => v.number), ["A1", "B2"]);
  const s = passes.summarize({ ...many, passType: "EMPLOYEE" }, "x", new Date(midnight("2026-03-10")));
  assert.deepEqual(s.vehicles, ["A1", "B2"]);
  assert.equal(s.passType, "EMPLOYEE");
  assert.equal(passes.summarize(old, "x", midnight("2026-03-10")).passType, "REGULAR");
});

test("the pass model keeps vehicleNumber in step with the first vehicle and enforces the limit", async () => {
  const Pass = require("../models/Pass");
  const id = "665f1f77bcf86cd799439011";
  const base = {
    companyId: id, passNumber: "P-1", holderName: "A", startDate: midnight("2026-03-01"), endDate: midnight("2026-04-01"),
  };
  const legacy = new Pass({ ...base, vehicleNumber: "RJ14AB1234", vehicleType: "CAR" });
  await legacy.validate();
  assert.deepEqual(legacy.vehicles.map((v) => v.number), ["RJ14AB1234"], "old style input fills the list");

  const multi = new Pass({
    ...base, maxVehicles: 2, vehicles: [{ number: "AA11", type: "CAR" }, { number: "BB22", type: "BIKE" }],
  });
  await multi.validate();
  assert.equal(multi.vehicleNumber, "AA11");
  assert.equal(multi.vehicleType, "CAR");
  multi.vehicles.shift();
  await multi.validate();
  assert.equal(multi.vehicleNumber, "BB22", "the next vehicle becomes the main one");

  const tooMany = new Pass({ ...base, maxVehicles: 1, vehicles: [{ number: "AA11", type: "CAR" }, { number: "BB22", type: "CAR" }] });
  await assert.rejects(() => tooMany.validate(), /at most 1 vehicle/);
});
