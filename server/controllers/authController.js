const AppError = require("../utils/AppError");
const env = require("../config/env");
const { signToken, hashToken, createResetToken } = require("../utils/token");
const { ROLES } = require("../config/permissions");
const { accessOf } = require("../services/roleService");
const audit = require("../services/auditService");
const loginGuard = require("../services/loginGuard");
const account = require("../services/accountService");
const emailService = require("../services/emailService");
const otp = require("../services/otpService");
const email = require("../integrations/email");
const User = require("../models/User");
const Company = require("../models/Company");

const TRIAL_DAYS = 14;
const RESET_TOKEN_MINUTES = 30;

// The user as the client sees it, with the custom role's name when there is one.
const userView = (user, customRole) => ({ ...user.toJSON(), customRole });

const authResponse = async (user, company) => {
  const access = await accessOf(user);
  return {
    token: signToken(user),
    user: userView(user, access.customRole),
    company: company || null,
    permissions: access.permissions,
  };
};

// POST /api/auth/register
// Registers a new company together with its first Company Admin.
const register = async (req, res) => {
  const { companyName, name, email, password, phoneToken, gstNumber, city, state } = req.body;
  const chosenCode = account.normalizeCompanyCode(req.body.companyCode);
  let { phone } = req.body;

  // With SIGNUP_OTP=on the mobile number must have been proven with a text-message code.
  const proven = otp.options().otpRequired;
  if (proven) {
    if (!phone) throw new AppError("Enter your mobile number", 400);
    phone = otp.assertProof(phoneToken, phone);
  }

  if (await User.exists({ email })) {
    throw new AppError("An account with this email already exists", 409);
  }

  // The admin picks the company code everyone signs in with; without one, a code is made.
  if (chosenCode) {
    const problem = await account.codeProblem(Company, chosenCode);
    if (problem) throw new AppError(problem, 409);
  }

  let company;
  try {
    company = await Company.create({
      ...(chosenCode ? { code: chosenCode } : {}),
      name: companyName,
      billingContact: { name, email, phone },
      ...(gstNumber ? { gstNumber } : {}),
      ...(city || state ? { address: { ...(city ? { city } : {}), ...(state ? { state } : {}) } } : {}),
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    // Two companies picking the same code at the same moment: the second one loses.
    if (error.code === 11000 && chosenCode) throw new AppError("This company code is already taken", 409);
    throw error;
  }

  let user;
  try {
    user = await User.create({
      companyId: company._id, name, email, phone, password, role: ROLES.COMPANY_ADMIN, ...(proven ? { phoneVerified: true } : {}),
    });
  } catch (error) {
    // Do not leave a company behind without an admin.
    await Company.deleteOne({ _id: company._id });
    throw error;
  }

  await audit.record(req, "AUTH_REGISTER", {
    actor: user, companyId: company._id, entity: "Company", entityId: company._id,
  });

  res.status(201).json({ success: true, data: await authResponse(user, company) });
};

// GET /api/auth/company-code?code=ABC123   is this company code free? (for the signup form)
const checkCompanyCode = async (req, res) => {
  const code = account.normalizeCompanyCode(req.query.code);
  const problem = code ? await account.codeProblem(Company, code) : "Enter a company code";
  res.json({ success: true, data: { code, available: !problem, ...(problem ? { reason: problem } : {}) } });
};

// GET /api/auth/signup-options   what the signup page should ask for
const signupOptions = (req, res) => {
  res.json({ success: true, data: otp.options() });
};

// POST /api/auth/otp/send   { phone }
const sendOtp = async (req, res) => {
  const result = await otp.send(req.body.phone);
  res.json({ success: true, data: result });
};

// POST /api/auth/otp/verify   { phone, code }
const verifyOtp = async (req, res) => {
  const result = await otp.verify(req.body.phone, req.body.code);
  res.json({ success: true, data: result });
};

// POST /api/auth/login
// Every company signs in with its own company code: { companyCode, loginId | email, password }.
// The one exception is the platform's own administrator (no company), who signs in with an email alone.
const login = async (req, res) => {
  const { password } = req.body;
  const code = account.normalizeCompanyCode(req.body.companyCode);
  const loginId = account.normalizeLoginId(req.body.loginId);
  const email = req.body.email;
  if (!email && !loginId) throw new AppError("Enter your login ID or email, and your password", 400);

  const needCode = new AppError("Enter your company code to sign in", 401);
  const invalid = new AppError("Invalid company code, login ID or password", 401);
  const select = "+password +failedLogins +lockedUntil";
  const who = { email: email || `${loginId}@${code || "-"}` };

  let user = null;
  if (code) {
    const company = await Company.findOne({ code }).select("_id");
    if (company) user = await User.findOne({ companyId: company._id, ...(email ? { email } : { loginId }) }).select(select);
  } else if (email) {
    // No code: only the platform administrator may sign in this way.
    user = await User.findOne({ email, role: ROLES.SUPER_ADMIN }).select(select);
    if (!user) {
      await loginGuard.burnTime(password);
      await audit.record(req, "AUTH_LOGIN_FAILED", who);
      throw needCode;
    }
  } else {
    await loginGuard.burnTime(password);
    throw needCode;
  }
  if (!user) {
    await loginGuard.burnTime(password); // same response time as for a real account
    await audit.record(req, "AUTH_LOGIN_FAILED", who);
    throw invalid;
  }

  if (loginGuard.isLocked(user)) {
    throw new AppError(
      `Too many wrong passwords. This account is locked for ${loginGuard.minutesLeft(user)} more minutes.`,
      429
    );
  }

  if (!(await user.comparePassword(password))) {
    const next = loginGuard.afterFailure(user.failedLogins);
    await User.updateOne({ _id: user._id }, { $set: next });
    await audit.record(req, next.lockedUntil ? "AUTH_ACCOUNT_LOCKED" : "AUTH_LOGIN_FAILED", {
      ...who, companyId: user.companyId,
    });
    throw invalid;
  }
  if (!user.isActive) throw new AppError("This account has been deactivated", 403);

  // Government officers have their own login page, and nobody else may use it.
  const officer = user.role === ROLES.GOVERNMENT_OFFICER;
  if (req.body.portal === "government" && !officer) throw invalid;
  if (officer && req.body.portal !== "government") {
    throw new AppError("Government officers sign in on the Government login page", 403);
  }

  let company = null;
  if (user.role !== ROLES.SUPER_ADMIN) {
    company = await Company.findById(user.companyId);
    if (!company || !company.isActive) throw new AppError("Company account is inactive", 403);
  }

  user.lastLoginAt = new Date();
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  await audit.record(req, "AUTH_LOGIN", { actor: user });

  res.json({ success: true, data: await authResponse(user, company) });
};

// POST /api/auth/change-password   (the signed-in user changes their own password)
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select("+password");

  if (!(await user.comparePassword(currentPassword))) {
    await audit.record(req, "AUTH_PASSWORD_CHANGE_FAILED");
    throw new AppError("Your current password is not correct", 400);
  }
  if (currentPassword === newPassword) {
    throw new AppError("Choose a password that is different from the current one", 400);
  }

  user.password = newPassword;
  user.tokenVersion += 1; // other devices are logged out
  await user.save();
  await audit.record(req, "AUTH_PASSWORD_CHANGED");

  // A fresh token so this device stays logged in.
  res.json({ success: true, data: { token: signToken(user) }, message: "Password changed" });
};

// GET /api/auth/me
const me = async (req, res) => {
  res.json({
    success: true,
    data: {
      user: userView(req.user, req.customRole || null),
      company: req.company || null,
      permissions: req.permissions,
    },
  });
};

// PUT /api/auth/preferences   { emailAlerts?, phoneAlerts? }  (at least one)
const updatePreferences = async (req, res) => {
  const changes = {};
  for (const key of ["emailAlerts", "phoneAlerts"]) if (req.body[key] !== undefined) changes[key] = req.body[key];
  if (!Object.keys(changes).length) throw new AppError("Nothing to change: send emailAlerts or phoneAlerts", 400);
  const user = await User.findByIdAndUpdate(req.user._id, { $set: changes }, { returnDocument: "after" });
  await audit.record(req, "AUTH_PREFERENCES_CHANGED", { meta: changes });
  res.json({ success: true, data: { user: userView(user, req.customRole || null) } });
};

// PUT /api/auth/profile   { name, phone? }
// The signed-in user edits their own name and mobile number. The email is the login, so it stays as it is.
const updateProfile = async (req, res) => {
  const { name, phone } = req.body;
  const update = { name, phone: phone || "" };
  const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { returnDocument: "after" });
  await audit.record(req, "AUTH_PROFILE_CHANGED", { meta: { phoneChanged: (req.user.phone || "") !== update.phone, nameChanged: req.user.name !== name } });
  res.json({ success: true, data: { user: userView(user, req.customRole || null) } });
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
    // Sent in the background so the answer is the same (and as fast) for every address.
    emailService.sendPasswordReset({ user, url: resetUrl, minutes: RESET_TOKEN_MINUTES });
    // Without email, the link is only available in development.
    if (!email.isEnabled() && !env.isDevLike) {
      console.error("Password reset requested but email is not switched on (EMAIL_PROVIDER): nobody can receive the link.");
    }
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
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  await audit.record(req, "AUTH_PASSWORD_RESET", { actor: user });

  res.json({ success: true, message: "Password updated. Please log in." });
};

module.exports = { register, checkCompanyCode, signupOptions, sendOtp, verifyOtp, login, me, logout, changePassword, forgotPassword, resetPassword, updatePreferences, updateProfile };
