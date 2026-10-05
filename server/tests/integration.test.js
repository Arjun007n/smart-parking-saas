// End-to-end API tests for Week 1 (auth, RBAC, company, locations, tenant
// isolation). They need a running MongoDB.
//
//   Run:  npm test
//
// The database is taken from MONGO_URI_TEST (default:
// mongodb://127.0.0.1:27017/smart_parking_test). Its name must end with
// "_test" because everything in it is deleted before the tests run.
require("dotenv").config({ quiet: true });

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret-0123456789abcdef";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.API_RATE_LIMIT_MAX = "100000";

const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("dns");
const mongoose = require("mongoose");

const TEST_URI = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/smart_parking_test";

const app = require("../app");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { ROLES } = require("../config/permissions");

let server;
let baseUrl;
let skipReason = null;

const api = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const registerCompany = async (n) => {
  const res = await api("POST", "/api/auth/register", {
    body: {
      companyName: `Company ${n}`, name: `Admin ${n}`,
      email: `admin${n}@example.com`, password: "Password123",
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
};

const parking = (name, extra = {}) => ({
  name, address: { line1: "MG Road", city: "Jaipur" }, capacity: { car: 100, bike: 50 }, ...extra,
});

test.before(async () => {
  const dbName = new URL(TEST_URI.replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run: test database "${dbName}" must end with "_test"`);
  }
  if (TEST_URI.startsWith("mongodb+srv")) dns.setServers(["8.8.8.8", "1.1.1.1"]);
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 4000 });
  } catch (error) {
    skipReason = `MongoDB not reachable at MONGO_URI_TEST (${error.message})`;
    console.warn(`\n*** INTEGRATION TESTS SKIPPED: ${skipReason} ***\n`);
    return;
  }
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

// Wraps a test so it is reported as skipped when there is no database.
const it = (name, fn) => test(name, async (t) => (skipReason ? t.skip(skipReason) : fn(t)));

// Shared state built up by the tests, which run in order.
const s = {};

it("register creates a company and its admin, and returns a token", async () => {
  s.a = await registerCompany(1);
  s.b = await registerCompany(2);
  assert.ok(s.a.token);
  assert.equal(s.a.user.role, ROLES.COMPANY_ADMIN);
  assert.equal(s.a.user.password, undefined);
  assert.equal(s.a.company.subscriptionStatus, "TRIAL");
  assert.ok(s.a.permissions.includes("LOCATION_MANAGE"));

  const again = await api("POST", "/api/auth/register", {
    body: { companyName: "Dup", name: "Dup", email: "ADMIN1@example.com", password: "Password123" },
  });
  assert.equal(again.status, 409);
});

it("register cannot be used to choose a role or company", async () => {
  const res = await api("POST", "/api/auth/register", {
    body: {
      companyName: "Sneaky", name: "Sneaky", email: "sneaky@example.com", password: "Password123",
      role: "SUPER_ADMIN", companyId: s.a.company._id,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, ROLES.COMPANY_ADMIN);
  assert.notEqual(res.body.data.user.companyId, s.a.company._id);
});

it("login works, wrong password and bad input are rejected", async () => {
  const ok = await api("POST", "/api/auth/login", { body: { email: "admin1@example.com", password: "Password123" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.token);

  const wrong = await api("POST", "/api/auth/login", { body: { email: "admin1@example.com", password: "nope-nope" } });
  assert.equal(wrong.status, 401);
  const unknown = await api("POST", "/api/auth/login", { body: { email: "ghost@example.com", password: "Password123" } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.message, wrong.body.message);

  const injection = await api("POST", "/api/auth/login", { body: { email: { $gt: "" }, password: { $gt: "" } } });
  assert.equal(injection.status, 400);
});

it("protected routes need a valid token", async () => {
  assert.equal((await api("GET", "/api/auth/me")).status, 401);
  assert.equal((await api("GET", "/api/locations", { token: "garbage" })).status, 401);
  const me = await api("GET", "/api/auth/me", { token: s.a.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, "admin1@example.com");
});

it("company admin creates the first parking location", async () => {
  const res = await api("POST", "/api/locations", {
    token: s.a.token,
    body: parking("City Mall Parking", { companyId: s.b.company._id, occupied: { car: 99 } }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.locA1 = res.body.data;
  // companyId and occupied from the body are ignored.
  assert.equal(s.locA1.companyId, s.a.company._id);
  assert.equal(s.locA1.occupied.car, 0);
  assert.equal(s.locA1.capacity.car, 100);

  const duplicate = await api("POST", "/api/locations", { token: s.a.token, body: parking("City Mall Parking") });
  assert.equal(duplicate.status, 409);

  const invalid = await api("POST", "/api/locations", { token: s.a.token, body: { name: "X" } });
  assert.equal(invalid.status, 400);
});

it("plan limit on locations is enforced", async () => {
  const second = await api("POST", "/api/locations", { token: s.a.token, body: parking("Airport Parking") });
  assert.equal(second.status, 201);
  s.locA2 = second.body.data;
  const third = await api("POST", "/api/locations", { token: s.a.token, body: parking("Station Parking") });
  assert.equal(third.status, 403); // trial plan allows 2
});

it("tenant isolation: company B cannot see or change company A's data", async () => {
  const list = await api("GET", "/api/locations", { token: s.b.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 0);

  const path = `/api/locations/${s.locA1._id}`;
  assert.equal((await api("GET", path, { token: s.b.token })).status, 404);
  assert.equal((await api("PUT", path, { token: s.b.token, body: { name: "Hacked" } })).status, 404);
  assert.equal((await api("DELETE", path, { token: s.b.token })).status, 404);

  // The x-company-id header only works for Super Admin.
  const spoof = await api("GET", "/api/locations", {
    token: s.b.token, headers: { "x-company-id": s.a.company._id },
  });
  assert.equal(spoof.body.data.length, 0);

  assert.equal((await api("GET", `/api/companies/${s.a.company._id}`, { token: s.b.token })).status, 404);
  assert.equal(
    (await api("PUT", `/api/companies/${s.a.company._id}`, { token: s.b.token, body: { name: "Hacked" } })).status,
    404
  );
  const companies = await api("GET", "/api/companies", { token: s.b.token });
  assert.deepEqual(companies.body.data.map((c) => c._id), [s.b.company._id]);

  const still = await api("GET", path, { token: s.a.token });
  assert.equal(still.body.data.name, "City Mall Parking");
});

it("company admin creates users and assigns roles and locations", async () => {
  const create = (body) => api("POST", "/api/users", { token: s.a.token, body });

  const locAdmin = await create({
    name: "Loc Admin", email: "locadmin@example.com", password: "Password123",
    role: ROLES.LOCATION_ADMIN, locationIds: [s.locA1._id],
  });
  assert.equal(locAdmin.status, 201, JSON.stringify(locAdmin.body));
  s.locAdmin = locAdmin.body.data;

  const operator = await create({
    name: "Entry Op", email: "entry@example.com", password: "Password123",
    role: ROLES.ENTRY_OPERATOR, locationIds: [s.locA2._id],
  });
  assert.equal(operator.status, 201);
  s.operator = operator.body.data;

  // Cannot create an equal or higher role, or assign another company's location.
  assert.equal((await create({ name: "Peer", email: "peer@example.com", password: "Password123", role: ROLES.COMPANY_ADMIN })).status, 403);
  assert.equal((await create({ name: "Root", email: "root@example.com", password: "Password123", role: ROLES.SUPER_ADMIN })).status, 403);
  assert.equal((await create({ name: "Dup", email: "entry@example.com", password: "Password123", role: ROLES.EXIT_OPERATOR })).status, 409);

  const bLoc = await api("POST", "/api/locations", { token: s.b.token, body: parking("B Parking") });
  s.locB = bLoc.body.data;
  const foreign = await create({
    name: "Foreign", email: "foreign@example.com", password: "Password123",
    role: ROLES.ENTRY_OPERATOR, locationIds: [s.locB._id],
  });
  assert.equal(foreign.status, 400);

  // Company B cannot see or edit company A's users.
  const bUsers = await api("GET", "/api/users", { token: s.b.token });
  assert.equal(bUsers.body.data.length, 0);
  assert.equal((await api("PUT", `/api/users/${s.operator._id}`, { token: s.b.token, body: { name: "Hacked" } })).status, 404);
});

it("RBAC: operator is limited to what the role allows", async () => {
  const login = await api("POST", "/api/auth/login", { body: { email: "entry@example.com", password: "Password123" } });
  const token = login.body.data.token;
  assert.deepEqual(login.body.data.permissions, ["ENTRY_CREATE"]);

  const visible = await api("GET", "/api/locations", { token });
  assert.deepEqual(visible.body.data.map((l) => l._id), [s.locA2._id]);
  assert.equal((await api("GET", `/api/locations/${s.locA1._id}`, { token })).status, 404);

  assert.equal((await api("POST", "/api/locations", { token, body: parking("Nope") })).status, 403);
  assert.equal((await api("PUT", `/api/locations/${s.locA2._id}`, { token, body: { name: "Nope" } })).status, 403);
  assert.equal((await api("GET", "/api/users", { token })).status, 403);
  assert.equal((await api("PUT", `/api/companies/${s.a.company._id}`, { token, body: { name: "Nope" } })).status, 403);
  assert.equal((await api("POST", "/api/companies", { token, body: { name: "Nope Co" } })).status, 403);
});

it("RBAC: location admin manages only their own location and lower roles", async () => {
  const login = await api("POST", "/api/auth/login", { body: { email: "locadmin@example.com", password: "Password123" } });
  const token = login.body.data.token;

  const update = await api("PUT", `/api/locations/${s.locA1._id}`, { token, body: { capacity: { car: 120 } } });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  assert.equal(update.body.data.capacity.car, 120);
  assert.equal(update.body.data.capacity.bike, 50);

  assert.equal((await api("PUT", `/api/locations/${s.locA2._id}`, { token, body: { name: "Nope" } })).status, 404);
  assert.equal((await api("POST", "/api/locations", { token, body: parking("Nope") })).status, 403);
  assert.equal((await api("DELETE", `/api/locations/${s.locA1._id}`, { token })).status, 403);
  assert.equal((await api("PUT", `/api/locations/${s.locA1._id}`, { token, body: { isActive: false } })).status, 403);

  const mine = await api("POST", "/api/users", {
    token,
    body: { name: "Exit Op", email: "exit@example.com", password: "Password123", role: ROLES.EXIT_OPERATOR, locationIds: [s.locA1._id] },
  });
  assert.equal(mine.status, 201, JSON.stringify(mine.body));

  const otherLocation = await api("POST", "/api/users", {
    token,
    body: { name: "Bad", email: "bad@example.com", password: "Password123", role: ROLES.EXIT_OPERATOR, locationIds: [s.locA2._id] },
  });
  assert.equal(otherLocation.status, 403);
  const peer = await api("POST", "/api/users", {
    token,
    body: { name: "Bad", email: "bad2@example.com", password: "Password123", role: ROLES.LOCATION_ADMIN, locationIds: [s.locA1._id] },
  });
  assert.equal(peer.status, 403);

  // Sees only lower-ranked users at their own location.
  const users = await api("GET", "/api/users", { token });
  assert.deepEqual(users.body.data.map((u) => u.email), ["exit@example.com"]);
  assert.equal((await api("PUT", `/api/users/${s.operator._id}`, { token, body: { name: "Nope" } })).status, 404);
});

it("company admin edits company details but not plan or subscription", async () => {
  const res = await api("PUT", `/api/companies/${s.a.company._id}`, {
    token: s.a.token,
    body: {
      legalName: "Company One Pvt Ltd", gstNumber: "08abcde1234f1z5",
      billingContact: { phone: "9999999999" },
      subscriptionStatus: "ACTIVE", plan: { maxLocations: 999 }, isVerified: true,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.legalName, "Company One Pvt Ltd");
  assert.equal(res.body.data.gstNumber, "08ABCDE1234F1Z5");
  assert.equal(res.body.data.billingContact.phone, "9999999999");
  assert.equal(res.body.data.billingContact.email, "admin1@example.com");
  assert.equal(res.body.data.subscriptionStatus, "TRIAL");
  assert.equal(res.body.data.plan.maxLocations, 2);
  assert.equal(res.body.data.onboarding.isVerified, false);

  const badGst = await api("PUT", `/api/companies/${s.a.company._id}`, { token: s.a.token, body: { gstNumber: "123" } });
  assert.equal(badGst.status, 400);
});

it("onboarding progress reflects what has been set up", async () => {
  const res = await api("GET", `/api/companies/${s.a.company._id}/onboarding`, { token: s.a.token });
  assert.equal(res.status, 200);
  const done = Object.fromEntries(res.body.data.steps.map((step) => [step.key, step.done]));
  assert.deepEqual(done, {
    registration: true, verification: false, admin: true, plan: false,
    location: true, capacity: true, tariff: false, operators: true, live: false,
  });
  assert.equal(res.body.data.readyToGoLive, false);
});

it("super admin works across companies and controls plans", async () => {
  await User.create({ name: "Root", email: "root@platform.test", password: "RootPassword123", role: ROLES.SUPER_ADMIN });
  const login = await api("POST", "/api/auth/login", { body: { email: "root@platform.test", password: "RootPassword123" } });
  assert.equal(login.status, 200);
  const token = login.body.data.token;

  const companies = await api("GET", "/api/companies", { token });
  assert.ok(companies.body.data.length >= 2);

  const all = await api("GET", "/api/locations", { token });
  assert.equal(all.body.data.length, 3);
  const onlyA = await api("GET", "/api/locations", { token, headers: { "x-company-id": s.a.company._id } });
  assert.equal(onlyA.body.data.length, 2);

  const upgrade = await api("PUT", `/api/companies/${s.a.company._id}`, {
    token, body: { subscriptionStatus: "ACTIVE", plan: { name: "Pro", maxLocations: 10 }, isVerified: true },
  });
  assert.equal(upgrade.status, 200, JSON.stringify(upgrade.body));
  assert.equal(upgrade.body.data.plan.maxLocations, 10);
  assert.equal(upgrade.body.data.plan.maxUsers, 10);

  const third = await api("POST", "/api/locations", { token: s.a.token, body: parking("Station Parking") });
  assert.equal(third.status, 201);

  // Creating tenant data as Super Admin needs an explicit company.
  assert.equal((await api("POST", "/api/locations", { token, body: parking("No company") })).status, 400);

  s.rootToken = token;
});

it("suspended company is locked out", async () => {
  const suspend = await api("PUT", `/api/companies/${s.b.company._id}`, {
    token: s.rootToken, body: { subscriptionStatus: "SUSPENDED" },
  });
  assert.equal(suspend.status, 200);
  assert.equal((await api("GET", "/api/locations", { token: s.b.token })).status, 403);
});

it("deactivating a user ends their session", async () => {
  const login = await api("POST", "/api/auth/login", { body: { email: "entry@example.com", password: "Password123" } });
  const token = login.body.data.token;
  assert.equal((await api("GET", "/api/auth/me", { token })).status, 200);

  const off = await api("DELETE", `/api/users/${s.operator._id}`, { token: s.a.token });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.isActive, false);

  assert.equal((await api("GET", "/api/auth/me", { token })).status, 401);
  const relogin = await api("POST", "/api/auth/login", { body: { email: "entry@example.com", password: "Password123" } });
  assert.equal(relogin.status, 403);
});

it("forgot / reset password flow", async () => {
  const unknown = await api("POST", "/api/auth/forgot-password", { body: { email: "ghost@example.com" } });
  const known = await api("POST", "/api/auth/forgot-password", { body: { email: "admin1@example.com" } });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.equal(unknown.body.message, known.body.message);
  const resetToken = known.body.devResetToken; // exposed in development/test only
  assert.ok(resetToken);

  assert.equal((await api("POST", "/api/auth/reset-password", { body: { token: "wrong", password: "NewPassword123" } })).status, 400);
  const reset = await api("POST", "/api/auth/reset-password", { body: { token: resetToken, password: "NewPassword123" } });
  assert.equal(reset.status, 200);

  // Old token and old password stop working, and the link cannot be reused.
  assert.equal((await api("GET", "/api/auth/me", { token: s.a.token })).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { body: { email: "admin1@example.com", password: "Password123" } })).status, 401);
  assert.equal((await api("POST", "/api/auth/reset-password", { body: { token: resetToken, password: "Another12345" } })).status, 400);

  const login = await api("POST", "/api/auth/login", { body: { email: "admin1@example.com", password: "NewPassword123" } });
  assert.equal(login.status, 200);
  s.a.token = login.body.data.token;
});

it("logout invalidates the token", async () => {
  assert.equal((await api("POST", "/api/auth/logout", { token: s.a.token })).status, 200);
  assert.equal((await api("GET", "/api/auth/me", { token: s.a.token })).status, 401);
});

it("audit log recorded the important actions", async () => {
  const actions = await AuditLog.distinct("action");
  for (const expected of [
    "AUTH_REGISTER", "AUTH_LOGIN", "AUTH_LOGIN_FAILED", "AUTH_LOGOUT", "AUTH_PASSWORD_RESET",
    "LOCATION_CREATE", "LOCATION_UPDATE", "USER_CREATE", "USER_DEACTIVATE", "COMPANY_UPDATE",
  ]) {
    assert.ok(actions.includes(expected), `missing audit action ${expected}`);
  }
});
