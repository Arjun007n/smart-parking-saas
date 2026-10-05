// Unit tests for the fee engine (plan, Day 12). No database needed.
process.env.NODE_ENV = "test";
process.env.APP_UTC_OFFSET_MINUTES = "330"; // India

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateFee, selectTariff, appliesAt, slabProblem, midnightsCrossed, tariffProblem,
} = require("../services/tariffService");

// Times are written in IST and converted, so tests read like real visits.
const ist = (text) => new Date(`${text}:00+05:30`);
const fee = (tariff, from, to, extra = {}) =>
  calculateFee(tariff, { entryTime: ist(from), exitTime: ist(to), ...extra });

// Car tariff: 10 min grace; up to 1h = 20; up to 3h = 50; then 20 per started hour.
const CAR = {
  gracePeriodMinutes: 10,
  slabs: [{ uptoMinutes: 60, rate: 20 }, { uptoMinutes: 180, rate: 50 }],
  additionalPerHour: 20,
  taxPercent: 0,
  taxInclusive: true,
};

test("grace period: free up to and including the last grace minute", () => {
  const inside = fee(CAR, "2026-03-02T10:00", "2026-03-02T10:10");
  assert.equal(inside.total, 0);
  assert.equal(inside.reason, "GRACE_PERIOD");
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T10:00").total, 0);
  // One minute later the whole stay is charged (not just the extra minute).
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T10:11").total, 20);
});

test("short stay: slab boundaries", () => {
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T10:45").total, 20);
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T11:00").total, 20); // exactly 60
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T11:01").total, 50); // 61
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T13:00").total, 50); // exactly 180
});

test("seconds round the duration up to the next minute", () => {
  const result = calculateFee(CAR, {
    entryTime: new Date("2026-03-02T10:00:00+05:30"),
    exitTime: new Date("2026-03-02T11:00:01+05:30"),
  });
  assert.equal(result.durationMinutes, 61);
  assert.equal(result.total, 50);
});

test("long stay: started hours after the last slab", () => {
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T13:01").total, 70); // 181 min
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T14:00").total, 70); // 240
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T18:00").total, 150); // 8h = 50 + 5*20
});

test("no slabs: plain hourly rate", () => {
  const hourly = { additionalPerHour: 30 };
  assert.equal(fee(hourly, "2026-03-02T10:00", "2026-03-02T10:01").total, 30);
  assert.equal(fee(hourly, "2026-03-02T10:00", "2026-03-02T12:00").total, 60);
  assert.equal(fee(hourly, "2026-03-02T10:00", "2026-03-02T12:01").total, 90);
});

test("slabs are used in order even if stored unsorted", () => {
  const unsorted = { ...CAR, slabs: [CAR.slabs[1], CAR.slabs[0]] };
  assert.equal(fee(unsorted, "2026-03-02T10:00", "2026-03-02T10:30").total, 20);
});

test("daily cap limits each 24 hours", () => {
  const capped = { ...CAR, maxDailyFee: 100 };
  assert.equal(fee(capped, "2026-03-02T08:00", "2026-03-02T12:00").total, 70); // under the cap
  assert.equal(fee(capped, "2026-03-02T08:00", "2026-03-02T20:00").total, 100); // 12h would be 230
  assert.equal(fee(capped, "2026-03-02T08:00", "2026-03-03T08:00").total, 100); // exactly 24h
  assert.equal(fee(capped, "2026-03-02T08:00", "2026-03-03T08:30").total, 120); // 1 day + 30 min
  assert.equal(fee(capped, "2026-03-02T08:00", "2026-03-04T20:00").total, 300); // 2 days + 12h
});

test("minimum fee applies only to chargeable stays", () => {
  const withMin = { ...CAR, minimumFee: 30 };
  assert.equal(fee(withMin, "2026-03-02T10:00", "2026-03-02T10:30").total, 30);
  assert.equal(fee(withMin, "2026-03-02T10:00", "2026-03-02T12:00").total, 50);
  assert.equal(fee(withMin, "2026-03-02T10:00", "2026-03-02T10:05").total, 0); // grace
});

test("overnight: surcharge for each local midnight crossed", () => {
  const night = { ...CAR, overnightFee: 40 };
  const sameDay = fee(night, "2026-03-02T10:00", "2026-03-02T23:59");
  assert.equal(sameDay.breakdown.overnight, 0);

  const oneNight = fee(night, "2026-03-02T22:00", "2026-03-03T07:00"); // 9h = 50 + 6*20 = 170
  assert.equal(oneNight.breakdown.base, 170);
  assert.equal(oneNight.breakdown.overnight, 40);
  assert.equal(oneNight.total, 210);

  assert.equal(fee(night, "2026-03-02T22:00", "2026-03-04T07:00").breakdown.overnight, 80);
  // 23:50 -> 00:05 crosses midnight but it is a 15 minute stay.
  assert.equal(fee(night, "2026-03-02T23:50", "2026-03-03T00:05").total, 60);
  // ...and inside the grace period nothing is charged at all.
  assert.equal(fee(night, "2026-03-02T23:55", "2026-03-03T00:03").total, 0);
});

test("midnight is counted in local time, not UTC", () => {
  // 04:00 -> 06:00 IST crosses UTC midnight (00:00 UTC = 05:30 IST) but not a local one.
  assert.equal(midnightsCrossed(ist("2026-03-02T04:00"), ist("2026-03-02T06:00"), 330), 0);
  assert.equal(midnightsCrossed(ist("2026-03-02T23:00"), ist("2026-03-03T01:00"), 330), 1);
  assert.equal(midnightsCrossed(ist("2026-03-02T23:00"), ist("2026-03-03T01:00"), 0), 0);
});

test("lost ticket: penalty added, grace does not apply", () => {
  const lost = { ...CAR, lostTicketFee: 200 };
  const result = fee(lost, "2026-03-02T10:00", "2026-03-02T11:30", { lostTicket: true });
  assert.equal(result.reason, "LOST_TICKET");
  assert.deepEqual(result.breakdown, { base: 50, overnight: 0, lostTicket: 200, discount: 0 });
  assert.equal(result.total, 250);
  assert.equal(fee(lost, "2026-03-02T10:00", "2026-03-02T10:05", { lostTicket: true }).total, 200);
  // Without a configured penalty a lost ticket pays the normal fee.
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T11:30", { lostTicket: true }).total, 50);
});

test("pass holders pay nothing", () => {
  const result = fee(CAR, "2026-03-02T10:00", "2026-03-02T18:00", { hasValidPass: true });
  assert.equal(result.total, 0);
  assert.equal(result.reason, "PASS");
  assert.equal(result.durationMinutes, 480);
});

test("discount is taken off before tax and is limited to 0-100%", () => {
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T12:00", { discountPercent: 20 }).total, 40);
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T12:00", { discountPercent: 150 }).total, 0);
  assert.equal(fee(CAR, "2026-03-02T10:00", "2026-03-02T12:00", { discountPercent: -5 }).total, 50);
});

test("tax: prices that already include tax", () => {
  const result = fee({ ...CAR, taxPercent: 18, taxInclusive: true }, "2026-03-02T10:00", "2026-03-02T12:00");
  assert.equal(result.total, 50);
  assert.equal(result.tax, 7.63);
  assert.equal(result.subtotal, 42.37);
  assert.equal(result.subtotal + result.tax, result.total);
});

test("tax: added on top", () => {
  const result = fee({ ...CAR, taxPercent: 18, taxInclusive: false }, "2026-03-02T10:00", "2026-03-02T12:00");
  assert.equal(result.subtotal, 50);
  assert.equal(result.tax, 9);
  assert.equal(result.total, 59);
});

test("money is rounded to 2 decimals", () => {
  const result = fee(
    { additionalPerHour: 33.33, taxPercent: 18, taxInclusive: false },
    "2026-03-02T10:00", "2026-03-02T10:30", { discountPercent: 10 }
  );
  assert.equal(result.breakdown.discount, 3.33);
  assert.equal(result.subtotal, 30);
  assert.equal(result.tax, 5.4);
  assert.equal(result.total, 35.4);
});

test("edge cases: bad input is rejected", () => {
  assert.throws(() => fee(CAR, "2026-03-02T10:00", "2026-03-02T09:00"), /before entry/);
  assert.throws(() => calculateFee(CAR, { entryTime: "not a date", exitTime: new Date() }), /Invalid entry time/);
  assert.throws(() => calculateFee(null, { entryTime: new Date() }), /No tariff/);
  // A free tariff is valid.
  assert.equal(fee({}, "2026-03-02T10:00", "2026-03-02T12:00").total, 0);
});

test("ISO strings are accepted for times", () => {
  const result = calculateFee(CAR, {
    entryTime: "2026-03-02T04:30:00.000Z",
    exitTime: "2026-03-02T06:30:00.000Z",
  });
  assert.equal(result.durationMinutes, 120);
  assert.equal(result.total, 50);
});

test("appliesAt: active flag, dates and days of the week", () => {
  const monday = ist("2026-03-02T10:00"); // a Monday
  assert.ok(appliesAt({}, monday));
  assert.ok(!appliesAt({ isActive: false }, monday));
  assert.ok(appliesAt({ daysOfWeek: [1] }, monday));
  assert.ok(!appliesAt({ daysOfWeek: [0, 6] }, monday));
  assert.ok(!appliesAt({ validFrom: ist("2026-03-03T00:00") }, monday));
  assert.ok(!appliesAt({ validTo: ist("2026-03-01T23:59") }, monday));
  // 01:00 IST on Monday is still Sunday in UTC; the local day must be used.
  assert.ok(appliesAt({ daysOfWeek: [1] }, ist("2026-03-02T01:00")));
});

test("selectTariff: weekend/event tariffs beat the general one", () => {
  const general = { name: "general", createdAt: "2026-01-01" };
  const weekend = { name: "weekend", daysOfWeek: [0, 6], createdAt: "2026-01-02" };
  const event = {
    name: "event", daysOfWeek: [6], createdAt: "2026-01-03",
    validFrom: ist("2026-03-07T00:00"), validTo: ist("2026-03-07T23:59"),
  };
  const newerGeneral = { name: "newer", createdAt: "2026-02-01" };
  const all = [general, weekend, event];

  assert.equal(selectTariff(all, ist("2026-03-02T10:00")).name, "general"); // Monday
  assert.equal(selectTariff(all, ist("2026-03-08T10:00")).name, "weekend"); // Sunday
  assert.equal(selectTariff(all, ist("2026-03-07T10:00")).name, "event"); // that Saturday
  assert.equal(selectTariff([general, newerGeneral], ist("2026-03-02T10:00")).name, "newer");
  assert.equal(selectTariff([weekend], ist("2026-03-02T10:00")), null);
  assert.equal(selectTariff([], ist("2026-03-02T10:00")), null);
});

test("slabProblem: finds slabs that are out of order", () => {
  assert.equal(slabProblem([]), null);
  assert.equal(slabProblem(CAR.slabs), null);
  assert.match(slabProblem([{ uptoMinutes: 60, rate: 20 }, { uptoMinutes: 60, rate: 30 }]), /longer duration/);
  assert.match(slabProblem([{ uptoMinutes: 60, rate: 20 }, { uptoMinutes: 120, rate: 10 }]), /cost less/);
});

// ---- Phase 4: event and airport tariffs ----

test("event flat fee: one fee for the whole stay, whatever the length", () => {
  const event = { gracePeriodMinutes: 5, flatFee: 200, taxPercent: 0 };
  assert.equal(fee(event, "2026-03-07T17:00", "2026-03-07T17:04").total, 0); // grace still applies
  assert.equal(fee(event, "2026-03-07T17:00", "2026-03-07T17:30").total, 200);
  assert.equal(fee(event, "2026-03-07T17:00", "2026-03-07T23:30").total, 200);
  assert.equal(fee(event, "2026-03-07T17:00", "2026-03-09T08:00").total, 200);
  // A zero flat fee is a free event, not "no price set".
  assert.equal(fee({ flatFee: 0 }, "2026-03-07T17:00", "2026-03-07T23:30").total, 0);
});

test("event flat fee still honours the minimum fee, lost ticket and tax", () => {
  const event = { flatFee: 100, lostTicketFee: 300, taxPercent: 18, taxInclusive: false };
  const lost = fee(event, "2026-03-07T17:00", "2026-03-07T20:00", { lostTicket: true });
  assert.equal(lost.breakdown.base, 100);
  assert.equal(lost.breakdown.lostTicket, 300);
  assert.equal(lost.total, 472); // 400 + 18%
});

test("airport long stay: daily rate for each started 24 hours once past the threshold", () => {
  const airport = {
    gracePeriodMinutes: 15,
    slabs: [{ uptoMinutes: 60, rate: 100 }, { uptoMinutes: 240, rate: 300 }],
    additionalPerHour: 100,
    longStayAfterMinutes: 480, // after 8 hours
    longStayDailyRate: 500,
  };
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-02T10:10").total, 0); // pick-up grace
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-02T11:00").total, 100);
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-02T18:00").total, 700); // 8h: still hourly 300+4*100
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-02T18:01").total, 500); // 481 min: one started day
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-03T10:00").total, 500); // exactly 24h
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-03T10:01").total, 1000); // second day started
  assert.equal(fee(airport, "2026-03-02T10:00", "2026-03-09T10:00").total, 3500); // a week away
});

test("long stay needs both numbers, otherwise the normal rates apply", () => {
  const half = { slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, longStayDailyRate: 5 };
  assert.equal(fee(half, "2026-03-02T10:00", "2026-03-04T10:00").total, 20 + 47 * 20);
});

test("appliesAt: time-of-day window on the entry time, also across midnight", () => {
  const evening = { startTime: "17:00", endTime: "23:00" };
  assert.ok(appliesAt(evening, ist("2026-03-02T17:00")));
  assert.ok(appliesAt(evening, ist("2026-03-02T22:59")));
  assert.ok(!appliesAt(evening, ist("2026-03-02T23:00")));
  assert.ok(!appliesAt(evening, ist("2026-03-02T09:00")));

  const night = { startTime: "22:00", endTime: "06:00" };
  assert.ok(appliesAt(night, ist("2026-03-02T23:30")));
  assert.ok(appliesAt(night, ist("2026-03-03T05:59")));
  assert.ok(!appliesAt(night, ist("2026-03-03T06:00")));
  assert.ok(!appliesAt(night, ist("2026-03-03T12:00")));
  // Only one of the two set: ignored (the controller refuses to save it).
  assert.ok(appliesAt({ startTime: "17:00" }, ist("2026-03-02T09:00")));
});

test("selectTariff: event beats the weekend tariff; priority beats everything", () => {
  const general = { name: "general", createdAt: "2026-01-01" };
  const weekend = { name: "weekend", daysOfWeek: [0, 6], createdAt: "2026-01-02" };
  const event = {
    name: "match", kind: "EVENT", createdAt: "2026-01-03",
    validFrom: ist("2026-03-07T00:00"), validTo: ist("2026-03-07T23:59"),
  };
  const eveningOnly = { name: "evening", kind: "EVENT", startTime: "18:00", endTime: "23:00", createdAt: "2026-01-04",
    validFrom: ist("2026-03-07T00:00"), validTo: ist("2026-03-07T23:59") };
  const all = [general, weekend, event];
  // 2026-03-07 is a Saturday: the weekend tariff is more specific, but the event wins.
  assert.equal(selectTariff(all, ist("2026-03-07T10:00")).name, "match");
  assert.equal(selectTariff(all, ist("2026-03-08T10:00")).name, "weekend");
  // Two events: the one with the time window is more specific.
  assert.equal(selectTariff([...all, eveningOnly], ist("2026-03-07T19:00")).name, "evening");
  assert.equal(selectTariff([...all, eveningOnly], ist("2026-03-07T10:00")).name, "match");
  // Explicit priority overrides the kind.
  const boosted = { ...general, name: "boosted", priority: 10 };
  assert.equal(selectTariff([...all, boosted], ist("2026-03-07T10:00")).name, "boosted");
});

test("tariffProblem: what may be saved", () => {
  const ok = { slabs: [{ uptoMinutes: 60, rate: 20 }] };
  assert.equal(tariffProblem(ok), null);
  assert.equal(tariffProblem({ flatFee: 0 }), null);
  assert.match(tariffProblem({}), /slab, an hourly rate or a flat fee/);
  assert.match(tariffProblem({ ...ok, startTime: "10:00" }), /both the start and the end/);
  assert.match(tariffProblem({ ...ok, startTime: "10:00", endTime: "10:00" }), /cannot be the same/);
  assert.match(tariffProblem({ ...ok, longStayAfterMinutes: 600 }), /Long stay needs both/);
  assert.match(tariffProblem({ ...ok, kind: "EVENT" }), /name/);
  assert.match(tariffProblem({ ...ok, kind: "EVENT", eventName: "Match" }), /start and an end date/);
  assert.equal(
    tariffProblem({ ...ok, kind: "EVENT", eventName: "Match", validFrom: "2026-03-07", validTo: "2026-03-08" }),
    null
  );
  assert.match(
    tariffProblem({ ...ok, validFrom: "2026-03-08", validTo: "2026-03-07" }),
    /after valid-from/
  );
});
