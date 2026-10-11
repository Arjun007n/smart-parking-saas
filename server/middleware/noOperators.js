const AppError = require("../utils/AppError");

// Refuses a request that carries database operators (keys such as `$ne` or `$where`) in its body, query or
// route parameters. Routes already validate the fields they accept; this is a second line of defence that
// stops an operator reaching a query even if one forgets to. The payment gateway's webhook is left alone
// (it has its own signature check and its own payload shape).
const MAX_DEPTH = 8;

const hasOperator = (value, depth = 0) => {
  if (!value || typeof value !== "object") return false;
  if (depth > MAX_DEPTH) return true; // absurdly deep: not a real request
  if (Array.isArray(value)) return value.some((item) => hasOperator(item, depth + 1));
  return Object.keys(value).some((key) => key.startsWith("$") || hasOperator(value[key], depth + 1));
};

const noOperators = (req, res, next) => {
  if (req.originalUrl.startsWith("/api/payments/webhook")) return next();
  if (hasOperator(req.body) || hasOperator(req.query) || hasOperator(req.params)) {
    return next(new AppError("Invalid request", 400));
  }
  return next();
};

module.exports = noOperators;
module.exports.hasOperator = hasOperator;
