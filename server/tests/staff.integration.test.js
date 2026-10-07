// Company code + Login ID sign-in, the Viewer and Supervisor roles, lane assignment and
// user licences per location, through the API. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const Company = require("../models/Company");
const User = require("../models/User");
const { todayText } = require("./reportDates");

setup();

const s = {};
const range = () => { const d = todayText(0); return `from=${d.from}&to=${d.to}`; };
const makeUser = (body, token = s.a.token) =>
  api("POST", "/api/users", { token, body: { name: "Staff", password: "Password123", locationIds: [s.loc._id], ...body } });
const codeLogin = (companyCode, loginId, password = "Password123") =>
  api("POST", "/api/auth/login", { body: { companyCode, loginId, password } });
const enter = (token, vehicleNumber, extra = {}) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR", ...extra } });

it("setup: a company with a two-lane location", async () => {
  s.a = await registerCompany("sa");
  s.b = await registerCompany("sb");
  // A trial plan allows 10 users; these tests make more than that.
  await Company.updateMany({ _id: { $in: [s.a.company._id, s.b.company._id] } }, { $set: { "plan.maxUsers": 100 } });
  const loc = await api("POST", "/api/locations", {
    token: s.a.token,
    body: {
      name: "Mall", address: { line1: "MG Road" }, capacity: { car: 50 },
      gates: [{ name: "In 1", type: "ENTRY" }, { name: "In 2", type: "ENTRY" }, { name: "Out 1", type: "EXIT" }],
    },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
});

it("every company gets its own sign-in code", async () => {
  assert.match(s.a.company.code, /^[A-Z0-9]{6}$/);
  assert.notEqual(s.a.company.code, s.b.company.code);
  // Old companies (made before codes existed) get one when the server starts.
  const old = await Company.collection.insertOne({ name: "Old Co", isActive: true, subscriptionStatus: "TRIAL", plan: { maxUsers: 10, maxLocations: 2 } });
  const { backfillCompanyCodes } = require("../services/accountService");
  assert.ok((await backfillCompanyCodes()) >= 1);
  const filled = await Company.findById(old.insertedId);
  assert.match(filled.code, /^[A-Z0-9]{6}$/);
  assert.equal(await backfillCompanyCodes(), 0, "safe to repeat");
});

it("Login ID: a user without an email signs in with company code + Login ID", async () => {
  const created = await makeUser({ loginId: "Gate.Op1", role: "ENTRY_OPERATOR" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.loginId, "gate.op1", "stored in lower case");
  assert.equal(created.body.data.email, undefined);

  const ok = await codeLogin(s.a.company.code.toLowerCase(), "GATE.OP1");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.user.role, "ENTRY_OPERATOR");
  assert.equal(ok.body.data.company.code, s.a.company.code);
  s.entryOp = ok.body.data.token;
  assert.equal((await api("GET", "/api/auth/me", { token: s.entryOp })).status, 200);
});

it("Login ID: wrong code, wrong ID, wrong password and another company's code all fail the same way", async () => {
  for (const attempt of [
    codeLogin("ZZZZZZ", "gate.op1"),
    codeLogin(s.a.company.code, "nobody"),
    codeLogin(s.a.company.code, "gate.op1", "WrongPassword1"),
    codeLogin(s.b.company.code, "gate.op1"),
  ]) {
    const res = await attempt;
    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Invalid company code, login ID or password");
  }
  const none = await api("POST", "/api/auth/login", { body: { companyCode: s.a.company.code, password: "Password123" } });
  assert.equal(none.status, 400, "a Login ID is needed with the code");
});

it("Login ID: unique inside a company, reusable in another; needs an email or a Login ID", async () => {
  assert.equal((await makeUser({ loginId: "gate.op1", role: "EXIT_OPERATOR" })).status, 409);
  assert.equal((await makeUser({ loginId: "gate.op1", role: "EXIT_OPERATOR", locationIds: [] }, s.b.token)).status, 201);
  assert.equal((await makeUser({ role: "EXIT_OPERATOR" })).status, 400, "no way to sign in");
  assert.equal((await makeUser({ loginId: "ab", role: "EXIT_OPERATOR" })).status, 400, "too short");
  assert.equal((await makeUser({ loginId: "has space", role: "EXIT_OPERATOR" })).status, 400);
  // Two people with no email do not clash (the email index only looks at users who have one).
  assert.equal((await makeUser({ loginId: "second.op", role: "EXIT_OPERATOR" })).status, 201);
  assert.equal((await makeUser({ loginId: "third.op", role: "EXIT_OPERATOR" })).status, 201);
  assert.equal((await User.countDocuments({ email: { $exists: false } })) >= 3, true);
});

it("Login ID: the account locks after repeated wrong passwords, like an email login", async () => {
  await makeUser({ loginId: "lock.me", role: "EXIT_OPERATOR" });
  let last;
  for (let i = 0; i < 10; i += 1) last = await codeLogin(s.a.company.code, "lock.me", "WrongPassword1");
  assert.equal(last.status, 401);
  assert.equal((await codeLogin(s.a.company.code, "lock.me")).status, 429, "locked even with the right password");
});

it("Login ID can be changed or added later by an admin; password reset by an admin works", async () => {
  const list = await api("GET", "/api/users", { token: s.a.token });
  const user = list.body.data.find((u) => u.loginId === "second.op");
  assert.equal((await api("PUT", `/api/users/${user._id}`, { token: s.a.token, body: { loginId: "third.op" } })).status, 409);
  assert.equal((await api("PUT", `/api/users/${user._id}`, { token: s.a.token, body: { loginId: "renamed.op", password: "NewPassword123" } })).status, 200);
  assert.equal((await codeLogin(s.a.company.code, "second.op")).status, 401);
  assert.equal((await codeLogin(s.a.company.code, "renamed.op", "NewPassword123")).status, 200);
});

it("The company code is required for everyone: admins and staff, with an email or a Login ID", async () => {
  const both = await makeUser({ email: "sa-both@example.com", loginId: "both.user", role: "EXIT_OPERATOR" });
  assert.equal(both.status, 201, JSON.stringify(both.body));
  const emailLogin = (body) => api("POST", "/api/auth/login", { body: { password: "Password123", ...body } });

  // With the code, an email works (for the admin and for staff who have one), and so does the Login ID.
  assert.equal((await emailLogin({ companyCode: s.a.company.code, email: "admin-sa@example.com" })).status, 200);
  assert.equal((await emailLogin({ companyCode: s.a.company.code, email: "sa-both@example.com" })).status, 200);
  assert.equal((await codeLogin(s.a.company.code, "both.user")).status, 200);

  // Without the code nobody gets in, not even with the right password.
  for (const body of [{ email: "admin-sa@example.com" }, { email: "sa-both@example.com" }, { loginId: "both.user" }]) {
    const res = await emailLogin(body);
    assert.equal(res.status, 401, JSON.stringify(body));
    assert.equal(res.body.message, "Enter your company code to sign in");
  }
  // An unknown email answers the same, so nothing is revealed about who has an account.
  assert.equal((await emailLogin({ email: "nobody-here@example.com" })).body.message, "Enter your company code to sign in");

  // The wrong company's code does not work for this user, and an email cannot be tried against another company.
  const other = await emailLogin({ companyCode: s.b.company.code, email: "admin-sa@example.com" });
  assert.equal(other.status, 401);
  assert.equal(other.body.message, "Invalid company code, login ID or password");
  assert.equal((await emailLogin({ companyCode: "ZZZZZZ", email: "admin-sa@example.com" })).status, 401);
  assert.equal((await emailLogin({})).status, 400, "an email or Login ID is needed");
});

it("The platform administrator signs in with an email alone", async () => {
  await User.create({ name: "Root", email: "root-sa@platform.test", password: "RootPassword123", role: "SUPER_ADMIN" });
  const ok = await api("POST", "/api/auth/login", { body: { email: "root-sa@platform.test", password: "RootPassword123" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.user.role, "SUPER_ADMIN");
  const wrong = await api("POST", "/api/auth/login", { body: { email: "root-sa@platform.test", password: "WrongPassword123" } });
  assert.equal(wrong.status, 401);
});

it("Viewer: sees reports, changes nothing", async () => {
  const made = await makeUser({ loginId: "viewer1", role: "VIEWER" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.viewer = (await codeLogin(s.a.company.code, "viewer1")).body.data;
  assert.deepEqual(s.viewer.permissions, ["REPORT_VIEW"]);
  assert.equal((await api("GET", `/api/reports/revenue?${range()}`, { token: s.viewer.token })).status, 200);
  assert.equal((await api("GET", "/api/locations", { token: s.viewer.token })).status, 200);
  assert.equal((await enter(s.viewer.token, "RJ14VW0001")).status, 403);
  assert.equal((await api("GET", "/api/users", { token: s.viewer.token })).status, 403);
  assert.equal((await api("POST", "/api/locations", { token: s.viewer.token, body: { name: "X", address: { line1: "Y" } } })).status, 403);
});

it("Supervisor: operates and oversees, with a reason; cannot manage users or settings", async () => {
  const made = await makeUser({ loginId: "super1", role: "SUPERVISOR" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.sup = (await codeLogin(s.a.company.code, "super1")).body.data;
  for (const key of ["ENTRY_CREATE", "EXIT_CREATE", "PAYMENT_COLLECT", "REPORT_VIEW", "SESSION_OVERRIDE"]) assert.ok(s.sup.permissions.includes(key));

  const entry = await enter(s.sup.token, "RJ14SU0001");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const session = entry.body.data.session;
  assert.equal((await api("GET", `/api/reports/revenue?${range()}`, { token: s.sup.token })).status, 200);

  // Corrections need a reason, and are allowed for the supervisor.
  assert.equal((await api("POST", `/api/parking/sessions/${session._id}/cancel`, { token: s.sup.token, body: {} })).status, 400);
  const cancelled = await api("POST", `/api/parking/sessions/${session._id}/cancel`, { token: s.sup.token, body: { reason: "Entered by mistake" } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  const second = await enter(s.sup.token, "RJ14SU0002");
  const released = await api("POST", `/api/parking/sessions/${second.body.data.session._id}/override`, { token: s.sup.token, body: { reason: "Customer dispute settled" } });
  assert.equal(released.status, 200, JSON.stringify(released.body));

  // An ordinary operator cannot.
  const third = await enter(s.entryOp, "RJ14OP0003");
  assert.equal(third.status, 201, JSON.stringify(third.body));
  assert.equal((await api("POST", `/api/parking/sessions/${third.body.data.session._id}/cancel`, { token: s.entryOp, body: { reason: "Not allowed" } })).status, 403);

  for (const [method, path, body] of [
    ["GET", "/api/users", undefined],
    ["POST", "/api/users", { name: "X Y", loginId: "xyz", password: "Password123", role: "VIEWER" }],
    ["GET", "/api/roles/catalog", undefined],
    ["POST", "/api/tariffs", { name: "x" }],
  ]) {
    assert.equal((await api(method, path, { token: s.sup.token, body })).status, 403, `${method} ${path}`);
  }
});

it("Roles: who may create Viewers and Supervisors", async () => {
  const site = await makeUser({ loginId: "site.admin", role: "LOCATION_ADMIN" });
  assert.equal(site.status, 201);
  const siteToken = (await codeLogin(s.a.company.code, "site.admin")).body.data.token;
  assert.equal((await makeUser({ loginId: "by.site1", role: "SUPERVISOR" }, siteToken)).status, 201, "a location admin hands out supervisor");
  assert.equal((await makeUser({ loginId: "by.site2", role: "VIEWER" }, siteToken)).status, 201);
  assert.equal((await api("POST", "/api/users", { token: s.sup.token, body: { name: "X Y", loginId: "by.sup", password: "Password123", role: "VIEWER", locationIds: [s.loc._id] } })).status, 403);
  assert.equal((await makeUser({ loginId: "bad.role", role: "LOCATION_ADMIN" }, siteToken)).status, 403, "never upwards");
});

it("Lanes: an operator tied to a lane can only use that lane", async () => {
  const made = await makeUser({ loginId: "lane.op", role: "ENTRY_OPERATOR", lanes: [{ locationId: s.loc._id, gate: "In 2" }] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.data.lanes.map((l) => l.gate), ["In 2"]);
  const token = (await codeLogin(s.a.company.code, "lane.op")).body.data.token;

  const wrong = await enter(token, "RJ14LN0001", { gate: "In 1" });
  assert.equal(wrong.status, 403, JSON.stringify(wrong.body));
  const right = await enter(token, "RJ14LN0002", { gate: "In 2" });
  assert.equal(right.status, 201, JSON.stringify(right.body));
  assert.equal(right.body.data.session.entryGate, "In 2");
  const none = await enter(token, "RJ14LN0003");
  assert.equal(none.status, 201, "with one suitable lane, it is used");
  assert.equal(none.body.data.session.entryGate, "In 2");

  // An unlimited user is not restricted.
  assert.equal((await enter(s.sup.token, "RJ14LN0004", { gate: "In 1" })).status, 201);
});

it("Lanes: only real lanes at locations the user works at; editing and location changes keep them in step", async () => {
  assert.equal((await makeUser({ loginId: "bad.lane", role: "ENTRY_OPERATOR", lanes: [{ locationId: s.loc._id, gate: "Nope" }] })).status, 400);
  assert.equal((await makeUser({ loginId: "bad.lane2", role: "ENTRY_OPERATOR", locationIds: [], lanes: [{ locationId: s.loc._id, gate: "In 1" }] })).status, 400);

  const list = (await api("GET", "/api/users", { token: s.a.token })).body.data;
  const op = list.find((u) => u.loginId === "lane.op");
  const changed = await api("PUT", `/api/users/${op._id}`, { token: s.a.token, body: { lanes: [{ locationId: s.loc._id, gate: "In 1" }] } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(changed.body.data.lanes.map((l) => l.gate), ["In 1"]);
  const cleared = await api("PUT", `/api/users/${op._id}`, { token: s.a.token, body: { lanes: [] } });
  assert.deepEqual(cleared.body.data.lanes, []);
  await api("PUT", `/api/users/${op._id}`, { token: s.a.token, body: { lanes: [{ locationId: s.loc._id, gate: "In 1" }] } });
  const moved = await api("PUT", `/api/users/${op._id}`, { token: s.a.token, body: { locationIds: [] } });
  assert.deepEqual(moved.body.data.lanes, [], "lanes of a location the user no longer works at are dropped");
});

it("Licences: a location can be limited, the limit is enforced and shown", async () => {
  const loc2 = await api("POST", "/api/locations", { token: s.b.token, body: { name: "Small", address: { line1: "Road" }, capacity: { car: 5 } } });
  assert.equal(loc2.status, 201);
  s.small = loc2.body.data;
  const mk = (loginId, extra = {}) => makeUser({ loginId, role: "ENTRY_OPERATOR", locationIds: [s.small._id], ...extra }, s.b.token);

  assert.equal((await api("PUT", `/api/users/licences/${s.small._id}`, { token: s.b.token, body: { limit: 2 } })).status, 200);
  assert.equal((await mk("lic.one")).status, 201);
  assert.equal((await mk("lic.two")).status, 201);
  const third = await mk("lic.three");
  assert.equal(third.status, 403, JSON.stringify(third.body));
  assert.match(third.body.message, /licence for 2 users/);

  const view = await api("GET", "/api/users/licences", { token: s.b.token });
  assert.equal(view.status, 200);
  const row = view.body.data.locations.find((l) => String(l.locationId) === String(s.small._id));
  assert.equal(row.limit, 2);
  assert.equal(row.used, 2);
  assert.equal(row.left, 0);
  assert.ok(view.body.data.validUpto, "the trial end is the valid-upto date");

  // Deactivating someone frees a seat; switching them back on needs one.
  const users = (await api("GET", "/api/users", { token: s.b.token })).body.data;
  const one = users.find((u) => u.loginId === "lic.one");
  assert.equal((await api("PUT", `/api/users/${one._id}`, { token: s.b.token, body: { isActive: false } })).status, 200);
  assert.equal((await mk("lic.three")).status, 201);
  const back = await api("PUT", `/api/users/${one._id}`, { token: s.b.token, body: { isActive: true } });
  assert.equal(back.status, 403, "no seat left");
});

it("Licences: cannot go below the staff already there or above the plan; only the company admin sets them", async () => {
  assert.equal((await api("PUT", `/api/users/licences/${s.small._id}`, { token: s.b.token, body: { limit: 1 } })).status, 400, "2 active users already");
  assert.equal((await api("PUT", `/api/users/licences/${s.small._id}`, { token: s.b.token, body: { limit: 100000 } })).status, 400, "more than the plan has");
  const site = await makeUser({ loginId: "lic.site", role: "LOCATION_ADMIN", locationIds: [s.small._id] }, s.b.token);
  assert.equal(site.status, 403, "the seat limit also applies to admins of the location");
  await api("PUT", `/api/users/licences/${s.small._id}`, { token: s.b.token, body: { limit: 3 } });
  assert.equal((await makeUser({ loginId: "lic.site", role: "LOCATION_ADMIN", locationIds: [s.small._id] }, s.b.token)).status, 201);
  const siteToken = (await codeLogin(s.b.company.code, "lic.site")).body.data.token;
  assert.equal((await api("PUT", `/api/users/licences/${s.small._id}`, { token: siteToken, body: { limit: 5 } })).status, 403);
  assert.equal((await api("GET", "/api/users/licences", { token: siteToken })).status, 200);
  // Clearing removes the location's own limit.
  assert.equal((await api("PUT", `/api/users/licences/${s.small._id}`, { token: s.b.token, body: {} })).status, 200);
  const view = await api("GET", "/api/users/licences", { token: s.b.token });
  assert.equal(view.body.data.locations.find((l) => String(l.locationId) === String(s.small._id)).limit, null);
  // Another company's location is not found.
  assert.equal((await api("PUT", `/api/users/licences/${s.small._id}`, { token: s.a.token, body: { limit: 1 } })).status, 404);
});

it("Audit: sign-in failures by Login ID are recorded with the company code and ID", async () => {
  const AuditLog = require("../models/AuditLog");
  const row = await AuditLog.findOne({ action: "AUTH_LOGIN_FAILED", actorEmail: `gate.op1@${s.a.company.code}` });
  assert.ok(row, "the failed attempt is in the audit log");
});

it("Register: optional billing details (GSTIN, city, state) are saved on the company; a bad GSTIN is refused", async () => {
  const body = { companyName: "Billing Co", name: "Owner Bee", email: "owner-bill@example.com", password: "Password123" };
  assert.equal((await api("POST", "/api/auth/register", { body: { ...body, gstNumber: "123" } })).status, 400);
  const ok = await api("POST", "/api/auth/register", { body: { ...body, gstNumber: "23aabcu9603r1zx", city: "Bhopal", state: "Madhya Pradesh" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.company.gstNumber, "23AABCU9603R1ZX");
  assert.equal(ok.body.data.company.address.city, "Bhopal");
  assert.equal(ok.body.data.company.address.state, "Madhya Pradesh");
  assert.match(ok.body.data.company.code, /^[A-Z0-9]{6}$/);
});

it("Register: the admin chooses the company code; it must be free, well formed and not reserved", async () => {
  const body = (n, code) => ({ companyName: `Coded ${n}`, name: "Coded Owner", email: `coded-${n}@example.com`, password: "Password123", ...(code !== undefined ? { companyCode: code } : {}) });
  const free = await api("GET", "/api/auth/company-code?code=acme-park1");
  assert.equal(free.body.data.available, false, "a dash is not allowed");
  const check = await api("GET", "/api/auth/company-code?code=acmepark1");
  assert.deepEqual([check.body.data.code, check.body.data.available], ["ACMEPARK1", true]);

  const made = await api("POST", "/api/auth/register", { body: body(1, " acmepark1 ") });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.company.code, "ACMEPARK1", "stored in upper case");

  assert.equal((await api("GET", "/api/auth/company-code?code=ACMEPARK1")).body.data.available, false, "now taken");
  const again = await api("POST", "/api/auth/register", { body: body(2, "acmepark1") });
  assert.equal(again.status, 409);
  assert.match(again.body.message, /already taken/);
  assert.equal(await User.countDocuments({ email: "coded-2@example.com" }), 0, "nothing is left behind");
  assert.equal((await api("POST", "/api/auth/register", { body: body(3, "ab") })).status, 409, "too short");
  assert.equal((await api("POST", "/api/auth/register", { body: body(4, "admin") })).status, 409, "reserved");

  // The chosen code works for signing in, with an email or a Login ID.
  const signedIn = await api("POST", "/api/auth/login", { body: { companyCode: "acmepark1", email: "coded-1@example.com", password: "Password123" } });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));

  // Left out, one is made for them.
  const auto = await api("POST", "/api/auth/register", { body: body(5) });
  assert.equal(auto.status, 201);
  assert.match(auto.body.data.company.code, /^[A-Z0-9]{6}$/);
});
