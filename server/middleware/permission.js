const AppError = require("../utils/AppError");
const { hasPermission } = require("../config/permissions");

// Allows the request only when the user's role has ALL listed permissions.
const requirePermission = (...permissions) => (req, res, next) => {
  if (!req.user) return next(new AppError("Please log in to continue", 401));
  const allowed = permissions.every((p) => hasPermission(req.user.role, p));
  if (!allowed) return next(new AppError("You do not have permission to do this", 403));
  next();
};

// Allows the request when the user's role has AT LEAST ONE of the permissions.
const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (!req.user) return next(new AppError("Please log in to continue", 401));
  const allowed = permissions.some((p) => hasPermission(req.user.role, p));
  if (!allowed) return next(new AppError("You do not have permission to do this", 403));
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new AppError("Please log in to continue", 401));
  if (!roles.includes(req.user.role)) {
    return next(new AppError("You do not have permission to do this", 403));
  }
  next();
};

module.exports = { requirePermission, requireAnyPermission, requireRole };
