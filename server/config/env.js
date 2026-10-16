// Central place for environment configuration. Fails fast when a required
// value is missing so the server never starts half-configured.
const required = ["MONGO_URI", "JWT_SECRET"];

// CLIENT_URL may list several approved web addresses separated by commas (for example the site and the admin
// site). The first one is used in the links of emails and payment returns.
const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

// NODE_ENV decides which safety checks apply. Only "development" and "test" switch the developer
// conveniences on; every other value, or none at all, is treated as production, so a forgotten setting can
// never leave the safe mode off.
const MODES = ["production", "development", "test"];
const devLike = () => process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
const productionLike = () => !devLike();

// Words that are never an acceptable signing secret.
const WEAK_SECRETS = /^(secret|password|changeme|change[-_ ]?me|jwtsecret|jwt[-_ ]?secret|test|testing|default|admin|12345678?9?0*|abc123|qwerty)/i;

const validateEnv = () => {
  const mode = process.env.NODE_ENV;
  if (mode !== undefined && String(mode).trim() !== "" && !MODES.includes(mode)) {
    throw new Error(`NODE_ENV "${mode}" is not known. Use production, development or test (leave it unset only if you want production behaviour).`);
  }
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  if (productionLike() && process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
  if (productionLike() && WEAK_SECRETS.test(process.env.JWT_SECRET)) {
    throw new Error("JWT_SECRET is a well-known weak value. Generate a random one (for example: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\")");
  }
  if (devLike() && process.env.JWT_SECRET.length < 32 && process.env.NODE_ENV !== "test") {
    console.warn("Warning: JWT_SECRET is shorter than 32 characters. Production will refuse to start with it; use a longer random value.");
  }
  // Online payments: a mistyped provider name must stop the server, not quietly turn payments off.
  const payments = require("../integrations/payment");
  if (!payments.isKnownProvider()) {
    throw new Error(`PAYMENT_PROVIDER "${payments.providerName()}" is not known. Use generic, simulated or razorpay.`);
  }
  if (productionLike() && payments.providerName() === "simulated") {
    throw new Error("PAYMENT_PROVIDER=simulated is for development only and cannot be used in production");
  }
  // Email: same rules.
  const mail = require("../integrations/email");
  if (!mail.isKnownProvider()) {
    throw new Error(`EMAIL_PROVIDER "${mail.providerName()}" is not known. Use none, simulated or resend.`);
  }
  if (productionLike() && mail.providerName() === "simulated") {
    throw new Error("EMAIL_PROVIDER=simulated is for development only and cannot be used in production");
  }
  const mailProblems = mail.provider().problems();
  if (mailProblems.length) throw new Error(`EMAIL_PROVIDER=${mail.providerName()}: ${mailProblems.join("; ")}`);
  // Text messages (SMS / WhatsApp): same rules.
  const texts = require("../integrations/messaging");
  if (!texts.isKnownProvider()) {
    throw new Error(`MESSAGING_PROVIDER "${texts.providerName()}" is not known. Use none, simulated or twilio.`);
  }
  if (productionLike() && texts.providerName() === "simulated") {
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
  if (productionLike() && fastag.providerName() === "simulated") {
    throw new Error("FASTAG_PROVIDER=simulated is for development only and cannot be used in production");
  }
  const fastagProblems = fastag.provider().problems();
  if (fastagProblems.length) throw new Error(`FASTAG_PROVIDER=${fastag.providerName()}: ${fastagProblems.join("; ")}`);
  // How many proxies sit in front of the server (used to find the caller's real IP address).
  const hops = process.env.TRUST_PROXY;
  if (hops !== undefined && String(hops).trim() !== "" && !/^[0-5]$/.test(String(hops).trim())) {
    throw new Error("TRUST_PROXY must be a number from 0 to 5: how many proxies are in front of the server (0 = none)");
  }
  // Browsers: only the approved web addresses may call the API. In production they must be set (not the
  // localhost default) and must be https.
  if (productionLike()) {
    if (!String(process.env.CLIENT_URL || "").trim()) {
      throw new Error("CLIENT_URL is required in production: the address(es) of the web app, separated by commas");
    }
    const insecure = parseOrigins(process.env.CLIENT_URL).filter((origin) => !origin.startsWith("https://"));
    if (insecure.length) throw new Error(`CLIENT_URL must use https in production: ${insecure.join(", ")}`);
  }
};

module.exports = {
  validateEnv,
  get nodeEnv() {
    return process.env.NODE_ENV || "production";
  },
  // True for "production" and for anything that is not development or test (including no value at all).
  get isProduction() {
    return productionLike();
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
    return this.corsOrigins[0];
  },
  // Every web address the browser may call the API from.
  get corsOrigins() {
    const list = parseOrigins(process.env.CLIENT_URL);
    return list.length ? list : ["http://localhost:5173"];
  },
  // Proxies in front of the server (hosting load balancer, CDN). Default 1, like most single-host setups.
  get trustProxy() {
    const text = String(process.env.TRUST_PROXY ?? "").trim();
    return /^[0-5]$/.test(text) ? Number(text) : 1;
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
