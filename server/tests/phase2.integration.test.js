// The end-of-day report email, and the position of a location on the map. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const email = require("../integrations/email");
const emailService = require("../services/emailService");
const reports = require("../services/dailyReportService");
const { localDateText, startOfLocalDay } = require("../utils/time");
const Company = require("../models/Company");
const Payment = require("../models/Payment");
const PassPayment = require("../models/PassPayment");
const ParkingSession = require("../models/ParkingSession");
const Pass = require("../models/Pass");

setup();

const s = {};
const HOUR = 3600 * 1000;
const at = (hour) => new Date(startOfLocalDay(new Date()).getTime() + hour * HOUR);

it("setup: a company with one location and some activity today", async () => {
  process.env.EMAIL_PROVIDER = "simulated";
  s.a = await registerCompany("rep-a");
  s.b = await registerCompany("rep-b");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Main Lot", address: { line1: "MG Road", city: "Jaipur" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token, body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const entry1 = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "RJ14AA0001", vehicleType: "CAR" } });
  const entry2 = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "RJ14AA0002", vehicleType: "CAR" } });
  assert.equal(entry1.status, 201, JSON.stringify(entry1.body));
  assert.equal(entry2.status, 201);
  // One of them left and paid 120 in cash and 80 by UPI; a pass was sold for 1000 by card.
  const first = entry1.body.data.session;
  await ParkingSession.updateOne({ _id: first._id }, { $set: { isOpen: false, status: "COMPLETED", exitTime: new Date() } });
  const base = { companyId: s.a.company._id, locationId: s.loc._id, status: "SUCCESS", paidAt: new Date(), kind: "FEE" };
  await Payment.create({ ...base, sessionId: first._id, amount: 120, method: "CASH" });
  const ghost = await ParkingSession.create({
    companyId: s.a.company._id, locationId: s.loc._id, vehicleNumber: "RJ14AA0003", vehicleType: "CAR", ticketNumber: "T-REPORT-3",
    entryTime: new Date(), isOpen: false, status: "COMPLETED", exitTime: new Date(),
  });
  await Payment.create({ ...base, sessionId: ghost._id, amount: 80, method: "UPI" });
  const pass = await Pass.findOne({ companyId: s.a.company._id });
  if (pass) await PassPayment.create({ companyId: s.a.company._id, locationId: s.loc._id, passId: pass._id, kind: "NEW", amount: 1000, method: "CARD", periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 24 * HOUR) });
  s.hasPass = Boolean(pass);
});

it("the summary adds up what happened today at each location", async () => {
  const summary = await reports.buildSummary({ companyId: s.a.company._id, dateText: localDateText() });
  assert.equal(summary.rows.length, 1);
  const row = summary.rows[0];
  assert.equal(row.name, "Main Lot");
  assert.equal(row.entries, 3, "two by the API, one added directly");
  assert.equal(row.inside, 1);
  assert.equal(row.capacity, 20);
  assert.equal(row.byMethod.CASH, 120);
  assert.equal(row.byMethod.UPI, 80);
  assert.equal(summary.totals.collected, 200 + (s.hasPass ? 1000 : 0));
  assert.equal(summary.totals.exits, 2);
  const yesterday = await reports.buildSummary({ companyId: s.a.company._id, dateText: localDateText(new Date(Date.now() - 24 * HOUR)) });
  assert.equal(yesterday.totals.entries, 0);
  assert.equal(yesterday.totals.collected, 0);
});

it("a company's report never includes another company's activity", async () => {
  const other = await reports.buildSummary({ companyId: s.b.company._id, dateText: localDateText() });
  assert.equal(other.rows.length, 0);
  assert.equal(other.totals.collected, 0);
});

it("settings: off by default; saved, validated and limited to the company's admins", async () => {
  const id = s.a.company._id;
  const start = await api("GET", `/api/companies/${id}/report-email`, { token: s.a.token });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.deepEqual(start.body.data, { enabled: false, recipients: [], sendAt: "22:00", lastSentFor: null, emailAvailable: true });

  assert.equal((await api("PUT", `/api/companies/${id}/report-email`, { token: s.a.token, body: { sendAt: "25:00" } })).status, 400);
  assert.equal((await api("PUT", `/api/companies/${id}/report-email`, { token: s.a.token, body: { recipients: ["not-an-email"] } })).status, 400);
  assert.equal((await api("PUT", `/api/companies/${id}/report-email`, { token: s.a.token, body: { enabled: "yes" } })).status, 400);

  const saved = await api("PUT", `/api/companies/${id}/report-email`, {
    token: s.a.token, body: { enabled: true, recipients: ["Owner@Example.com", "owner@example.com", "boss@example.com"], sendAt: "21:30" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.data.recipients, ["owner@example.com", "boss@example.com"]);
  assert.equal(saved.body.data.sendAt, "21:30");
  assert.equal(saved.body.data.enabled, true);

  assert.equal((await api("GET", `/api/companies/${id}/report-email`, { token: s.b.token })).status, 404, "another company's settings are not visible");
  assert.equal((await api("PUT", `/api/companies/${id}/report-email`, { token: s.b.token, body: { enabled: false } })).status, 404);
  assert.equal((await api("GET", `/api/companies/${id}/report-email`)).status, 401);

  const staff = await api("POST", "/api/users", { token: s.a.token, body: { name: "Gate", email: "rep-staff@example.com", password: "Password123", role: "ENTRY_OPERATOR" } });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  const staffToken = await login("rep-staff@example.com");
  assert.equal((await api("GET", `/api/companies/${id}/report-email`, { token: staffToken })).status, 403);
});

it("the test button emails today's report so far to the person who pressed it only", async () => {
  email.outbox.length = 0;
  const res = await api("POST", `/api/companies/${s.a.company._id}/report-email/test`, { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.sentTo, ["admin-rep-a@example.com"]);
  assert.equal(email.outbox.length, 1);
  assert.match(email.outbox[0].subject, /^Report so far /);
  assert.match(email.outbox[0].text, /Main Lot: Rs/);
});

it("the test button says so when email is off", async () => {
  process.env.EMAIL_PROVIDER = "none";
  const res = await api("POST", `/api/companies/${s.a.company._id}/report-email/test`, { token: s.a.token });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /not switched on/);
  assert.equal((await api("GET", `/api/companies/${s.a.company._id}/report-email`, { token: s.a.token })).body.data.emailAvailable, false);
  process.env.EMAIL_PROVIDER = "simulated";
});

it("the daily run waits for the chosen time, sends once, and then stays quiet", async () => {
  email.outbox.length = 0;
  assert.equal(await reports.runDue(at(20)), 0, "20:00 is before 21:30");
  assert.equal(email.outbox.length, 0);

  assert.equal(await reports.runDue(at(22)), 1);
  const sent = email.outbox.filter((m) => /^Daily report /.test(m.subject));
  assert.deepEqual(sent.map((m) => m.to[0]).sort(), ["boss@example.com", "owner@example.com"]);
  assert.equal((await Company.findById(s.a.company._id)).reportEmail.lastSentFor, localDateText());

  email.outbox.length = 0;
  assert.equal(await reports.runDue(at(23)), 0, "already sent for today");
  assert.equal(email.outbox.length, 0);
  // Company B never switched it on.
  assert.equal((await Company.findById(s.b.company._id)).reportEmail.lastSentFor, undefined);
});

it("with no addresses chosen the report goes to the company admins; with email off nothing is claimed", async () => {
  const id = s.b.company._id;
  await api("PUT", `/api/companies/${id}/report-email`, { token: s.b.token, body: { enabled: true, sendAt: "10:00" } });
  process.env.EMAIL_PROVIDER = "none";
  assert.equal(await reports.runDue(at(23)), 0);
  assert.equal((await Company.findById(id)).reportEmail.lastSentFor, undefined, "not marked as sent, so it goes out once email works");
  process.env.EMAIL_PROVIDER = "simulated";
  email.outbox.length = 0;
  assert.equal(await reports.runDue(at(23)), 1);
  assert.deepEqual(email.outbox.map((m) => m.to[0]), ["admin-rep-b@example.com"]);
});

it("a company that is suspended gets no report", async () => {
  const c = await registerCompany("rep-c");
  await api("PUT", `/api/companies/${c.company._id}/report-email`, { token: c.token, body: { enabled: true, sendAt: "10:00" } });
  await Company.updateOne({ _id: c.company._id }, { $set: { subscriptionStatus: "SUSPENDED" } });
  email.outbox.length = 0;
  await reports.runDue(at(23));
  assert.ok(!email.outbox.some((m) => m.to[0] === "admin-rep-c@example.com"));
});

it("a send that fails is tried again at the next run", async () => {
  const d = await registerCompany("rep-d");
  await api("PUT", `/api/companies/${d.company._id}/report-email`, { token: d.token, body: { enabled: true, sendAt: "10:00" } });
  const realSend = email.PROVIDERS.simulated.send;
  email.PROVIDERS.simulated.send = async () => { throw new Error("provider down"); };
  const first = await reports.runDue(at(23));
  email.PROVIDERS.simulated.send = realSend;
  assert.equal(first, 0);
  assert.equal((await Company.findById(d.company._id)).reportEmail.lastSentFor, undefined);
  email.outbox.length = 0;
  assert.equal(await reports.runDue(at(23)), 1);
  await emailService.flush();
  assert.equal(email.outbox.length, 1);
});

it("a location's position can be saved, is shown on the public booking page, and can be removed", async () => {
  const set = await api("PUT", `/api/locations/${s.loc._id}`, {
    token: s.a.token,
    body: { coordinates: { lat: 26.9124, lng: 75.7873 }, vehicleTypes: ["CAR"], onlineBooking: { enabled: true, fees: { car: 0 } } },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.data.coordinates, { lat: 26.9124, lng: 75.7873 });

  const list = await api("GET", "/api/public/booking/locations");
  const found = list.body.data.locations.find((l) => String(l.id) === String(s.loc._id));
  assert.ok(found, "listed for booking");
  assert.deepEqual(found.coordinates, { lat: 26.9124, lng: 75.7873 });

  const bad = await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { coordinates: { lat: 91, lng: 75 } } });
  assert.equal(bad.status, 400);

  const cleared = await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { coordinates: { clear: true } } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.ok(!cleared.body.data.coordinates || (cleared.body.data.coordinates.lat === undefined && cleared.body.data.coordinates.lng === undefined));
  const again = await api("GET", "/api/public/booking/locations");
  const gone = again.body.data.locations.find((l) => String(l.id) === String(s.loc._id));
  assert.ok(gone);
  assert.equal(gone.coordinates, undefined, "no position, none shown");
});
