// Payment abstraction.
//
// - WALLET is paid from the customer's prepaid wallet; the money was taken
//   when the wallet was topped up, and the debit is a ledger entry.
// - CASH, UPI, CARD and FASTAG are collected by the operator at the gate. The
//   operator confirms the money was received, so the payment is recorded as
//   SUCCESS straight away. A UPI/card reference can be stored with it.
// - GATEWAY is an online payment. It starts as PENDING and becomes SUCCESS
//   only when the gateway tells us (webhook), or when the reconciliation
//   sweep asks the gateway and learns it was paid.
//
// Which gateway is used is chosen by PAYMENT_PROVIDER:
//   generic    (default) any gateway that can call our signed webhook
//   simulated  pretend gateway for development and demos (never in production)
//   razorpay   Razorpay payment links
//
// A provider offers: isConfigured(), createOrder(), parseWebhook(req),
// fetchStatus(payment) and refund(payment, reason). Adding another gateway
// means adding one file in ./providers and one line below.

const generic = require("./providers/generic");
const simulated = require("./providers/simulated");
const razorpay = require("./providers/razorpay");

const PROVIDERS = { generic, simulated, razorpay };
const MANUAL_METHODS = ["CASH", "UPI", "CARD", "FASTAG", "WALLET"];
const isManual = (method) => MANUAL_METHODS.includes(method);

const providerName = () => (process.env.PAYMENT_PROVIDER || "generic").trim().toLowerCase();
const isKnownProvider = (name = providerName()) => Object.prototype.hasOwnProperty.call(PROVIDERS, name);
const provider = () => PROVIDERS[providerName()] || null;
const isGatewayConfigured = () => Boolean(provider() && provider().isConfigured());

module.exports = {
  MANUAL_METHODS, PROVIDERS, isManual, providerName, isKnownProvider, provider, isGatewayConfigured,
  // Kept for the generic provider's callers and tests.
  sign: generic.sign,
  verifyWebhookSignature: (rawBody, signature) => generic.verifySignature(rawBody, signature),
};
