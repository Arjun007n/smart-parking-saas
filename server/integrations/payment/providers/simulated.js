// A pretend gateway for development, demos and tests. It never touches money.
// The order gets a made-up pay address (shown as a QR code) and the screen has
// a "customer paid" button that goes through exactly the same code as a real
// webhook. It switches itself off when NODE_ENV is "production".

const crypto = require("crypto");
const generic = require("./generic");

module.exports = {
  name: "simulated",
  hostedPage: true,
  isConfigured: () => process.env.NODE_ENV !== "production",
  simulated: true,
  // Real webhooks are still accepted when a secret is set, which makes the full path testable.
  parseWebhook: generic.parseWebhook,
  async createOrder() {
    const transactionId = generic.newTransactionId();
    return { transactionId, payUrl: `simulated://pay/${transactionId}` };
  },
  async fetchStatus() {
    return null;
  },
  async refund() {
    return { refundId: `SIMREF-${crypto.randomBytes(6).toString("hex").toUpperCase()}` };
  },
};
