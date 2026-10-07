// Email: provider choice, sending rules, Resend adapter (with a fake network), templates, alert levels.
const test = require("node:test");
const assert = require("node:assert/strict");
const email = require("../integrations/email");
const emailService = require("../services/emailService");

const KEYS = ["EMAIL_PROVIDER", "EMAIL_FROM", "RESEND_API_KEY", "EMAIL_REPLY_TO", "EMAIL_TIMEOUT_MS", "EMAIL_ALERT_HOURLY_CAP", "NODE_ENV", "PAYMENT_PROVIDER"];
const saved = { fetch: globalThis.fetch, errors: console.error };
for (const k of KEYS) saved[k] = process.env[k];
test.afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = saved.fetch;
  console.error = saved.errors;
  email.outbox.length = 0;
});

const useResend = () => {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_secret_key";
  process.env.EMAIL_FROM = "Smart Parking <alerts@example.com>";
};
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("email is off unless a provider is chosen; unknown names are caught", async () => {
  delete process.env.EMAIL_PROVIDER;
  assert.equal(email.providerName(), "none");
  assert.equal(email.isEnabled(), false);
  assert.deepEqual(await email.send({ to: "a@example.com", subject: "Hi", text: "Hello" }), { sent: false, reason: "email is not switched on" });
  process.env.EMAIL_PROVIDER = " Simulated ";
  assert.equal(email.isEnabled(), true);
  process.env.EMAIL_PROVIDER = "postcard";
  assert.equal(email.isKnownProvider(), false);
  assert.equal(email.isEnabled(), false);
});

test("resend needs a key and a from address", () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  assert.equal(email.PROVIDERS.resend.problems().length, 2);
  assert.equal(email.PROVIDERS.resend.isConfigured(), false);
  useResend();
  assert.deepEqual(email.PROVIDERS.resend.problems(), []);
  assert.equal(email.isEnabled(), true);
});

test("simulated provider keeps one copy per recipient and cleans the input", async () => {
  process.env.EMAIL_PROVIDER = "simulated";
  const result = await email.send({
    to: ["One@Example.com", "one@example.com", "not-an-email", "two@example.com", "<x>@bad.com"],
    subject: "Line one\r\nBcc: attacker@example.com",
    text: "Body",
  });
  assert.equal(result.sent, true);
  assert.deepEqual(result.sentTo, ["one@example.com", "two@example.com"]);
  assert.equal(email.outbox.length, 2);
  assert.deepEqual(email.outbox[0].to, ["one@example.com"], "recipients never see each other");
  assert.equal(email.outbox[0].subject, "Line one Bcc: attacker@example.com", "a subject is one line");

  assert.equal((await email.send({ to: ["nope"], subject: "S", text: "T" })).reason, "no valid recipient");
  assert.equal((await email.send({ to: "a@example.com", subject: "  ", text: "T" })).sent, false);
  assert.equal((await email.send({ to: "a@example.com", subject: "S", text: "" })).sent, false);

  const many = Array.from({ length: 50 }, (_, i) => `user${i}@example.com`);
  email.outbox.length = 0;
  await email.send({ to: many, subject: "S", text: "T" });
  assert.equal(email.outbox.length, email.MAX_RECIPIENTS);
});

test("resend: request shape, idempotency key and reply-to", async () => {
  useResend();
  process.env.EMAIL_REPLY_TO = "help@example.com";
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return answer(200, { id: "msg_1" });
  };
  const result = await email.send({ to: ["a@example.com"], subject: "Sub", text: "Txt", html: "<p>Txt</p>", key: "alert:1" });
  assert.deepEqual(result, { sent: true, sentTo: ["a@example.com"], failed: [], reason: undefined });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].options.headers.Authorization, "Bearer re_secret_key");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "alert:1:a@example.com");
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, {
    from: "Smart Parking <alerts@example.com>", to: ["a@example.com"], subject: "Sub", text: "Txt", html: "<p>Txt</p>", reply_to: "help@example.com",
  });
});

test("resend: one retry for rate limits, server errors and network trouble, none for rejections", async () => {
  useResend();
  console.error = () => {};
  const sequence = (...steps) => {
    let calls = 0;
    globalThis.fetch = async () => {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      if (step instanceof Error) throw step;
      return step;
    };
    return () => calls;
  };
  const msg = { to: ["a@example.com"], subject: "S", text: "T" };

  let calls = sequence(answer(429, { message: "slow down" }), answer(200, { id: "x" }));
  assert.equal((await email.send(msg)).sent, true);
  assert.equal(calls(), 2);

  calls = sequence(answer(500, {}), answer(502, {}));
  assert.equal((await email.send(msg)).sent, false);
  assert.equal(calls(), 2, "only one retry");

  calls = sequence(new Error("ECONNRESET"), answer(200, { id: "y" }));
  assert.equal((await email.send(msg)).sent, true);
  assert.equal(calls(), 2);

  calls = sequence(answer(422, { message: "Invalid `from` address" }));
  const rejected = await email.send(msg);
  assert.equal(rejected.sent, false);
  assert.deepEqual(rejected.failed, ["a@example.com"]);
  assert.equal(calls(), 1, "a rejection is not retried");
});

test("resend failures are logged without the key or the message", async () => {
  useResend();
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  globalThis.fetch = async () => answer(401, { message: "API key is invalid" });
  const result = await email.send({ to: ["a@example.com"], subject: "S", text: "Secret body text" });
  assert.equal(result.sent, false);
  assert.ok(logged.some((l) => /401/.test(l)));
  assert.ok(!logged.some((l) => l.includes("re_secret_key") || l.includes("Secret body text")));
});

test("one failing address does not stop the others", async () => {
  useResend();
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    const { to } = JSON.parse(options.body);
    return to[0] === "bad@example.com" ? answer(422, { message: "no" }) : answer(200, { id: "ok" });
  };
  const result = await email.send({ to: ["good@example.com", "bad@example.com", "fine@example.com"], subject: "S", text: "T" });
  assert.deepEqual(result.sentTo, ["good@example.com", "fine@example.com"]);
  assert.deepEqual(result.failed, ["bad@example.com"]);
  assert.equal(result.sent, true);
});

test("a slow provider is cut off by the timeout", async () => {
  useResend();
  process.env.EMAIL_TIMEOUT_MS = "1000";
  console.error = () => {};
  globalThis.fetch = (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const started = Date.now();
  const result = await email.send({ to: ["a@example.com"], subject: "S", text: "T" });
  assert.equal(result.sent, false);
  assert.ok(Date.now() - started < 8000);
});

test("templates escape everything that came from outside", () => {
  const evil = `<script>alert(1)</script> "quoted" & 'single'`;
  const alert = emailService.renderAlert({
    notification: { title: evil, message: evil, severity: "critical" }, companyName: evil, locationName: evil, url: "https://app.example.com/dashboard/notifications?a=1&b=2",
  });
  assert.ok(!alert.html.includes("<script>"));
  assert.ok(alert.html.includes("&lt;script&gt;"));
  assert.ok(alert.html.includes("a=1&amp;b=2"));
  assert.match(alert.subject, /^Urgent: /);
  assert.ok(alert.text.includes("https://app.example.com/dashboard/notifications?a=1&b=2"), "plain text keeps the raw link");

  const warn = emailService.renderAlert({ notification: { title: "Pass ends", message: "m", severity: "warning" }, url: "https://x.example.com" });
  assert.equal(warn.subject, "Pass ends");

  const reset = emailService.renderPasswordReset({ name: "<b>Ann</b>", url: "https://app.example.com/reset-password?token=abc", minutes: 30 });
  assert.ok(reset.html.includes("&lt;b&gt;Ann"));
  assert.ok(reset.text.includes("https://app.example.com/reset-password?token=abc"));
  assert.match(reset.text, /30 minutes/);
});

test("alert levels decide who gets which alert", () => {
  const user = (emailAlerts) => ({ emailAlerts });
  assert.equal(emailService.wants(user(undefined), "critical"), true, "default is critical only");
  assert.equal(emailService.wants(user(undefined), "warning"), false);
  assert.equal(emailService.wants(user("CRITICAL"), "critical"), true);
  assert.equal(emailService.wants(user("IMPORTANT"), "warning"), true);
  assert.equal(emailService.wants(user("IMPORTANT"), "info"), false);
  assert.equal(emailService.wants(user("ALL"), "info"), true);
  assert.equal(emailService.wants(user("OFF"), "critical"), false);
  assert.equal(emailService.wants(user("nonsense"), "critical"), true, "an unknown value falls back to the default");
});

test("each company gets a limited number of alert emails per hour", () => {
  process.env.EMAIL_ALERT_HOURLY_CAP = "2";
  const now = Date.now();
  assert.equal(emailService.underCap("cap-co", now), true);
  assert.equal(emailService.underCap("cap-co", now), true);
  assert.equal(emailService.underCap("cap-co", now), false);
  assert.equal(emailService.underCap("other-co", now), true, "another company is not affected");
  assert.equal(emailService.underCap("cap-co", now + 61 * 60 * 1000), true, "the hour passes");
});

test("startup refuses a bad email setup", () => {
  const { validateEnv } = require("../config/env");
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://x";
  process.env.JWT_SECRET = "z".repeat(40);
  delete process.env.PAYMENT_PROVIDER;
  process.env.EMAIL_PROVIDER = "postcard";
  assert.throws(validateEnv, /EMAIL_PROVIDER/);
  process.env.EMAIL_PROVIDER = "simulated";
  process.env.NODE_ENV = "production";
  assert.throws(validateEnv, /simulated is for development only/);
  process.env.NODE_ENV = "test";
  process.env.EMAIL_PROVIDER = "resend";
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  assert.throws(validateEnv, /RESEND_API_KEY is required; EMAIL_FROM is required/);
  useResend();
  assert.doesNotThrow(validateEnv);
  process.env.EMAIL_PROVIDER = "none";
  assert.doesNotThrow(validateEnv);
});

test("pass notices: the last valid day is the day before the stored end, and values are escaped", () => {
  // Valid 2 Mar to 1 Apr (end = local midnight after the last day; local = UTC+5:30).
  const pass = {
    passNumber: "P-260302-AB3XYZ", holderName: "<b>Asha</b>", vehicleNumber: "RJ14AB1234",
    vehicles: [{ number: "RJ14AB1234" }, { number: "RJ14CD5678" }],
    startDate: new Date("2026-03-01T18:30:00Z"), endDate: new Date("2026-04-01T18:30:00Z"),
  };
  const made = emailService.renderPassNotice({ kind: "NEW", pass, companyName: "Arjun.co", locationName: "Mall" });
  assert.equal(made.subject, "Your parking pass P-260302-AB3XYZ");
  assert.match(made.text, /Valid from 2 March 2026 to 1 April 2026/);
  assert.match(made.text, /Vehicles: RJ14AB1234, RJ14CD5678/);
  assert.ok(!made.html.includes("<b>Asha</b>"), "holder name is escaped in html");

  assert.match(emailService.renderPassNotice({ kind: "RENEWED", pass }).subject, /renewed/);
  const soon = emailService.renderPassNotice({ kind: "EXPIRING", pass, daysLeft: 1 });
  assert.equal(soon.subject, "Your parking pass ends in 1 day");
  assert.match(soon.text, /valid until 1 April 2026/);
});

test("pass notices go out only when email is on and the pass has a valid address", async () => {
  process.env.EMAIL_PROVIDER = "none";
  assert.equal(emailService.sendPassNotice({ pass: { email: "a@b.co" }, kind: "NEW" }), null);
  process.env.EMAIL_PROVIDER = "simulated";
  assert.equal(emailService.sendPassNotice({ pass: {}, kind: "NEW" }), null);
  assert.equal(emailService.sendPassNotice({ pass: { email: "not an address" }, kind: "NEW" }), null);
});
