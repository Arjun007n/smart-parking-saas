// Payment abstraction (plan, Day 19).
//
// - CASH, UPI and CARD are collected by the operator at the gate. The
//   operator confirms the money was received, so the payment is recorded as
//   SUCCESS straight away. A UPI/card reference can be stored with it.
// - GATEWAY is for an online payment gateway. The payment starts as PENDING
//   and only becomes SUCCESS when the gateway calls our webhook with a valid
//   signature. No specific gateway is wired in yet: `createGatewayOrder` is
//   the one place to add it (Phase 2 of the plan).

const crypto = require("crypto");

const MANUAL_METHODS = ["CASH", "UPI", "CARD"];
const isManual = (method) => MANUAL_METHODS.includes(method);

const webhookSecret = () => process.env.PAYMENT_WEBHOOK_SECRET || "";
const isGatewayConfigured = () => webhookSecret().length >= 16;

// Returns the reference the gateway will send back in its webhook.
const createGatewayOrder = async () => ({
  transactionId: `ORD-${crypto.randomBytes(12).toString("hex").toUpperCase()}`,
});

const sign = (rawBody, secret = webhookSecret()) =>
  crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

// True only when `signature` is the HMAC-SHA256 of the exact request body.
const verifyWebhookSignature = (rawBody, signature) => {
  if (!isGatewayConfigured() || !rawBody || typeof signature !== "string") return false;
  const expected = Buffer.from(sign(rawBody), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

module.exports = {
  MANUAL_METHODS, isManual, isGatewayConfigured, createGatewayOrder, sign, verifyWebhookSignature,
};
