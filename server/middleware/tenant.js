const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { ROLES } = require("../config/permissions");

// Decides which company (tenant) a request works on. Must run after `protect`.
//
// - Normal users are always locked to their own company. Anything they send
//   in the body, query or headers is ignored.
// - Super Admin works across all companies, or on one company when the
//   "x-company-id" header is sent.
//
// Controllers must use `req.tenantFilter` in every query on tenant-owned data.
const tenant = (req, res, next) => {
  if (req.user.role === ROLES.SUPER_ADMIN) {
    const header = req.headers["x-company-id"];
    if (header !== undefined && !mongoose.isValidObjectId(header)) {
      return next(new AppError("Invalid x-company-id header", 400));
    }
    req.companyId = header ? new mongoose.Types.ObjectId(header) : null;
  } else {
    if (!req.user.companyId) return next(new AppError("User is not linked to a company", 403));
    req.companyId = req.user.companyId;
  }

  req.tenantFilter = req.companyId ? { companyId: req.companyId } : {};
  next();
};

// For routes that create tenant-owned records: a company must be known.
const requireCompany = (req, res, next) => {
  if (!req.companyId) {
    return next(new AppError("Select a company first (send the x-company-id header)", 400));
  }
  next();
};

module.exports = { tenant, requireCompany };
