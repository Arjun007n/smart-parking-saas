const AppError = require("../utils/AppError");
const env = require("../config/env");
const { signToken, hashToken, createResetToken } = require("../utils/token");
const { ROLES, permissionsFor } = require("../config/permissions");
const audit = require("../services/auditService");
const User = require("../models/User");
const Company = require("../models/Company");

const TRIAL_DAYS = 14;
const RESET_TOKEN_MINUTES = 30;

const authResponse = (user, company) => ({
  token: signToken(user),
  user,
  company: company || null,
  permissions: permissionsFor(user.role),
});

// POST /api/auth/register
// Registers a new company together with its first Company Admin.
const register = async (req, res) => {
  const { companyName, name, email, phone, password } = req.body;

  if (await User.exists({ email })) {
    throw new AppError("An account with this email already exists", 409);
  }

  const company = await Company.create({
    name: companyName,
    billingContact: { name, email, phone },
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
  });

  let user;
  try {
    user = await User.create({
      companyId: company._id, name, email, phone, password, role: ROLES.COMPANY_ADMIN,
    });
  } catch (error) {
    // Do not leave a company behind without an admin.
    await Company.deleteOne({ _id: company._id });
    throw error;
  }

  await audit.record(req, "AUTH_REGISTER", {
    actor: user, companyId: company._id, entity: "Company", entityId: company._id,
  });

  res.status(201).json({ success: true, data: authResponse(user, company) });
};

// POST /api/auth/login
const login = async (req, res) => {
  const { email, password } = req.body;
  const invalid = new AppError("Invalid email or password", 401);

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    await audit.record(req, "AUTH_LOGIN_FAILED", { email, companyId: user ? user.companyId : undefined });
    throw invalid;
  }
  if (!user.isActive) throw new AppError("This account has been deactivated", 403);

  let company = null;
  if (user.role !== ROLES.SUPER_ADMIN) {
    company = await Company.findById(user.companyId);
    if (!company || !company.isActive) throw new AppError("Company account is inactive", 403);
  }

  user.lastLoginAt = new Date();
  await user.save();
  await audit.record(req, "AUTH_LOGIN", { actor: user });

  res.json({ success: true, data: authResponse(user, company) });
};

// GET /api/auth/me
const me = async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user,
      company: req.company || null,
      permissions: permissionsFor(req.user.role),
    },
  });
};

// POST /api/auth/logout
// Invalidates every token of this user (all devices).
const logout = async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  await audit.record(req, "AUTH_LOGOUT");
  res.json({ success: true, message: "Logged out" });
};

// POST /api/auth/forgot-password
// Always answers the same way, so nobody can learn which emails are registered.
const forgotPassword = async (req, res) => {
  const user = await User.findOne({ email: req.body.email, isActive: true });
  const body = {
    success: true,
    message: "If that email is registered, a password reset link has been sent.",
  };

  if (user) {
    const { raw, hash } = createResetToken();
    user.passwordResetToken = hash;
    user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);
    await user.save();
    await audit.record(req, "AUTH_PASSWORD_RESET_REQUESTED", { actor: user });

    const resetUrl = `${env.clientUrl}/reset-password?token=${raw}`;
    // TODO (Day 25): send resetUrl by email through the notification service.
    // Until then the link is only available in development.
    if (env.isDevLike) {
      console.log(`Password reset link for ${user.email}: ${resetUrl}`);
      body.devResetToken = raw;
    }
  }

  res.json(body);
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  const user = await User.findOne({
    passwordResetToken: hashToken(req.body.token),
    passwordResetExpires: { $gt: new Date() },
    isActive: true,
  });
  if (!user) throw new AppError("Reset link is invalid or has expired", 400);

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.tokenVersion += 1; // log out everywhere
  await user.save();
  await audit.record(req, "AUTH_PASSWORD_RESET", { actor: user });

  res.json({ success: true, message: "Password updated. Please log in." });
};

module.exports = { register, login, me, logout, forgotPassword, resetPassword };
