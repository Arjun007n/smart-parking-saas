const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { verifyToken } = require("../utils/token");
const User = require("../models/User");
const Company = require("../models/Company");
const { ROLES } = require("../config/permissions");
const { accessOf } = require("../services/roleService");

const BLOCKED_SUBSCRIPTIONS = ["SUSPENDED", "CANCELLED"];
// A government officer may only reach their own reports and their own account (sign out, change password).
// This is checked for every request here, so a route that forgot to ask for a permission still stays closed.
const GOVERNMENT_AREAS = ["/api/government", "/api/auth"];

// Requires a valid "Authorization: Bearer <token>" header and loads the user.
const protect = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new AppError("Please log in to continue", 401);

  const payload = verifyToken(token);
  // The user id must be a plain id. Anything else (for example an object
  // that the database would read as a query) is refused outright.
  if (typeof payload.sub !== "string" || !mongoose.isValidObjectId(payload.sub)) {
    throw new AppError("Session expired or invalid. Please log in again.", 401);
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw new AppError("Account not found or deactivated", 401);
  if (payload.tv !== user.tokenVersion) {
    throw new AppError("Session expired. Please log in again.", 401);
  }

  if (user.role !== ROLES.SUPER_ADMIN) {
    const company = user.companyId ? await Company.findById(user.companyId) : null;
    if (!company || !company.isActive) throw new AppError("Company account is inactive", 403);
    if (BLOCKED_SUBSCRIPTIONS.includes(company.subscriptionStatus)) {
      throw new AppError("Company subscription is not active", 403);
    }
    req.company = company;
  }

  if (user.role === ROLES.GOVERNMENT_OFFICER && !GOVERNMENT_AREAS.includes(req.baseUrl)) {
    throw new AppError("This account can only open the government reports", 403);
  }

  req.user = user;
  // What this user may do right now (custom role or built-in role).
  const access = await accessOf(user);
  req.permissions = access.permissions;
  req.customRole = access.customRole;
  next();
};

module.exports = { protect };
