const Role = require("../models/Role");
const AppError = require("../utils/AppError");
const {
  ROLES, GRANTABLE_PERMISSIONS, CUSTOM_BASE_ROLES, permissionsFor, canManageRole,
} = require("../config/permissions");

const MAX_ROLES_PER_COMPANY = 50;

// What a user may do right now, and the custom role (if any) that says so.
//
// Without a custom role this is the built-in role's list. With one it is the
// custom role's list, cut down to what a custom role may ever carry. A user
// whose custom role cannot be found gets nothing (fail closed), never the
// base role's permissions.
const accessOf = async (user) => {
  if (!user.customRoleId || user.role === ROLES.SUPER_ADMIN) {
    return { permissions: permissionsFor(user.role), customRole: null };
  }
  const role = await Role.findOne({ _id: user.customRoleId, companyId: user.companyId }).lean();
  if (!role) return { permissions: [], customRole: null };
  return {
    permissions: role.permissions.filter((p) => GRANTABLE_PERMISSIONS.includes(p)),
    customRole: { id: role._id, name: role.name },
  };
};

// Can this actor hand out this role? The base role must be below the actor's
// rank, and the actor may not give away a permission they do not hold.
const canAssign = (actor, actorPermissions, role) =>
  CUSTOM_BASE_ROLES.includes(role.baseRole) &&
  canManageRole(actor.role, role.baseRole) &&
  role.permissions.every((p) => actorPermissions.includes(p));

// Finds a role of the actor's company and checks the actor may assign it.
const findAssignable = async (req, companyId, roleId) => {
  const role = await Role.findOne({ _id: roleId, companyId });
  if (!role) throw new AppError("Role not found", 404);
  if (!canAssign(req.user, req.permissions || permissionsFor(req.user.role), role)) {
    throw new AppError("You cannot assign this role", 403);
  }
  return role;
};

// Cleans a permission list: known, grantable, no repeats, in a stable order.
const normalizePermissions = (list) => {
  const unknown = list.filter((p) => !GRANTABLE_PERMISSIONS.includes(p));
  if (unknown.length) throw new AppError(`These permissions cannot be given to a custom role: ${unknown.join(", ")}`, 400);
  return GRANTABLE_PERMISSIONS.filter((p) => list.includes(p));
};

// The actor may only create or edit a role made of permissions they hold.
const checkWithinActor = (req, permissions, baseRole) => {
  const own = req.permissions || permissionsFor(req.user.role);
  if (!permissions.every((p) => own.includes(p))) {
    throw new AppError("You cannot give permissions you do not have yourself", 403);
  }
  if (baseRole && !canManageRole(req.user.role, baseRole)) {
    throw new AppError("You cannot create a role on this base role", 403);
  }
};

// True when every permission in the list is one the actor holds.
const withinActor = (req, permissions) => {
  const own = req.permissions || permissionsFor(req.user.role);
  return permissions.every((p) => own.includes(p));
};

module.exports = {
  MAX_ROLES_PER_COMPANY, accessOf, canAssign, findAssignable, normalizePermissions, checkWithinActor, withinActor,
};
