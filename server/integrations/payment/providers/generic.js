// The simplest gateway link, and the default: any gateway (or a small bridge
// script in front of one) tells us a payment's result by calling
//
//     POST /api/payments/webhook
//     x-signature: <HMAC-SHA256 of the exact body, key = PAYMENT_WEBHOOK_SECRET>
//     { "transactionId": "ORD-...", "status": "SUCCESS" | "FAILED",
//       "gatewayRef": "...", "reason": "...", "amount": 40 }   (amount is optional)
//
// We make the order id ourselves; there is no hosted payment page, so the
// person at the gate shows the customer whatever the gateway gives them.

const crypto = require("crypto");
const AppError = require("../../../utils/AppError");

const webhookSecret = () => process.env.PAYMENT_WEBHOOK_SECRET || "";
const isConfigured = () => webhookSecret().length >= 16;

const newTransactionId = () => `ORD-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;

const sign = (rawBody, secret = webhookSecret()) => crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

// True only when `signature` is the HMAC-SHA256 of the exact request body.
const verifySignature = (rawBody, signature, secret = webhookSecret()) => {
  if (secret.length < 16 || !rawBody || typeof signature !== "string") return false;
  const expected = Buffer.from(sign(rawBody, secret), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

// Returns the payment result in our own shape, or throws when the call is not genuine.
const parseWebhook = (req) => {
  if (!verifySignature(req.rawBody, req.headers["x-signature"])) throw new AppError("Invalid signature", 401);
  const { transactionId, status, gatewayRef, gatewayPaymentId, reason, amount } = req.body || {};
  if (typeof transactionId !== "string" || !["SUCCESS", "FAILED"].includes(status)) {
    throw new AppError("Invalid webhook body", 400);
  }
  if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)) {
    throw new AppError("Invalid webhook body", 400);
  }
  return {
    transactionId,
    status,
    ...(typeof gatewayRef === "string" ? { gatewayRef: gatewayRef.slice(0, 100) } : {}),
    ...(typeof gatewayPaymentId === "string" ? { gatewayPaymentId: gatewayPaymentId.slice(0, 100) } : {}),
    ...(typeof reason === "string" ? { reason: reason.slice(0, 200) } : {}),
    ...(amount !== undefined ? { amount } : {}),
  };
};

module.exports = {
  name: "generic",
  hostedPage: false, // no payment page: only the person at the gate can show the customer how to pay
  isConfigured,
  sign,
  verifySignature,
  parseWebhook,
  newTransactionId,
  async createOrder() {
    return { transactionId: newTransactionId() };
  },
  // This gateway link cannot be asked about a payment; only its webhook tells us.
  async fetchStatus() {
    return null;
  },
  async refund() {
    throw new AppError("Online payments must be refunded through the payment gateway", 409);
  },
};
