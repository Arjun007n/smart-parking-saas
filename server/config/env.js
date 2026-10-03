// Central place for environment configuration. Fails fast when a required
// value is missing so the server never starts half-configured.
const required = ["MONGO_URI", "JWT_SECRET"];

const validateEnv = () => {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  if (process.env.NODE_ENV === "production" && process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
};

module.exports = {
  validateEnv,
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
  // Only these two environments may expose developer conveniences.
  get isDevLike() {
    return this.nodeEnv === "development" || this.nodeEnv === "test";
  },
  get port() {
    return Number(process.env.PORT) || 5000;
  },
  get jwtSecret() {
    return process.env.JWT_SECRET;
  },
  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN || "7d";
  },
  get clientUrl() {
    return process.env.CLIENT_URL || "http://localhost:5173";
  },
  get authRateLimitMax() {
    return Number(process.env.AUTH_RATE_LIMIT_MAX) || 20;
  },
};