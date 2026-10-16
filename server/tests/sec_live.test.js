// Live stream hardening (no database): events without a company are heard by nobody, a per-company cap, places
// kept for gate agents, and open streams being checked again (account switched off, locations changed).
process.env.NODE_ENV = "test";
process.env.LIVE_MAX_STREAMS = "10";
process.env.LIVE_MAX_PER_COMPANY = "3";
process.env.LIVE_DEVICE_RESERVE = "4";
process.env.LIVE_RECHECK_MS = "600000";

const test = require("node:test");
const assert = require("node:assert/strict");
const hub = require("../services/liveHub");

const C1 = "64b000000000000000000001";
const C2 = "64b000000000000000000002";
const L1 = "64b0000000000000000000a1";
const L2 = "64b0000000000000000000a2";

// A request / response pair that records what was written and whether the stream was ended.
const fake = () => {
  const res = {
    text: "", ended: false, writableEnded: false, destroyed: false, handlers: {},
    status() { return res; },
    set() { return res; },
    flushHeaders() {},
    write(t) { res.text += t; return true; },
    on(name, fn) { res.handlers[name] = fn; },
    end() { res.ended = true; res.writableEnded = true; },
  };
  const req = { socket: { setTimeout() {}, setNoDelay() {} } };
  return { req, res };
};
const person = (userId, companyId, extra = {}) => {
  const { req, res } = fake();
  const client = hub.addPerson(req, res, { userId, companyId, locationIds: null, ...extra });
  return { client, res };
};

test.afterEach(() => hub.closeAll());

test("SP-18: an event that does not name a company is heard by nobody", () => {
  const screen = { companyId: C1, locationIds: null };
  assert.equal(hub.hears(screen, { locationId: L1 }), false);
  assert.equal(hub.hears(screen, {}), false);
  assert.equal(hub.hears(screen, undefined), false);
  assert.equal(hub.hears({ companyId: null, locationIds: null }, { locationId: L1 }), false, "not even a platform admin screen");
  assert.equal(hub.hears(screen, { companyId: C1 }), true);
  assert.equal(hub.hears({ companyId: null, locationIds: null }, { companyId: C2 }), true, "a platform admin screen still hears every company's events");
  assert.equal(hub.hears({ companyId: C1, locationIds: [L1] }, { companyId: C1, locationId: L2 }), false);
  assert.equal(hub.broadcast({ type: "x" }, { type: "x" }), 0);
});

test("SP-19: one company cannot use more than its share of screen streams", () => {
  assert.equal(hub.MAX_PER_COMPANY, 3);
  const mine = [person("u1", C1), person("u2", C1), person("u3", C1)];
  assert.ok(mine.every((p) => p.client));
  assert.equal(person("u4", C1).client, null, "the 4th stream of the same company is refused");
  assert.ok(person("u5", C2).client, "another company is not affected");
  assert.equal(hub.stats().people, 4);
  // A stream that closes frees its place.
  mine[0].res.handlers.close();
  assert.ok(person("u6", C1).client);
});

test("SP-19: screens can never take the places kept for gate agents", () => {
  assert.equal(hub.MAX_TOTAL, 10);
  assert.equal(hub.DEVICE_RESERVE, 4);
  let opened = 0;
  for (let i = 0; i < 20; i += 1) if (person(`p${i}`, `64b0000000000000000001${String(i).padStart(2, "0")}`).client) opened += 1;
  assert.equal(opened, 6, "screens stop at MAX_TOTAL - reserve");
  for (let i = 0; i < 4; i += 1) {
    const { req, res } = fake();
    assert.ok(hub.addDevice(req, res, `64b0000000000000000002${String(i).padStart(2, "0")}`), `device ${i} still gets a place`);
  }
  const { req, res } = fake();
  assert.equal(hub.addDevice(req, res, "64b000000000000000000299"), null, "the pool is full for devices too");
  assert.deepEqual(hub.stats(), { people: 6, devices: 4 });
});

test("SP-18: an open stream whose person was switched off is closed at the next check; others stay", async () => {
  const gone = person("u1", C1, { recheck: async () => false });
  const fine = person("u2", C1, { recheck: async () => true });
  const noCheck = person("u3", C1);
  await hub.sweepPeople(Date.now() + 1000);
  assert.equal(gone.res.ended, false, "not due yet: checked every 10 minutes");
  await hub.sweepPeople(Date.now() + hub.RECHECK_MS + 1000);
  assert.equal(gone.res.ended, true);
  assert.equal(fine.res.ended, false);
  assert.equal(noCheck.res.ended, false);
  assert.equal(hub.stats().people, 2);
});

test("SP-18: a check that fails (database down) keeps the stream and tries again next time", async () => {
  let calls = 0;
  const p = person("u1", C1, { recheck: async () => { calls += 1; if (calls === 1) throw new Error("db down"); return false; } });
  const later = Date.now() + hub.RECHECK_MS + 1000;
  await hub.sweepPeople(later);
  assert.equal(p.res.ended, false);
  await hub.sweepPeople(later + 1000);
  assert.equal(p.res.ended, false, "not due again straight away");
  await hub.sweepPeople(later + hub.RECHECK_MS + 2000);
  assert.equal(p.res.ended, true);
});

test("SP-18: a check can change the locations a screen hears", async () => {
  const p = person("u1", C1, { locationIds: [L1], recheck: async () => ({ locationIds: [L2] }) });
  assert.equal(hub.hears(p.client, { companyId: C1, locationId: L1 }), true);
  await hub.sweepPeople(Date.now() + hub.RECHECK_MS + 1000);
  assert.equal(hub.hears(p.client, { companyId: C1, locationId: L1 }), false, "no longer allowed there");
  assert.equal(hub.hears(p.client, { companyId: C1, locationId: L2 }), true);
});

test("SP-18: closeUser ends every stream of one person only", () => {
  const a1 = person("u1", C1);
  const a2 = person("u1", C1);
  const b = person("u2", C1);
  assert.equal(hub.closeUser("u1"), 2);
  assert.ok(a1.res.ended && a2.res.ended);
  assert.equal(b.res.ended, false);
  assert.equal(hub.closeUser("nobody"), 0);
});

test("SP-18: the re-check reads the person again: switched off, signed out everywhere, company suspended, locations changed", async () => {
  const User = require("../models/User");
  const Company = require("../models/Company");
  const { recheckFor } = require("../controllers/liveController");
  const originalUser = User.findById;
  const originalCompany = Company.findById;
  let user;
  let company = { isActive: true, subscriptionStatus: "ACTIVE" };
  User.findById = () => ({ select: async () => user });
  Company.findById = () => ({ select: async () => company });
  const connected = { _id: "u1", tokenVersion: 3 };
  try {
    user = { isActive: true, tokenVersion: 3, role: "LOCATION_ADMIN", companyId: C1, locationIds: [L1, L2] };
    assert.deepEqual(await recheckFor(connected)(), { locationIds: [L1, L2] });
    assert.deepEqual(await recheckFor(connected, L1)(), { locationIds: [L1] }, "a screen narrowed to one location stays narrowed");

    user = { ...user, locationIds: [L2] };
    assert.equal(await recheckFor(connected, L1)(), false, "no longer allowed at the location it watches");
    assert.deepEqual(await recheckFor(connected)(), { locationIds: [L2] });

    user = { ...user, role: "COMPANY_ADMIN" };
    assert.deepEqual(await recheckFor(connected)(), { locationIds: null });

    assert.equal(await recheckFor({ _id: "u1", tokenVersion: 2 })(), false, "token version changed (signed out everywhere)");
    user = { ...user, isActive: false };
    assert.equal(await recheckFor(connected)(), false);
    user = null;
    assert.equal(await recheckFor(connected)(), false);

    user = { isActive: true, tokenVersion: 3, role: "COMPANY_ADMIN", companyId: C1, locationIds: [] };
    company = { isActive: false, subscriptionStatus: "ACTIVE" };
    assert.equal(await recheckFor(connected)(), false);
    company = { isActive: true, subscriptionStatus: "SUSPENDED" };
    assert.equal(await recheckFor(connected)(), false);
    user = { ...user, role: "SUPER_ADMIN", companyId: undefined };
    assert.deepEqual(await recheckFor(connected)(), { locationIds: null }, "the platform admin has no company to check");
  } finally {
    User.findById = originalUser;
    Company.findById = originalCompany;
  }
});
