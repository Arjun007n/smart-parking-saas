// Per-location subscriptions: prices, quotes for buying / renewing / adding to a subscription, what a
// subscription allows, and its state. No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");

const { ADDONS } = require("../config/addons");
const subs = require("../services/subscriptionService");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T06:00:00Z");
const prices = ADDONS.map((a) => ({ ...a }));
const withPrice = (key, price) => prices.map((a) => (a.key === key ? { ...a, price } : a));
const status = (code) => (error) => error.statusCode === code || error.status === code;

const bought = (extra = {}) => ({
  status: "ACTIVE", users: 5, periodStart: new Date(NOW.getTime() - 15 * DAY), periodEnd: new Date(NOW.getTime() + 15 * DAY),
  addons: { pass: true, photo: false, anpr: 1, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 },
  ...extra,
});

const addUp = (q) => {
  assert.equal(Math.round(q.lines.reduce((s, l) => s + l.amount, 0) * 100), Math.round(q.subtotal * 100), "lines add up to the sub total");
  assert.equal(Math.round(q.lines.reduce((s, l) => s + l.taxable, 0) * 100), Math.round(q.gross * 100), "taxable values add up to the gross");
  assert.equal(Math.round((q.cgst + q.sgst) * 100), Math.round(q.gst * 100), "CGST + SGST is the GST");
  assert.equal(Math.round((q.gross + q.gst) * 100), Math.round(q.total * 100), "total is gross + GST");
};

test("the add-on list has the seven add-ons with their starting prices", () => {
  assert.deepEqual(ADDONS.map((a) => [a.key, a.price]), [
    ["pass", 250], ["photo", 500], ["anpr", 500], ["fastag", 500], ["gateway", 300], ["dataBackup", 200], ["photoBackup", 800],
  ]);
});

test("add-on choices are checked and completed", () => {
  const clean = subs.cleanAddons({ pass: "true", anpr: "2" });
  assert.deepEqual(clean, { pass: true, photo: false, anpr: 2, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 });
  assert.throws(() => subs.cleanAddons({ anpr: -1 }), status(400));
  assert.throws(() => subs.cleanAddons({ fastag: 1.5 }), status(400));
  assert.throws(() => subs.cleanAddons({ dataBackup: 2 }), /choose 1, 3, 6, 12/);
  assert.throws(() => subs.cleanAddons({ photoBackup: 5 }), status(400));
});

test("a new subscription: users x months plus the add-ons, GST on top", () => {
  const q = subs.quoteNew({ users: 10, months: 1, addons: { pass: true, photo: true, photoBackup: 1 } }, prices);
  // 10 x 499 + 250 + 500 + 800 = 6540, no discount for one month; 18% GST = 1177.20
  assert.equal(q.subtotal, 6540);
  assert.equal(q.discount, 0);
  assert.equal(q.gst, 1177.2);
  assert.equal(q.total, 7717.2);
  assert.deepEqual(q.lines.map((l) => l.key), ["users", "pass", "photo", "dataBackup", "photoBackup"]);
  assert.equal(q.lines.find((l) => l.key === "dataBackup").amount, 0, "the first month of data backup is free");
  addUp(q);
});

test("a longer plan gets the tenure discount on everything, shared over the lines", () => {
  const q = subs.quoteNew({ users: 5, months: 12, addons: { pass: true, anpr: 2 } }, prices);
  // (5 x 499 + 250 + 2 x 500) x 12 = 45,  = 3745 x 12 = 44940; 20% off
  assert.equal(q.subtotal, 44940);
  assert.equal(q.discountPercent, 20);
  assert.equal(q.discount, 8988);
  assert.equal(q.gross, 35952);
  addUp(q);
  const odd = subs.quoteNew({ users: 3, months: 3, addons: { pass: true, photo: true, gateway: true } }, prices);
  assert.equal(odd.discountPercent, 5);
  addUp(odd);
});

test("a changed price (Super Admin) is used by the quote", () => {
  const q = subs.quoteNew({ users: 1, months: 1, addons: { pass: true } }, withPrice("pass", 300));
  assert.equal(q.lines.find((l) => l.key === "pass").rate, 300);
  assert.equal(q.subtotal, 499 + 300);
});

test("a new subscription needs sensible users and a plan length that is offered", () => {
  assert.throws(() => subs.quoteNew({ users: 0, months: 1, addons: {} }, prices), status(400));
  assert.throws(() => subs.quoteNew({ users: 501, months: 1, addons: {} }, prices), status(400));
  assert.throws(() => subs.quoteNew({ users: 2.5, months: 1, addons: {} }, prices), status(400));
  assert.throws(() => subs.quoteNew({ users: 2, months: 7, addons: {} }, prices), /plan lengths/);
});

test("a renewal prices what the subscription already has", () => {
  const q = subs.quoteRenew(bought(), 6, prices);
  // (5 x 499 + 250 + 500) x 6 = 3245 x 6 = 19470; 10% off
  assert.equal(q.users, 5);
  assert.equal(q.subtotal, 19470);
  assert.equal(q.discount, 1947);
  assert.equal(q.addons.anpr, 1);
  addUp(q);
  assert.throws(() => subs.quoteRenew(bought(), 5, prices), status(400));
});

test("adding users and add-ons part-way charges the days left, with no tenure discount", () => {
  const q = subs.quoteUpdate(bought(), { addUsers: 2, gateway: true }, prices, NOW);
  assert.equal(q.daysLeft, 15);
  // half a month: 2 x 499 x 0.5 = 499 and 300 x 0.5 = 150
  assert.equal(q.subtotal, 649);
  assert.equal(q.discount, 0);
  assert.equal(q.users, 7);
  assert.equal(q.addons.gateway, true);
  assert.deepEqual(q.extra, { users: 2, gateway: true });
  addUp(q);
});

test("more cameras and longer backups are charged for the extra only", () => {
  const q = subs.quoteUpdate(bought({ addons: { pass: true, photo: false, anpr: 1, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 } }),
    { addAnpr: 2, dataBackup: 3, photoBackup: 3 }, prices, NOW);
  assert.equal(q.addons.anpr, 3);
  assert.equal(q.addons.dataBackup, 3);
  assert.equal(q.addons.photoBackup, 3);
  // anpr 2 x 500 x .5 = 500; data backup (3 - 1 free) = 2 x 200 x .5 = 200; photo backup 3 x 800 x .5 = 1200
  assert.equal(q.subtotal, 1900);
  addUp(q);
});

test("adding what is already there, or nothing at all, is refused", () => {
  assert.throws(() => subs.quoteUpdate(bought(), {}, prices, NOW), /Choose something to add/);
  assert.throws(() => subs.quoteUpdate(bought(), { pass: true }, prices, NOW), /Choose something to add/);
  assert.throws(() => subs.quoteUpdate(bought(), { addUsers: 0, dataBackup: 1 }, prices, NOW), /Choose something to add/);
});

test("a backup cannot be shortened mid-period, and only offered lengths are taken", () => {
  const long = bought({ addons: { pass: true, photo: false, anpr: 0, fastag: 0, gateway: false, dataBackup: 6, photoBackup: 3 } });
  assert.throws(() => subs.quoteUpdate(long, { dataBackup: 3 }, prices, NOW), /cannot be shortened/);
  assert.throws(() => subs.quoteUpdate(long, { photoBackup: 1 }, prices, NOW), /cannot be shortened/);
  assert.throws(() => subs.quoteUpdate(long, { photoBackup: 4 }, prices, NOW), status(400));
});

test("users cannot go past the most a subscription may have", () => {
  assert.throws(() => subs.quoteUpdate(bought({ users: 499 }), { addUsers: 2 }, prices, NOW), /at most 500/);
});

test("an ended, cancelled or not-yet-started subscription cannot be added to", () => {
  const ended = bought({ periodEnd: new Date(NOW.getTime() - DAY) });
  assert.throws(() => subs.quoteUpdate(ended, { addUsers: 1 }, prices, NOW), status(409));
  assert.throws(() => subs.quoteUpdate(bought({ status: "CANCELLED" }), { addUsers: 1 }, prices, NOW), status(409));
  const later = bought({ periodStart: new Date(NOW.getTime() + 5 * DAY), periodEnd: new Date(NOW.getTime() + 35 * DAY) });
  assert.throws(() => subs.quoteUpdate(later, { addUsers: 1 }, prices, NOW), /not started yet/);
});

test("when two subscriptions run at a location the best of each add-on counts", () => {
  const merged = subs.mergeAddons([
    { addons: { pass: true, photo: false, anpr: 1, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 } },
    { addons: { pass: false, photo: true, anpr: 3, fastag: 2, gateway: false, dataBackup: 6, photoBackup: 1 } },
  ]);
  assert.deepEqual(merged, { pass: true, photo: true, anpr: 3, fastag: 2, gateway: false, dataBackup: 6, photoBackup: 1 });
  assert.deepEqual(subs.mergeAddons([]), { pass: false, photo: false, anpr: 0, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 });
});

test("a subscription is active, upcoming, expired or cancelled", () => {
  assert.equal(subs.stateOf(bought(), NOW), "ACTIVE");
  assert.equal(subs.stateOf(bought({ periodEnd: new Date(NOW.getTime() - 1) }), NOW), "EXPIRED");
  assert.equal(subs.stateOf(bought({ periodStart: new Date(NOW.getTime() + DAY) }), NOW), "UPCOMING");
  assert.equal(subs.stateOf(bought({ status: "CANCELLED" }), NOW), "CANCELLED");
});

test("with no subscription of its own a location follows the free trial or the old plan", () => {
  const future = new Date(NOW.getTime() + 3 * DAY);
  const past = new Date(NOW.getTime() - DAY);
  assert.equal(subs.companyAllows({ subscriptionStatus: "TRIAL", trialEndsAt: future }, NOW), true);
  assert.equal(subs.companyAllows({ subscriptionStatus: "TRIAL", trialEndsAt: past }, NOW), false);
  assert.equal(subs.companyAllows({ subscriptionStatus: "ACTIVE", subscription: { currentPeriodEnd: future } }, NOW), true);
  assert.equal(subs.companyAllows({ subscriptionStatus: "ACTIVE", subscription: { currentPeriodEnd: past } }, NOW), false);
  assert.equal(subs.companyAllows({ subscriptionStatus: "EXPIRED" }, NOW), false);
  assert.equal(subs.companyAllows(null, NOW), false);
});
