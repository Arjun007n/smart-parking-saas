// Security hardening of subscriptions: the old company-wide plan no longer grants every paid add-on to NEW
// purchases, and an update quoted before a renewal is not applied after it. No database: models are stubbed.
process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const subs = require("../services/subscriptionService");
const Company = require("../models/Company");
const Location = require("../models/Location");
const PlanOrder = require("../models/PlanOrder");
const Subscription = require("../models/Subscription");
const Notification = require("../models/Notification");
const audit = require("../services/auditService");

const DAY = 86400000;
const future = (days) => new Date(Date.now() + days * DAY);

// Stubs of the model calls the service makes. `state` holds the "database".
const stub = (state) => {
  const originals = {
    exists: PlanOrder.exists, subFind: Subscription.find, subExists: Subscription.exists, coFind: Company.findById, locFind: Location.find,
    count: Subscription.countDocuments, create: Subscription.create, subFindById: Subscription.findById, orderUpdate: PlanOrder.updateOne,
    orderFind: PlanOrder.find, notifCreate: Notification.create, record: audit.record,
  };
  PlanOrder.exists = async (filter) => state.orders.some((o) => {
    if (filter.addons && filter.addons.$exists === false && o.addons) return false;
    return o.status === filter.status;
  });
  Subscription.find = async () => [];
  Subscription.exists = async (filter) => (filter.legacy === false ? false : state.subs.some((s) => String(s.locationId) === String(filter.locationId)));
  Company.findById = () => ({ select: () => ({ lean: async () => state.company }) });
  Location.find = () => ({ select: () => ({ lean: async () => state.locations }) });
  Subscription.countDocuments = async () => state.subs.length;
  Subscription.create = async (doc) => { state.subs.push(doc); return doc; };
  Notification.create = async (doc) => { state.notifications.push(doc); const e = new Error("dup"); e.code = 11000; throw e; };
  audit.record = async (_req, action) => { state.audits.push(action); };
  return () => {
    PlanOrder.exists = originals.exists; Subscription.find = originals.subFind; Subscription.exists = originals.subExists;
    Company.findById = originals.coFind; Location.find = originals.locFind; Subscription.countDocuments = originals.count;
    Subscription.create = originals.create; Subscription.findById = originals.subFindById; PlanOrder.updateOne = originals.orderUpdate;
    PlanOrder.find = originals.orderFind; Notification.create = originals.notifCreate; audit.record = originals.record;
  };
};

const activeCompany = { _id: "c1", code: "AC", subscriptionStatus: "ACTIVE", subscription: { currentPeriodEnd: future(100) }, plan: { maxUsers: 5 }, createdAt: new Date() };
const NEW_PLAN_ORDER = { status: "PAID", addons: { pass: false } };
const OLD_PLAN_ORDER = { status: "PAID" };

test("a location with no subscription of its own, under a NEW company-wide paid plan, gets no paid add-ons", async () => {
  const state = { orders: [NEW_PLAN_ORDER], subs: [], company: activeCompany, locations: [], notifications: [], audits: [] };
  const restore = stub(state);
  try {
    const ent = await subs.entitlement("c1", "l1");
    assert.equal(ent.state, "ACTIVE");
    assert.equal(ent.source, "COMPANY");
    assert.equal(ent.addons.pass, false);
    assert.equal(ent.addons.gateway, false);
    assert.equal(ent.addons.anpr, 0);
    await assert.rejects(() => subs.assertAddon("c1", "l1", "pass"), /not in this location's subscription/);
  } finally { restore(); }
});

test("an existing company on the earlier plan (orders without the mark) keeps every add-on exactly as before", async () => {
  for (const orders of [[OLD_PLAN_ORDER], [OLD_PLAN_ORDER, NEW_PLAN_ORDER], []]) {
    const state = { orders, subs: [], company: activeCompany, locations: [], notifications: [], audits: [] };
    const restore = stub(state);
    try {
      const ent = await subs.entitlement("c1", "l1");
      assert.equal(ent.state, "ACTIVE");
      assert.equal(ent.addons.pass, true);
      assert.equal(ent.addons.anpr, Infinity);
      assert.equal(ent.addons.gateway, true);
    } finally { restore(); }
  }
});

test("the free trial still has every add-on", async () => {
  const state = { orders: [], subs: [], company: { _id: "c1", subscriptionStatus: "TRIAL", trialEndsAt: future(5) }, locations: [], notifications: [], audits: [] };
  const restore = stub(state);
  try {
    const ent = await subs.entitlement("c1", "l1");
    assert.equal(ent.addons.pass, true);
    assert.equal(ent.addons.anpr, Infinity);
  } finally { restore(); }
});

test("grandfathering a new company-wide plan makes location subscriptions without the paid add-ons; old plans and trials as before", async () => {
  const run = async (company, orders) => {
    const state = { orders, subs: [], company, locations: [{ _id: "l1", name: "Main", userLicence: { limit: 4 } }], notifications: [], audits: [] };
    const restore = stub(state);
    try {
      assert.equal(await subs.grandfather(company), 1);
      return state.subs[0];
    } finally { restore(); }
  };
  const fresh = await run(activeCompany, [NEW_PLAN_ORDER]);
  assert.equal(fresh.legacy, true);
  assert.equal(fresh.users, 4, "the users are kept");
  assert.deepEqual({ ...fresh.addons }, { pass: false, photo: false, anpr: 0, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 });
  const old = await run(activeCompany, [OLD_PLAN_ORDER]);
  assert.deepEqual({ ...old.addons }, { pass: true, photo: true, anpr: 1000, fastag: 1000, gateway: true, dataBackup: 12, photoBackup: 12 });
  const trial = await run({ ...activeCompany, subscriptionStatus: "TRIAL", trialEndsAt: future(5) }, [NEW_PLAN_ORDER]);
  assert.equal(trial.addons.pass, true, "a trial always has everything");
});

test("an UPDATE order is stale when the subscription's end date changed since the quote", () => {
  const end = future(10);
  const order = { _id: "o1", kind: "UPDATE", quotedPeriodEnd: end };
  assert.equal(subs.isStaleUpdate(order, { periodEnd: new Date(end.getTime()) }), false);
  assert.equal(subs.isStaleUpdate(order, { periodEnd: future(375) }), true);
  // already applied: a repeat of the payment result must not turn into "stale" after a later renewal
  assert.equal(subs.isStaleUpdate(order, { periodEnd: future(375), appliedOrders: ["o1"] }), false);
  // orders made before this rule have no quoted end date: applied as before
  assert.equal(subs.isStaleUpdate({ _id: "o2", kind: "UPDATE" }, { periodEnd: future(375) }), false);
  assert.equal(subs.isStaleUpdate({ _id: "o3", kind: "RENEWAL", quotedPeriodEnd: end }, { periodEnd: future(375) }), false);
});

test("a paid UPDATE order quoted before a renewal is marked superseded and not applied; the admins are alerted", async () => {
  const state = { orders: [], subs: [], company: activeCompany, locations: [], notifications: [], audits: [], updates: [], applied: 0 };
  const restore = stub(state);
  const chain = (v) => ({ select: () => ({ lean: async () => v }) });
  Subscription.findById = () => chain({ _id: "s1", periodEnd: future(375), appliedOrders: [], locationId: "l1" });
  PlanOrder.updateOne = async (filter, change) => { state.updates.push(change.$set); return { modifiedCount: 1 }; };
  const realUpdate = Subscription.updateOne;
  Subscription.updateOne = async () => { state.applied += 1; return { modifiedCount: 1 }; };
  try {
    const order = {
      _id: "o1", companyId: "c1", locationId: "l1", subscriptionId: "s1", kind: "UPDATE", orderNumber: "ORN1", total: 100, users: 99,
      quotedPeriodEnd: future(10), addons: { resulting: { anpr: 100 } },
    };
    const result = await subs.applyOrder(order, activeCompany);
    assert.deepEqual(result, { superseded: true });
    assert.equal(state.applied, 0, "the subscription was not changed");
    assert.equal(state.updates[0].superseded, true);
    assert.deepEqual(state.audits, ["SUBSCRIPTION_ORDER_SUPERSEDED"]);
    assert.equal(state.notifications[0].type, "PAYMENT_ISSUE");
    assert.equal(state.notifications[0].dedupeKey, "plan-superseded:o1");
  } finally {
    Subscription.updateOne = realUpdate;
    restore();
  }
});

test("applying a renewal closes the open UPDATE orders of that subscription", async () => {
  const state = { orders: [], subs: [], company: activeCompany, locations: [], notifications: [], audits: [], updates: [] };
  const restore = stub(state);
  const realUpdate = Subscription.updateOne;
  const realFindById = Subscription.findById;
  const realCompanyUpdate = Company.updateOne;
  const periodEnd = future(10);
  Subscription.findById = () => ({ periodEnd, periodStart: new Date(), then(resolve) { resolve({ _id: "s1", periodEnd, periodStart: new Date() }); } });
  Subscription.updateOne = async () => ({ modifiedCount: 1 });
  Company.updateOne = async () => ({});
  PlanOrder.find = async () => [{ _id: "u1", provider: "simulated", status: "PENDING" }, { _id: "u2", provider: "simulated", status: "PENDING" }];
  PlanOrder.updateOne = async (filter, change) => { state.updates.push({ filter, set: change.$set }); return { modifiedCount: 1 }; };
  // refreshCompany reads live subscriptions: none, so it returns early
  Subscription.find = () => ({ select: () => ({ lean: async () => [] }) });
  Company.findById = () => ({ select: () => ({ lean: async () => activeCompany }) });
  try {
    await subs.applyOrder({ _id: "r1", companyId: "c1", locationId: "l1", subscriptionId: "s1", kind: "RENEWAL", months: 12, periodStart: periodEnd, periodEnd: future(375) }, activeCompany);
    assert.deepEqual(state.updates.map((u) => u.filter._id), ["u1", "u2"]);
    assert.ok(state.updates.every((u) => u.set.status === "CANCELLED"));
  } finally {
    Subscription.updateOne = realUpdate; Subscription.findById = realFindById; Company.updateOne = realCompanyUpdate;
    restore();
  }
});
