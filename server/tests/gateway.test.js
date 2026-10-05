// Payment gateway providers, without a database or the internet.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret-0123456789abcdef0123";
process.env.PAYMENT_WEBHOOK_SECRET = "unit-test-webhook-secret-123456";
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "rzp-test-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "razorpay-webhook-secret-12345";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const gateway = require("../integrations/payment");
const generic = require("../integrations/payment/providers/generic");
const razorpay = require("../integrations/payment/providers/razorpay");
const simulated = require("../integrations/payment/providers/simulated");
const env = require("../config/env");

const withProvider = (name, work) => async () => {
  const saved = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = name;
  try {
    await work();
  } finally {
    if (saved === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = saved;
  }
};

const webhookReq = (body, signatureHeader, signature) => {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { rawBody, body, headers: signatureHeader ? { [signatureHeader]: signature(rawBody) } : {} };
};

test("provider choice: generic by default, unknown names are caught", () => {
  delete process.env.PAYMENT_PROVIDER;
  assert.equal(gateway.providerName(), "generic");
  assert.equal(gateway.provider(), generic);
  assert.ok(gateway.isGatewayConfigured());
  assert.ok(!gateway.isKnownProvider("stripe"));
  assert.ok(!gateway.isKnownProvider("__proto__"));
  assert.ok(!gateway.isKnownProvider("constructor"));
});

test("provider choice: validateEnv rejects a mistyped provider and simulated in production", withProvider("razorpa", () => {
  const saved = { uri: process.env.MONGO_URI, node: process.env.NODE_ENV };
  process.env.MONGO_URI = "mongodb://x/y";
  try {
    assert.throws(() => env.validateEnv(), /not known/);
    process.env.PAYMENT_PROVIDER = "simulated";
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "x".repeat(40);
    assert.throws(() => env.validateEnv(), /development only/);
    assert.ok(!simulated.isConfigured(), "simulated switches itself off in production");
  } finally {
    process.env.MONGO_URI = saved.uri;
    process.env.NODE_ENV = saved.node;
  }
}));

test("generic webhook: signature, body and amount are checked", () => {
  const good = { transactionId: "ORD-1", status: "SUCCESS", gatewayRef: "G1", amount: 40 };
  const sign = (raw) => generic.sign(raw);
  const event = generic.parseWebhook(webhookReq(good, "x-signature", sign));
  assert.deepEqual(event, { transactionId: "ORD-1", status: "SUCCESS", gatewayRef: "G1", amount: 40 });

  assert.throws(() => generic.parseWebhook(webhookReq(good)), (e) => e.statusCode === 401);
  assert.throws(() => generic.parseWebhook(webhookReq(good, "x-signature", () => "0".repeat(64))), (e) => e.statusCode === 401);
  for (const bad of [
    { ...good, status: "MAYBE" }, { ...good, transactionId: 5 }, { ...good, amount: "40" }, { ...good, amount: -1 },
  ]) {
    assert.throws(() => generic.parseWebhook(webhookReq(bad, "x-signature", sign)), (e) => e.statusCode === 400);
  }
});

test("generic provider: makes order ids, cannot refund or be asked", async () => {
  const order = await generic.createOrder();
  assert.match(order.transactionId, /^ORD-[0-9A-F]{24}$/);
  assert.equal(await generic.fetchStatus(), null);
  await assert.rejects(generic.refund(), (e) => e.statusCode === 409);
});

test("simulated provider: pay address, fake refund, no questions to a gateway", async () => {
  const order = await simulated.createOrder();
  assert.equal(order.payUrl, `simulated://pay/${order.transactionId}`);
  assert.match((await simulated.refund()).refundId, /^SIMREF-/);
  assert.equal(await simulated.fetchStatus(), null);
});

const razorpaySign = (raw) => crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
const paidEvent = (overrides = {}) => ({
  event: "payment_link.paid",
  payload: {
    payment_link: { entity: { id: "plink_ABC", reference_id: "ORD-AAAA", amount: 4000, amount_paid: 4000, status: "paid" } },
    payment: { entity: { id: "pay_XYZ", amount: 4000, status: "captured" } },
  },
  ...overrides,
});

test("razorpay webhook: a paid link becomes our result; other events are ignored", () => {
  const event = razorpay.parseWebhook(webhookReq(paidEvent(), "x-razorpay-signature", razorpaySign));
  assert.deepEqual(event, {
    transactionId: "ORD-AAAA", status: "SUCCESS", gatewayRef: "plink_ABC", gatewayPaymentId: "pay_XYZ", amount: 40,
  });
  assert.equal(razorpay.parseWebhook(webhookReq({ event: "payment.failed", payload: {} }, "x-razorpay-signature", razorpaySign)), null);
  assert.equal(razorpay.parseWebhook(webhookReq({ event: "payment_link.expired", payload: {} }, "x-razorpay-signature", razorpaySign)), null);
});

test("razorpay webhook: wrong or missing signature, and a body without our reference, are refused", () => {
  assert.throws(() => razorpay.parseWebhook(webhookReq(paidEvent())), (e) => e.statusCode === 401);
  assert.throws(() => razorpay.parseWebhook(webhookReq(paidEvent(), "x-razorpay-signature", () => "1".repeat(64))), (e) => e.statusCode === 401);
  // The generic header and secret do not open the Razorpay door.
  assert.throws(() => razorpay.parseWebhook(webhookReq(paidEvent(), "x-signature", razorpaySign)), (e) => e.statusCode === 401);
  const noRef = paidEvent();
  delete noRef.payload.payment_link.entity.reference_id;
  assert.throws(() => razorpay.parseWebhook(webhookReq(noRef, "x-razorpay-signature", razorpaySign)), (e) => e.statusCode === 400);
});

// Replaces fetch for one test and records what was asked.
const fakeGateway = async (answers, work) => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
    const next = answers.shift();
    return { ok: next.ok !== false, status: next.status || 200, json: async () => next.json };
  };
  try {
    await work(calls);
  } finally {
    globalThis.fetch = real;
  }
};

test("razorpay createOrder: amount in paise, our reference, expiry at least 16 minutes ahead", () =>
  fakeGateway([{ json: { id: "plink_1", short_url: "https://rzp.io/i/abc" } }], async (calls) => {
    const soon = new Date(Date.now() + 5 * 60000); // our own 5-minute window is too short for Razorpay
    const order = await razorpay.createOrder({ amount: 40.5, session: { ticketNumber: "T-260302-AAAAAA", vehicleNumber: "RJ14AB1234" }, expiresAt: soon });
    const [call] = calls;
    assert.equal(call.url, "https://api.razorpay.com/v1/payment_links");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.Authorization, `Basic ${Buffer.from("rzp_test_key:rzp-test-secret").toString("base64")}`);
    assert.equal(call.body.amount, 4050);
    assert.equal(call.body.currency, "INR");
    assert.equal(call.body.reference_id, order.transactionId);
    assert.ok(call.body.expire_by * 1000 >= Date.now() + 15.5 * 60000);
    assert.equal(order.gatewayRef, "plink_1");
    assert.equal(order.payUrl, "https://rzp.io/i/abc");
    assert.ok(order.expiresAt > soon, "the stored deadline follows Razorpay's");
  }));

test("razorpay createOrder: a booking fee carries its own description and a return page, a ticket payment does not", () =>
  fakeGateway([{ json: { id: "plink_2", short_url: "https://rzp.io/i/def" } }, { json: { id: "plink_3", short_url: "https://rzp.io/i/ghi" } }], async (calls) => {
    const later = new Date(Date.now() + 30 * 60000);
    await razorpay.createOrder({
      amount: 60, session: { ticketNumber: "booking fee", vehicleNumber: "RJ14AB1234" }, expiresAt: later,
      description: "Parking booking fee (RJ14AB1234)", returnUrl: "https://app.example/booking/return",
    });
    await razorpay.createOrder({ amount: 60, session: { ticketNumber: "T-1", vehicleNumber: "RJ14AB1234" }, expiresAt: later });
    assert.equal(calls[0].body.description, "Parking booking fee (RJ14AB1234)");
    assert.equal(calls[0].body.callback_url, "https://app.example/booking/return");
    assert.equal(calls[0].body.callback_method, "get");
    assert.equal(calls[1].body.description, "Parking T-1 (RJ14AB1234)");
    assert.ok(!("callback_url" in calls[1].body));
  }));

test("razorpay: a refusal becomes a clear error, a dead network too", async () => {
  await fakeGateway([{ ok: false, status: 400, json: { error: { description: "Amount too small" } } }], async () => {
    await assert.rejects(
      razorpay.createOrder({ amount: 0.1, session: { ticketNumber: "T", vehicleNumber: "V" }, expiresAt: new Date() }),
      (e) => e.statusCode === 502 && /Amount too small/.test(e.message)
    );
  });
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    await assert.rejects(razorpay.fetchStatus({ gatewayRef: "plink_1" }), (e) => e.statusCode === 502);
  } finally {
    globalThis.fetch = real;
  }
});

test("razorpay fetchStatus: paid, expired, still waiting", async () => {
  await fakeGateway([
    { json: { id: "plink_1", status: "paid", amount_paid: 4000, payments: [{ payment_id: "pay_1", status: "captured" }] } },
    { json: { id: "plink_1", status: "expired" } },
    { json: { id: "plink_1", status: "created" } },
  ], async () => {
    assert.deepEqual(await razorpay.fetchStatus({ gatewayRef: "plink_1" }), {
      status: "SUCCESS", amount: 40, gatewayRef: "plink_1", gatewayPaymentId: "pay_1",
    });
    assert.deepEqual(await razorpay.fetchStatus({ gatewayRef: "plink_1" }), { status: "FAILED", reason: "Payment link expired" });
    assert.equal(await razorpay.fetchStatus({ gatewayRef: "plink_1" }), null);
  });
  assert.equal(await razorpay.fetchStatus({}), null, "no link, nothing to ask");
});

test("razorpay refund: full amount in paise to the gateway payment; unknown payment id is explained", async () => {
  await fakeGateway([{ json: { id: "rfnd_1" } }], async (calls) => {
    const out = await razorpay.refund({ amount: 40, gatewayPaymentId: "pay_1" }, "Charged twice");
    assert.equal(out.refundId, "rfnd_1");
    assert.equal(calls[0].url, "https://api.razorpay.com/v1/payments/pay_1/refund");
    assert.equal(calls[0].body.amount, 4000);
  });
  await fakeGateway([{ json: { id: "plink_1", status: "created" } }], async () => {
    await assert.rejects(razorpay.refund({ amount: 40, gatewayRef: "plink_1" }, "Why not"), (e) => e.statusCode === 409);
  });
});

test("razorpay is configured only with keys and a long enough webhook secret", () => {
  assert.ok(razorpay.isConfigured());
  const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = "short";
  try {
    assert.ok(!razorpay.isConfigured());
  } finally {
    process.env.RAZORPAY_WEBHOOK_SECRET = saved;
  }
});
