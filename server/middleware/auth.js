const AppError = require("../utils/AppError");
const { verifyToken } = require("../utils/token");
const User = require("../models/User");
const Company = require("../models/Company");
const { ROLES } = require("../config/permissions");

const BLOCKED_SUBSCRIPTIONS = ["SUSPENDED", "CANCELLED"];

// Requires a valid "Authorization: Bearer <token>" header and loads the user.
const protect = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new AppError("Please log in to continue", 401);

  const payload = verifyToken(token);

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

  req.user = user;
  next();
};

module.exports = { protect };
