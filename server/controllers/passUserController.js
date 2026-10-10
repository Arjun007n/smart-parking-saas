const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const passes = require("../services/passService");
const passUsers = require("../services/passUserService");
const { parsePlate, normalizePlate, escapeRegex } = require("../utils/plate");
const { getAccessibleLocation } = require("../utils/scope");
const { isCompanyWide } = require("../config/permissions");
const { round2 } = require("../services/collectionService");
const { respond, wantsExport, pageFrom, CSV_LIMIT } = require("./reportController");
const { assertPassCompany } = require("./passCompanyController");
const passController = require("./passController");
const Pass = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const PassCompany = require("../models/PassCompany");
const PassUser = require("../models/PassUser");
const PassVehicle = require("../models/PassVehicle");
const { VEHICLE_TYPES } = require("../models/constants");

const PAGE_SIZE = 25;
const LIMITS = [25, 50, 100, 200, 500, 1000, 2000];
const toId = (id) => new mongoose.Types.ObjectId(String(id));
const limitFrom = (req) => {
  const wanted = Number.parseInt(req.query.limit, 10);
  return LIMITS.includes(wanted) ? wanted : PAGE_SIZE;
};

// Users a person may see. A company admin sees every pass user. A location admin sees the users who
// hold a pass at their locations, and the ones they made themselves.
const userScope = async (req) => {
  const base = { ...req.tenantFilter };
  if (isCompanyWide(req.user.role)) return base;
  const ids = await Pass.find({ $and: [passes.scopeFilter(req), { passUserId: { $exists: true } }] }).distinct("passUserId");
  return { ...base, $or: [{ _id: { $in: ids } }, { createdBy: req.user._id }] };
};

const findUser = async (req) => {
  const user = await PassUser.findOne({ $and: [{ _id: req.params.id }, await userScope(req)] });
  if (!user) throw new AppError("Pass user not found", 404);
  return user;
};

const nameMap = async (Model, ids, field = "name") => {
  const rows = await Model.find({ _id: { $in: ids.filter(Boolean) } }).select(field).lean();
  return new Map(rows.map((r) => [String(r._id), r]));
};

const companyIdFilter = (req, field = "passCompanyId") => {
  if (!req.query.passCompanyId) return {};
  if (req.query.passCompanyId === "none") return { [field]: { $exists: false } };
  if (!mongoose.isValidObjectId(req.query.passCompanyId)) throw new AppError("Invalid company", 400);
  return { [field]: toId(req.query.passCompanyId) };
};

// ---------------------------------------------------------------- the numbers above the list

// GET /api/pass-users/stats
const stats = async (req, res) => {
  await passUsers.backfill(req.companyId);
  const now = new Date();
  const scope = await userScope(req);
  const userIds = await PassUser.find(scope).distinct("_id");
  const passScope = { $and: [passes.scopeFilter(req), { isCurrent: true }, ...(isCompanyWide(req.user.role) ? [] : [{ passUserId: { $in: userIds } }])] };
  const [companies, vehicles, passRows, revenueRows] = await Promise.all([
    PassCompany.countDocuments({ ...req.tenantFilter, isActive: true }),
    PassVehicle.countDocuments({ ...req.tenantFilter, passUserId: { $in: userIds } }),
    Pass.aggregate([
      { $match: passScope },
      {
        $group: {
          _id: null,
          passes: { $sum: 1 },
          active: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "ACTIVE"] }, { $ne: ["$approval", "PENDING"] }, { $lte: ["$startDate", now] }, { $gt: ["$endDate", now] }] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "ACTIVE"] }, { $lte: ["$endDate", now] }] }, 1, 0] } },
        },
      },
    ]),
    PassPayment.aggregate([
      { $match: { companyId: toId(req.companyId), amount: { $gt: 0 } } },
      { $lookup: { from: Pass.collection.name, localField: "passId", foreignField: "_id", as: "p", pipeline: [{ $project: { status: 1, startDate: 1, endDate: 1, locationIds: 1, isCurrent: 1 } }] } },
      { $unwind: "$p" },
      { $match: { "p.status": "ACTIVE", "p.startDate": { $lte: now }, "p.endDate": { $gt: now } } },
      { $group: { _id: null, revenue: { $sum: "$amount" } } },
    ]),
  ]);
  const p = passRows[0] || {};
  res.json({
    success: true,
    data: {
      companies, users: userIds.length, vehicles, passes: p.passes || 0, active: p.active || 0, expired: p.expired || 0,
      activeRevenue: revenueRows[0] ? round2(revenueRows[0].revenue) : 0,
    },
  });
};

// ---------------------------------------------------------------- the list

// GET /api/pass-users?q=&passCompanyId=&userId=&limit=&page=      (+ ?format=csv|xlsx|pdf)
const list = async (req, res) => {
  await passUsers.backfill(req.companyId);
  const conditions = [await userScope(req), companyIdFilter(req)];
  if (req.query.userId) {
    if (!mongoose.isValidObjectId(req.query.userId)) throw new AppError("Invalid user", 400);
    conditions.push({ _id: toId(req.query.userId) });
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) {
    const like = { $regex: escapeRegex(q), $options: "i" };
    const byPlate = await PassVehicle.find({ ...req.tenantFilter, plateNumber: { $regex: `^${escapeRegex(normalizePlate(q))}` } }).distinct("passUserId");
    conditions.push({ $or: [{ name: like }, { mobile: like }, { email: like }, { _id: { $in: byPlate } }] });
  }
  const filter = { $and: conditions };
  const exporting = wantsExport(req);
  const size = limitFrom(req);
  const page = pageFrom(req);
  const [users, total] = await Promise.all([
    PassUser.find(filter).sort({ name: 1, _id: 1 }).skip(exporting ? 0 : (page - 1) * size).limit(exporting ? CSV_LIMIT : size),
    PassUser.countDocuments(filter),
  ]);
  const ids = users.map((u) => u._id);
  const now = new Date();
  const [companies, vehicleRows, passRows] = await Promise.all([
    nameMap(PassCompany, users.map((u) => u.passCompanyId)),
    PassVehicle.aggregate([{ $match: { passUserId: { $in: ids } } }, { $group: { _id: "$passUserId", n: { $sum: 1 } } }]),
    Pass.aggregate([
      { $match: { passUserId: { $in: ids }, isCurrent: true } },
      {
        $group: {
          _id: "$passUserId", n: { $sum: 1 },
          active: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "ACTIVE"] }, { $ne: ["$approval", "PENDING"] }, { $lte: ["$startDate", now] }, { $gt: ["$endDate", now] }] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const vehicleBy = new Map(vehicleRows.map((r) => [String(r._id), r.n]));
  const passBy = new Map(passRows.map((r) => [String(r._id), r]));
  const rows = users.map((u) => {
    const company = u.passCompanyId ? companies.get(String(u.passCompanyId)) : null;
    const p = passBy.get(String(u._id)) || {};
    return {
      _id: u._id, name: u.name, mobile: u.mobile || "", email: u.email || "", address: u.address || "", gstNumber: u.gstNumber || "",
      passCompanyId: u.passCompanyId || null, company: company ? company.name : "", vehicles: vehicleBy.get(String(u._id)) || 0, passes: p.n || 0, active: p.active || 0,
    };
  });
  if (exporting) {
    req.reportKey = "pass-users-list";
    return respond(req, res, "pass-users", [
      { key: "name", label: "Pass user name" }, { key: "company", label: "Company name" }, { key: "mobile", label: "Mobile no." },
      { key: "email", label: "Email ID" }, { key: "address", label: "Address" }, { key: "gstNumber", label: "GST no." },
      { key: "vehicles", label: "Vehicles" }, { key: "passes", label: "Passes" },
    ], rows.map((r) => ({ ...r, company: r.company || "N/A" })), { total });
  }
  res.json({ success: true, data: { users: rows, total, page, pageSize: size } });
};

// GET /api/pass-users/options: every user in a short form, for the filters and pickers.
const options = async (req, res) => {
  await passUsers.backfill(req.companyId);
  const users = await PassUser.find(await userScope(req)).sort({ name: 1 }).select("name mobile passCompanyId").limit(2000).lean();
  res.json({ success: true, data: { users: users.map((u) => ({ _id: u._id, name: u.name, mobile: u.mobile || "", passCompanyId: u.passCompanyId || null })) } });
};

// ---------------------------------------------------------------- Create Pass (the form on the list)

// The vehicle rows of a Create Pass form, checked as a whole before anything is made.
const checkRows = async (req, rows) => {
  if (!Array.isArray(rows) || rows.length === 0) throw new AppError("Add at least one vehicle", 400);
  const seen = new Set();
  const checked = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const label = `Vehicle ${i + 1}`;
    let plate;
    try { plate = parsePlate(row.vehicleNumber); } catch { throw new AppError(`${label}: vehicle number must be 4 to 12 letters and digits`, 400); }
    if (seen.has(plate)) throw new AppError(`${plate} is listed twice`, 400);
    seen.add(plate);
    if (!VEHICLE_TYPES.includes(row.vehicleType)) throw new AppError(`${label}: choose the vehicle type`, 400);
    if (!row.locationId) throw new AppError(`${label}: choose the location`, 400);
    const location = await getAccessibleLocation(req, row.locationId, { mustBeActive: true });
    if (!row.endDate) throw new AppError(`${label}: enter the validity dates`, 400);
    const period = passes.datedPeriod({ from: row.startDate, to: row.endDate });
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw new AppError(`${label}: enter the pass charges (0 or more)`, 400);
    checked.push({ plate, vehicleType: row.vehicleType, location, startDate: row.startDate, endDate: row.endDate, amount, period });
  }
  return checked;
};

const methodFor = (amount, method) => (amount === 0 ? "COMPLIMENTARY" : method || "CASH");

const saleBody = (user, row, { method, transactionId }) => ({
  holderName: user.name, phone: user.mobile || undefined, email: user.email || undefined, passUserId: String(user._id),
  vehicleNumber: row.plate, vehicleType: row.vehicleType, locationId: String(row.location._id), locationIds: [String(row.location._id)],
  startDate: row.startDate || undefined, endDate: row.endDate, amount: row.amount, method: methodFor(row.amount, method),
  ...(transactionId ? { transactionId } : {}),
});

// Sells each row as its own pass; a row that fails does not stop the others.
const sellRows = async (req, user, rows, payment) => {
  const results = [];
  for (const row of rows) {
    try {
      const { pass } = await passController.sellPass(req, saleBody(user, row, payment));
      results.push({ ok: true, vehicleNumber: row.plate, passId: pass._id, passNumber: pass.passNumber });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      results.push({ ok: false, vehicleNumber: row.plate, error: error.message });
    }
  }
  return results;
};

// POST /api/pass-users
// The Create Pass form. A new user (name, mobile, address, ...) or an existing one (passUserId), with one
// or more vehicle rows (number, type, location, validity dates, charges). Each row becomes a pass.
const create = async (req, res) => {
  const { passUserId, rows, method, transactionId, passCompanyId } = req.body;
  if (method !== undefined && !["CASH", "UPI", "CARD"].includes(method)) throw new AppError("Choose how the money was taken: cash, UPI or card", 400);
  if (transactionId && Array.isArray(rows) && rows.length > 1) throw new AppError("A payment reference belongs to one pass. Add one vehicle at a time to use it.", 400);
  const checked = await checkRows(req, rows);

  let user;
  let isNew = false;
  if (passUserId) {
    user = await PassUser.findOne({ $and: [{ _id: passUserId }, await userScope(req)] });
    if (!user) throw new AppError("Pass user not found", 404);
  } else {
    const details = passUsers.cleanDetails(req.body, { creating: true });
    const companyRef = await assertPassCompany(req.companyId, passCompanyId);
    if (await PassUser.exists({ companyId: req.companyId, mobile: details.mobile })) {
      throw new AppError("A pass user with this mobile number already exists. Choose Existing User.", 409);
    }
    user = await PassUser.create({ ...details, ...(companyRef ? { passCompanyId: companyRef } : {}), companyId: req.companyId, createdBy: req.user._id });
    isNew = true;
  }

  // A vehicle may hold one current pass, and may belong to one user.
  const problems = [];
  for (const row of checked) {
    const existing = await passes.findCurrentPass(req.companyId, row.plate);
    if (existing) problems.push(`${row.plate} already has pass ${existing.passNumber}. Renew it from the user's Passes page.`);
    const owner = await PassVehicle.findOne({ companyId: req.companyId, plateNumber: row.plate });
    if (owner && String(owner.passUserId) !== String(user._id)) problems.push(`${row.plate} already belongs to another pass user.`);
  }
  if (problems.length) {
    if (isNew) await PassUser.deleteOne({ _id: user._id });
    throw new AppError(problems.join(" "), 409);
  }

  const results = await sellRows(req, user, checked, { method, transactionId });
  const created = results.filter((r) => r.ok).length;
  if (created === 0 && isNew) await PassUser.deleteOne({ _id: user._id });
  if (created === 0) throw new AppError(results[0].error, 409);
  await audit.record(req, isNew ? "PASS_USER_CREATE" : "PASS_USER_PASSES_ADD", {
    entity: "PassUser", entityId: user._id, companyId: req.companyId, meta: { name: user.name, passes: created, failed: results.length - created },
  });
  res.status(201).json({ success: true, data: { user, created, failed: results.length - created, results } });
};

// ---------------------------------------------------------------- one user

// GET /api/pass-users/:id
const getOne = async (req, res) => {
  const user = await findUser(req);
  const [vehicles, company] = await Promise.all([
    PassVehicle.find({ passUserId: user._id }).sort({ plateNumber: 1 }),
    user.passCompanyId ? PassCompany.findById(user.passCompanyId).select("name gstNumber") : null,
  ]);
  res.json({ success: true, data: { user, vehicles, company } });
};

// PUT /api/pass-users/:id
const update = async (req, res) => {
  const user = await findUser(req);
  const details = passUsers.cleanDetails(req.body);
  if (details.mobile && details.mobile !== user.mobile && (await PassUser.exists({ companyId: user.companyId, mobile: details.mobile, _id: { $ne: user._id } }))) {
    throw new AppError("Another pass user already has this mobile number", 409);
  }
  Object.assign(user, details);
  if (req.body.passCompanyId !== undefined) user.passCompanyId = req.body.passCompanyId ? await assertPassCompany(user.companyId, req.body.passCompanyId) : undefined;
  try {
    await user.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("Another pass user already has this mobile number", 409);
    throw error;
  }
  await passUsers.syncPasses(user);
  await audit.record(req, "PASS_USER_UPDATE", {
    entity: "PassUser", entityId: user._id, companyId: user.companyId, meta: { name: user.name, changed: Object.keys(req.body) },
  });
  res.json({ success: true, data: user });
};

// DELETE /api/pass-users/:id
// Only a user with no passes can go (their vehicle records go with them). One with passes keeps its history.
const remove = async (req, res) => {
  const user = await findUser(req);
  const count = await Pass.countDocuments({ companyId: user.companyId, passUserId: user._id });
  if (count > 0) {
    throw new AppError(`${user.name} has ${count} pass${count === 1 ? "" : "es"}. Delete or cancel the passes first.`, 409);
  }
  await PassVehicle.deleteMany({ companyId: user.companyId, passUserId: user._id });
  await PassUser.deleteOne({ _id: user._id });
  await audit.record(req, "PASS_USER_DELETE", { entity: "PassUser", entityId: user._id, companyId: user.companyId, meta: { name: user.name } });
  res.json({ success: true, data: { deleted: true } });
};

// ---------------------------------------------------------------- vehicles of a user

// POST /api/pass-users/:id/vehicles
const addVehicle = async (req, res) => {
  const user = await findUser(req);
  const plate = parsePlate(req.body.vehicleNumber);
  const owner = await PassVehicle.findOne({ companyId: user.companyId, plateNumber: plate });
  if (owner) {
    throw new AppError(String(owner.passUserId) === String(user._id) ? `${plate} is already on this user` : `${plate} already belongs to another pass user`, 409);
  }
  const vehicle = await PassVehicle.create({ companyId: user.companyId, passUserId: user._id, plateNumber: plate, vehicleType: req.body.vehicleType });
  await audit.record(req, "PASS_USER_VEHICLE_ADD", { entity: "PassUser", entityId: user._id, companyId: user.companyId, meta: { vehicleNumber: plate } });
  res.status(201).json({ success: true, data: vehicle });
};

// PUT /api/pass-users/:id/vehicles/:vehicleId
// The number and type can change while the vehicle has no current pass (a vehicle on a pass is changed on the pass).
const updateVehicle = async (req, res) => {
  const user = await findUser(req);
  const vehicle = await PassVehicle.findOne({ _id: req.params.vehicleId, passUserId: user._id });
  if (!vehicle) throw new AppError("Vehicle not found", 404);
  if (await passes.findCurrentPass(user.companyId, vehicle.plateNumber)) {
    throw new AppError(`${vehicle.plateNumber} is on a pass. Change it with "Replace vehicle" on the pass.`, 409);
  }
  const plate = req.body.vehicleNumber !== undefined ? parsePlate(req.body.vehicleNumber) : vehicle.plateNumber;
  if (plate !== vehicle.plateNumber && (await PassVehicle.exists({ companyId: user.companyId, plateNumber: plate }))) {
    throw new AppError(`${plate} already belongs to a pass user`, 409);
  }
  vehicle.plateNumber = plate;
  if (req.body.vehicleType) vehicle.vehicleType = req.body.vehicleType;
  await vehicle.save();
  await audit.record(req, "PASS_USER_VEHICLE_EDIT", { entity: "PassUser", entityId: user._id, companyId: user.companyId, meta: { vehicleNumber: plate } });
  res.json({ success: true, data: vehicle });
};

// POST /api/pass-users/:id/passes
// "Create / Renew Pass" on a user's page, for one of the user's vehicles. A vehicle with a pass has that pass
// re-dated (and the location added); one without gets a new pass.
const createOrRenew = async (req, res) => {
  const user = await findUser(req);
  const { vehicleId, method, transactionId } = req.body;
  if (method !== undefined && !["CASH", "UPI", "CARD"].includes(method)) throw new AppError("Choose how the money was taken: cash, UPI or card", 400);
  const vehicle = await PassVehicle.findOne({ _id: vehicleId, passUserId: user._id });
  if (!vehicle) throw new AppError("Vehicle not found for this user", 404);
  const [row] = await checkRows(req, [{ ...req.body, vehicleNumber: vehicle.plateNumber, vehicleType: vehicle.vehicleType }]);

  const existing = await passes.findCurrentPass(user.companyId, vehicle.plateNumber);
  if (!existing) {
    const { pass, payment } = await passController.sellPass(req, saleBody(user, row, { method, transactionId }));
    return res.status(201).json({ success: true, data: { pass: passController.withState(pass), payment, renewed: false } });
  }
  if (existing.passUserId && String(existing.passUserId) !== String(user._id)) {
    throw new AppError(`${vehicle.plateNumber} has a pass for another pass user`, 409);
  }
  if (!existing.passUserId) {
    existing.passUserId = user._id;
    await existing.save();
  }
  const { pass, payment } = await passController.renewDated(req, existing, {
    location: row.location, period: row.period, amount: row.amount, method: methodFor(row.amount, method), transactionId,
  });
  res.status(201).json({ success: true, data: { pass: passController.withState(pass), payment, renewed: true } });
};

// ---------------------------------------------------------------- Vehicle List

// GET /api/pass-users/vehicles?q=&passUserId=&passCompanyId=&vehicleType=&limit=&page=      (+ ?format=)
const vehicleList = async (req, res) => {
  await passUsers.backfill(req.companyId);
  const users = await PassUser.find(await userScope(req)).select("name mobile passCompanyId").lean();
  const userBy = new Map(users.map((u) => [String(u._id), u]));
  const conditions = [{ ...req.tenantFilter, passUserId: { $in: users.map((u) => u._id) } }];
  if (req.query.passUserId) {
    if (!mongoose.isValidObjectId(req.query.passUserId)) throw new AppError("Invalid user", 400);
    conditions.push({ passUserId: toId(req.query.passUserId) });
  }
  if (req.query.passCompanyId) {
    const owners = users.filter((u) => (req.query.passCompanyId === "none" ? !u.passCompanyId : String(u.passCompanyId) === req.query.passCompanyId)).map((u) => u._id);
    conditions.push({ passUserId: { $in: owners } });
  }
  if (req.query.vehicleType) {
    if (!VEHICLE_TYPES.includes(req.query.vehicleType)) throw new AppError("Unknown vehicle type", 400);
    conditions.push({ vehicleType: req.query.vehicleType });
  }
  if (req.query.vehicleNumber) conditions.push({ plateNumber: normalizePlate(String(req.query.vehicleNumber).slice(0, 20)) });
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) {
    const owners = users.filter((u) => new RegExp(escapeRegex(q), "i").test(`${u.name} ${u.mobile || ""}`)).map((u) => u._id);
    conditions.push({ $or: [{ plateNumber: { $regex: escapeRegex(normalizePlate(q)) } }, { passUserId: { $in: owners } }] });
  }
  const filter = { $and: conditions };
  const exporting = wantsExport(req);
  const size = limitFrom(req);
  const page = pageFrom(req);
  const [vehicles, total] = await Promise.all([
    PassVehicle.find(filter).sort({ plateNumber: 1 }).skip(exporting ? 0 : (page - 1) * size).limit(exporting ? CSV_LIMIT : size).lean(),
    PassVehicle.countDocuments(filter),
  ]);
  const companies = await nameMap(PassCompany, users.map((u) => u.passCompanyId));
  const rows = vehicles.map((v) => {
    const owner = userBy.get(String(v.passUserId)) || {};
    const company = owner.passCompanyId ? companies.get(String(owner.passCompanyId)) : null;
    return {
      _id: v._id, passUserId: v.passUserId, vehicleNumber: v.plateNumber, vehicleType: v.vehicleType,
      userName: owner.name || "", company: company ? company.name : "", mobile: owner.mobile || "",
    };
  });
  if (exporting) {
    req.reportKey = "pass-vehicle-list";
    return respond(req, res, "pass-vehicles", [
      { key: "vehicleNumber", label: "Vehicle no." }, { key: "vehicleType", label: "Vehicle type" }, { key: "userName", label: "User name" },
      { key: "company", label: "Company name" }, { key: "mobile", label: "Mobile" },
    ], rows.map((r) => ({ ...r, company: r.company || "N/A" })), { total });
  }
  res.json({ success: true, data: { vehicles: rows, total, page, pageSize: size } });
};

module.exports = { stats, list, options, create, getOne, update, remove, addVehicle, updateVehicle, createOrRenew, vehicleList, userScope };
