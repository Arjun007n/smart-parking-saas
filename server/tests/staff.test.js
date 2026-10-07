// Staff sign-in and access: roles, lanes, company code, Login ID. The rules that need no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLES, PERMISSIONS: P, ROLE_PERMISSIONS, ROLE_RANK, GRANTABLE_PERMISSIONS, PERMISSION_INFO, CUSTOM_BASE_ROLES,
  canManageRole, isCompanyWide, permissionsFor,
} = require("../config/permissions");
const account = require("../services/accountService");
const lanes = require("../services/laneService");

test("viewer can only read reports and change nothing", () => {
  assert.deepEqual(permissionsFor(ROLES.VIEWER), [P.REPORT_VIEW]);
  for (const write of [P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.SESSION_OVERRIDE, P.USER_MANAGE, P.TARIFF_MANAGE]) {
    assert.ok(!permissionsFor(ROLES.VIEWER).includes(write), `viewer must not have ${write}`);
  }
});

test("supervisor operates and oversees, but manages no users, tariffs or settings", () => {
  const own = permissionsFor(ROLES.SUPERVISOR);
  for (const key of [P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW, P.SESSION_OVERRIDE]) {
    assert.ok(own.includes(key), `supervisor needs ${key}`);
  }
  for (const key of [P.USER_MANAGE, P.TARIFF_MANAGE, P.LOCATION_MANAGE, P.COMPANY_MANAGE, P.ROLE_MANAGE, P.WALLET_MANAGE, P.PASS_MANAGE]) {
    assert.ok(!own.includes(key), `supervisor must not have ${key}`);
  }
});

test("ranks: location admin > supervisor > operators > viewer", () => {
  assert.ok(canManageRole(ROLES.LOCATION_ADMIN, ROLES.SUPERVISOR));
  assert.ok(canManageRole(ROLES.LOCATION_ADMIN, ROLES.VIEWER));
  assert.ok(canManageRole(ROLES.COMPANY_ADMIN, ROLES.SUPERVISOR));
  assert.ok(canManageRole(ROLES.SUPERVISOR, ROLES.VIEWER) === true, "rank alone: supervisor is above viewer");
  assert.ok(!canManageRole(ROLES.SUPERVISOR, ROLES.LOCATION_ADMIN));
  assert.ok(!canManageRole(ROLES.VIEWER, ROLES.VIEWER));
  assert.ok(ROLE_RANK[ROLES.SUPERVISOR] > ROLE_RANK[ROLES.ENTRY_OPERATOR]);
  assert.ok(ROLE_RANK[ROLES.VIEWER] < ROLE_RANK[ROLES.ENTRY_OPERATOR]);
  // Only the company admin and platform see every location; the new roles are per location.
  assert.ok(!isCompanyWide(ROLES.SUPERVISOR) && !isCompanyWide(ROLES.VIEWER));
});

test("correcting tickets is a named permission that admins and supervisors hold", () => {
  for (const role of [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.LOCATION_ADMIN, ROLES.SUPERVISOR]) {
    assert.ok(ROLE_PERMISSIONS[role].includes(P.SESSION_OVERRIDE), `${role} corrects tickets`);
  }
  for (const role of [ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR, ROLES.COLLECTION_OPERATOR, ROLES.VIEWER]) {
    assert.ok(!ROLE_PERMISSIONS[role].includes(P.SESSION_OVERRIDE), `${role} must not correct tickets`);
  }
  assert.ok(GRANTABLE_PERMISSIONS.includes(P.SESSION_OVERRIDE));
  assert.ok(PERMISSION_INFO[P.SESSION_OVERRIDE].label);
});

test("company codes are short, readable and unambiguous", async () => {
  const taken = new Set();
  const fake = { exists: async ({ code }) => taken.has(code) };
  for (let i = 0; i < 200; i += 1) {
    const code = await account.uniqueCompanyCode(fake);
    assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
    taken.add(code);
  }
  assert.equal(taken.size, 200);
});

test("a code that is already taken is not handed out again", async () => {
  let calls = 0;
  const fake = { exists: async () => (calls++ < 3 ? { _id: 1 } : null) };
  assert.match(await account.uniqueCompanyCode(fake), /^[A-Z0-9]{6}$/);
  assert.equal(calls, 4);
  await assert.rejects(account.uniqueCompanyCode({ exists: async () => ({ _id: 1 }) }));
});

test("Login IDs and company codes are cleaned before use", () => {
  assert.equal(account.normalizeLoginId("  Gate.Op-1 "), "gate.op-1");
  assert.equal(account.normalizeLoginId(undefined), "");
  assert.equal(account.normalizeCompanyCode(" ab c 234 "), "ABC234");
  for (const good of ["abc", "gate.op-1", "op_2", "a1b2c3"]) assert.match(good, account.LOGIN_ID_PATTERN);
  for (const bad of ["ab", "-abc", "has space", "x".repeat(31), "UPPER", "a@b"]) assert.doesNotMatch(bad, account.LOGIN_ID_PATTERN);
});

// ---- lanes ----
const location = {
  _id: "L1", name: "Mall",
  gates: [{ name: "In 1", type: "ENTRY" }, { name: "In 2", type: "ENTRY" }, { name: "Out 1", type: "EXIT" }, { name: "Both", type: "BOTH" }],
};
const as = (mine) => ({ user: { lanes: mine.map((gate) => ({ locationId: "L1", gate })) } });

test("a user without lanes may use any lane", () => {
  assert.equal(lanes.resolveGate({ user: { lanes: [] } }, location, "ENTRY", "In 2"), "In 2");
  assert.equal(lanes.resolveGate({ user: {} }, location, "ENTRY", undefined), undefined);
  assert.equal(lanes.assignedGates({ lanes: [{ locationId: "OTHER", gate: "In 1" }] }, location), null, "lanes at another location do not limit this one");
});

test("a user with lanes may only use those", () => {
  const req = as(["In 1", "Out 1"]);
  assert.equal(lanes.resolveGate(req, location, "ENTRY", "In 1"), "In 1");
  assert.equal(lanes.resolveGate(req, location, "EXIT", "Out 1"), "Out 1");
  assert.throws(() => lanes.resolveGate(req, location, "ENTRY", "In 2"), /not assigned to lane In 2/);
});

test("with no lane named, the only suitable lane is used; with several the user must choose", () => {
  assert.equal(lanes.resolveGate(as(["In 1", "Out 1"]), location, "ENTRY"), "In 1");
  assert.equal(lanes.resolveGate(as(["In 1", "Out 1"]), location, "EXIT"), "Out 1");
  assert.throws(() => lanes.resolveGate(as(["In 1", "In 2"]), location, "ENTRY"), /Choose one of your lanes/);
});

test("a lane of the wrong direction does not count", () => {
  assert.throws(() => lanes.resolveGate(as(["Out 1"]), location, "ENTRY", "Out 1"), /not assigned to an entry lane/);
  assert.equal(lanes.resolveGate(as(["Both"]), location, "ENTRY", "Both"), "Both");
  assert.equal(lanes.resolveGate(as(["Both"]), location, "EXIT"), "Both");
});

test("a lane removed from the location no longer counts", () => {
  assert.throws(() => lanes.resolveGate(as(["Gone"]), location, "ENTRY"), /not assigned to an entry lane/);
});

test("soft mode (re-entry) swaps in the user's own lane", () => {
  assert.equal(lanes.resolveGate(as(["In 2"]), location, "ENTRY", "In 1", { soft: true }), "In 2");
  assert.equal(lanes.resolveGate(as(["In 1", "In 2"]), location, "ENTRY", undefined, { soft: true }), "In 1");
});

test("assigning lanes checks the location, the lane and that the user works there", () => {
  const locations = [location];
  const ok = lanes.checkAssignment(
    [{ locationId: "L1", gate: "In 1" }, { locationId: "L1", gate: "In 1" }, { locationId: "L1", gate: "Out 1" }], locations, ["L1"]
  );
  assert.deepEqual(ok.map((l) => l.gate), ["In 1", "Out 1"], "repeats are dropped");
  assert.throws(() => lanes.checkAssignment([{ locationId: "L1", gate: "Nope" }], locations, ["L1"]), /no lane called/);
  assert.throws(() => lanes.checkAssignment([{ locationId: "L9", gate: "In 1" }], locations, ["L1"]), /not found/);
  assert.throws(() => lanes.checkAssignment([{ locationId: "L1", gate: "In 1" }], locations, []), /Assign Mall/);
});

test("a chosen company code is checked for shape, reserved words and whether it is taken", async () => {
  const taken = new Set(["ACME2026"]);
  const fake = { exists: async ({ code }) => taken.has(code) };
  assert.equal(await account.codeProblem(fake, "ACMEPARK"), null);
  assert.match(await account.codeProblem(fake, "ACME2026"), /already taken/);
  assert.match(await account.codeProblem(fake, "AB"), /4 to 12/);
  assert.match(await account.codeProblem(fake, "HAS SPACE"), /4 to 12/);
  assert.match(await account.codeProblem(fake, "TOOLONGCODE123"), /4 to 12/);
  assert.match(await account.codeProblem(fake, "ADMIN"), /not available/);
});

test("a government officer has the government reports and nothing else, and no custom role can give more", () => {
  assert.deepEqual(permissionsFor(ROLES.GOVERNMENT_OFFICER), [P.GOVERNMENT_REPORT]);
  assert.ok(ROLE_RANK[ROLES.GOVERNMENT_OFFICER] < ROLE_RANK[ROLES.VIEWER], "ranked below everybody");
  assert.ok(!GRANTABLE_PERMISSIONS.includes(P.GOVERNMENT_REPORT), "a custom role cannot carry it");
  assert.ok(!CUSTOM_BASE_ROLES.includes(ROLES.GOVERNMENT_OFFICER), "and cannot be built on the officer role");
  assert.ok(!isCompanyWide(ROLES.GOVERNMENT_OFFICER), "an officer only sees the locations they were given");
  // The admins who create officers hold the permission themselves; operators and viewers do not.
  assert.ok(permissionsFor(ROLES.COMPANY_ADMIN).includes(P.GOVERNMENT_REPORT));
  assert.ok(permissionsFor(ROLES.LOCATION_ADMIN).includes(P.GOVERNMENT_REPORT));
  for (const role of [ROLES.SUPERVISOR, ROLES.GATE_OPERATOR, ROLES.VIEWER]) assert.ok(!permissionsFor(role).includes(P.GOVERNMENT_REPORT));
  // Only officers' own permission list lacks every other permission.
  for (const permission of Object.values(P)) {
    if (permission !== P.GOVERNMENT_REPORT) assert.ok(!permissionsFor(ROLES.GOVERNMENT_OFFICER).includes(permission), `${permission} must not be an officer's`);
  }
});
