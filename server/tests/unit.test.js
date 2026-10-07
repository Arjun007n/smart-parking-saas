// Unit tests that need no database.  Run:  npm run test:unit
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  ROLES, PERMISSIONS, hasPermission, canManageRole, isCompanyWide, permissionsFor,
} = require("../config/permissions");
const { validateData, validateBody } = require("../middleware/validate");
const { requirePermission, requireRole } = require("../middleware/permission");
const { tenant, requireCompany } = require("../middleware/tenant");
const { errorHandler } = require("../middleware/errorHandler");
const rateLimit = require("../middleware/rateLimit");
const { signToken, verifyToken, createResetToken, hashToken } = require("../utils/token");
const AppError = require("../utils/AppError");
const User = require("../models/User");
const Location = require("../models/Location");
const Vehicle = require("../models/Vehicle");
const ParkingSession = require("../models/ParkingSession");
const AuditLog = require("../models/AuditLog");

const id = () => new mongoose.Types.ObjectId();

// Runs a middleware and returns the error it passed to next() (or null).
const run = (middleware, req) => {
  let result = "not-called";
  middleware(req, {}, (err) => { result = err || null; });
  return result;
};

const fakeRes = () => {
  const res = { headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
};

test("permissions: the gate operator does gate work and nothing else", () => {
  const { ROLE_PERMISSIONS, ROLE_RANK, CUSTOM_BASE_ROLES } = require("../config/permissions");
  assert.deepEqual([...ROLE_PERMISSIONS[ROLES.GATE_OPERATOR]].sort(), ["ENTRY_CREATE", "EXIT_CREATE", "PAYMENT_COLLECT"]);
  for (const p of ["REPORT_VIEW", "SESSION_OVERRIDE", "PASS_MANAGE", "USER_MANAGE", "LOCATION_MANAGE", "TARIFF_MANAGE", "VEHICLE_MANAGE", "WALLET_MANAGE"]) {
    assert.ok(!hasPermission(ROLES.GATE_OPERATOR, p), p);
  }
  assert.equal(ROLE_RANK[ROLES.GATE_OPERATOR], ROLE_RANK[ROLES.ENTRY_OPERATOR]);
  assert.ok(CUSTOM_BASE_ROLES.includes(ROLES.GATE_OPERATOR));
});

test("permissions: each role gets the expected rights", () => {
  assert.ok(hasPermission(ROLES.ENTRY_OPERATOR, PERMISSIONS.ENTRY_CREATE));
  assert.ok(!hasPermission(ROLES.ENTRY_OPERATOR, PERMISSIONS.EXIT_CREATE));
  assert.ok(!hasPermission(ROLES.ENTRY_OPERATOR, PERMISSIONS.USER_MANAGE));
  assert.ok(hasPermission(ROLES.EXIT_OPERATOR, PERMISSIONS.PAYMENT_COLLECT));
  assert.ok(!hasPermission(ROLES.COLLECTION_OPERATOR, PERMISSIONS.ENTRY_CREATE));
  assert.ok(hasPermission(ROLES.LOCATION_ADMIN, PERMISSIONS.TARIFF_MANAGE));
  assert.ok(!hasPermission(ROLES.LOCATION_ADMIN, PERMISSIONS.COMPANY_MANAGE));
  assert.ok(hasPermission(ROLES.COMPANY_ADMIN, PERMISSIONS.COMPANY_MANAGE));
  assert.ok(!hasPermission(ROLES.COMPANY_ADMIN, PERMISSIONS.PLATFORM_MANAGE));
  assert.ok(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.PLATFORM_MANAGE));
  assert.deepEqual(permissionsFor("NOT_A_ROLE"), []);
});

test("permissions: a role can only manage lower roles", () => {
  assert.ok(canManageRole(ROLES.COMPANY_ADMIN, ROLES.LOCATION_ADMIN));
  assert.ok(canManageRole(ROLES.LOCATION_ADMIN, ROLES.ENTRY_OPERATOR));
  assert.ok(!canManageRole(ROLES.COMPANY_ADMIN, ROLES.COMPANY_ADMIN));
  assert.ok(!canManageRole(ROLES.LOCATION_ADMIN, ROLES.COMPANY_ADMIN));
  assert.ok(!canManageRole(ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR));
  assert.ok(!canManageRole(ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN));
  assert.ok(!canManageRole(ROLES.COMPANY_ADMIN, "NOT_A_ROLE"));
  assert.ok(isCompanyWide(ROLES.COMPANY_ADMIN));
  assert.ok(!isCompanyWide(ROLES.LOCATION_ADMIN));
});

test("requirePermission / requireRole block and allow correctly", () => {
  const guard = requirePermission(PERMISSIONS.USER_MANAGE);
  assert.equal(run(guard, { user: { role: ROLES.COMPANY_ADMIN } }), null);
  assert.equal(run(guard, { user: { role: ROLES.ENTRY_OPERATOR } }).statusCode, 403);
  assert.equal(run(guard, {}).statusCode, 401);
  assert.equal(run(requireRole(ROLES.SUPER_ADMIN), { user: { role: ROLES.COMPANY_ADMIN } }).statusCode, 403);
});

test("tenant: normal users are locked to their own company", () => {
  const own = id();
  const other = id();
  const req = { user: { role: ROLES.COMPANY_ADMIN, companyId: own }, headers: { "x-company-id": String(other) } };
  assert.equal(run(tenant, req), null);
  assert.equal(String(req.companyId), String(own));
  assert.equal(String(req.tenantFilter.companyId), String(own));
});

test("tenant: super admin can pick a company or work across all", () => {
  const target = id();
  const picked = { user: { role: ROLES.SUPER_ADMIN }, headers: { "x-company-id": String(target) } };
  assert.equal(run(tenant, picked), null);
  assert.equal(String(picked.companyId), String(target));

  const all = { user: { role: ROLES.SUPER_ADMIN }, headers: {} };
  assert.equal(run(tenant, all), null);
  assert.deepEqual(all.tenantFilter, {});
  assert.equal(run(requireCompany, all).statusCode, 400);

  const bad = { user: { role: ROLES.SUPER_ADMIN }, headers: { "x-company-id": "abc" } };
  assert.equal(run(tenant, bad).statusCode, 400);
});

test("tenant: a user without a company is rejected", () => {
  assert.equal(run(tenant, { user: { role: ROLES.ENTRY_OPERATOR }, headers: {} }).statusCode, 403);
});

test("validate: drops unknown fields and normalises values", () => {
  const rules = {
    name: { type: "string", required: true, min: 2 },
    email: { type: "email", required: true },
    capacity: { type: "object", fields: { car: { type: "number", integer: true, min: 0 } } },
  };
  const { data, errors } = validateData(rules, {
    name: "  City Mall  ", email: " Admin@Example.COM ", capacity: { car: 10, hacked: 1 },
    role: "SUPER_ADMIN", companyId: "x",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(data, { name: "City Mall", email: "admin@example.com", capacity: { car: 10 } });
});

test("validate: reports problems", () => {
  const rules = {
    name: { type: "string", required: true, min: 2 },
    email: { type: "email", required: true },
    count: { type: "number", integer: true, min: 0 },
    role: { type: "string", enum: ["A", "B"] },
    ids: { type: "array", of: { type: "objectId" } },
    nested: { type: "object", fields: { x: { type: "number" } } },
  };
  const { errors } = validateData(rules, {
    name: " ", email: "nope", count: -1, role: "C", ids: ["123"], nested: "text",
  });
  assert.deepEqual(errors.map((e) => e.field).sort(), ["count", "email", "ids[0]", "name", "nested", "role"]);
  // Wrong types are rejected, not coerced (blocks NoSQL operator injection).
  assert.equal(validateData({ email: { type: "email" } }, { email: { $gt: "" } }).errors.length, 1);
  assert.equal(validateData({ n: { type: "number" } }, { n: "5" }).errors.length, 1);
  assert.equal(validateData(rules, null).errors.length, 2);
});

test("validateBody replaces req.body with the cleaned data", () => {
  const req = { body: { name: "Ok name", extra: true } };
  assert.equal(run(validateBody({ name: { type: "string", required: true } }), req), null);
  assert.deepEqual(req.body, { name: "Ok name" });
  assert.equal(run(validateBody({ name: { type: "string", required: true } }), { body: {} }).statusCode, 400);
});

test("rateLimit blocks after the limit and is per IP", () => {
  const limiter = rateLimit({ windowMs: 60000, max: 2 });
  const hit = (ip) => {
    let err = null;
    limiter({ ip }, fakeRes(), (e) => { err = e || null; });
    return err;
  };
  assert.equal(hit("1.1.1.1"), null);
  assert.equal(hit("1.1.1.1"), null);
  assert.equal(hit("1.1.1.1").statusCode, 429);
  assert.equal(hit("2.2.2.2"), null);
});

test("tokens: sign/verify, tampering and reset tokens", () => {
  const user = { _id: id(), tokenVersion: 3 };
  const payload = verifyToken(signToken(user));
  assert.equal(payload.sub, String(user._id));
  assert.equal(payload.tv, 3);
  assert.throws(() => verifyToken(signToken(user) + "x"));
  const { raw, hash } = createResetToken();
  assert.equal(hashToken(raw), hash);
  assert.notEqual(raw, hash);
});

test("errorHandler hides internal errors and maps known ones", () => {
  const send = (err) => {
    const res = fakeRes();
    const original = console.error;
    console.error = () => {};
    try { errorHandler(err, {}, res, () => {}); } finally { console.error = original; }
    return res;
  };
  assert.equal(send(new AppError("Nope", 403)).body.message, "Nope");
  const internal = send(new Error("db password leaked"));
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.body.message, "Something went wrong");
  assert.equal(send({ code: 11000, keyPattern: { companyId: 1, name: 1 } }).statusCode, 409);
  assert.equal(send({ name: "TokenExpiredError" }).statusCode, 401);
  assert.equal(send({ name: "CastError", path: "_id" }).statusCode, 400);
});

// Returns the validation errors of a document ({} when it is valid).
const errorsOf = (doc) => doc.validate().then(() => ({}), (error) => error.errors);

test("models: required fields and enums", async () => {
  const noCompany = new User({ name: "A", email: "a@b.co", password: "12345678", role: ROLES.ENTRY_OPERATOR });
  assert.ok((await errorsOf(noCompany)).companyId);
  const superAdmin = new User({ name: "A", email: "a@b.co", password: "12345678", role: ROLES.SUPER_ADMIN });
  assert.deepEqual(await errorsOf(superAdmin), {});
  assert.ok((await errorsOf(new User({ name: "A", email: "a@b.co", password: "12345678", role: "BOSS" }))).role);

  const location = new Location({ companyId: id(), name: "P1", address: { line1: "Road" } });
  assert.deepEqual(await errorsOf(location), {});
  assert.equal(location.capacity.car, 0);
  assert.ok((await errorsOf(new Location({ name: "P1", address: { line1: "Road" } }))).companyId);
});

test("models: user JSON never contains secrets", () => {
  const user = new User({
    companyId: id(), name: "A", email: "a@b.co", password: "12345678",
    role: ROLES.COMPANY_ADMIN, passwordResetToken: "abc",
  });
  const json = JSON.parse(JSON.stringify(user));
  assert.equal(json.password, undefined);
  assert.equal(json.passwordResetToken, undefined);
  assert.equal(json.tokenVersion, undefined);
});

test("models: plate numbers are normalised, sessions track open state", async () => {
  assert.equal(new Vehicle({ companyId: id(), plateNumber: "rj14 ab-1234" }).plateNumber, "RJ14AB1234");

  const session = new ParkingSession({
    companyId: id(), locationId: id(), ticketNumber: "T1", vehicleNumber: "RJ14AB1234", vehicleType: "CAR",
  });
  await session.validate();
  assert.equal(session.isOpen, true);
  session.status = "COMPLETED";
  await session.validate();
  assert.equal(session.isOpen, false);
});

test("models: audit logs are append-only", async () => {
  await assert.rejects(() => AuditLog.updateOne({}, { action: "X" }), /append-only/);
  await assert.rejects(() => AuditLog.deleteMany({}), /append-only/);
});

// ---- Week 2 ----
const { collectCleared } = require("../middleware/validate");
const { parsePlate, normalizePlate, escapeRegex } = require("../utils/plate");

test("validate: dates are parsed, bad dates rejected", () => {
  const rules = { at: { type: "date", required: true } };
  const good = validateData(rules, { at: "2026-03-02T10:00:00+05:30" });
  assert.deepEqual(good.errors, []);
  assert.ok(good.data.at instanceof Date);
  assert.equal(good.data.at.toISOString(), "2026-03-02T04:30:00.000Z");
  assert.equal(validateData(rules, { at: "yesterday" }).errors.length, 1);
  assert.equal(validateData(rules, { at: 12345 }).errors.length, 1);
});

test("collectCleared notes which optional fields were sent as null", () => {
  const req = { body: { maxDailyFee: null, overnightFee: 0, name: null } };
  assert.equal(run(collectCleared(["maxDailyFee", "overnightFee", "lostTicketFee"]), req), null);
  assert.deepEqual(req.cleared, ["maxDailyFee"]);
});

test("vehicle numbers are normalised and checked", () => {
  assert.equal(normalizePlate(" rj14 ab-1234 "), "RJ14AB1234");
  assert.equal(parsePlate("dl 01 xy 9999"), "DL01XY9999");
  assert.throws(() => parsePlate("!!"), /4 to 12/);
  assert.throws(() => parsePlate("ABC"), /4 to 12/);
  assert.throws(() => parsePlate({ $gt: "" }), /4 to 12/);
  assert.equal(escapeRegex(".*"), "\\.\\*");
});

test("permissions: vehicle management is for admins", () => {
  assert.ok(hasPermission(ROLES.COMPANY_ADMIN, PERMISSIONS.VEHICLE_MANAGE));
  assert.ok(hasPermission(ROLES.LOCATION_ADMIN, PERMISSIONS.VEHICLE_MANAGE));
  assert.ok(!hasPermission(ROLES.ENTRY_OPERATOR, PERMISSIONS.VEHICLE_MANAGE));
});
