const AppError = require("../utils/AppError");
const { ROLES } = require("../config/permissions");
const audit = require("../services/auditService");
const reports = require("../services/dailyReportService");
const email = require("../integrations/email");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Tariff = require("../models/Tariff");
const User = require("../models/User");
const { VEHICLE_KEYS } = require("../models/constants");

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
      $or: VEHICLE_KEYS.map((key) => ({ [`capacity.${key}`]: { $gt: 0 } })),
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

// ---- the end-of-day report email (see services/dailyReportService.js) ----

const reportEmailView = (company) => {
  const setting = company.reportEmail || {};
  return {
    enabled: Boolean(setting.enabled),
    recipients: setting.recipients || [],
    sendAt: reports.minutesToText(setting.sendAtMinutes ?? 1320),
    lastSentFor: setting.lastSentFor || null,
    // False when the server has no email provider: the setting is kept but nothing is sent.
    emailAvailable: email.isEnabled(),
  };
};

// GET /api/companies/:id/report-email
const getReportEmail = async (req, res) => {
  res.json({ success: true, data: reportEmailView(await findAccessible(req)) });
};

// PUT /api/companies/:id/report-email   { enabled?, recipients?, sendAt? }
const updateReportEmail = async (req, res) => {
  const company = await findAccessible(req);
  const { enabled, recipients, sendAt } = req.body;
  if (enabled !== undefined) company.reportEmail.enabled = enabled;
  if (recipients !== undefined) company.reportEmail.recipients = [...new Set(recipients.map((r) => r.toLowerCase()))].slice(0, 10);
  if (sendAt !== undefined) {
    const minutes = reports.textToMinutes(sendAt);
    if (minutes === null) throw new AppError("Send time must look like 22:00", 400);
    company.reportEmail.sendAtMinutes = minutes;
  }
  await company.save();
  await audit.record(req, "COMPANY_REPORT_EMAIL_UPDATE", {
    entity: "Company", entityId: company._id, companyId: company._id,
    meta: { enabled: company.reportEmail.enabled, recipients: company.reportEmail.recipients.length, sendAt: reports.minutesToText(company.reportEmail.sendAtMinutes) },
  });
  res.json({ success: true, data: reportEmailView(company) });
};

// POST /api/companies/:id/report-email/test
// Sends today's report so far to the person who asked (not to the list), so they can see what it looks like.
const sendReportEmailTest = async (req, res) => {
  const company = await findAccessible(req);
  const result = await reports.sendReport({ company, to: [req.user.email], partial: true });
  if (!result.sent) throw new AppError(`The test email was not sent: ${result.reason}`, 409);
  res.json({ success: true, data: { sentTo: result.sentTo } });
};

module.exports = { getReportEmail, updateReportEmail, sendReportEmailTest, listCompanies, getCompany, createCompany, updateCompany, getOnboarding };
