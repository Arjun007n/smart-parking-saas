const AppError = require("../utils/AppError");
const { ROLES, ROLE_RANK, canManageRole, isCompanyWide } = require("../config/permissions");
const audit = require("../services/auditService");
const User = require("../models/User");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Operator = require("../models/Operator");

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

// Adds each user's operator profile to the API answer as `operator`.
const withProfiles = async (users) => {
  const profiles = await Operator.find({ userId: { $in: users.map((u) => u._id) } }).lean();
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));
  return users.map((user) => {
    const profile = byUser.get(String(user._id));
    return {
      ...user.toJSON(),
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
  const { name, email, phone, password, role } = req.body;

  if (role === ROLES.SUPER_ADMIN || !canManageRole(req.user.role, role)) {
    throw new AppError("You cannot create a user with this role", 403);
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
  });
  await saveOperatorProfile(user, req.body.operator);
  await audit.record(req, "USER_CREATE", { entity: "User", entityId: user._id, meta: { role } });

  res.status(201).json({ success: true, data: await withProfile(user) });
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  const user = await findManageable(req);
  const { name, phone, role, locationIds, isActive, password } = req.body;
  const changed = [];

  if (role !== undefined && role !== user.role) {
    if (role === ROLES.SUPER_ADMIN || !canManageRole(req.user.role, role)) {
      throw new AppError("You cannot assign this role", 403);
    }
    user.role = role;
    changed.push("role");
  }
  if (locationIds !== undefined) {
    user.locationIds = await checkLocations(req.user, user.companyId, locationIds);
    changed.push("locationIds");
  }
  if (name !== undefined) { user.name = name; changed.push("name"); }
  if (phone !== undefined) { user.phone = phone; changed.push("phone"); }
  if (isActive !== undefined && isActive !== user.isActive) {
    user.isActive = isActive;
    changed.push("isActive");
  }
  if (password !== undefined) {
    user.password = password; // "reset access"
    changed.push("password");
  }
  // Role, access or password changes end the user's existing sessions.
  if (changed.some((f) => ["role", "isActive", "password", "locationIds"].includes(f))) {
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
