const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const mail = require("../integrations/email");
const { round2 } = require("../services/collectionService");
const PassCompany = require("../models/PassCompany");
const Pass = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const PassUser = require("../models/PassUser");

const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const clean = (body) => {
  const out = {};
  for (const key of ["name", "contactName", "phone", "address"]) if (body[key] !== undefined) out[key] = String(body[key]).trim();
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (email && !mail.isEmail(email)) throw new AppError("Enter a valid email address", 400);
    out.email = email;
  }
  if (body.gstNumber !== undefined) {
    const gst = String(body.gstNumber).trim().toUpperCase();
    if (gst && !GST_PATTERN.test(gst)) throw new AppError("That GST number does not look right (15 letters and digits)", 400);
    out.gstNumber = gst;
  }
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  return out;
};

const findInScope = async (req) => {
  const found = await PassCompany.findOne({ _id: req.params.id, ...req.tenantFilter });
  if (!found) throw new AppError("Company not found", 404);
  return found;
};

// What each company holds: passes, vehicles, how many are valid now, and what it has paid.
const statsFor = async (companyId, ids) => {
  const now = new Date();
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(String(id)));
  const [passRows, moneyRows, userRows] = await Promise.all([
    Pass.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(String(companyId)), passCompanyId: { $in: objectIds }, isCurrent: true } },
      {
        $group: {
          _id: "$passCompanyId",
          passes: { $sum: 1 },
          vehicles: { $sum: { $size: { $ifNull: ["$vehicles", []] } } },
          active: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "ACTIVE"] }, { $lte: ["$startDate", now] }, { $gt: ["$endDate", now] }] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "ACTIVE"] }, { $lte: ["$endDate", now] }] }, 1, 0] } },
        },
      },
    ]),
    PassPayment.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(String(companyId)), amount: { $gt: 0 } } },
      { $lookup: { from: Pass.collection.name, localField: "passId", foreignField: "_id", as: "p", pipeline: [{ $project: { passCompanyId: 1 } }] } },
      { $unwind: "$p" },
      { $match: { "p.passCompanyId": { $in: objectIds } } },
      { $group: { _id: "$p.passCompanyId", revenue: { $sum: "$amount" } } },
    ]),
    PassUser.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(String(companyId)), passCompanyId: { $in: objectIds } } },
      { $group: { _id: "$passCompanyId", users: { $sum: 1 } } },
    ]),
  ]);
  const userBy = new Map(userRows.map((r) => [String(r._id), r.users]));
  const passBy = new Map(passRows.map((r) => [String(r._id), r]));
  const moneyBy = new Map(moneyRows.map((r) => [String(r._id), r.revenue]));
  return new Map(ids.map((id) => {
    const p = passBy.get(String(id)) || {};
    return [String(id), { users: userBy.get(String(id)) || 0, passes: p.passes || 0, vehicles: p.vehicles || 0, active: p.active || 0, expired: p.expired || 0, revenue: round2(moneyBy.get(String(id)) || 0) }];
  }));
};

// GET /api/pass-companies?q=
const listPassCompanies = async (req, res) => {
  const filter = { ...req.tenantFilter };
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (req.query.active === "true") filter.isActive = true;
  const companies = await PassCompany.find(filter).sort({ name: 1 }).limit(500);
  const stats = await statsFor(req.companyId, companies.map((c) => c._id));
  const data = companies.map((c) => ({ ...c.toJSON(), stats: stats.get(String(c._id)) }));
  const totals = data.reduce(
    (t, c) => ({ companies: t.companies + 1, users: t.users + c.stats.users, passes: t.passes + c.stats.passes, vehicles: t.vehicles + c.stats.vehicles, active: t.active + c.stats.active, revenue: round2(t.revenue + c.stats.revenue) }),
    { companies: 0, users: 0, passes: 0, vehicles: 0, active: 0, revenue: 0 }
  );
  res.json({ success: true, data: { companies: data, totals } });
};

// POST /api/pass-companies
const createPassCompany = async (req, res) => {
  const fields = clean(req.body);
  let created;
  try {
    created = await PassCompany.create({ ...fields, companyId: req.companyId, createdBy: req.user._id });
  } catch (error) {
    if (error.code === 11000) throw new AppError("A company with this name already exists", 409);
    throw error;
  }
  await audit.record(req, "PASS_COMPANY_CREATE", { entity: "PassCompany", entityId: created._id, companyId: req.companyId, meta: { name: created.name } });
  res.status(201).json({ success: true, data: created });
};

// PUT /api/pass-companies/:id
const updatePassCompany = async (req, res) => {
  const found = await findInScope(req);
  Object.assign(found, clean(req.body));
  try {
    await found.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("A company with this name already exists", 409);
    throw error;
  }
  await audit.record(req, "PASS_COMPANY_UPDATE", { entity: "PassCompany", entityId: found._id, companyId: found.companyId, meta: { changed: Object.keys(req.body) } });
  res.json({ success: true, data: found });
};

// DELETE /api/pass-companies/:id
// A company nobody belongs to can be removed; one with pass users or passes is switched off instead (it keeps its history).
const removePassCompany = async (req, res) => {
  const found = await findInScope(req);
  const [users, passCount] = await Promise.all([
    PassUser.countDocuments({ companyId: found.companyId, passCompanyId: found._id }),
    Pass.countDocuments({ companyId: found.companyId, passCompanyId: found._id }),
  ]);
  if (users > 0 || passCount > 0) {
    throw new AppError(`${found.name} has ${users} pass user${users === 1 ? "" : "s"} and ${passCount} pass${passCount === 1 ? "" : "es"}. Switch it off instead of deleting it.`, 409);
  }
  await PassCompany.deleteOne({ _id: found._id });
  await audit.record(req, "PASS_COMPANY_DELETE", { entity: "PassCompany", entityId: found._id, companyId: found.companyId, meta: { name: found.name } });
  res.json({ success: true, data: { deleted: true } });
};

// Used when a pass is sold or changed: the company must belong to the same tenant.
const assertPassCompany = async (companyId, id) => {
  if (!id) return undefined;
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid company", 400);
  const found = await PassCompany.findOne({ _id: id, companyId, isActive: true }).select("_id");
  if (!found) throw new AppError("That company was not found, or it is switched off", 404);
  return found._id;
};

module.exports = { listPassCompanies, createPassCompany, updatePassCompany, removePassCompany, assertPassCompany, statsFor };
