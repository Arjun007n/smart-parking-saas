// Unit tests for Week 4 helpers that need no database.
process.env.NODE_ENV = "test";
process.env.APP_UTC_OFFSET_MINUTES = "330";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toCsv } = require("../utils/csv");
const { rangeFromQuery, timezoneString, localDateText } = require("../utils/time");
const { reconcile } = require("../services/collectionService");
const { capacityLevel } = require("../services/notificationService");
const { EVENTS, publish, subscribe, rooms } = require("../services/eventBus");
const { sendExternal, channels } = require("../integrations/notifications");

test("csv: quoting, empty values and dates", () => {
  const csv = toCsv(
    [{ key: "a", label: "Name" }, { key: "b", label: "Note, with comma" }, { key: "c", label: "When" }],
    [
      { a: 'He said "hi"', b: "line1\nline2", c: new Date("2026-03-02T04:30:00Z") },
      { a: null, b: undefined, c: 0 },
    ]
  );
  assert.equal(
    csv,
    'Name,"Note, with comma",When\r\n"He said ""hi""","line1\nline2",2026-03-02T04:30:00.000Z\r\n,,0'
  );
});

test("csv: text that a spreadsheet would run as a formula is neutralised", () => {
  const csv = toCsv([{ key: "v", label: "V" }], [
    { v: "=HYPERLINK(\"http://evil\")" }, { v: "+1+1" }, { v: "-2" }, { v: "@SUM(A1)" }, { v: -5 }, { v: "RJ14AB1234" },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[1], '"\'=HYPERLINK(""http://evil"")"');
  assert.equal(lines[2], "'+1+1");
  assert.equal(lines[3], "'-2");
  assert.equal(lines[4], "'@SUM(A1)");
  assert.equal(lines[5], "-5"); // a real negative number is kept as a number
  assert.equal(lines[6], "RJ14AB1234");
});

test("rangeFromQuery: local dates, both ends included, with limits", () => {
  const range = rangeFromQuery({ from: "2026-03-01", to: "2026-03-07" });
  assert.equal(range.start.toISOString(), "2026-02-28T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-03-07T18:30:00.000Z");
  assert.equal(range.days, 7);

  const today = rangeFromQuery({}, { now: new Date("2026-03-01T19:00:00Z") }); // already 2 March in India
  assert.equal(today.from, "2026-03-02");
  assert.equal(today.days, 1);
  assert.equal(rangeFromQuery({ from: "2026-03-05" }).days, 1); // "to" defaults to "from"

  assert.throws(() => rangeFromQuery({ from: "2026-03-07", to: "2026-03-01" }), /must not be before/);
  assert.throws(() => rangeFromQuery({ from: "2026-01-01", to: "2026-12-31" }), /at most 92 days/);
  assert.doesNotThrow(() => rangeFromQuery({ from: "2026-01-01", to: "2026-12-31" }, { maxDays: 366 }));
  assert.throws(() => rangeFromQuery({ from: "yesterday" }), /must look like/);
  assert.throws(() => rangeFromQuery({ from: ["2026-03-01"] }), /must look like/);
});

test("time zone helpers", () => {
  assert.equal(timezoneString(), "+05:30");
  assert.equal(localDateText(new Date("2026-03-01T19:00:00Z")), "2026-03-02");
  const saved = process.env.APP_UTC_OFFSET_MINUTES;
  process.env.APP_UTC_OFFSET_MINUTES = "-480";
  try {
    assert.equal(timezoneString(), "-08:00");
  } finally {
    process.env.APP_UTC_OFFSET_MINUTES = saved;
  }
});

test("shift reconciliation: expected cash and difference", () => {
  assert.deepEqual(reconcile({ openingCash: 500, cashCollected: 40, cashRefunded: 20, adjustments: 100 }), { expectedCash: 620 });
  assert.deepEqual(
    reconcile({ openingCash: 500, cashCollected: 40, cashRefunded: 20, adjustments: 100, closingCash: 610 }),
    { expectedCash: 620, difference: -10 } // short by 10
  );
  assert.equal(reconcile({ openingCash: 0, cashCollected: 100, closingCash: 150 }).difference, 50); // over
  assert.equal(reconcile({ openingCash: 100, cashCollected: 0, closingCash: 100 }).difference, 0);
  assert.equal(reconcile({ openingCash: 0.1, cashCollected: 0.2, closingCash: 0.3 }).difference, 0); // no float drift
  assert.equal(reconcile({ openingCash: 100, adjustments: -30, closingCash: 0 }).expectedCash, 70);
});

test("capacity levels", () => {
  assert.equal(capacityLevel(10, 10), "full");
  assert.equal(capacityLevel(11, 10), "full");
  assert.equal(capacityLevel(9, 10), "almost");
  assert.equal(capacityLevel(8, 10), null);
  assert.equal(capacityLevel(0, 0), null); // type not offered here
  assert.equal(capacityLevel(1, 2), null);
});

test("event bus: delivery, isolation of failing listeners, rooms", async () => {
  const seen = [];
  const original = console.error;
  console.error = () => {};
  const stop = [
    subscribe(EVENTS.ENTRY_CREATED, () => { throw new Error("broken listener"); }),
    subscribe(EVENTS.ENTRY_CREATED, async () => { throw new Error("broken async listener"); }),
    subscribe(EVENTS.ENTRY_CREATED, (payload) => seen.push(payload.ticket)),
  ];
  try {
    assert.doesNotThrow(() => publish(EVENTS.ENTRY_CREATED, { ticket: "T1" }));
    publish(EVENTS.EXIT_COMPLETED, { ticket: "T2" }); // nobody listening
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    stop.forEach((off) => off());
    console.error = original;
  }
  assert.deepEqual(seen, ["T1"]);
  publish(EVENTS.ENTRY_CREATED, { ticket: "T3" });
  assert.deepEqual(seen, ["T1"]); // unsubscribed

  assert.deepEqual(rooms({ companyId: "c1", locationId: "l1" }), ["company:c1", "location:l1"]);
  assert.deepEqual(rooms({ companyId: "c1" }), ["company:c1"]);
  assert.equal(EVENTS.OCCUPANCY_UPDATED, "parking:occupancy-updated");
});

test("external channels report 'not configured' and never throw", async () => {
  const results = await sendExternal({ title: "Test", message: "Hello" });
  assert.deepEqual(results.map((r) => r.channel), ["push"]);
  assert.ok(results.every((r) => r.sent === false && r.reason === "not configured"));
  assert.equal(channels.push.isConfigured(), false);
  assert.deepEqual(await sendExternal({}, ["carrier-pigeon"]), [{ channel: "carrier-pigeon", sent: false, reason: "not configured" }]);
});
