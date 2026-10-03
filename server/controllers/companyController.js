const AppError = require("../utils/AppError");
const { ROLES } = require("../config/permissions");
const audit = require("../services/auditService");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Tariff = require("../models/Tariff");
const User = require("../models/User");

const isSuperAdmin = (req) => req.user.role === ROLES.SUPER_ADMIN;

// A company can be read by its own users and by Super Admin only.
const findAccessible = async (req) => {
  if (!isSuperAdmin(req) && String(req.user.companyId) !== req.params.id) {
    throw new AppError("Company not found", 404);
  }
  const company = await Company.findById(req.params.id);
  if (!company) throw new AppError("Company not found", 404);
  return company;
};

// GET /api/companies
const listCompanies = async (req, res) => {
  const filter = isSuperAdmin(req) ? {} : { _id: req.user.companyId };
  const companies = await Company.find(filter).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, data: companies });
};

// GET /api/companies/:id
const getCompany = async (req, res) => {
  res.json({ success: true, data: await findAccessible(req) });
};

// POST /api/companies  (Super Admin)
const createCompany = async (req, res) => {
  const company = await Company.create(req.body);
  await audit.record(req, "COMPANY_CREATE", {
    entity: "Company", entityId: company._id, companyId: company._id,
  });
  res.status(201).json({ success: true, data: company });
};

// Fields only the platform (Super Admin) may change.
const PLATFORM_ONLY = ["subscriptionStatus", "plan", "isActive", "isVerified", "trialEndsAt"];

// PUT /api/companies/:id
const updateCompany = async (req, res) => {
  const company = await findAccessible(req);
  const updates = { ...req.body };

  if (!isSuperAdmin(req)) {
    for (const field of PLATFORM_ONLY) delete updates[field];
  }

  const { plan, isVerified, billingContact, address, ...simple } = updates;
  Object.assign(company, simple);
  if (billingContact) Object.assign(company.billingContact, billingContact);
  if (address) Object.assign(company.address, address);
  if (plan) {
    Object.assign(company.plan, plan);
    company.onboarding.planSelected = true;
  }
  if (isVerified !== undefined) company.onboarding.isVerified = isVerified;

  await company.save();
  await audit.record(req, "COMPANY_UPDATE", {
    entity: "Company", entityId: company._id, companyId: company._id,
    meta: { changed: Object.keys(updates) },
  });

  res.json({ success: true, data: company });
};

// GET /api/companies/:id/onboarding
// Progress through: registration -> verification -> admin -> plan ->
// first location -> capacity -> tariff -> operators -> go live.
const getOnboarding = async (req, res) => {
  const company = await findAccessible(req);
  const companyId = company._id;

  const [admins, locations, withCapacity, tariffs, operators] = await Promise.all([
    User.countDocuments({ companyId, role: ROLES.COMPANY_ADMIN, isActive: true }),
    Location.countDocuments({ companyId, isActive: true }),
    Location.countDocuments({
      companyId,
      isActive: true,
      $or: [{ "capacity.car": { $gt: 0 } }, { "capacity.bike": { $gt: 0 } }, { "capacity.heavy": { $gt: 0 } }],
    }),
    Tariff.countDocuments({ companyId, isActive: true }),
    User.countDocuments({
      companyId,
      isActive: true,
      role: { $in: [ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR, ROLES.COLLECTION_OPERATOR] },
    }),
  ]);

  const steps = [
    { key: "registration", label: "Company registered", done: true },
    { key: "verification", label: "Company verified", done: company.onboarding.isVerified },
    { key: "admin", label: "Admin account created", done: admins > 0 },
    { key: "plan", label: "Plan selected", done: company.onboarding.planSelected },
    { key: "location", label: "First parking location created", done: locations > 0 },
    { key: "capacity", label: "Capacity configured", done: withCapacity > 0 },
    { key: "tariff", label: "Tariff configured", done: tariffs > 0 },
    { key: "operators", label: "Operators added", done: operators > 0 },
  ];
  const ready = steps.every((s) => s.done);
  steps.push({ key: "live", label: "Operations started", done: Boolean(company.onboarding.wentLiveAt) });

  res.json({
    success: true,
    data: {
      steps,
      completed: steps.filter((s) => s.done).length,
      total: steps.length,
      readyToGoLive: ready,
    },
  });
};

module.exports = { listCompanies, getCompany, createCompany, updateCompany, getOnboarding };
