// Security and robustness tests through the real API (plan, Day 29):
// headers, CORS, bad input, tokens, account lock, password change, tenant
// isolation sweep, and duplicate/parallel requests. Needs MongoDB.
const jwt = require("jsonwebtoken");
const { setup, it, api, send, registerCompany, login, withCode, assert } = require("./helpers");
const env = require("../config/env");
const User = require("../models/User");
const Payment = require("../models/Payment");
const ParkingSession = require("../models/ParkingSession");
const AuditLog = require("../models/AuditLog");

setup();

const s = {};
const json = { "content-type": "application/json" };
const count = (results, status) => results.filter((r) => r.status === status).length;
const occupied = async (location) =>
  (await api("GET", `/api/locations/${location._id}`, { token: s.a.token })).body.data.occupied;
const enter = (location, vehicleNumber, extra = {}) =>
  api("POST", "/api/parking/entry", {
    token: s.a.token, body: { locationId: location._id, vehicleNumber, vehicleType: "CAR", ...extra },
  });

it("setup: two companies; a roomy location and a tight one", async () => {
  s.a = await registerCompany("seca");
  s.b = await registerCompany("secb");

  const roomy = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Roomy", address: { line1: "Road 1" }, capacity: { car: 50, bike: 50 } },
  });
  const tight = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Tight", address: { line1: "Road 2" }, capacity: { car: 2 } },
  });
  assert.equal(roomy.status, 201, JSON.stringify(roomy.body));
  s.roomy = roomy.body.data;
  s.tight = tight.body.data;

  // Cars: free for the first hour (so exits close at once). Bikes: 20 from the first minute.
  const tariffs = [
    { locationId: s.roomy._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 60, additionalPerHour: 20 },
    { locationId: s.roomy._id, name: "Bike", vehicleType: "BIKE", additionalPerHour: 20 },
    { locationId: s.tight._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 60, additionalPerHour: 20 },
  ];
  for (const body of tariffs) {
    assert.equal((await api("POST", "/api/tariffs", { token: s.a.token, body })).status, 201);
  }

  const staff = (name, email, role, locationIds) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds } });
  s.operator = (await staff("Both Sites", "sec-op@example.com", "EXIT_OPERATOR", [s.roomy._id, s.tight._id])).body.data;
  await staff("Roomy Admin", "sec-locadmin@example.com", "LOCATION_ADMIN", [s.roomy._id]);
  s.locAdmin = await login("sec-locadmin@example.com");
});

it("security headers are set and the framework is not advertised", async () => {
  const res = await send("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("x-frame-options"));
  assert.ok(res.headers.get("strict-transport-security"));
  assert.ok(res.headers.get("content-security-policy"));
  assert.equal(res.headers.get("x-powered-by"), null);
});

it("CORS: only the web app's own address is allowed", async () => {
  const evil = await send("GET", "/api/health", { headers: { origin: "https://evil.example" } });
  assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example");
  assert.notEqual(evil.headers.get("access-control-allow-origin"), "*");

  const own = await send("GET", "/api/health", { headers: { origin: env.clientUrl } });
  assert.equal(own.headers.get("access-control-allow-origin"), env.clientUrl);
});

it("bad requests get clean errors with no internal details", async () => {
  const broken = await send("POST", "/api/auth/login", { headers: json, body: "{not json" });
  assert.equal(broken.status, 400);
  assert.equal(JSON.parse(broken.text).message, "Invalid JSON body");

  const huge = await send("POST", "/api/auth/login", { headers: json, body: JSON.stringify({ email: "a@b.co", password: "x".repeat(200 * 1024) }) });
  assert.equal(huge.status, 413);

  const missing = await send("GET", "/api/no-such-route");
  assert.equal(missing.status, 404);

  for (const res of [broken, huge, missing]) {
    assert.ok(!/stack|node_modules|at \w+ \(/.test(res.text), res.text.slice(0, 200));
    assert.equal(JSON.parse(res.text).success, false);
  }
});

it("database-operator injection is refused in bodies and ignored in the address", async () => {
  const body = await api("POST", "/api/auth/login", { body: { email: { $ne: "" }, password: { $ne: "" } } });
  assert.equal(body.status, 400);
  const reset = await api("POST", "/api/auth/reset-password", { body: { token: { $ne: "" }, password: "NewPassword123" } });
  assert.equal(reset.status, 400);

  await enter(s.roomy, "RJ14IN0001");
  // Company B tries operators in the query string to reach company A's data.
  for (const path of [
    "/api/parking/entries?locationId[$ne]=x",
    "/api/parking/entries?q[$regex]=.*",
    "/api/vehicles?q[$regex]=.*",
    "/api/vehicles?blocked[$ne]=true",
    "/api/payments?locationId[$exists]=true",
    "/api/audit-logs?action[$ne]=X",
    "/api/shifts?date[$gt]=2000-01-01",
  ]) {
    const res = await api("GET", path, { token: s.b.token });
    assert.ok([200, 400].includes(res.status), `${path} -> ${res.status}`);
    assert.ok(!JSON.stringify(res.body).includes("RJ14IN0001"), path);
    assert.ok(!JSON.stringify(res.body).includes(s.a.company._id), path);
  }
});

it("nobody can change their own role, permissions or password through the user screens", async () => {
  const mine = String(s.a.user._id);
  // The company admin is not among the people they may manage, so their own record is "not found".
  for (const body of [{ role: "COMPANY_ADMIN" }, { role: "SUPER_ADMIN" }, { isActive: false }, { password: "AnotherPass123" }]) {
    const res = await api("PUT", `/api/users/${mine}`, { token: s.a.token, body });
    // 404 (not among the people they manage) or 400 (a role that cannot be given at all): never a change.
    assert.ok([400, 404].includes(res.status), `${JSON.stringify(body)} -> ${res.status}`);
  }
  // A location admin cannot lift themselves, or the company admin above them, either.
  const own = await User.findOne({ email: "sec-locadmin@example.com" });
  const self = await api("PUT", `/api/users/${own._id}`, { token: s.locAdmin, body: { role: "COMPANY_ADMIN" } });
  assert.equal(self.status, 404);
  const up = await api("PUT", `/api/users/${mine}`, { token: s.locAdmin, body: { password: "AnotherPass123" } });
  assert.equal(up.status, 404);
  assert.equal((await User.findById(own._id)).role, "LOCATION_ADMIN");
  assert.equal((await User.findById(mine)).role, "COMPANY_ADMIN");
  // Nobody can create a platform administrator.
  const root = await api("POST", "/api/users", { token: s.a.token, body: { name: "Root", email: "sec-root@example.com", password: "Password123", role: "SUPER_ADMIN" } });
  assert.ok([400, 403].includes(root.status), String(root.status));
});

it("tokens: forged, altered, expired or orphaned tokens are refused", async () => {
  const me = (token) => api("GET", "/api/auth/me", { token });
  const payload = { sub: s.a.user._id, tv: 0 };
  const b64 = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");

  assert.equal((await me(s.a.token)).status, 200);
  assert.equal((await me(`${s.a.token}x`)).status, 401);
  assert.equal((await me(jwt.sign(payload, "some-other-secret-some-other-secret"))).status, 401);
  assert.equal((await me(`${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`)).status, 401);
  assert.equal((await me(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: "HS512" }))).status, 401);
  assert.equal((await me(jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: -10 }))).status, 401);
  // Correctly signed, but for a user that does not exist, or with an old token version.
  assert.equal((await me(jwt.sign({ sub: "64b000000000000000000000", tv: 0 }, process.env.JWT_SECRET))).status, 401);
  assert.equal((await me(jwt.sign({ sub: s.a.user._id, tv: 99 }, process.env.JWT_SECRET))).status, 401);
  assert.equal((await me(jwt.sign({ sub: { $ne: null }, tv: 0 }, process.env.JWT_SECRET))).status, 401);
  // No token in the query string or body is ever accepted.
  assert.equal((await api("GET", `/api/auth/me?token=${s.a.token}`)).status, 401);
});

it("every protected area refuses requests without a login", async () => {
  for (const path of [
    "/api/users", "/api/companies", "/api/locations", "/api/slots", "/api/vehicles", "/api/tariffs",
    "/api/parking/entries", "/api/parking/exits", "/api/payments", "/api/payments/collection", "/api/shifts",
    "/api/shifts/current", "/api/dashboard", "/api/reports/revenue", "/api/reports/collection",
    "/api/reports/vehicles", "/api/reports/occupancy", "/api/reports/operators", "/api/audit-logs",
    "/api/notifications", "/api/leads", "/api/faq/all", "/api/blog/admin/all",
  ]) {
    assert.equal((await api("GET", path)).status, 401, path);
  }
});

it("tenant isolation sweep: company B gets nothing from company A's records", async () => {
  // Real records of company A to aim at.
  const entry = await enter(s.roomy, "RJ14TS0001", { vehicleType: "BIKE" });
  const session = entry.body.data.session;
  const opToken = await login("sec-op@example.com");
  const shift = await api("POST", "/api/shifts", { token: opToken, body: { locationId: s.roomy._id, openingCash: 0 } });
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
  await api("POST", "/api/parking/exit", { token: opToken, body: { locationId: s.roomy._id, ticketNumber: session.ticketNumber } });
  const paid = await api("POST", "/api/payments", { token: opToken, body: { sessionId: session._id, method: "CASH", amount: 20 } });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  const tariff = (await api("GET", `/api/tariffs?locationId=${s.roomy._id}`, { token: s.a.token })).body.data[0];
  const vehicle = (await api("GET", "/api/vehicles?q=RJ14TS0001", { token: s.a.token })).body.data.vehicles[0];
  s.payment = paid.body.data.payment;
  s.shift = shift.body.data;

  const reason = { reason: "Trying to get in" };
  const attempts = [
    ["GET", `/api/companies/${s.a.company._id}`],
    ["PUT", `/api/companies/${s.a.company._id}`, { name: "Taken over" }],
    ["GET", `/api/companies/${s.a.company._id}/onboarding`],
    ["GET", `/api/locations/${s.roomy._id}`],
    ["PUT", `/api/locations/${s.roomy._id}`, { name: "Taken over" }],
    ["DELETE", `/api/locations/${s.roomy._id}`],
    ["GET", `/api/slots?locationId=${s.roomy._id}`],
    ["POST", "/api/slots", { locationId: s.roomy._id, code: "X1" }],
    ["GET", `/api/tariffs/${tariff._id}`],
    ["PUT", `/api/tariffs/${tariff._id}`, { name: "Taken over" }],
    ["DELETE", `/api/tariffs/${tariff._id}`],
    ["POST", "/api/tariffs/preview", { locationId: s.roomy._id, vehicleType: "CAR", entryTime: new Date().toISOString(), exitTime: new Date().toISOString() }],
    ["GET", `/api/vehicles/${vehicle._id}`],
    ["PUT", `/api/vehicles/${vehicle._id}`, { isBlocked: true, blockedReason: "Mischief" }],
    ["GET", `/api/users/${s.operator._id}`],
    ["PUT", `/api/users/${s.operator._id}`, { password: "Hijacked12345" }],
    ["DELETE", `/api/users/${s.operator._id}`],
    ["POST", "/api/users", { name: "Planted", email: "planted@example.com", password: "Password123", role: "ENTRY_OPERATOR", locationIds: [s.roomy._id] }],
    ["POST", "/api/parking/entry", { locationId: s.roomy._id, vehicleNumber: "RJ14XX0001", vehicleType: "CAR" }],
    ["POST", "/api/parking/exit", { locationId: s.roomy._id, vehicleNumber: "RJ14IN0001" }],
    ["GET", `/api/parking/sessions/${session._id}`],
    ["GET", `/api/parking/sessions/${session._id}/receipt`],
    ["POST", `/api/parking/sessions/${session._id}/cancel`, reason],
    ["POST", `/api/parking/sessions/${session._id}/override`, reason],
    ["POST", "/api/payments", { sessionId: session._id, method: "CASH", amount: 20 }],
    ["POST", `/api/payments/${s.payment._id}/refund`, reason],
    ["POST", "/api/shifts", { locationId: s.roomy._id, openingCash: 0 }],
    ["POST", `/api/shifts/${s.shift._id}/close`, { closingCash: 0 }],
    ["POST", `/api/shifts/${s.shift._id}/adjustments`, { amount: 500, reason: "Mischief here" }],
    ["GET", `/api/dashboard?locationId=${s.roomy._id}`],
    ["GET", `/api/reports/revenue?locationId=${s.roomy._id}`],
    ["GET", `/api/reports/vehicles?locationId=${s.roomy._id}`],
  ];

  for (const [method, path, body] of attempts) {
    const res = await api(method, path, { token: s.b.token, body });
    assert.ok([400, 403, 404].includes(res.status), `${method} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 150)}`);
    // The Super Admin header does nothing for an ordinary company admin.
    const spoofed = await api(method, path, { token: s.b.token, body, headers: { "x-company-id": s.a.company._id } });
    assert.ok([400, 403, 404].includes(spoofed.status), `${method} ${path} with x-company-id -> ${spoofed.status}`);
  }

  // Lists filtered by company A's location come back empty rather than as an error.
  const collection = await api("GET", `/api/payments/collection?locationId=${s.roomy._id}`, { token: s.b.token });
  assert.equal(collection.body.data.total.amount, 0);
  assert.equal((await api("GET", `/api/payments?locationId=${s.roomy._id}`, { token: s.b.token })).body.data.total, 0);
  assert.equal((await api("GET", `/api/parking/entries?locationId=${s.roomy._id}`, { token: s.b.token })).body.data.total, 0);
  assert.equal((await api("GET", `/api/tariffs?locationId=${s.roomy._id}`, { token: s.b.token })).body.data.length, 0);

  // Nothing of company A changed.
  assert.equal((await api("GET", `/api/locations/${s.roomy._id}`, { token: s.a.token })).body.data.name, "Roomy");
  assert.equal((await api("GET", `/api/payments?date=`, { token: s.a.token })).body.data.payments[0].status, "SUCCESS");
  assert.equal((await api("GET", "/api/shifts/current", { token: opToken })).body.data.status, "OPEN");
  assert.equal(await User.countDocuments({ email: "planted@example.com" }), 0);
  s.opToken = opToken;
});

it("a location admin's edit keeps a user's assignments at other locations", async () => {
  const edit = await api("PUT", `/api/users/${s.operator._id}`, { token: s.locAdmin, body: { locationIds: [s.roomy._id], name: "Both Sites" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.deepEqual([...edit.body.data.locationIds].sort(), [s.roomy._id, s.tight._id].sort());

  // They still cannot hand out a location they do not manage.
  assert.equal((await api("PUT", `/api/users/${s.operator._id}`, { token: s.locAdmin, body: { locationIds: [s.tight._id] } })).status, 403);
  s.opToken = await login("sec-op@example.com"); // the edit ended the old session
});

it("account lock: ten wrong passwords lock the account, even for the right password", async () => {
  const attempt = async (password) => api("POST", "/api/auth/login", { body: await withCode({ email: "sec-locadmin@example.com", password }) });
  for (let i = 0; i < 10; i += 1) assert.equal((await attempt(`wrong-password-${i}`)).status, 401);

  const locked = await attempt("Password123");
  assert.equal(locked.status, 429);
  assert.match(locked.body.message, /locked/);
  assert.ok((await AuditLog.distinct("action")).includes("AUTH_ACCOUNT_LOCKED"));

  // After the lock time has passed the right password works and the counter is cleared.
  await User.updateOne({ email: "sec-locadmin@example.com" }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  assert.equal((await attempt("Password123")).status, 200);
  const user = await User.findOne({ email: "sec-locadmin@example.com" }).select("+failedLogins +lockedUntil");
  assert.equal(user.failedLogins, 0);
  assert.equal(user.lockedUntil, undefined);

  // Unknown emails never lock and always answer the same way.
  for (let i = 0; i < 12; i += 1) {
    const res = await api("POST", "/api/auth/login", { body: { companyCode: s.a.company.code, email: "nobody@example.com", password: "whatever-123" } });
    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Invalid company code, login ID or password");
  }
});

it("change password: needs the current password; other devices are logged out", async () => {
  const otherDevice = await login("sec-locadmin@example.com");
  const thisDevice = await login("sec-locadmin@example.com");
  const change = (body, token = thisDevice) => api("POST", "/api/auth/change-password", { token, body });

  assert.equal((await api("POST", "/api/auth/change-password", { body: { currentPassword: "Password123", newPassword: "NewPassword456" } })).status, 401);
  assert.equal((await change({ currentPassword: "not-my-password", newPassword: "NewPassword456" })).status, 400);
  assert.equal((await change({ currentPassword: "Password123", newPassword: "short" })).status, 400);
  assert.equal((await change({ currentPassword: "Password123", newPassword: "Password123" })).status, 400);

  const ok = await change({ currentPassword: "Password123", newPassword: "NewPassword456" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await api("GET", "/api/auth/me", { token: ok.body.data.token })).status, 200);
  assert.equal((await api("GET", "/api/auth/me", { token: thisDevice })).status, 401);
  assert.equal((await api("GET", "/api/auth/me", { token: otherDevice })).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { body: await withCode({ email: "sec-locadmin@example.com", password: "Password123" }) })).status, 401);
  await login("sec-locadmin@example.com", "NewPassword456");

  const stored = await User.findOne({ email: "sec-locadmin@example.com" }).select("+password");
  assert.match(stored.password, /^\$2[aby]\$12\$/); // bcrypt, cost 12; never the plain text
});

it("parallel entries of the same vehicle create exactly one ticket", async () => {
  const before = (await occupied(s.roomy)).car;
  const results = await Promise.all(Array.from({ length: 6 }, () => enter(s.roomy, "RJ14PA0001")));
  assert.equal(count(results, 201), 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(count(results, 409), 5);
  assert.equal((await occupied(s.roomy)).car, before + 1);
  assert.equal(await ParkingSession.countDocuments({ vehicleNumber: "RJ14PA0001", isOpen: true }), 1);
});

it("a retried entry (same request key) in parallel gives one ticket and takes one space", async () => {
  const before = (await occupied(s.roomy)).car;
  const results = await Promise.all(
    Array.from({ length: 6 }, () => enter(s.roomy, "RJ14PA0002", { idempotencyKey: "parallel-retry-key-1" }))
  );
  assert.ok(results.every((r) => [200, 201].includes(r.status)), JSON.stringify(results.map((r) => [r.status, r.body.message])));
  assert.equal(new Set(results.map((r) => r.body.data.session.ticketNumber)).size, 1);
  assert.equal((await occupied(s.roomy)).car, before + 1);
});

it("parallel entries never overfill a location", async () => {
  // Capacity 2: six different cars arrive at the same moment.
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => enter(s.tight, `RJ14FL000${i}`)));
  assert.equal(count(results, 201), 2, JSON.stringify(results.map((r) => r.status)));
  assert.equal(count(results, 409), 4);
  assert.equal((await occupied(s.tight)).car, 2);
  assert.equal(await ParkingSession.countDocuments({ locationId: s.tight._id, isOpen: true }), 2);
  s.tightTickets = results.filter((r) => r.status === 201).map((r) => r.body.data.session.ticketNumber);
});

it("parallel exits of one ticket free the space exactly once", async () => {
  const exit = () => api("POST", "/api/parking/exit", { token: s.opToken, body: { locationId: s.tight._id, ticketNumber: s.tightTickets[0] } });
  const results = await Promise.all(Array.from({ length: 6 }, exit));
  assert.equal(count(results, 200), 1, JSON.stringify(results.map((r) => [r.status, r.body.message])));
  assert.equal(count(results, 409), 5);
  assert.equal((await occupied(s.tight)).car, 1);
});

it("parallel payments for one session take the money exactly once", async () => {
  const entry = await enter(s.roomy, "RJ14PY0001", { vehicleType: "BIKE" });
  const session = entry.body.data.session;
  await api("POST", "/api/parking/exit", { token: s.opToken, body: { locationId: s.roomy._id, ticketNumber: session.ticketNumber } });
  const before = (await occupied(s.roomy)).bike;

  const pay = () => api("POST", "/api/payments", { token: s.opToken, body: { sessionId: session._id, method: "CASH", amount: 20 } });
  const results = await Promise.all(Array.from({ length: 6 }, pay));
  assert.equal(count(results, 201), 1, JSON.stringify(results.map((r) => [r.status, r.body.message])));
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)));
  assert.equal(await Payment.countDocuments({ sessionId: session._id, status: "SUCCESS" }), 1);
  assert.equal(await Payment.countDocuments({ sessionId: session._id }), 1);
  assert.equal((await occupied(s.roomy)).bike, before - 1);

  // The shift counted it once.
  const shift = (await api("GET", "/api/shifts/current", { token: s.opToken })).body.data;
  assert.equal(shift.totals.payments, 2); // this one and the one from the tenant sweep
  assert.equal(shift.totals.collected, 40);
});

it("parallel refunds and parallel shift operations happen once", async () => {
  const refund = () => api("POST", `/api/payments/${s.payment._id}/refund`, { token: s.a.token, body: { reason: "Customer was charged in error" } });
  const refunds = await Promise.all(Array.from({ length: 5 }, refund));
  assert.equal(count(refunds, 200), 1, JSON.stringify(refunds.map((r) => r.status)));
  assert.equal(count(refunds, 409), 4);
  const shift = (await api("GET", "/api/shifts/current", { token: s.opToken })).body.data;
  assert.equal(shift.totals.cashRefunded, 20);

  const close = () => api("POST", `/api/shifts/${s.shift._id}/close`, { token: s.opToken, body: { closingCash: 20 } });
  const closes = await Promise.all(Array.from({ length: 5 }, close));
  assert.equal(count(closes, 200), 1, JSON.stringify(closes.map((r) => r.status)));
  assert.equal(closes.find((r) => r.status === 200).body.data.difference, 0); // 0 + 40 - 20 = 20 counted

  const open = () => api("POST", "/api/shifts", { token: s.opToken, body: { locationId: s.roomy._id, openingCash: 0 } });
  const opens = await Promise.all(Array.from({ length: 5 }, open));
  assert.equal(count(opens, 201), 1, JSON.stringify(opens.map((r) => r.status)));
  assert.equal(count(opens, 409), 4);
});

it("occupancy always equals the number of open sessions", async () => {
  for (const location of [s.roomy, s.tight]) {
    const occ = await occupied(location);
    const open = await ParkingSession.countDocuments({ locationId: location._id, isOpen: true });
    assert.equal(occ.car + occ.bike + occ.heavy + occ.taxi + occ.tempo, open, location.name);
  }
});

it("the general request limit answers 429 and recovers", async () => {
  const saved = process.env.API_RATE_LIMIT_MAX;
  process.env.API_RATE_LIMIT_MAX = "1";
  let limited;
  try {
    await send("GET", "/api/faq"); // the first request of a new minute is always allowed
    limited = await send("GET", "/api/faq");
  } finally {
    process.env.API_RATE_LIMIT_MAX = saved;
  }
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(JSON.parse(limited.text).success, false);
  assert.equal((await send("GET", "/api/faq")).status, 200);
});
