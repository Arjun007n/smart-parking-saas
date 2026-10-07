// Custom roles through the API: who may edit them, who may hand them out,
// how permissions change at once, and that companies stay apart.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, withCode, assert } = require("./helpers");
const AuditLog = require("../models/AuditLog");

setup();

const s = {};
const role = (body, token = s.a.token) =>
  api("POST", "/api/roles", { token, body: { name: "Gate reports", baseRole: "ENTRY_OPERATOR", permissions: ["ENTRY_CREATE", "REPORT_VIEW"], ...body } });
const newUser = (body, token = s.a.token) =>
  api("POST", "/api/users", { token, body: { name: "Staff", password: "Password123", locationIds: [s.loc._id], ...body } });

it("setup: two companies, a location, a location admin", async () => {
  s.a = await registerCompany("ra");
  s.b = await registerCompany("rb");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Main", address: { line1: "MG Road" }, capacity: { car: 10 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const admin = await newUser({ email: "ra-site@example.com", role: "LOCATION_ADMIN" });
  assert.equal(admin.status, 201, JSON.stringify(admin.body));
  s.site = await login("ra-site@example.com");
  await newUser({ email: "ra-op@example.com", role: "ENTRY_OPERATOR" });
  s.plainOp = await login("ra-op@example.com");
});

it("roles: only the company admin edits them; people who manage users can read them", async () => {
  assert.equal((await role({}, s.site)).status, 403, "a location admin cannot create roles");
  assert.equal((await role({}, s.plainOp)).status, 403);
  assert.equal((await api("GET", "/api/roles", { token: s.plainOp })).status, 403);
  assert.equal((await api("GET", "/api/roles", { token: s.site })).status, 200, "location admins can see roles to hand them out");
  assert.equal((await api("GET", "/api/roles/catalog", { token: s.site })).status, 403);

  const catalog = await api("GET", "/api/roles/catalog", { token: s.a.token });
  assert.equal(catalog.status, 200);
  const keys = catalog.body.data.permissions.map((p) => p.key);
  assert.ok(keys.includes("REPORT_VIEW"));
  for (const hidden of ["COMPANY_MANAGE", "PLATFORM_MANAGE", "ROLE_MANAGE"]) assert.ok(!keys.includes(hidden));
  assert.ok(!catalog.body.data.baseRoles.includes("COMPANY_ADMIN"));
});

it("roles: creating one checks the name, base role and permissions", async () => {
  assert.equal((await role({ permissions: ["COMPANY_MANAGE"] })).status, 400, "company settings cannot be granted");
  assert.equal((await role({ permissions: ["ROLE_MANAGE"] })).status, 400);
  assert.equal((await role({ permissions: ["MADE_UP"] })).status, 400);
  assert.equal((await role({ baseRole: "COMPANY_ADMIN" })).status, 400, "company-wide roles are not a base");
  assert.equal((await role({ baseRole: "SUPER_ADMIN" })).status, 400);
  assert.equal((await role({ name: "x" })).status, 400);

  const created = await role({});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  s.role = created.body.data;
  assert.deepEqual(s.role.permissions, ["ENTRY_CREATE", "REPORT_VIEW"]);
  assert.equal(s.role.userCount, 0);
  assert.equal(s.role.nameKey, undefined);

  assert.equal((await role({ name: "GATE REPORTS" })).status, 409, "names are unique, ignoring case");
  assert.equal((await role({ name: "Gate reports" }, s.b.token)).status, 201, "another company may reuse the name");
});

it("users: a custom role sets the permissions, the base role sets the rank", async () => {
  const created = await newUser({ email: "ra-cr@example.com", customRoleId: s.role._id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.role, "ENTRY_OPERATOR", "role comes from the base role");
  assert.equal(created.body.data.customRole.name, "Gate reports");
  s.crId = created.body.data._id;

  const logged = await api("POST", "/api/auth/login", { body: await withCode({ email: "ra-cr@example.com", password: "Password123" }) });
  assert.equal(logged.status, 200);
  assert.deepEqual(logged.body.data.permissions, ["ENTRY_CREATE", "REPORT_VIEW"]);
  assert.equal(logged.body.data.user.customRole.name, "Gate reports");
  s.cr = logged.body.data.token;

  const me = await api("GET", "/api/auth/me", { token: s.cr });
  assert.deepEqual(me.body.data.permissions, ["ENTRY_CREATE", "REPORT_VIEW"]);
  assert.equal(me.body.data.user.customRole.name, "Gate reports");

  // A plain entry operator has no reports; this one does.
  assert.equal((await api("GET", "/api/dashboard", { token: s.plainOp })).status, 403);
  assert.equal((await api("GET", "/api/dashboard", { token: s.cr })).status, 200);
  // Still an entry operator by rank: it manages nobody and creates no users.
  assert.equal((await api("GET", "/api/users", { token: s.cr })).status, 403);

  assert.equal((await newUser({ email: "ra-cr2@example.com", customRoleId: s.role._id, role: "EXIT_OPERATOR" })).status, 400, "role must match the base role");
  assert.equal((await newUser({ email: "ra-cr3@example.com", customRoleId: "507f1f77bcf86cd799439011" })).status, 404);
  assert.equal((await newUser({ email: "ra-cr4@example.com" })).status, 400, "a role of some kind is needed");
});

it("roles: a change reaches people who are already logged in, with no new login", async () => {
  const dropped = await api("PUT", `/api/roles/${s.role._id}`, { token: s.a.token, body: { permissions: ["ENTRY_CREATE"] } });
  assert.equal(dropped.status, 200, JSON.stringify(dropped.body));
  assert.equal(dropped.body.data.userCount, 1);
  assert.equal((await api("GET", "/api/dashboard", { token: s.cr })).status, 403, "the old token lost reports at once");
  assert.equal((await api("GET", "/api/auth/me", { token: s.cr })).status, 200, "and is still logged in");

  const none = await api("PUT", `/api/roles/${s.role._id}`, { token: s.a.token, body: { permissions: [] } });
  assert.equal(none.status, 200);
  const me = await api("GET", "/api/auth/me", { token: s.cr });
  assert.deepEqual(me.body.data.permissions, [], "a role with nothing allowed gives nothing, not the base role's rights");

  await api("PUT", `/api/roles/${s.role._id}`, { token: s.a.token, body: { permissions: ["ENTRY_CREATE", "REPORT_VIEW"], description: "Gate staff who see reports" } });
  assert.equal((await api("GET", "/api/dashboard", { token: s.cr })).status, 200);

  const bad = await api("PUT", `/api/roles/${s.role._id}`, { token: s.a.token, body: { permissions: ["COMPANY_MANAGE"] } });
  assert.equal(bad.status, 400);
  assert.equal((await api("PUT", `/api/roles/${s.role._id}`, { token: s.site, body: { name: "Hijack" } })).status, 403);
});

it("users: a location admin hands out only roles below them that they could give themselves", async () => {
  const list = await api("GET", "/api/roles", { token: s.site });
  assert.equal(list.body.data.find((r) => r._id === s.role._id).assignable, true);

  const high = await role({ name: "Site manager", baseRole: "LOCATION_ADMIN", permissions: ["REPORT_VIEW", "USER_MANAGE"] });
  assert.equal(high.status, 201);
  const sameRank = await newUser({ email: "ra-hi@example.com", customRoleId: high.body.data._id }, s.site);
  assert.equal(sameRank.status, 403, "a location admin cannot create another one");
  assert.equal((await api("GET", "/api/roles", { token: s.site })).body.data.find((r) => r._id === high.body.data._id).assignable, false);
  assert.equal((await newUser({ email: "ra-hi@example.com", customRoleId: high.body.data._id })).status, 201, "the company admin can");

  const low = await newUser({ email: "ra-low@example.com", customRoleId: s.role._id }, s.site);
  assert.equal(low.status, 201, JSON.stringify(low.body));
  s.lowId = low.body.data._id;

  // A custom-role location admin who lacks a permission cannot give it away.
  const narrow = await role({ name: "Narrow admin", baseRole: "LOCATION_ADMIN", permissions: ["USER_MANAGE"] });
  const narrowUser = await newUser({ email: "ra-narrow@example.com", customRoleId: narrow.body.data._id });
  assert.equal(narrowUser.status, 201);
  const narrowToken = await login("ra-narrow@example.com");
  const attempt = await newUser({ email: "ra-narrow-child@example.com", customRoleId: s.role._id }, narrowToken);
  assert.equal(attempt.status, 403, "REPORT_VIEW is not theirs to give");
  assert.equal((await newUser({ email: "ra-narrow-child@example.com", role: "ENTRY_OPERATOR" }, narrowToken)).status, 403, "nor can they hand out a standard role that has more than they hold");
  // And they cannot take over a user who can do more than they can.
  assert.equal((await api("PUT", `/api/users/${s.lowId}`, { token: narrowToken, body: { password: "BrandNew12345" } })).status, 403);
  assert.equal((await api("PUT", `/api/users/${s.lowId}`, { token: narrowToken, body: { role: "EXIT_OPERATOR" } })).status, 403);
});

it("users: moving between a custom role and a built-in role", async () => {
  const toBuiltIn = await api("PUT", `/api/users/${s.crId}`, { token: s.a.token, body: { role: "ENTRY_OPERATOR" } });
  assert.equal(toBuiltIn.status, 200, JSON.stringify(toBuiltIn.body));
  assert.equal(toBuiltIn.body.data.customRole, null, "picking a built-in role replaces the custom one");
  assert.equal((await api("GET", "/api/auth/me", { token: s.cr })).status, 401, "sessions end when the role changes");

  const back = await api("PUT", `/api/users/${s.crId}`, { token: s.a.token, body: { customRoleId: s.role._id } });
  assert.equal(back.body.data.customRole.name, "Gate reports");

  const cleared = await api("PUT", `/api/users/${s.crId}`, { token: s.a.token, body: { customRoleId: null } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.data.customRole, null);
  assert.equal(cleared.body.data.role, "ENTRY_OPERATOR", "back to the base role");
  assert.deepEqual((await api("POST", "/api/auth/login", { body: await withCode({ email: "ra-cr@example.com", password: "Password123" }) })).body.data.permissions, ["ENTRY_CREATE"]);

  const users = await api("GET", "/api/users", { token: s.a.token });
  assert.ok(users.body.data.some((u) => u.customRole?.name === "Gate reports"), "the list names custom roles");
});

it("roles: a role that people hold cannot be deleted; companies stay apart", async () => {
  const held = await api("DELETE", `/api/roles/${s.role._id}`, { token: s.a.token });
  assert.equal(held.status, 409, "still held by the user created by the location admin");

  // Company B can neither see, edit, delete nor hand out company A's role.
  const listB = await api("GET", "/api/roles", { token: s.b.token });
  assert.ok(!listB.body.data.some((r) => r._id === s.role._id));
  assert.equal((await api("PUT", `/api/roles/${s.role._id}`, { token: s.b.token, body: { name: "Mine now" } })).status, 404);
  assert.equal((await api("DELETE", `/api/roles/${s.role._id}`, { token: s.b.token })).status, 404);
  assert.equal((await newUser({ email: "rb-x@example.com", customRoleId: s.role._id, locationIds: [] }, s.b.token)).status, 404);

  // Free the role, then it can go.
  await api("PUT", `/api/users/${s.lowId}`, { token: s.a.token, body: { customRoleId: null } });
  const gone = await api("DELETE", `/api/roles/${s.role._id}`, { token: s.a.token });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal((await api("PUT", `/api/roles/${s.role._id}`, { token: s.a.token, body: { name: "Ghost" } })).status, 404);
});

it("roles: every change is in the audit log", async () => {
  const actions = (await AuditLog.find({ companyId: s.a.company._id }).lean()).map((e) => e.action);
  for (const action of ["ROLE_CREATE", "ROLE_UPDATE", "ROLE_DELETE"]) assert.ok(actions.includes(action), action);
});
