const AppError = require("../utils/AppError");
const { ROLES, ROLE_RANK, canManageRole, isCompanyWide, permissionsFor } = require("../config/permissions");
const audit = require("../services/auditService");
const User = require("../models/User");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Operator = require("../models/Operator");
const Role = require("../models/Role");
const { findAssignable, accessOf, withinActor } = require("../services/roleService");

const sameIds = (ids) => [...new Set(ids.map(String))];

// Roles the actor is allowed to see and manage (strictly lower rank).
const manageableRoles = (actorRole) =>
  Object.keys(ROLE_RANK).filter((role) => canManageRole(actorRole, role));

// Limits a query to users the actor may manage.
const scopeFilter = (req) => {
  const filter = { ...req.tenantFilter, role: { $in: manageableRoles(req.user.role) } };
  if (!isCompanyWide(req.user.role)) {
    filter.locationIds = { $in: req.user.locationIds };
  }
  return filter;
};

// Checks the locations exist in the company and that the actor may assign them.
const checkLocations = async (actor, companyId, locationIds) => {
  const ids = sameIds(locationIds);
  if (!isCompanyWide(actor.role)) {
    const own = actor.locationIds.map(String);
    if (!ids.length) throw new AppError("Assign at least one of your locations", 400);
    if (!ids.every((id) => own.includes(id))) {
      throw new AppError("You can only assign locations you manage", 403);
    }
  }
  if (ids.length) {
    const found = await Location.countDocuments({ _id: { $in: ids }, companyId });
    if (found !== ids.length) throw new AppError("One or more locations were not found", 400);
  }
  return ids;
};

const findManageable = async (req) => {
  const user = await User.findOne({ _id: req.params.id, ...scopeFilter(req) });
  if (!user) throw new AppError("User not found", 404);
  return user;
};

// Saves the operator profile (employee code, shift) that belongs to a user.
const saveOperatorProfile = async (user, profile) => {
  if (!profile) return;
  const update = { companyId: user.companyId };
  if (profile.employeeCode !== undefined) update.employeeCode = profile.employeeCode;
  if (profile.shift) {
    for (const [key, value] of Object.entries(profile.shift)) update[`shift.${key}`] = value;
  }
  await Operator.findOneAndUpdate({ userId: user._id }, { $set: update }, { upsert: true });
};

// Adds each user's operator profile (`operator`) and custom role name
// (`customRole`) to the API answer.
const withProfiles = async (users) => {
  const profiles = await Operator.find({ userId: { $in: users.map((u) => u._id) } }).lean();
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));
  const roleIds = [...new Set(users.filter((u) => u.customRoleId).map((u) => String(u.customRoleId)))];
  const customRoles = roleIds.length ? await Role.find({ _id: { $in: roleIds } }).select("name").lean() : [];
  const roleNames = new Map(customRoles.map((r) => [String(r._id), r.name]));
  return users.map((user) => {
    const profile = byUser.get(String(user._id));
    return {
      ...user.toJSON(),
      customRole: user.customRoleId
        ? { id: user.customRoleId, name: roleNames.get(String(user.customRoleId)) || null }
        : null,
      operator: profile
        ? { employeeCode: profile.employeeCode, shift: profile.shift, lastActiveAt: profile.lastActiveAt }
        : null,
    };
  });
};
const withProfile = async (user) => (await withProfiles([user]))[0];

// GET /api/users
const listUsers = async (req, res) => {
  const users = await User.find(scopeFilter(req)).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, data: await withProfiles(users) });
};

// GET /api/users/:id
const getUser = async (req, res) => {
  res.json({ success: true, data: await withProfile(await findManageable(req)) });
};

// POST /api/users
const createUser = async (req, res) => {
  const { name, email, phone, password, customRoleId } = req.body;

  // A custom role brings its own base role; otherwise a built-in role is needed.
  let role = req.body.role;
  let customRole = null;
  if (customRoleId) {
    customRole = await findAssignable(req, req.companyId, customRoleId);
    if (role && role !== customRole.baseRole) {
      throw new AppError("The role does not match the custom role's base role", 400);
    }
    role = customRole.baseRole;
  }
  if (!role) throw new AppError("Choose a role", 400);
  if (role === ROLES.SUPER_ADMIN || !canManageRole(req.user.role, role)) {
    throw new AppError("You cannot create a user with this role", 403);
  }
  // Nobody can create a user who could do more than they can themselves
  // (matters when the creator has a custom role with fewer permissions).
  if (!customRole && !withinActor(req, permissionsFor(role))) {
    throw new AppError("This role has permissions you do not have yourself", 403);
  }

  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);

  const activeUsers = await User.countDocuments({ companyId: req.companyId, isActive: true });
  if (activeUsers >= company.plan.maxUsers) {
    throw new AppError(`Your plan allows ${company.plan.maxUsers} users. Upgrade to add more.`, 403);
  }

  if (await User.exists({ email })) {
    throw new AppError("An account with this email already exists", 409);
  }

  const locationIds = await checkLocations(req.user, req.companyId, req.body.locationIds || []);

  const user = await User.create({
    companyId: req.companyId, name, email, phone, password, role, locationIds,
    customRoleId: customRole ? customRole._id : undefined,
  });
  await saveOperatorProfile(user, req.body.operator);
  await audit.record(req, "USER_CREATE", { entity: "User", entityId: user._id, meta: { role, customRoleId: customRole ? customRole._id : undefined } });

  res.status(201).json({ success: true, data: await withProfile(user) });
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  const user = await findManageable(req);
  const { name, phone, role, locationIds, isActive, password, customRoleId } = req.body;
  const clearRole = (req.cleared || []).includes("customRoleId");
  const changed = [];

  // Changing a user's role or password hands over their access. That is only
  // allowed when the user's present permissions are all ones the actor holds
  // (a custom-role actor must not upgrade or take over a richer user).
  const touchesAccess = customRoleId !== undefined || clearRole || role !== undefined || password !== undefined;
  if (touchesAccess && !withinActor(req, (await accessOf(user)).permissions)) {
    throw new AppError("This user has permissions you do not have yourself, so you cannot change their role or password", 403);
  }
  const mayGive = (builtInRole) => {
    if (!withinActor(req, permissionsFor(builtInRole))) {
      throw new AppError("This role has permissions you do not have yourself", 403);
    }
  };

  if (customRoleId !== undefined) {
    // Give the user a custom role. Its base role becomes the user's role.
    const customRole = await findAssignable(req, user.companyId, customRoleId);
    if (role !== undefined && role !== customRole.baseRole) {
      throw new AppError("The role does not match the custom role's base role", 400);
    }
    if (String(user.customRoleId) !== String(customRole._id)) {
      user.customRoleId = customRole._id;
      changed.push("customRoleId");
    }
    if (user.role !== customRole.baseRole) {
      if (!canManageRole(req.user.role, customRole.baseRole)) {
        throw new AppError("You cannot assign this role", 403);
      }
      user.role = customRole.baseRole;
      changed.push("role");
    }
  } else {
    if (clearRole && user.customRoleId) {
      mayGive(role !== undefined ? role : user.role);
      user.customRoleId = undefined; // back to the built-in role
      changed.push("customRoleId");
    }
    if (role !== undefined && (role !== user.role || (user.customRoleId && !clearRole))) {
      if (role === ROLES.SUPER_ADMIN || !canManageRole(req.user.role, role)) {
        throw new AppError("You cannot assign this role", 403);
      }
      mayGive(role);
      // Choosing a built-in role replaces any custom role.
      if (user.customRoleId) {
        user.customRoleId = undefined;
        changed.push("customRoleId");
      }
      if (role !== user.role) {
        user.role = role;
        changed.push("role");
      }
    }
  }
  if (locationIds !== undefined) {
    const allowed = await checkLocations(req.user, user.companyId, locationIds);
    // A location admin decides only about their own locations. Assignments
    // the user has at other locations are kept as they are.
    const own = req.user.locationIds.map(String);
    const untouched = isCompanyWide(req.user.role)
      ? []
      : user.locationIds.map(String).filter((id) => !own.includes(id));
    user.locationIds = [...untouched, ...allowed];
    changed.push("locationIds");
  }
  if (name !== undefined) { user.name = name; changed.push("name"); }
  if (phone !== undefined) { user.phone = phone; changed.push("phone"); }
  if (isActive !== undefined && isActive !== user.isActive) {
    if (isActive) {
      // Switching someone back on counts against the plan like adding them.
      const company = await Company.findById(user.companyId);
      const activeUsers = await User.countDocuments({ companyId: user.companyId, isActive: true });
      if (company && activeUsers >= company.plan.maxUsers) {
        throw new AppError(`Your plan allows ${company.plan.maxUsers} users. Upgrade to add more.`, 403);
      }
    }
    user.isActive = isActive;
    changed.push("isActive");
  }
  if (password !== undefined) {
    user.password = password; // "reset access"
    changed.push("password");
  }
  // Role, access or password changes end the user's existing sessions.
  if (changed.some((f) => ["role", "customRoleId", "isActive", "password", "locationIds"].includes(f))) {
    user.tokenVersion += 1;
  }

  await user.save();
  if (req.body.operator) {
    await saveOperatorProfile(user, req.body.operator);
    changed.push("operator");
  }
  await audit.record(req, "USER_UPDATE", {
    entity: "User", entityId: user._id, companyId: user.companyId, meta: { changed },
  });

  res.json({ success: true, data: await withProfile(user) });
};

// DELETE /api/users/:id
// Users are deactivated, not removed, so history and audit records stay valid.
const deactivateUser = async (req, res) => {
  const user = await findManageable(req);
  user.isActive = false;
  user.tokenVersion += 1;
  await user.save();
  await audit.record(req, "USER_DEACTIVATE", {
    entity: "User", entityId: user._id, companyId: user.companyId,
  });
  res.json({ success: true, data: await withProfile(user) });
};

module.exports = { listUsers, getUser, createUser, updateUser, deactivateUser };
