const env = require("../config/env");
const AppError = require("../utils/AppError");
const { reportError } = require("../utils/monitor");

const notFound = (req, res, next) =>
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));

// Converts known library errors into clean API responses.
const normalize = (err) => {
  if (err.isOperational) return err;

  if (err.name === "ValidationError" && err.errors) {
    const errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return new AppError("Validation failed", 400, errors);
  }
  if (err.name === "VersionError") return new AppError("This record was just changed by someone else. Reload and try again.", 409);
  if (err.name === "CastError") return new AppError(`Invalid ${err.path}`, 400);
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {}).filter((k) => k !== "companyId").join(", ");
    return new AppError(`A record with this ${field || "value"} already exists`, 409);
  }
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return new AppError("Session expired or invalid. Please log in again.", 401);
  }
  if (err.type === "entity.parse.failed") return new AppError("Invalid JSON body", 400);
  if (err.type === "entity.too.large") return new AppError("Request body too large", 413);
  return err;
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const error = normalize(err);
  const statusCode = error.isOperational ? error.statusCode : 500;

  if (statusCode >= 500) {
    reportError(err, { method: req.method, path: req.originalUrl, userId: req.user ? String(req.user._id) : undefined });
  }

  const body = {
    success: false,
    message: error.isOperational ? error.message : "Something went wrong",
  };
  if (error.errors) body.errors = error.errors;
  // Internal error details are shown only in development and test.
  if (!error.isOperational && env.isDevLike) body.debug = err.message;

  res.status(statusCode).json(body);
};

module.exports = { notFound, errorHandler };
