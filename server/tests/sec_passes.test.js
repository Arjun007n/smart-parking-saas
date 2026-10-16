// Security hardening of pass notices, pass scoping, bulk pass logs and the pass payment index. No database:
// models are replaced by small stubs.
process.env.APP_UTC_OFFSET_MINUTES = "330";
process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const caps = require("../utils/messageCaps");
const messaging = require("../integrations/messaging");
const emailIntegration = require("../integrations/email");
const messageService = require("../services/messageService");
const emailService = require("../services/emailService");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Pass = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const PassUser = require("../models/PassUser");
const PassCompany = require("../models/PassCompany");
const PassVehicle = require("../models/PassVehicle");
const audit = require("../services/auditService");
const passUsers = require("../services/passUserService");
const passCompanies = require("../controllers/passCompanyController");
const passUserController = require("../controllers/passUserController");
const passController = require("../controllers/passController");

const KEYS = ["MESSAGING_PROVIDER", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM", "PASS_NOTICE_DAILY_CAP", "PASS_NOTICE_RECIPIENT_CAP", "ALLOWED_SMS_COUNTRIES"];
const saved = { errors: console.error };
for (const k of KEYS) saved[k] = process.env[k];
const chain = (value) => ({ select: () => ({ lean: async () => value, ...{} }), lean: async () => value });
Company.findById = () => chain({ name: "Acme" });
Location.findById = () => chain({ name: "Main" });

test.beforeEach(() => {
  caps.reset();
  messaging.outbox.length = 0;
  emailIntegration.outbox.length = 0;
  console.error = () => {};
});
test.afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  console.error = saved.errors;
});

const pass = (over = {}) => ({
  _id: "p1", companyId: "c1", locationIds: [], passNumber: "P-260302-AB3XYZ", holderName: "Asha", vehicleNumber: "RJ14AB1234",
  phone: "9876543210", email: "asha@example.com", startDate: new Date("2026-03-01T18:30:00Z"), endDate: new Date("2026-04-01T18:30:00Z"), ...over,
});

test("safeName strips links, control characters and long text, and leaves ordinary names alone", () => {
  assert.equal(caps.safeName("Acme Parking"), "Acme Parking");
  assert.equal(caps.safeName("St. Mary's Car Park, Sector 5"), "St. Mary's Car Park, Sector 5");
  assert.equal(caps.safeName("Arjun.co"), "Arjun.co");
  assert.equal(caps.safeName("Bank KYC pending http://evil.example/x now"), "Bank KYC pending now");
  assert.equal(caps.safeName("Pay at WWW.evil.com/login today"), "Pay at today");
  assert.equal(caps.safeName("Visit evil.com now"), "Visit now");
  assert.equal(caps.safeName("Line one\r\nLine\ttwo\u0007"), "Line one Line two");
  assert.equal(caps.safeName("evil​.com here"), "here");
  assert.equal(caps.safeName(null), "");
  assert.equal(caps.safeName("x".repeat(500)).length, 60);
});

test("SMS and email text carry the cleaned company and location names", () => {
  const body = messageService.renderPass({ kind: "NEW", pass: pass(), companyName: "Bank KYC https://evil.example/a", locationName: "Main\nGate" });
  assert.ok(!body.includes("http"), body);
  assert.ok(!body.includes("\n"));
  assert.match(body, /^Bank KYC, Main Gate: your parking pass/);
  const mail = emailService.renderPassNotice({ kind: "NEW", pass: pass(), companyName: "Acme www.evil.com", locationName: "Mall" });
  assert.ok(!mail.text.includes("evil"), mail.text);
  assert.ok(mail.text.includes("Acme · Mall"));
});

test("pass SMS: a company can send only PASS_NOTICE_DAILY_CAP a day, a number only PASS_NOTICE_RECIPIENT_CAP", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  process.env.PASS_NOTICE_DAILY_CAP = "3";
  process.env.PASS_NOTICE_RECIPIENT_CAP = "2";
  for (let i = 0; i < 3; i += 1) messageService.sendPassNotice({ pass: pass({ _id: `a${i}`, phone: `98765432${10 + i}` }), kind: "NEW" });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 3);
  messageService.sendPassNotice({ pass: pass({ _id: "a9", phone: "9876543299" }), kind: "NEW" });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 3, "fourth notice of the company is skipped");
  // another company is not affected; the same number is capped at 2
  for (let i = 0; i < 4; i += 1) messageService.sendPassNotice({ pass: pass({ _id: `b${i}`, companyId: "c2", phone: "9000000001" }), kind: "RENEWED" });
  await messageService.flush();
  assert.equal(messaging.outbox.length, 3 + 2);
});

test("pass email: same per-company and per-address caps, and nothing throws when a cap is hit", async () => {
  process.env.EMAIL_PROVIDER = "simulated";
  process.env.PASS_NOTICE_DAILY_CAP = "2";
  for (let i = 0; i < 4; i += 1) emailService.sendPassNotice({ pass: pass({ _id: `e${i}`, email: `h${i}@example.com` }), kind: "NEW" });
  await emailService.flush();
  assert.equal(emailIntegration.outbox.length, 2);
});

test("default caps are generous: 500 a day per company, 10 per recipient", () => {
  delete process.env.PASS_NOTICE_DAILY_CAP;
  delete process.env.PASS_NOTICE_RECIPIENT_CAP;
  assert.equal(caps.passDailyCap(), 500);
  assert.equal(caps.passRecipientCap(), 10);
  let allowed = 0;
  for (let i = 0; i < 12; i += 1) if (caps.allowPassNotice("c1", "sms", "+919876543210")) allowed += 1;
  assert.equal(allowed, 10);
});

test("a counter starts again when its window is over", () => {
  assert.equal(caps.take("k", 1, 1000, 0), true);
  assert.equal(caps.take("k", 1, 1000, 500), false);
  assert.equal(caps.take("k", 1, 1000, 1001), true);
});

test("PassPayment: the reference is unique per company, not across companies", () => {
  const unique = PassPayment.schema.indexes().filter(([, options]) => options && options.unique);
  const keys = unique.map(([key]) => JSON.stringify(key));
  assert.ok(keys.includes(JSON.stringify({ companyId: 1, transactionId: 1 })), keys.join(" "));
  assert.ok(!keys.includes(JSON.stringify({ transactionId: 1 })), "no global index on transactionId alone");
});

test("pass company revenue: a location admin's revenue counts only payments of their locations", async () => {
  const seen = [];
  const aggregates = (rows) => (pipeline) => { seen.push(pipeline); return Promise.resolve(rows); };
  const originals = [Pass.aggregate, PassPayment.aggregate, PassUser.aggregate];
  Pass.aggregate = aggregates([]);
  PassPayment.aggregate = aggregates([]);
  PassUser.aggregate = aggregates([]);
  try {
    const mine = "64b000000000000000000001";
    await passCompanies.statsFor("64b0000000000000000000aa", ["64b0000000000000000000bb"], [mine]);
    const money = seen.find((p) => p[0].$match && p[0].$match.amount);
    assert.deepEqual(money[0].$match.locationId.$in.map(String), [mine]);
    seen.length = 0;
    await passCompanies.statsFor("64b0000000000000000000aa", ["64b0000000000000000000bb"]);
    const all = seen.find((p) => p[0].$match && p[0].$match.amount);
    assert.equal(all[0].$match.locationId, undefined, "company-wide roles still see everything");
  } finally {
    [Pass.aggregate, PassPayment.aggregate, PassUser.aggregate] = originals;
  }
});

test("pass user stats: a location admin's revenue is limited to their locations", async () => {
  const originals = { find: PassUser.find, backfill: passUsers.backfill, passFind: Pass.find, agg: Pass.aggregate, payAgg: PassPayment.aggregate, pc: PassCompany.countDocuments, pv: PassVehicle.countDocuments };
  const pipelines = [];
  passUsers.backfill = async () => {};
  PassUser.find = () => ({ distinct: async () => [] });
  Pass.find = () => ({ distinct: async () => [] });
  Pass.aggregate = async () => [];
  PassPayment.aggregate = async (pipeline) => { pipelines.push(pipeline); return []; };
  PassCompany.countDocuments = async () => 0;
  PassVehicle.countDocuments = async () => 0;
  try {
    const loc = "64b000000000000000000001";
    const run = async (role) => {
      pipelines.length = 0;
      const req = { companyId: "64b0000000000000000000aa", tenantFilter: { companyId: "64b0000000000000000000aa" }, user: { role, _id: "u1", locationIds: [loc] } };
      const res = { json() {} };
      await passUserController.stats(req, res);
      return pipelines[0][0].$match;
    };
    const scoped = await run("LOCATION_ADMIN");
    assert.deepEqual(scoped.locationId.$in.map(String), [loc]);
    const company = await run("COMPANY_ADMIN");
    assert.equal(company.locationId, undefined);
  } finally {
    PassUser.find = originals.find; passUsers.backfill = originals.backfill; Pass.find = originals.passFind; Pass.aggregate = originals.agg;
    PassPayment.aggregate = originals.payAgg; PassCompany.countDocuments = originals.pc; PassVehicle.countDocuments = originals.pv;
  }
});

test("bulk pass edit: the audit record lists the affected pass numbers (first 200) and the count", async () => {
  const originals = { find: Pass.find, record: audit.record };
  const rows = Array.from({ length: 250 }, (_, i) => ({
    _id: `64b0000000000000000${String(10000 + i).slice(1)}`.slice(0, 24).padEnd(24, "0"), passNumber: `P-${i}`, status: "ACTIVE",
    endDate: new Date("2026-04-01T18:30:00Z"), startDate: new Date("2026-03-01T18:30:00Z"), save: async () => {},
  }));
  Pass.find = async () => rows;
  const logged = [];
  audit.record = async (_req, action, details) => { logged.push({ action, details }); };
  try {
    const req = {
      companyId: "c1", tenantFilter: { companyId: "c1" }, user: { role: "COMPANY_ADMIN", _id: "u1", locationIds: [] },
      body: { ids: rows.map((r) => "64b000000000000000000001"), action: "EXTEND", days: 5, reason: "festival" },
    };
    let out;
    await passController.bulkUpdate(req, { json: (body) => { out = body; } });
    assert.equal(out.data.changed, 250);
    const meta = logged[0].details.meta;
    assert.equal(logged[0].action, "PASS_BULK_UPDATE");
    assert.equal(meta.changed, 250);
    assert.equal(meta.passNumbers.length, 200);
    assert.equal(meta.passNumbers[0], "P-0");
    assert.equal(meta.reason, "festival");
  } finally {
    Pass.find = originals.find; audit.record = originals.record;
  }
});
