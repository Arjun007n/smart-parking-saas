const AppError = require("../utils/AppError");

// Minimal in-memory rate limiter (per IP, per limiter). Good enough for a
// single server process. When the API runs on several instances, replace
// this with a shared store (for example Redis).
const rateLimit = ({ windowMs, max, message }) => {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const limit = typeof max === "function" ? max() : max;
    const now = Date.now();
    const key = req.ip || "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      // Never let the table grow without limit (many different addresses): drop the expired ones first.
      if (hits.size >= 100000) for (const [oldKey, old] of hits) if (old.resetAt <= now) hits.delete(oldKey);
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new AppError(message || "Too many requests. Please try again later.", 429));
    }
    next();
  };
};

module.exports = rateLimit;
