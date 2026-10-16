// Security fixes: environment modes, developer extras, fee rules, user takeover rule, wallet rule, password policy.
process.env.NODE_ENV = "test";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const env = require("../config/env");
const { devAccess, isLoopbackAddress } = require("../utils/devAccess");
const { lowersFee, reEntryNeedsSupervisor, reEntryGraceMinutes } = require("../utils/feeRules");
const { targetWithinLocations } = require("../utils/userRules");
const { isCommonPassword, assertNotCommon } = require("../utils/passwordPolicy");
const wallets = require("../services/walletService");
const simulatedPayment = require("../integrations/payment/providers/simulated");
const fastag = require("../integrations/fastag");

const withMode = (value, fn) => {
  const saved = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try { return fn(); } finally { process.env.NODE_ENV = saved; }
};

test("SP-12: only development and test are developer modes; anything else, or nothing, is production", () => {
  for (const [mode, production] of [["production", true], ["development", false], ["test", false], ["staging", true], [undefined, true], ["", true]]) {
    assert.equal(withMode(mode, () => env.isProduction), production, String(mode));
    assert.equal(withMode(mode, () => env.isDevLike), !production, String(mode));
  }
});

test("SP-12: an unknown NODE_ENV stops the server; an unset one gets the production checks", () => {
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://x";
  process.env.JWT_SECRET = "s".repeat(40);
  process.env.CLIENT_URL = "https://app.example.com";
  assert.throws(() => withMode("staging", () => env.validateEnv()), /NODE_ENV "staging" is not known/);
  // Unset counts as production: a short secret is refused.
  process.env.JWT_SECRET = "short-secret-of-26-chars-ab";
  assert.throws(() => withMode(undefined, () => env.validateEnv()), /at least 32 characters/);
  assert.throws(() => withMode("production", () => env.validateEnv()), /at least 32 characters/);
  process.env.JWT_SECRET = "password".padEnd(40, "x");
  assert.throws(() => withMode("production", () => env.validateEnv()), /well-known weak value/);
  process.env.JWT_SECRET = "s".repeat(40);
});

test("SP-12: the payment and FASTag simulators exist only in development or test", () => {
  assert.equal(withMode("test", () => simulatedPayment.isConfigured()), true);
  assert.equal(withMode("development", () => simulatedPayment.isConfigured()), true);
  for (const mode of ["production", "staging", undefined]) {
    assert.equal(withMode(mode, () => simulatedPayment.isConfigured()), false, String(mode));
    assert.equal(withMode(mode, () => fastag.PROVIDERS.simulated.isConfigured()), false, String(mode));
  }
});

test("SP-01: developer extras go only to the developer at this computer", () => {
  const local = (address) => ({ socket: { remoteAddress: address } });
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(a), true, a);
    assert.equal(withMode("development", () => devAccess(local(a))), true, a);
  }
  for (const a of ["192.168.1.20", "10.0.2.2", "::ffff:192.168.1.8", "203.0.113.9", undefined]) {
    assert.equal(withMode("development", () => devAccess(local(a))), false, String(a));
  }
  // A header cannot change this.
  assert.equal(withMode("development", () => devAccess({ socket: { remoteAddress: "192.168.1.20" }, headers: { "x-forwarded-for": "127.0.0.1" } })), false);
  // Production never has extras, even from this computer.
  assert.equal(withMode("production", () => devAccess(local("127.0.0.1"))), false);
  assert.equal(withMode(undefined, () => devAccess(local("127.0.0.1"))), false);
});

test("SP-04/05: re-entry grace and fee reductions", () => {
  assert.equal(reEntryGraceMinutes(), 30);
  const now = Date.now();
  assert.equal(reEntryNeedsSupervisor(new Date(now - 5 * 60000), now), false);
  assert.equal(reEntryNeedsSupervisor(new Date(now - 30 * 60000), now), false);
  assert.equal(reEntryNeedsSupervisor(new Date(now - 31 * 60000), now), true);
  assert.equal(reEntryNeedsSupervisor(undefined, now), true, "unknown age needs a supervisor");
  process.env.REENTRY_GRACE_MINUTES = "120";
  assert.equal(reEntryNeedsSupervisor(new Date(now - 90 * 60000), now), false);
  delete process.env.REENTRY_GRACE_MINUTES;
  assert.equal(lowersFee(0, 60), true);
  assert.equal(lowersFee(20, 60), true);
  assert.equal(lowersFee(60, 60), false);
  assert.equal(lowersFee(60.003, 60), false);
  assert.equal(lowersFee(80, 60), false, "charging more is allowed");
});

test("SP-03: a user with another location is outside a location admin's reach", () => {
  assert.equal(targetWithinLocations(["a", "b"], ["a"]), true);
  assert.equal(targetWithinLocations(["a"], ["a", "b"]), false);
  assert.equal(targetWithinLocations(["a"], ["b"]), false);
  assert.equal(targetWithinLocations([], ["a"]), false);
  assert.equal(targetWithinLocations(["a"], ["a"]), true);
  assert.equal(targetWithinLocations(["507f1f77bcf86cd799439011"], [{ toString: () => "507f1f77bcf86cd799439011" }]), true);
});

test("SP-02: a wallet pays for its own vehicles; others need a supervisor", () => {
  const wallet = { vehicles: ["RJ14AB1234"] };
  assert.deepEqual(wallets.mayPayFor(wallet, "RJ14AB1234"), { ok: true, linked: true });
  assert.deepEqual(wallets.mayPayFor(wallet, "RJ14ZZ9999"), { ok: false, linked: false });
  assert.deepEqual(wallets.mayPayFor(wallet, "RJ14ZZ9999", { allowUnlinked: true }), { ok: true, linked: false });
  assert.deepEqual(wallets.mayPayFor(null, "RJ14AB1234"), { ok: false, linked: false });
  assert.deepEqual(wallets.mayPayFor({}, "RJ14AB1234"), { ok: false, linked: false });
});

test("SP-44: the most common passwords are refused, ordinary ones are fine", () => {
  for (const bad of ["12345678", "password", "qwerty123", "aaaaaaaa", "23456789", "11111111"]) assert.equal(isCommonPassword(bad), true, bad);
  for (const good of ["Password123", "RootPassword123", "correct-horse-9", "Tr0ub4dor&3"]) assert.equal(isCommonPassword(good), false, good);
  assert.throws(() => assertNotCommon("12345678"), /too easy to guess/);
  assert.doesNotThrow(() => assertNotCommon("Password123"));
});
