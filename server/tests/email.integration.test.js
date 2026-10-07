// Emails through the API (simulated provider): alert recipients and levels, password reset, preferences.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, withCode, assert } = require("./helpers");
const email = require("../integrations/email");
const emailService = require("../services/emailService");
const { notify } = require("../services/notificationService");
const AuditLog = require("../models/AuditLog");

setup();

const s = {};
let counter = 0;
const raise = async (company, severity, locationId, extra = {}) => {
  counter += 1;
  const created = await notify({
    companyId: company.company._id, locationId, type: "GENERAL", severity,
    title: `Alert ${counter} (${severity})`, message: "Something happened.", dedupeKey: `email-it-${counter}`, ...extra,
  });
  assert.ok(created, "the alert is stored");
  await emailService.flush();
  return created;
};
const recipients = () => email.outbox.map((m) => m.to[0]).sort();
const reset = () => { email.outbox.length = 0; };

it("setup: a company with an owner, two location admins, an operator and a second company", async () => {
  process.env.EMAIL_PROVIDER = "simulated";
  s.a = await registerCompany("ema");
  s.b = await registerCompany("emb");
  const loc = async (name) => {
    const res = await api("POST", "/api/locations", { token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
  };
  s.main = await loc("Main");
  s.annex = await loc("Annex");
  const staff = async (name, mail, role, ids) => {
    const res = await api("POST", "/api/users", { token: s.a.token, body: { name, email: mail, password: "Password123", role, locationIds: ids } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
  };
  s.siteMain = await staff("Site Main", "em-main@example.com", "LOCATION_ADMIN", [s.main._id]);
  await staff("Site Annex", "em-annex@example.com", "LOCATION_ADMIN", [s.annex._id]);
  await staff("Gate", "em-gate@example.com", "ENTRY_OPERATOR", [s.main._id]);
  s.tokenMain = await login("em-main@example.com");
  s.tokenAnnex = await login("em-annex@example.com");
  reset();
});

it("a critical alert reaches company admins and that location's admins, one copy each", async () => {
  await raise(s.a, "critical", s.main._id);
  assert.deepEqual(recipients(), ["admin-ema@example.com", "em-main@example.com"]);
  const mail = email.outbox[0];
  assert.match(mail.subject, /^Urgent: Alert \d+ \(critical\)$/);
  assert.match(mail.text, /Company ema/);
  assert.match(mail.text, /Main/);
  assert.match(mail.text, /\/dashboard\/notifications/);
  assert.ok(mail.html.includes("<a href="));
});

it("a company-wide alert reaches every admin, and never another company", async () => {
  reset();
  await raise(s.a, "critical", undefined);
  assert.deepEqual(recipients(), ["admin-ema@example.com", "em-annex@example.com", "em-main@example.com"]);
  reset();
  await raise(s.b, "critical", undefined);
  assert.deepEqual(recipients(), ["admin-emb@example.com"]);
});

it("warnings stay in the app until someone asks for them by email", async () => {
  reset();
  await raise(s.a, "warning", s.main._id);
  await raise(s.a, "info", s.main._id);
  assert.deepEqual(recipients(), []);

  const bad = await api("PUT", "/api/auth/preferences", { token: s.tokenMain, body: { emailAlerts: "EVERYTHING" } });
  assert.equal(bad.status, 400);
  assert.equal((await api("PUT", "/api/auth/preferences", { body: { emailAlerts: "ALL" } })).status, 401);
  const set = await api("PUT", "/api/auth/preferences", { token: s.tokenMain, body: { emailAlerts: "IMPORTANT" } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.user.emailAlerts, "IMPORTANT");
  const me = await api("GET", "/api/auth/me", { token: s.tokenMain });
  assert.equal(me.body.data.user.emailAlerts, "IMPORTANT");
  assert.equal((await AuditLog.find({ companyId: s.a.company._id, action: "AUTH_PREFERENCES_CHANGED" })).length, 1);

  reset();
  await raise(s.a, "warning", s.main._id);
  assert.deepEqual(recipients(), ["em-main@example.com"], "only the person who asked");
  reset();
  await raise(s.a, "info", s.main._id);
  assert.deepEqual(recipients(), [], "important means warning and critical");

  await api("PUT", "/api/auth/preferences", { token: s.tokenMain, body: { emailAlerts: "ALL" } });
  await raise(s.a, "info", s.main._id);
  assert.deepEqual(recipients(), ["em-main@example.com"]);
});

it("someone who switched alerts off, or was deactivated, gets nothing", async () => {
  await api("PUT", "/api/auth/preferences", { token: s.tokenMain, body: { emailAlerts: "OFF" } });
  reset();
  await raise(s.a, "critical", s.main._id);
  assert.deepEqual(recipients(), ["admin-ema@example.com"]);

  await api("PUT", "/api/auth/preferences", { token: s.tokenAnnex, body: { emailAlerts: "CRITICAL" } });
  const off = await api("PUT", `/api/users/${s.siteMain._id}`, { token: s.a.token, body: { isActive: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  await api("PUT", "/api/auth/preferences", { token: s.a.token, body: { emailAlerts: "OFF" } });
  reset();
  await raise(s.a, "critical", s.main._id);
  assert.deepEqual(recipients(), [], "nobody left who wants it");
});

it("the same alert is never emailed twice", async () => {
  await api("PUT", "/api/auth/preferences", { token: s.a.token, body: { emailAlerts: "CRITICAL" } });
  reset();
  counter += 1;
  const base = { companyId: s.a.company._id, locationId: undefined, type: "GENERAL", severity: "critical", title: "Once only", message: "m", dedupeKey: "email-it-once" };
  assert.ok(await notify(base));
  assert.equal(await notify(base), null, "the repeat is dropped");
  await emailService.flush();
  assert.deepEqual(recipients(), ["admin-ema@example.com", "em-annex@example.com"], "one copy each, not two");
});

it("with email off nothing is sent and alerts still work", async () => {
  process.env.EMAIL_PROVIDER = "none";
  reset();
  const created = await raise(s.a, "critical", undefined);
  assert.ok(created._id);
  assert.equal(email.outbox.length, 0);
  process.env.EMAIL_PROVIDER = "simulated";
});

it("each company has an hourly cap on alert emails", async () => {
  process.env.EMAIL_ALERT_HOURLY_CAP = "2";
  reset();
  const fresh = await registerCompany("emc"); // a company that has sent nothing yet this hour
  for (let i = 0; i < 4; i += 1) {
    counter += 1;
    await notify({ companyId: fresh.company._id, type: "GENERAL", severity: "critical", title: `Flood ${i}`, message: "m", dedupeKey: `email-flood-${counter}` });
  }
  await emailService.flush();
  assert.equal(email.outbox.length, 2);
  delete process.env.EMAIL_ALERT_HOURLY_CAP;
});

it("password reset emails the link, and the answer is the same for unknown addresses", async () => {
  reset();
  const real = await api("POST", "/api/auth/forgot-password", { body: { email: "em-annex@example.com" } });
  const unknown = await api("POST", "/api/auth/forgot-password", { body: { email: "nobody-here@example.com" } });
  await emailService.flush();
  assert.equal(real.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(real.body.message, unknown.body.message);
  assert.equal(email.outbox.length, 1, "only the real account gets mail");
  const mail = email.outbox[0];
  assert.deepEqual(mail.to, ["em-annex@example.com"]);
  assert.equal(mail.subject, "Reset your Smart Parking password");
  const link = /https?:\/\/\S+\/reset-password\?token=([0-9a-f]+)/.exec(mail.text);
  assert.ok(link, mail.text);
  assert.equal(link[1], real.body.devResetToken, "the emailed token is the real one");

  const done = await api("POST", "/api/auth/reset-password", { body: { token: link[1], password: "BrandNewPass123" } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await api("POST", "/api/auth/login", { body: await withCode({ email: "em-annex@example.com", password: "BrandNewPass123" }) })).status, 200);
});

it("password reset with email off sends nothing", async () => {
  process.env.EMAIL_PROVIDER = "none";
  reset();
  const res = await api("POST", "/api/auth/forgot-password", { body: { email: "em-gate@example.com" } });
  await emailService.flush();
  assert.equal(res.status, 200);
  assert.equal(email.outbox.length, 0);
  process.env.EMAIL_PROVIDER = "simulated";
});

it("pass holder: an address on a pass gets a confirmation, a renewal notice and one ending-soon reminder", async () => {
  process.env.EMAIL_PROVIDER = "simulated";
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token, body: { locationId: s.main._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const sell = (body) => api("POST", "/api/passes", {
    token: s.a.token, body: { locationId: s.main._id, vehicleType: "CAR", holderName: "Asha Rao", months: 1, amount: 1000, method: "CASH", ...body },
  });

  const bad = await sell({ vehicleNumber: "RJ14EM0001", email: "nope" });
  assert.equal(bad.status, 400, "a malformed address is refused");

  reset();
  const sold = await sell({ vehicleNumber: "RJ14EM0001", email: " Asha@Example.com " });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  await emailService.flush();
  assert.equal(sold.body.data.pass.email, "asha@example.com");
  assert.deepEqual(email.outbox.map((m) => m.to[0]), ["asha@example.com"]);
  assert.match(email.outbox[0].text, /Pass number: P-/);

  reset();
  const passId = sold.body.data.pass._id;
  const renewed = await api("POST", `/api/passes/${passId}/renew`, {
    token: s.a.token, body: { locationId: s.main._id, months: 1, amount: 1000, method: "CASH" },
  });
  assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
  await emailService.flush();
  assert.match(email.outbox[0].subject, /renewed/);

  // No address: nothing for the holder.
  reset();
  const quiet = await sell({ vehicleNumber: "RJ14EM0002" });
  assert.equal(quiet.status, 201);
  await emailService.flush();
  assert.equal(email.outbox.filter((m) => m.to[0].endsWith("asha@example.com")).length, 0);
  assert.equal(email.outbox.length, 0);

  // Ending soon: one reminder, not repeated.
  const Pass = require("../models/Pass");
  await Pass.updateOne({ _id: passId }, { $set: { endDate: new Date(Date.now() + 2.5 * 86400000) } });
  reset();
  const { checkPassExpiry } = require("../services/passService");
  await checkPassExpiry();
  await emailService.flush();
  const reminders = email.outbox.filter((m) => m.to[0] === "asha@example.com");
  assert.equal(reminders.length, 1);
  assert.match(reminders[0].subject, /ends in 3 days/);
  reset();
  await checkPassExpiry();
  await emailService.flush();
  assert.equal(email.outbox.filter((m) => m.to[0] === "asha@example.com").length, 0, "no second reminder");

  // The address can be changed and cleared.
  const changed = await api("PUT", `/api/passes/${passId}`, { token: s.a.token, body: { email: "new@example.com" } });
  assert.equal(changed.body.data.email, "new@example.com");
  const cleared = await api("PUT", `/api/passes/${passId}`, { token: s.a.token, body: { email: "" } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.data.email, undefined);
  assert.equal((await api("PUT", `/api/passes/${passId}`, { token: s.a.token, body: { email: "bad" } })).status, 400);
});
