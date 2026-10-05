// Custom roles: the rules that need no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLES, PERMISSIONS: P, ROLE_PERMISSIONS, GRANTABLE_PERMISSIONS, CUSTOM_BASE_ROLES, PERMISSION_INFO,
  isCompanyWide, permissionsFor,
} = require("../config/permissions");
const { requirePermission, requireAnyPermission, can } = require("../middleware/permission");
const roleService = require("../services/roleService");
const Role = require("../models/Role");

const run = (middleware, req) => {
  let result;
  middleware(req, {}, (error) => { result = error || null; });
  return result;
};

test("what a custom role may carry is limited", () => {
  for (const blocked of [P.COMPANY_MANAGE, P.PLATFORM_MANAGE, P.ROLE_MANAGE]) {
    assert.ok(!GRANTABLE_PERMISSIONS.includes(blocked), `${blocked} must not be grantable`);
  }
  for (const key of GRANTABLE_PERMISSIONS) {
    assert.ok(PERMISSION_INFO[key]?.label && PERMISSION_INFO[key]?.description, `${key} needs a label`);
    assert.ok(Object.values(P).includes(key));
  }
  // Company-wide roles cannot be a base: nobody but the platform could manage them.
  for (const base of CUSTOM_BASE_ROLES) assert.ok(!isCompanyWide(base), `${base} is company-wide`);
  assert.ok(!CUSTOM_BASE_ROLES.includes(ROLES.SUPER_ADMIN));
  assert.ok(!CUSTOM_BASE_ROLES.includes(ROLES.COMPANY_ADMIN));
});

test("only the company admin and the platform can edit roles", () => {
  assert.ok(ROLE_PERMISSIONS[ROLES.COMPANY_ADMIN].includes(P.ROLE_MANAGE));
  assert.ok(ROLE_PERMISSIONS[ROLES.SUPER_ADMIN].includes(P.ROLE_MANAGE));
  for (const role of [ROLES.LOCATION_ADMIN, ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR, ROLES.COLLECTION_OPERATOR]) {
    assert.ok(!permissionsFor(role).includes(P.ROLE_MANAGE), `${role} must not manage roles`);
  }
});

test("permission checks use the user's own permission list when there is one", () => {
  // An entry operator whose custom role allows reports only.
  const req = { user: { role: ROLES.ENTRY_OPERATOR }, permissions: [P.REPORT_VIEW] };
  assert.equal(run(requirePermission(P.REPORT_VIEW), req), null);
  assert.equal(run(requirePermission(P.ENTRY_CREATE), req).statusCode, 403, "base role rights do not leak through");
  assert.equal(run(requireAnyPermission(P.ENTRY_CREATE, P.REPORT_VIEW), req), null);
  assert.equal(can(req, P.REPORT_VIEW), true);
  assert.equal(can(req, P.ENTRY_CREATE), false);

  // A custom role with nothing allowed blocks everything.
  const none = { user: { role: ROLES.LOCATION_ADMIN }, permissions: [] };
  assert.equal(run(requirePermission(P.REPORT_VIEW), none).statusCode, 403);

  // Without a list the built-in role decides, as before.
  const plain = { user: { role: ROLES.ENTRY_OPERATOR } };
  assert.equal(run(requirePermission(P.ENTRY_CREATE), plain), null);
  assert.equal(run(requirePermission(P.REPORT_VIEW), plain).statusCode, 403);
});

test("permission lists are cleaned and unknown or forbidden ones are refused", () => {
  assert.deepEqual(
    roleService.normalizePermissions([P.REPORT_VIEW, P.ENTRY_CREATE, P.REPORT_VIEW]),
    [P.ENTRY_CREATE, P.REPORT_VIEW],
    "duplicates dropped, order stable"
  );
  assert.deepEqual(roleService.normalizePermissions([]), []);
  for (const bad of [P.COMPANY_MANAGE, P.PLATFORM_MANAGE, P.ROLE_MANAGE, "MADE_UP"]) {
    assert.throws(() => roleService.normalizePermissions([P.REPORT_VIEW, bad]), (e) => e.statusCode === 400);
  }
});

test("a role can only be handed out by someone who outranks it and holds its permissions", () => {
  const role = (baseRole, permissions) => ({ baseRole, permissions });
  const companyAdmin = { role: ROLES.COMPANY_ADMIN };
  const locationAdmin = { role: ROLES.LOCATION_ADMIN };
  const all = permissionsFor(ROLES.COMPANY_ADMIN);
  const locAll = permissionsFor(ROLES.LOCATION_ADMIN);

  assert.ok(roleService.canAssign(companyAdmin, all, role(ROLES.LOCATION_ADMIN, [P.REPORT_VIEW])));
  assert.ok(roleService.canAssign(locationAdmin, locAll, role(ROLES.ENTRY_OPERATOR, [P.ENTRY_CREATE, P.REPORT_VIEW])));
  // Same rank is not enough.
  assert.ok(!roleService.canAssign(locationAdmin, locAll, role(ROLES.LOCATION_ADMIN, [P.REPORT_VIEW])));
  // A custom-role location admin who lacks a permission cannot give it away.
  assert.ok(!roleService.canAssign(locationAdmin, [P.USER_MANAGE], role(ROLES.ENTRY_OPERATOR, [P.TARIFF_MANAGE])));
  // Nobody can use a company-wide base role.
  assert.ok(!roleService.canAssign({ role: ROLES.SUPER_ADMIN }, permissionsFor(ROLES.SUPER_ADMIN), role(ROLES.COMPANY_ADMIN, [])));
});

test("a role's author cannot create or edit a role with rights they lack", () => {
  const req = (user, permissions) => ({ user, permissions });
  const admin = req({ role: ROLES.COMPANY_ADMIN }, permissionsFor(ROLES.COMPANY_ADMIN));
  assert.doesNotThrow(() => roleService.checkWithinActor(admin, [P.TARIFF_MANAGE], ROLES.LOCATION_ADMIN));
  assert.throws(() => roleService.checkWithinActor(admin, [P.TARIFF_MANAGE], ROLES.COMPANY_ADMIN), (e) => e.statusCode === 403);
  const limited = req({ role: ROLES.COMPANY_ADMIN }, [P.ROLE_MANAGE, P.REPORT_VIEW]);
  assert.throws(() => roleService.checkWithinActor(limited, [P.TARIFF_MANAGE], ROLES.ENTRY_OPERATOR), (e) => e.statusCode === 403);
});

test("accessOf: built-in role, custom role, and a custom role that has gone missing", async () => {
  const original = Role.findOne;
  try {
    const user = (extra) => ({ role: ROLES.ENTRY_OPERATOR, companyId: "c1", ...extra });
    // No custom role: the built-in list, with no database call.
    Role.findOne = () => { throw new Error("must not be called"); };
    let access = await roleService.accessOf(user());
    assert.deepEqual(access.permissions, [P.ENTRY_CREATE]);
    assert.equal(access.customRole, null);
    access = await roleService.accessOf({ role: ROLES.SUPER_ADMIN, customRoleId: "x" });
    assert.ok(access.permissions.includes(P.PLATFORM_MANAGE), "super admin ignores custom roles");

    // A custom role replaces the list, and anything that must not be there is cut.
    let asked;
    Role.findOne = (filter) => ({
      lean: async () => {
        asked = filter;
        return { _id: "r1", name: "Reports", permissions: [P.REPORT_VIEW, P.COMPANY_MANAGE] };
      },
    });
    access = await roleService.accessOf(user({ customRoleId: "r1" }));
    assert.deepEqual(access.permissions, [P.REPORT_VIEW]);
    assert.deepEqual(access.customRole, { id: "r1", name: "Reports" });
    assert.deepEqual(asked, { _id: "r1", companyId: "c1" }, "looked up inside the user's own company");

    // Role gone: nothing is allowed.
    Role.findOne = () => ({ lean: async () => null });
    access = await roleService.accessOf(user({ customRoleId: "r1" }));
    assert.deepEqual(access.permissions, []);
  } finally {
    Role.findOne = original;
  }
});

test("a role needs a name, a base role and only grantable permissions", async () => {
  const COMPANY = "507f1f77bcf86cd799439011";
  const errorsOf = async (data) => {
    try {
      await new Role(data).validate();
      return null;
    } catch (error) {
      return error.errors;
    }
  };
  const ok = new Role({ companyId: COMPANY, name: "  Shift Lead ", baseRole: ROLES.LOCATION_ADMIN, permissions: [P.REPORT_VIEW] });
  await ok.validate();
  assert.equal(ok.name, "Shift Lead");
  // The lower-case key that makes names unique per company is set before saving.
  assert.equal(ok.nameKey, "shift lead");
  assert.equal(ok.toJSON().nameKey, undefined);

  assert.ok((await errorsOf({ companyId: COMPANY, name: "x", baseRole: ROLES.COMPANY_ADMIN })).baseRole);
  assert.ok(await errorsOf({ companyId: COMPANY, name: "Bad", baseRole: ROLES.ENTRY_OPERATOR, permissions: [P.COMPANY_MANAGE] }));
  assert.ok((await errorsOf({ name: "Orphan", baseRole: ROLES.ENTRY_OPERATOR })).companyId);
});

// The user controller's role-switching rules, run against stand-in models.
test("updating a user: custom role, built-in role and clearing, and who may do it", async () => {
  const User = require("../models/User");
  const Operator = require("../models/Operator");
  const audit = require("../services/auditService");
  const controller = require("../controllers/userController");
  const saved = { User: User.findOne, OpFind: Operator.find, RoleFind: Role.find, RoleOne: Role.findOne, record: audit.record };

  const COMPANY = "507f1f77bcf86cd799439011";
  const reportsRole = { _id: "r-reports", companyId: COMPANY, name: "Reports", baseRole: ROLES.EXIT_OPERATOR, permissions: [P.REPORT_VIEW] };
  const makeUser = (extra = {}) => {
    const user = {
      _id: "u1", companyId: COMPANY, role: ROLES.ENTRY_OPERATOR, locationIds: [], tokenVersion: 0, isActive: true,
      saves: 0, async save() { this.saves += 1; },
      toJSON() { return { _id: this._id, role: this.role, customRoleId: this.customRoleId }; },
      ...extra,
    };
    return user;
  };
  const actor = { role: ROLES.COMPANY_ADMIN, locationIds: [] };
  const call = async (user, body, { cleared = [], who = actor, perms = permissionsFor(who.role) } = {}) => {
    User.findOne = async () => user;
    let sent;
    const req = { params: { id: "u1" }, body, cleared, user: who, permissions: perms, tenantFilter: { companyId: COMPANY }, headers: {} };
    const res = { json: (payload) => { sent = payload; } };
    await controller.updateUser(req, res);
    return sent.data;
  };

  try {
    Operator.find = () => ({ lean: async () => [] });
    Role.find = () => ({ select: () => ({ lean: async () => [reportsRole] }) });
    // Like a Mongoose query: can be awaited, or turned plain with .lean().
    const query = (value) => ({ then: (resolve, reject) => Promise.resolve(value).then(resolve, reject), lean: async () => value });
    Role.findOne = (filter) => query(filter._id === reportsRole._id ? { ...reportsRole, toObject() { return this; } } : null);
    audit.record = async () => {};

    // Give a custom role: the user's role becomes its base role, sessions end.
    let user = makeUser();
    let out = await call(user, { customRoleId: "r-reports" });
    assert.equal(user.customRoleId, "r-reports");
    assert.equal(user.role, ROLES.EXIT_OPERATOR);
    assert.equal(user.tokenVersion, 1);
    assert.equal(out.customRole.name, "Reports");

    // The same role again changes nothing and ends no session.
    await call(user, { customRoleId: "r-reports" });
    assert.equal(user.tokenVersion, 1);

    // A role of another company (not found) is refused.
    await assert.rejects(call(makeUser(), { customRoleId: "elsewhere" }), (e) => e.statusCode === 404);
    // A mismatching built-in role next to a custom role is refused.
    await assert.rejects(call(makeUser(), { customRoleId: "r-reports", role: ROLES.ENTRY_OPERATOR }), (e) => e.statusCode === 400);

    // Choosing a built-in role replaces the custom role.
    user = makeUser({ role: ROLES.EXIT_OPERATOR, customRoleId: "r-reports" });
    await call(user, { role: ROLES.EXIT_OPERATOR });
    assert.equal(user.customRoleId, undefined);
    assert.equal(user.role, ROLES.EXIT_OPERATOR);
    assert.equal(user.tokenVersion, 1);

    // Clearing keeps the base role.
    user = makeUser({ role: ROLES.EXIT_OPERATOR, customRoleId: "r-reports" });
    await call(user, {}, { cleared: ["customRoleId"] });
    assert.equal(user.customRoleId, undefined);
    assert.equal(user.role, ROLES.EXIT_OPERATOR);
    assert.equal(user.tokenVersion, 1);

    // Editing only the name leaves the custom role and the sessions alone.
    user = makeUser({ role: ROLES.EXIT_OPERATOR, customRoleId: "r-reports" });
    await call(user, { name: "New Name" });
    assert.equal(user.customRoleId, "r-reports");
    assert.equal(user.tokenVersion, 0);

    // A location admin may not give a role whose base role is not below them.
    const locationAdmin = { role: ROLES.LOCATION_ADMIN, locationIds: [] };
    Role.findOne = () => query({ ...reportsRole, baseRole: ROLES.LOCATION_ADMIN, toObject() { return this; } });
    await assert.rejects(call(makeUser(), { customRoleId: "r-reports" }, { who: locationAdmin }), (e) => e.statusCode === 403);
    // Nor one that carries a permission they do not hold themselves.
    Role.findOne = () => query({ ...reportsRole, permissions: [P.TARIFF_MANAGE], toObject() { return this; } });
    await assert.rejects(
      call(makeUser(), { customRoleId: "r-reports" }, { who: locationAdmin, perms: [P.USER_MANAGE] }),
      (e) => e.statusCode === 403
    );

    // Nobody can pass on access they do not hold themselves. This actor has a
    // custom role with USER_MANAGE only (location admin rank).
    const narrow = { role: ROLES.LOCATION_ADMIN, locationIds: [] };
    const narrowPerms = [P.USER_MANAGE];
    Role.findOne = () => query(null);
    await assert.rejects(
      call(makeUser(), { role: ROLES.EXIT_OPERATOR }, { who: narrow, perms: narrowPerms }),
      (e) => e.statusCode === 403, "cannot change the role of a user who can do more than the actor"
    );
    await assert.rejects(
      call(makeUser(), { password: "NewPassword123" }, { who: narrow, perms: narrowPerms }),
      (e) => e.statusCode === 403, "cannot reset the password of a user who can do more than the actor"
    );
    await assert.rejects(
      call(makeUser({ customRoleId: "r-reports" }), {}, { who: narrow, perms: narrowPerms, cleared: ["customRoleId"] }),
      (e) => e.statusCode === 403, "cannot clear a role either"
    );
    // The target is within the actor's permissions, but the new built-in role is not.
    await assert.rejects(
      call(makeUser(), { role: ROLES.EXIT_OPERATOR }, { who: narrow, perms: [P.USER_MANAGE, P.ENTRY_CREATE] }),
      (e) => e.statusCode === 403, "cannot give a role with permissions the actor lacks"
    );
    // Plain edits that hand over no access are still fine.
    const plainEdit = makeUser();
    await call(plainEdit, { name: "Renamed" }, { who: narrow, perms: narrowPerms });
    assert.equal(plainEdit.saves, 1);

    // Creating a user with a built-in role is held to the same ceiling.
    await assert.rejects(
      controller.createUser(
        { body: { name: "New", email: "n@example.com", password: "Password123", role: ROLES.COLLECTION_OPERATOR }, user: narrow, permissions: narrowPerms, companyId: COMPANY, headers: {} },
        { status: () => ({ json() {} }) }
      ),
      (e) => e.statusCode === 403
    );
  } finally {
    User.findOne = saved.User; Operator.find = saved.OpFind; Role.find = saved.RoleFind;
    Role.findOne = saved.RoleOne; audit.record = saved.record;
  }
});
