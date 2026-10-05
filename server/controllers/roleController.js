const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const Role = require("../models/Role");
const User = require("../models/User");
const roles = require("../services/roleService");
const { permissionsOf } = require("../middleware/permission");
const {
  ROLES, ROLE_PERMISSIONS, CUSTOM_BASE_ROLES, GRANTABLE_PERMISSIONS, PERMISSION_INFO,
} = require("../config/permissions");

// A role as the API shows it: how many users hold it, and whether the person
// asking may hand it out.
const present = (req, role, counts) => ({
  ...role.toJSON(),
  userCount: counts.get(String(role._id)) || 0,
  assignable: roles.canAssign(req.user, permissionsOf(req), role),
});

const countUsers = async (roleIds) => {
  if (!roleIds.length) return new Map();
  const rows = await User.aggregate([
    { $match: { customRoleId: { $in: roleIds } } },
    { $group: { _id: "$customRoleId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

const findRole = async (req) => {
  const role = await Role.findOne({ _id: req.params.id, ...req.tenantFilter });
  if (!role) throw new AppError("Role not found", 404);
  return role;
};

// GET /api/roles
const listRoles = async (req, res) => {
  const found = await Role.find(req.tenantFilter).sort({ nameKey: 1 }).limit(200);
  const counts = await countUsers(found.map((r) => r._id));
  res.json({ success: true, data: found.map((r) => present(req, r, counts)) });
};

// GET /api/roles/catalog
// Everything the role editor needs: what can be granted, which base roles
// exist, and what the built-in roles already allow (for comparison).
const catalog = async (req, res) => {
  res.json({
    success: true,
    data: {
      permissions: GRANTABLE_PERMISSIONS.map((key) => ({ key, ...PERMISSION_INFO[key] })),
      baseRoles: CUSTOM_BASE_ROLES.filter((r) => r !== ROLES.SUPER_ADMIN),
      builtIn: Object.fromEntries(
        Object.entries(ROLE_PERMISSIONS)
          .filter(([role]) => role !== ROLES.SUPER_ADMIN)
          .map(([role, list]) => [role, list.filter((p) => GRANTABLE_PERMISSIONS.includes(p))])
      ),
      maxRoles: roles.MAX_ROLES_PER_COMPANY,
    },
  });
};

// POST /api/roles
const createRole = async (req, res) => {
  const { name, description, baseRole } = req.body;
  const permissions = roles.normalizePermissions(req.body.permissions || []);
  roles.checkWithinActor(req, permissions, baseRole);

  if (await Role.countDocuments(req.tenantFilter) >= roles.MAX_ROLES_PER_COMPANY) {
    throw new AppError(`A company can have up to ${roles.MAX_ROLES_PER_COMPANY} custom roles`, 400);
  }

  let role;
  try {
    role = await Role.create({
      companyId: req.companyId, name, description, baseRole, permissions, createdBy: req.user._id,
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("A role with this name already exists", 409);
    throw error;
  }
  await audit.record(req, "ROLE_CREATE", {
    entity: "Role", entityId: role._id, meta: { name, baseRole, permissions },
  });
  res.status(201).json({ success: true, data: present(req, role, new Map()) });
};

// PUT /api/roles/:id
// The base role is fixed. Permission changes apply at once: permissions are
// read on every request, so nobody has to log in again.
const updateRole = async (req, res) => {
  const role = await findRole(req);
  const before = [...role.permissions];
  const { name, description } = req.body;

  if (req.body.permissions !== undefined) {
    const permissions = roles.normalizePermissions(req.body.permissions);
    roles.checkWithinActor(req, permissions);
    role.permissions = permissions;
  }
  // Editing a role the actor may not assign (higher base role) is not allowed.
  if (!roles.canAssign(req.user, permissionsOf(req), { ...role.toObject(), permissions: before })) {
    throw new AppError("You cannot change this role", 403);
  }
  if (name !== undefined) role.name = name;
  if (description !== undefined) role.description = description;

  try {
    await role.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("A role with this name already exists", 409);
    throw error;
  }
  await audit.record(req, "ROLE_UPDATE", {
    entity: "Role", entityId: role._id, companyId: role.companyId,
    meta: { name: role.name, before, after: role.permissions },
  });
  const counts = await countUsers([role._id]);
  res.json({ success: true, data: present(req, role, counts) });
};

// DELETE /api/roles/:id
// A role that people still hold cannot be deleted: move them first.
const deleteRole = async (req, res) => {
  const role = await findRole(req);
  const holders = await User.countDocuments({ customRoleId: role._id });
  if (holders) {
    throw new AppError(`${holders} user(s) still have this role. Give them another role first.`, 409);
  }
  await role.deleteOne();
  await audit.record(req, "ROLE_DELETE", {
    entity: "Role", entityId: role._id, companyId: role.companyId, meta: { name: role.name },
  });
  res.json({ success: true, message: "Role deleted" });
};

module.exports = { listRoles, catalog, createRole, updateRole, deleteRole };
