const AppError = require("../utils/AppError");
const { ROLES, ROLE_RANK, canManageRole, isCompanyWide, permissionsFor } = require("../config/permissions");
const audit = require("../services/auditService");
const User = require("../models/User");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Operator = require("../models/Operator");
const Role = require("../models/Role");
const { findAssignable, accessOf, withinActor } = require("../services/roleService");
const account = require("../services/accountService");
const liveHub = require("../services/liveHub");
const { targetWithinLocations } = require("../utils/userRules");
const { assertNotCommon } = require("../utils/passwordPolicy");
const lanesService = require("../services/laneService");
const licences = require("../services/licenceService");
const { buildReportFile, formatOf } = require("../services/reportExport");

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

// A Login ID in its stored form, checked for shape. Empty means "none".
const cleanLoginId = (value) => {
  const loginId = account.normalizeLoginId(value);
  if (!loginId) return undefined;
  if (!account.LOGIN_ID_PATTERN.test(loginId)) {
    throw new AppError("A Login ID has 3 to 30 letters, digits, dots, dashes or underscores", 400);
  }
  return loginId;
};

// Checks the lanes chosen for a user against the locations they work at. At a location set up with lanes,
// gate staff get exactly one lane (both its gates), a lane has one operator, and staff must have a lane.
const checkLanes = async (companyId, lanes, locationIds, { role, userId, active = true } = {}) => {
  if (!lanes.length && !locationIds.length) return [];
  const locations = await Location.find({ companyId, _id: { $in: locationIds } }).select("name gates").lean();
  const clean = lanes.length ? lanesService.checkAssignment(lanes, locations, locationIds) : [];
  const ruled = await lanesService.applyLaneRules({ role, userId, clean, locations });
  if (active) lanesService.requireLaneForStaff({ role, lanes: ruled, locations });
  return ruled;
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
  if (password) assertNotCommon(password);
  const loginId = cleanLoginId(req.body.loginId);
  if (!email && !loginId) throw new AppError("Give the user an email or a Login ID to sign in with", 400);

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

  // A government officer uses no seat of the plan or of a location.
  const officer = role === ROLES.GOVERNMENT_OFFICER;
  if (!officer) {
    const activeUsers = await User.countDocuments({ companyId: req.companyId, isActive: true, role: { $ne: ROLES.GOVERNMENT_OFFICER } });
    if (activeUsers >= company.plan.maxUsers) {
      throw new AppError(`Your plan allows ${company.plan.maxUsers} users. Upgrade to add more.`, 403);
    }
  }

  if (email && (await User.exists({ email }))) {
    throw new AppError("An account with this email already exists", 409);
  }
  if (loginId && (await User.exists({ companyId: req.companyId, loginId }))) {
    throw new AppError("This Login ID is already used in your company", 409);
  }

  const locationIds = await checkLocations(req.user, req.companyId, req.body.locationIds || []);
  if (officer && !locationIds.length) throw new AppError("Choose the locations this officer may see", 400);
  if (!officer) await licences.assertRoom(req.companyId, locationIds);
  const lanes = await checkLanes(req.companyId, req.body.lanes || [], locationIds, { role });

  const user = await User.create({
    companyId: req.companyId, name, email, loginId, phone, password, role, locationIds, lanes,
    customRoleId: customRole ? customRole._id : undefined,
    ...(req.body.access ? { access: req.body.access } : {}),
  });
  await saveOperatorProfile(user, req.body.operator);
  await audit.record(req, "USER_CREATE", { entity: "User", entityId: user._id, meta: { role, loginId, customRoleId: customRole ? customRole._id : undefined } });

  res.status(201).json({ success: true, data: await withProfile(user) });
};

// Password, role and on/off changes hand over or remove someone's access, so they are limited to users whose
// locations all belong to the actor (company-wide admins are not limited).
const assertWholeUserIsInScope = (req, user) => {
  if (isCompanyWide(req.user.role)) return;
  if (!targetWithinLocations(req.user.locationIds, user.locationIds)) {
    throw new AppError("This user also works at a location you do not manage. Ask a company admin to make this change.", 403);
  }
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  const user = await findManageable(req);
  const { name, phone, role, locationIds, isActive, password, customRoleId } = req.body;
  const before = { role: user.role, isActive: user.isActive, locationIds: [...user.locationIds] };
  const clearRole = (req.cleared || []).includes("customRoleId");
  const changed = [];

  // Changing a user's role or password hands over their access. That is only
  // allowed when the user's present permissions are all ones the actor holds
  // (a custom-role actor must not upgrade or take over a richer user).
  const switchesActive = isActive !== undefined && isActive !== user.isActive;
  const touchesAccess = customRoleId !== undefined || clearRole || role !== undefined || password !== undefined || switchesActive;
  if (touchesAccess && !withinActor(req, (await accessOf(user)).permissions)) {
    throw new AppError("This user has permissions you do not have yourself, so you cannot change their role, password or status", 403);
  }
  // A user who also works at a location the actor does not manage can be changed only by a company-wide admin.
  if (touchesAccess) assertWholeUserIsInScope(req, user);
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
  if (req.body.loginId !== undefined) {
    const loginId = cleanLoginId(req.body.loginId);
    if (!loginId && !user.email) throw new AppError("This user has no email, so they need a Login ID to sign in", 400);
    if (loginId !== user.loginId) {
      if (loginId && (await User.exists({ companyId: user.companyId, loginId, _id: { $ne: user._id } }))) {
        throw new AppError("This Login ID is already used in your company", 409);
      }
      user.loginId = loginId;
      changed.push("loginId");
    }
  }
  if (req.body.access) {
    for (const [key, value] of Object.entries(req.body.access)) user.set(`access.${key}`, value);
    changed.push("access");
  }
  if (name !== undefined) { user.name = name; changed.push("name"); }
  if (phone !== undefined) { user.phone = phone; changed.push("phone"); }
  if (isActive !== undefined && isActive !== user.isActive) {
    if (isActive) {
      // Switching someone back on counts against the plan like adding them.
      const company = await Company.findById(user.companyId);
      const activeUsers = await User.countDocuments({ companyId: user.companyId, isActive: true, role: { $ne: ROLES.GOVERNMENT_OFFICER } });
      if (company && user.role !== ROLES.GOVERNMENT_OFFICER && activeUsers >= company.plan.maxUsers) {
        throw new AppError(`Your plan allows ${company.plan.maxUsers} users. Upgrade to add more.`, 403);
      }
    }
    user.isActive = isActive;
    changed.push("isActive");
  }
  // Lanes: what was sent, or what is left of the old ones after the locations changed.
  if (req.body.lanes !== undefined || locationIds !== undefined || changed.includes("role")) {
    const wanted = req.body.lanes !== undefined ? req.body.lanes : user.lanes.map((l) => ({ locationId: String(l.locationId), gate: l.gate }));
    const stillThere = wanted.filter((l) => user.locationIds.map(String).includes(String(l.locationId)));
    user.lanes = await checkLanes(user.companyId, stillThere, user.locationIds, { role: user.role, userId: user._id, active: user.isActive });
    changed.push("lanes");
  }
  // Seats: adding someone to a location, or switching them back on, must fit the location's licence.
  if (user.isActive && user.role !== ROLES.GOVERNMENT_OFFICER && (locationIds !== undefined || !before.isActive)) {
    await licences.assertRoom(user.companyId, user.locationIds, { user: before });
  }
  if (password !== undefined) {
    assertNotCommon(password);
    user.password = password; // "reset access"
    changed.push("password");
  }
  // Role, access or password changes end the user's existing sessions.
  if (changed.some((f) => ["role", "customRoleId", "isActive", "password", "locationIds"].includes(f))) {
    user.tokenVersion += 1;
  }

  await user.save();
  // A user switched off or given another role stops receiving live gate events at once.
  if (changed.some((f) => ["isActive", "role", "customRoleId", "locationIds", "password"].includes(f))) liveHub.closeUser(user._id);
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
  if (!withinActor(req, (await accessOf(user)).permissions)) {
    throw new AppError("This user has permissions you do not have yourself, so you cannot switch them off", 403);
  }
  assertWholeUserIsInScope(req, user);
  user.isActive = false;
  user.tokenVersion += 1;
  await user.save();
  liveHub.closeUser(user._id);
  await audit.record(req, "USER_DEACTIVATE", {
    entity: "User", entityId: user._id, companyId: user.companyId,
  });
  res.json({ success: true, data: await withProfile(user) });
};

const ROLE_NAMES = {
  COMPANY_ADMIN: "Company Admin", LOCATION_ADMIN: "Location Admin", SUPERVISOR: "Supervisor", ENTRY_OPERATOR: "Entry Operator",
  EXIT_OPERATOR: "Exit Operator", COLLECTION_OPERATOR: "Collection Operator", GATE_OPERATOR: "Operator", VIEWER: "Viewer", GOVERNMENT_OFFICER: "Government Officer",
};

// GET /api/users/export?format=xlsx|csv|pdf: the Users table as a file.
const exportUsers = async (req, res) => {
  const format = formatOf(req) || "xlsx";
  const users = await User.find(scopeFilter(req)).sort({ createdAt: 1 }).limit(500);
  const people = await withProfiles(users);
  const locations = await Location.find({ ...req.tenantFilter }).select("name").lean();
  const names = Object.fromEntries(locations.map((l) => [String(l._id), l.name]));
  const columns = [
    { key: "sn", label: "SN" }, { key: "name", label: "User name" }, { key: "role", label: "Role" },
    { key: "loginId", label: "Login ID" }, { key: "mobile", label: "Mobile" }, { key: "email", label: "Email ID" },
    { key: "location", label: "Location" }, { key: "lanes", label: "Lane/Door" }, { key: "status", label: "Status" },
  ];
  const rows = people.map((u, i) => ({
    sn: i + 1, name: u.name, role: (u.customRole && u.customRole.name) || ROLE_NAMES[u.role] || u.role,
    loginId: u.loginId || "", mobile: u.phone || "", email: u.email || "",
    location: u.locationIds.map((id) => names[String(id)]).filter(Boolean).join(", "),
    lanes: (u.lanes || []).map((l, k) => `${k + 1}. ${l.gate}`).join("  "),
    status: u.isActive ? "Active" : "Inactive",
  }));
  const file = buildReportFile({
    format, name: "users", report: "user-list", columns, rows, extra: {}, company: req.company ? req.company.name : "", scope: "",
  });
  res.set({ "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" });
  res.send(file.buffer);
};

// GET /api/users/licences
// Seats per location: the limit, how many are in use, and until when the licences run.
const listLicences = async (req, res) => {
  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);
  const filter = { ...req.tenantFilter };
  if (!isCompanyWide(req.user.role)) filter._id = { $in: req.user.locationIds };
  const locations = await Location.find(filter).sort({ name: 1 }).limit(500).lean();
  const data = await licences.overview(company, locations);
  if (!isCompanyWide(req.user.role)) data.activeUsers = undefined; // only the company admin sees company totals
  res.json({ success: true, data });
};

// PUT /api/users/licences/:locationId   { limit }   (limit null = no limit of its own)
const setLicence = async (req, res) => {
  const company = await Company.findById(req.companyId);
  if (!company) throw new AppError("Company not found", 404);
  const location = await Location.findOne({ _id: req.params.locationId, companyId: req.companyId });
  if (!location) throw new AppError("Location not found", 404);
  const limit = req.body.limit === undefined || req.body.limit === null ? null : req.body.limit;
  await licences.setLimit(company, location, limit);
  await audit.record(req, "LICENCE_SET", { entity: "Location", entityId: location._id, meta: { limit } });
  const locations = await Location.find({ companyId: req.companyId }).sort({ name: 1 }).limit(500).lean();
  res.json({ success: true, data: await licences.overview(company, locations) });
};

module.exports = { exportUsers, listUsers, getUser, createUser, updateUser, deactivateUser, listLicences, setLicence };
