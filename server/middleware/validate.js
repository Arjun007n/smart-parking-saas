const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

// Small request validator. It checks types and limits, and it returns ONLY
// the fields named in the rules, so clients cannot set fields such as
// `role` or `companyId` unless a route explicitly allows them.
//
// Rule options: type ("string" | "email" | "number" | "boolean" | "date" | "objectId"
// | "array" | "object"), required, min, max, enum, pattern, upper, of (rule
// for array items), fields (rules for object keys).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const checkValue = (rule, value, path, errors) => {
  const fail = (message) => {
    errors.push({ field: path, message });
    return undefined;
  };

  switch (rule.type) {
    case "string":
    case "email": {
      if (typeof value !== "string") return fail("must be text");
      let text = value.trim();
      if (rule.type === "email") {
        text = text.toLowerCase();
        if (!EMAIL.test(text) || text.length > 254) return fail("must be a valid email");
      }
      if (rule.upper) text = text.toUpperCase();
      if (rule.required && !text) return fail("is required");
      if (rule.min && text.length < rule.min) return fail(`must be at least ${rule.min} characters`);
      if (text.length > (rule.max || 500)) return fail(`must be at most ${rule.max || 500} characters`);
      if (rule.enum && !rule.enum.includes(text)) return fail(`must be one of: ${rule.enum.join(", ")}`);
      if (rule.pattern && text && !rule.pattern.test(text)) return fail(rule.message || "has an invalid format");
      return text;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("must be a number");
      if (rule.integer && !Number.isInteger(value)) return fail("must be a whole number");
      if (rule.min !== undefined && value < rule.min) return fail(`must be at least ${rule.min}`);
      if (rule.max !== undefined && value > rule.max) return fail(`must be at most ${rule.max}`);
      return value;
    }
    case "boolean":
      if (typeof value !== "boolean") return fail("must be true or false");
      return value;
    case "date": {
      const date = typeof value === "string" ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return fail("must be a valid date and time");
      return date;
    }
    case "objectId":
      if (typeof value !== "string" || !mongoose.isValidObjectId(value)) return fail("must be a valid id");
      return value;
    case "array": {
      if (!Array.isArray(value)) return fail("must be a list");
      if (value.length > (rule.max || 100)) return fail(`must have at most ${rule.max || 100} items`);
      return value.map((item, i) => checkValue(rule.of, item, `${path}[${i}]`, errors));
    }
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("must be an object");
      return clean(rule.fields, value, `${path}.`, errors);
    default:
      throw new Error(`Unknown validation type for ${path}`);
  }
};

const clean = (rules, input, prefix, errors) => {
  const output = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = input[key];
    const path = `${prefix}${key}`;
    if (value === undefined || value === null) {
      if (rule.required) errors.push({ field: path, message: "is required" });
      continue;
    }
    const result = checkValue(rule, value, path, errors);
    if (result !== undefined) output[key] = result;
  }
  return output;
};

const validateData = (rules, input) => {
  const errors = [];
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const data = clean(rules, source, "", errors);
  return { data, errors };
};

const validateBody = (rules) => (req, res, next) => {
  const { data, errors } = validateData(rules, req.body);
  if (errors.length) return next(new AppError("Validation failed", 400, errors));
  req.body = data;
  next();
};

// Remembers which of the given fields the client sent as null ("clear this
// value"). Must run before validateBody, which drops nulls.
const collectCleared = (names) => (req, res, next) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  req.cleared = names.filter((name) => body[name] === null);
  next();
};

// Guards `:id` style route params.
const validateIdParam = (name = "id") => (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params[name])) {
    return next(new AppError(`Invalid ${name}`, 400));
  }
  next();
};

module.exports = { validateBody, validateData, validateIdParam, collectCleared };
