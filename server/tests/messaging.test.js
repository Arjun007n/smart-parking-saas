// Text messages: provider choice, phone numbers, Twilio adapter (with a fake network), wording, alert levels.
const test = require("node:test");
const assert = require("node:assert/strict");
const messaging = require("../integrations/messaging");
const messageService = require("../services/messageService");

const KEYS = [
  "MESSAGING_PROVIDER", "MESSAGING_CHANNELS", "MESSAGING_DEFAULT_COUNTRY_CODE", "MESSAGING_TIMEOUT_MS", "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_WHATSAPP_FROM", "NODE_ENV",
];
const saved = { fetch: globalThis.fetch, errors: console.error };
for (const k of KEYS) saved[k] = process.env[k];
test.afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = saved.fetch;
  console.error = saved.errors;
  messaging.outbox.length = 0;
});

const useTwilio = (extra = {}) => {
  Object.assign(process.env, {
    MESSAGING_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACtest123", TWILIO_AUTH_TOKEN: "secret_token", TWILIO_SMS_FROM: "+15005550006", ...extra,
  });
};
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("messages are off unless a provider is chosen; unknown names are caught", async () => {
  delete process.env.MESSAGING_PROVIDER;
  assert.equal(messaging.providerName(), "none");
  assert.equal(messaging.isEnabled(), false);
  assert.deepEqual(await messaging.send({ to: "9876543210", body: "Hi" }), { sent: false, reason: "messages are not switched on" });
  process.env.MESSAGING_PROVIDER = " Simulated ";
  assert.equal(messaging.isEnabled(), true);
  process.env.MESSAGING_PROVIDER = "pigeon";
  assert.equal(messaging.isKnownProvider(), false);
  assert.equal(messaging.isEnabled(), false);
});

test("phone numbers are cleaned into +country form, and junk is refused", () => {
  delete process.env.MESSAGING_DEFAULT_COUNTRY_CODE;
  assert.equal(messaging.normalizePhone("98765 43210"), "+919876543210");
  assert.equal(messaging.normalizePhone("09876543210"), "+919876543210");
  assert.equal(messaging.normalizePhone("+91 98765-43210"), "+919876543210");
  assert.equal(messaging.normalizePhone("919876543210"), "+919876543210");
  assert.equal(messaging.normalizePhone("0091 98765 43210"), "+919876543210");
  assert.equal(messaging.normalizePhone("+1 (415) 555-2671"), "+14155552671");
  for (const bad of ["", "abc", "12345", "+0123456789", "98765x43210", null, undefined, {}]) assert.equal(messaging.normalizePhone(bad), null, String(bad));
  process.env.MESSAGING_DEFAULT_COUNTRY_CODE = "44";
  assert.equal(messaging.normalizePhone("07911123456"), "+447911123456");
  assert.equal(messaging.isPhone("x"), false);
});

test("channels default to sms; unknown names are reported", () => {
  delete process.env.MESSAGING_CHANNELS;
  assert.deepEqual(messaging.channels(), ["sms"]);
  process.env.MESSAGING_CHANNELS = "WhatsApp, sms, sms";
  assert.deepEqual(messaging.channels(), ["whatsapp", "sms"]);
  process.env.MESSAGING_CHANNELS = "sms,telegram";
  assert.deepEqual(messaging.unknownChannels(), ["telegram"]);
  process.env.MESSAGING_CHANNELS = "telegram";
  assert.deepEqual(messaging.channels(), []);
});

test("twilio needs credentials and a sender for each channel", () => {
  for (const k of KEYS) delete process.env[k];
  process.env.MESSAGING_PROVIDER = "twilio";
  assert.equal(messaging.provider().isConfigured(), false);
  assert.equal(messaging.provider().problems().length, 3);
  useTwilio();
  assert.deepEqual(messaging.provider().problems(), []);
  process.env.MESSAGING_CHANNELS = "sms,whatsapp";
  assert.match(messaging.provider().problems().join(" "), /TWILIO_WHATSAPP_FROM/);
  process.env.TWILIO_WHATSAPP_FROM = "+14155238886";
  assert.deepEqual(messaging.provider().problems(), []);
  delete process.env.TWILIO_SMS_FROM;
  assert.match(messaging.provider().problems().join(" "), /TWILIO_SMS_FROM/);
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG123";
  assert.deepEqual(messaging.provider().problems(), []);
});

test("twilio SMS: the request is built right, credentials are in the header only", async () => {
  useTwilio();
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return answer(201, { sid: "SM1" }); };
  const result = await messaging.send({ to: ["98765 43210", "9876543210", "bad"], body: "Hello\u0007 there", key: "k1" });
  assert.equal(result.sent, true);
  assert.deepEqual(result.sentTo, ["+919876543210"]);
  assert.equal(calls.length, 1, "duplicates and bad numbers are dropped");
  assert.equal(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json");
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("ACtest123:secret_token").toString("base64")}`);
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get("To"), "+919876543210");
  assert.equal(form.get("From"), "+15005550006");
  assert.equal(form.get("Body"), "Hello  there");
  assert.ok(!calls[0].options.body.includes("secret_token"));
});

test("twilio WhatsApp: prefixes both numbers; a messaging service replaces the SMS From", async () => {
  useTwilio({ MESSAGING_CHANNELS: "sms,whatsapp", TWILIO_WHATSAPP_FROM: "+14155238886", TWILIO_MESSAGING_SERVICE_SID: "MGabc" });
  const forms = [];
  globalThis.fetch = async (url, options) => { forms.push(new URLSearchParams(options.body)); return answer(201, { sid: "SM" }); };
  const result = await messaging.send({ to: "9876543210", body: "Hi" });
  assert.equal(result.sent, true);
  assert.equal(forms.length, 2);
  const [sms, whatsapp] = forms;
  assert.equal(sms.get("MessagingServiceSid"), "MGabc");
  assert.equal(sms.get("From"), null);
  assert.equal(whatsapp.get("To"), "whatsapp:+919876543210");
  assert.equal(whatsapp.get("From"), "whatsapp:+14155238886");
});

test("twilio errors: a refusal is not retried and never leaks the token; a server error is retried once", async () => {
  useTwilio();
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return answer(400, { message: "The 'To' number is not valid", code: 21211 }); };
  const refused = await messaging.send({ to: "9876543210", body: "Hi" });
  assert.deepEqual([refused.sent, refused.failed, calls], [false, ["+919876543210"], 1]);
  assert.ok(logged.join("\n").includes("21211"));
  assert.ok(!logged.join("\n").includes("secret_token"));
  assert.ok(!logged.join("\n").includes("9876543210"), "the number is masked in the log");

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return calls === 1 ? answer(503, {}) : answer(201, { sid: "SM2" }); };
  assert.equal((await messaging.send({ to: "9876543210", body: "Hi" })).sent, true);
  assert.equal(calls, 2);

  globalThis.fetch = async () => { throw Object.assign(new Error("boom"), { name: "AbortError" }); };
  const slow = await messaging.send({ to: "9876543210", body: "Hi" });
  assert.equal(slow.sent, false);
  assert.match(logged.join("\n"), /timed out/);
});

test("send checks its input and shortens long text", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  assert.equal((await messaging.send({ to: "nope", body: "Hi" })).reason, "no valid phone number");
  assert.equal((await messaging.send({ to: "9876543210", body: "   " })).reason, "a message needs text");
  await messaging.send({ to: "9876543210", body: "x".repeat(2000) });
  assert.equal(messaging.outbox[0].body.length, 600);
  assert.equal(messaging.outbox[0].channel, "sms");
});

test("wording: alert, entry, exit, pass and booking texts", () => {
  const entryTime = new Date("2026-03-02T04:30:00Z"); // 10:00 local at +05:30
  const session = { vehicleNumber: "MH12AB1234", ticketNumber: "T-0007", entryTime };
  process.env.APP_UTC_OFFSET_MINUTES = "330";
  const entry = messageService.renderVisit({ kind: "ENTRY", session, companyName: "Acme", locationName: "Main" });
  assert.match(entry, /^Acme, Main: MH12AB1234 entered at 10:00 on 2 Mar\. Ticket T-0007\.$/);

  const left = { ...session, exitTime: new Date("2026-03-02T07:00:00Z"), durationMinutes: 150, fee: { total: 80 } };
  assert.match(messageService.renderVisit({ kind: "EXIT", session: left, companyName: "Acme", locationName: "Main" }), /left at 12:30 after 2h 30m\. Paid Rs 80\./);
  assert.match(messageService.renderVisit({ kind: "EXIT", session: { ...left, fee: { total: 0 } }, companyName: "Acme" }), /No fee\./);
  assert.match(messageService.renderVisit({ kind: "EXIT", session: { ...left, fee: { total: 0 }, passId: "p1" }, companyName: "Acme" }), /Covered by your pass\./);
  assert.match(messageService.renderVisit({ kind: "EXIT", session: { ...left, fee: { total: 100, due: 40 } }, companyName: "Acme" }), /Paid Rs 40\./);

  const pass = { passNumber: "P-0001", vehicleNumber: "MH12AB1234", endDate: new Date("2026-04-01T18:30:00Z") };
  assert.match(messageService.renderPass({ kind: "NEW", pass, companyName: "Acme" }), /pass P-0001 \(MH12AB1234\) is active until 1 Apr\./);
  assert.match(messageService.renderPass({ kind: "RENEWED", pass, companyName: "Acme" }), /is renewed until 1 Apr\./);
  assert.match(messageService.renderPass({ kind: "EXPIRING", pass, companyName: "Acme", daysLeft: 1 }), /ends in 1 day, on 1 Apr/);

  const booking = { vehicleNumber: "MH12AB1234", expectedAt: entryTime };
  assert.match(messageService.renderBooking({ booking, companyName: "Acme", locationName: "Main" }), /booking confirmed for MH12AB1234, expected 2 Mar 10:00\./);

  const alert = messageService.renderAlert({ notification: { severity: "critical", title: "Main is full", message: "20 of 20." }, companyName: "Acme", locationName: "Main" });
  assert.equal(alert, "URGENT: Main is full - 20 of 20. - Acme, Main");
});

test("alert levels follow the person's choice and default to urgent only", () => {
  const { wants } = messageService;
  assert.equal(wants({}, "critical"), true);
  assert.equal(wants({}, "warning"), false);
  assert.equal(wants({ phoneAlerts: "IMPORTANT" }, "warning"), true);
  assert.equal(wants({ phoneAlerts: "IMPORTANT" }, "info"), false);
  assert.equal(wants({ phoneAlerts: "ALL" }, "info"), true);
  assert.equal(wants({ phoneAlerts: "OFF" }, "critical"), false);
});

test("the hourly cap limits alert texts per company", () => {
  const now = 1_000_000;
  process.env.MESSAGING_ALERT_HOURLY_CAP = "2";
  assert.equal(messageService.underCap("cap-co", now), true);
  assert.equal(messageService.underCap("cap-co", now + 1), true);
  assert.equal(messageService.underCap("cap-co", now + 2), false);
  assert.equal(messageService.underCap("cap-co", now + 60 * 60 * 1000 + 5), true, "a new hour starts fresh");
  delete process.env.MESSAGING_ALERT_HOURLY_CAP;
});
