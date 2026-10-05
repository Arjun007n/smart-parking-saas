// Razorpay, through its Payment Links API (no extra package needed).
//
// Each online payment becomes a payment link with a short URL. The QR code on
// the screen holds that URL; the customer scans it, pays with any UPI app or
// card, and Razorpay calls our webhook.
//
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   from the Razorpay dashboard (API keys)
//   RAZORPAY_WEBHOOK_SECRET                the secret you type when you add the webhook
//   Webhook URL:  https://<your-api>/api/payments/webhook
//   Webhook events to tick:  payment_link.paid
//
// NOTE: written from Razorpay's documentation and tested only against
// recorded sample payloads. Try it once with Razorpay's test keys before
// using live keys.

const crypto = require("crypto");
const AppError = require("../../../utils/AppError");
const generic = require("./generic");

const API = process.env.RAZORPAY_API_URL || "https://api.razorpay.com/v1";
const keyId = () => process.env.RAZORPAY_KEY_ID || "";
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || "";
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || "";
const isConfigured = () => Boolean(keyId() && keySecret() && webhookSecret().length >= 16);

// Razorpay accepts a payment link expiry only at least 15 minutes ahead.
const MIN_EXPIRY_MINUTES = 16;
const paise = (rupees) => Math.round(rupees * 100);
const rupees = (paiseAmount) => Math.round(Number(paiseAmount)) / 100;

const call = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // We do not know whether Razorpay received the request.
    throw Object.assign(new AppError("The payment gateway did not answer. Try again, or take another payment method.", 502), { outcomeUnknown: true });
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = json?.error?.description ? `: ${json.error.description}` : "";
    // A 5xx may have been applied before it failed; a 4xx was refused outright.
    throw Object.assign(new AppError(`The payment gateway refused the request${detail}`, 502), { outcomeUnknown: response.status >= 500 });
  }
  return json;
};

const verifySignature = (rawBody, signature) => generic.verifySignature(rawBody, signature, webhookSecret());

// Turns a Razorpay webhook into our own shape, or null for events we ignore.
const parseWebhook = (req) => {
  if (!verifySignature(req.rawBody, req.headers["x-razorpay-signature"])) throw new AppError("Invalid signature", 401);
  const event = req.body?.event;
  if (event !== "payment_link.paid") return null;

  const link = req.body?.payload?.payment_link?.entity;
  const payment = req.body?.payload?.payment?.entity;
  if (!link || typeof link.reference_id !== "string") throw new AppError("Invalid webhook body", 400);
  const paid = link.amount_paid ?? payment?.amount;
  return {
    transactionId: link.reference_id,
    status: "SUCCESS",
    gatewayRef: typeof link.id === "string" ? link.id : undefined,
    gatewayPaymentId: typeof payment?.id === "string" ? payment.id : undefined,
    ...(paid !== undefined ? { amount: rupees(paid) } : {}),
  };
};

module.exports = {
  name: "razorpay",
  // The customer gets a payment page of its own (needed for online bookings, where nobody is at a counter).
  hostedPage: true,
  isConfigured,
  parseWebhook,
  signForTests: (rawBody) => crypto.createHmac("sha256", webhookSecret()).update(rawBody).digest("hex"),

  async createOrder({ amount, session, expiresAt, description, returnUrl, notes }) {
    const transactionId = generic.newTransactionId();
    const floor = Date.now() + MIN_EXPIRY_MINUTES * 60000;
    const expiry = new Date(Math.max(expiresAt.getTime(), floor));
    const link = await call("POST", "/payment_links", {
      amount: paise(amount),
      currency: "INR",
      accept_partial: false,
      reference_id: transactionId, // comes back in the webhook
      description: description || (session ? `Parking ${session.ticketNumber} (${session.vehicleNumber})` : "Smart Parking"),
      expire_by: Math.floor(expiry.getTime() / 1000),
      reminder_enable: false,
      notes: notes || (session ? { ticket: session.ticketNumber } : {}),
      // Where the customer is sent after paying (online bookings): a page of ours, never a secret.
      ...(returnUrl ? { callback_url: returnUrl, callback_method: "get" } : {}),
    });
    return { transactionId, gatewayRef: link.id, payUrl: link.short_url, expiresAt: expiry };
  },

  // Asks Razorpay what happened to a payment whose webhook never arrived.
  async fetchStatus(payment) {
    if (!payment.gatewayRef) return null;
    const link = await call("GET", `/payment_links/${encodeURIComponent(payment.gatewayRef)}`);
    if (link.status === "paid") {
      const first = Array.isArray(link.payments) ? link.payments.find((p) => p.status === "captured") || link.payments[0] : null;
      return {
        status: "SUCCESS",
        amount: rupees(link.amount_paid),
        gatewayRef: link.id,
        ...(first?.payment_id ? { gatewayPaymentId: first.payment_id } : {}),
      };
    }
    if (link.status === "expired" || link.status === "cancelled") return { status: "FAILED", reason: `Payment link ${link.status}` };
    return null; // still waiting for the customer
  },

  // Stops the customer paying a link we no longer want paid.
  async cancel(payment) {
    if (payment.gatewayRef) await call("POST", `/payment_links/${encodeURIComponent(payment.gatewayRef)}/cancel`);
  },

  async refund(payment, reason) {
    let paymentId = payment.gatewayPaymentId;
    if (!paymentId) {
      const known = await module.exports.fetchStatus(payment);
      paymentId = known?.gatewayPaymentId;
    }
    if (!paymentId) throw new AppError("The gateway payment id is not known. Refund it from the Razorpay dashboard.", 409);
    const refund = await call("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
      amount: paise(payment.amount),
      speed: "normal",
      notes: { reason: String(reason).slice(0, 200) },
    });
    return { refundId: refund.id };
  },
};
