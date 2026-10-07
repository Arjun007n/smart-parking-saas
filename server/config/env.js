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
  // Online payments: a mistyped provider name must stop the server, not quietly turn payments off.
  const payments = require("../integrations/payment");
  if (!payments.isKnownProvider()) {
    throw new Error(`PAYMENT_PROVIDER "${payments.providerName()}" is not known. Use generic, simulated or razorpay.`);
  }
  if (process.env.NODE_ENV === "production" && payments.providerName() === "simulated") {
    throw new Error("PAYMENT_PROVIDER=simulated is for development only and cannot be used in production");
  }
  // Email: same rules.
  const mail = require("../integrations/email");
  if (!mail.isKnownProvider()) {
    throw new Error(`EMAIL_PROVIDER "${mail.providerName()}" is not known. Use none, simulated or resend.`);
  }
  if (process.env.NODE_ENV === "production" && mail.providerName() === "simulated") {
    throw new Error("EMAIL_PROVIDER=simulated is for development only and cannot be used in production");
  }
  const mailProblems = mail.provider().problems();
  if (mailProblems.length) throw new Error(`EMAIL_PROVIDER=${mail.providerName()}: ${mailProblems.join("; ")}`);
  // Text messages (SMS / WhatsApp): same rules.
  const texts = require("../integrations/messaging");
  if (!texts.isKnownProvider()) {
    throw new Error(`MESSAGING_PROVIDER "${texts.providerName()}" is not known. Use none, simulated or twilio.`);
  }
  if (process.env.NODE_ENV === "production" && texts.providerName() === "simulated") {
    throw new Error("MESSAGING_PROVIDER=simulated is for development only and cannot be used in production");
  }
  if (texts.unknownChannels().length) {
    throw new Error(`MESSAGING_CHANNELS has unknown channel(s): ${texts.unknownChannels().join(", ")}. Use sms and/or whatsapp.`);
  }
  const textProblems = texts.provider().problems();
  if (textProblems.length) throw new Error(`MESSAGING_PROVIDER=${texts.providerName()}: ${textProblems.join("; ")}`);
  // Mobile-number check at signup needs a working message provider.
  if (String(process.env.SIGNUP_OTP || "off").trim().toLowerCase() === "on" && !texts.isEnabled()) {
    throw new Error("SIGNUP_OTP=on needs text messages: set MESSAGING_PROVIDER (twilio, or simulated while testing)");
  }
  // FASTag charging: same rules. A mistyped name or missing credential stops the server.
  const fastag = require("../integrations/fastag");
  if (!fastag.isKnownProvider()) {
    throw new Error(`FASTAG_PROVIDER "${fastag.providerName()}" is not known. Use none, simulated or http.`);
  }
  if (process.env.NODE_ENV === "production" && fastag.providerName() === "simulated") {
    throw new Error("FASTAG_PROVIDER=simulated is for development only and cannot be used in production");
  }
  const fastagProblems = fastag.provider().problems();
  if (fastagProblems.length) throw new Error(`FASTAG_PROVIDER=${fastag.providerName()}: ${fastagProblems.join("; ")}`);
};

module.exports = {
  validateEnv,
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
  // Developer conveniences (error details, password reset link in the API
  // answer) are allowed only when NODE_ENV is explicitly "development" or
  // "test". If NODE_ENV is missing, the server behaves as in production.
  get isDevLike() {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
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
  // Requests allowed per IP address per minute, across the whole API.
  get apiRateLimitMax() {
    return Number(process.env.API_RATE_LIMIT_MAX) || 600;
  },
  // Set FORCE_HTTPS=true in production when the host does not already
  // redirect http to https.
  get forceHttps() {
    return process.env.FORCE_HTTPS === "true";
  },
};
