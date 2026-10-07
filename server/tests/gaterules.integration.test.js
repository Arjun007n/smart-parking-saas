// Gate rules, the operator collection report, day summary, report periods, dashboard additions,
// per-location report recipients and the pass company master, through the API. Needs MongoDB.
const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const { closeForgottenTickets } = require("../services/operationsService");
const { todayText } = require("./reportDates");

setup();

const s = {};
const range = () => { const d = todayText(0); return `from=${d.from}&to=${d.to}`; };
const backdate = (id, minutes) => ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - minutes * 60000) } });
const enter = (token, vehicleNumber) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
const startExit = (token, ticketNumber, extra = {}) =>
  api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, ticketNumber, ...extra } });
const rules = (ops) => api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { operations: ops } });

it("setup: a company, a tariff, gate staff and an open cash shift", async () => {
  s.a = await registerCompany("gr");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Mall", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const staff = (name, email, role) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds: [s.loc._id] } });
  s.entryUser = (await staff("Gate In", "gr-in@example.com", "ENTRY_OPERATOR")).body.data;
  s.exitUser = (await staff("Gate Out", "gr-out@example.com", "EXIT_OPERATOR")).body.data;
  await staff("Super", "gr-super@example.com", "SUPERVISOR");
  s.entry = await login("gr-in@example.com");
  s.exit = await login("gr-out@example.com");
  s.super = await login("gr-super@example.com");
  const shift = await api("POST", "/api/shifts", { token: s.exit, body: { locationId: s.loc._id, openingCash: 0 } });
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
  s.shift = shift.body.data;
});

it("gate rules: saved on the location, with defaults and limits", async () => {
  assert.equal(s.loc.operations === undefined || s.loc.operations.exitAmountEdit === undefined, true, "nothing stored until set");
  assert.equal((await rules({ autoExitHours: 5000 })).status, 400);
  assert.equal((await rules({ allowReEntry: "no" })).status, 400);
  const ok = await rules({ exitAmountEdit: true, autoExitHours: 0, printTicketNumber: false });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.operations.exitAmountEdit, true);
  assert.equal(ok.body.data.operations.printTicketNumber, false);
  // Staff who only work the gate cannot change the rules.
  assert.equal((await api("PUT", `/api/locations/${s.loc._id}`, { token: s.exit, body: { operations: { allowReEntry: false } } })).status, 403);
});

it("exit amount edit: needs the switch, a reason, and is recorded", async () => {
  const entry = await enter(s.entry, "RJ14EDIT01");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const ticket = entry.body.data.session.ticketNumber;
  await backdate(entry.body.data.session._id, 90);

  // Switch off: refused.
  await rules({ exitAmountEdit: false });
  const refused = await startExit(s.exit, ticket, { editedAmount: 20, editReason: "Regular customer" });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));

  await rules({ exitAmountEdit: true });
  const noReason = await startExit(s.exit, ticket, { editedAmount: 20 });
  assert.equal(noReason.status, 400, JSON.stringify(noReason.body));
  assert.equal((await startExit(s.exit, ticket, { editedAmount: 20, editReason: "abc" })).status, 400);
  assert.equal((await startExit(s.exit, ticket, { editedAmount: -5, editReason: "Regular customer" })).status, 400);

  const calc = await startExit(s.exit, ticket);
  const original = calc.body.data.session.fee.total;
  assert.ok(original > 20, `tariff fee ${original}`);

  const edited = await startExit(s.exit, ticket, { editedAmount: 20, editReason: "Regular customer" });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.session.fee.total, 20);
  assert.equal(edited.body.data.session.feeEdit.calculated, original);
  assert.equal(edited.body.data.session.feeEdit.reason, "Regular customer");
  // The payment must match the changed amount.
  const wrong = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: edited.body.data.session._id, method: "CASH", amount: original } });
  assert.equal(wrong.status, 409, "paying the old amount is refused");
  const paid = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: edited.body.data.session._id, method: "CASH", amount: 20 } });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  s.paidCash = 20;

  const log = await AuditLog.findOne({ action: "PARKING_FEE_EDITED", entityId: edited.body.data.session._id });
  assert.ok(log, "the change is in the audit log");
  assert.equal(log.meta.calculated, original);
  assert.equal(log.meta.charged, 20);

  // A calculation without a change clears an earlier one.
  const e2 = await enter(s.entry, "RJ14EDIT02");
  await backdate(e2.body.data.session._id, 90);
  await startExit(s.exit, e2.body.data.session.ticketNumber, { editedAmount: 10, editReason: "Regular customer" });
  const again = await startExit(s.exit, e2.body.data.session.ticketNumber);
  assert.equal(again.body.data.session.feeEdit.reason, null);
  assert.equal(again.body.data.session.fee.total, original);
  s.open2 = e2.body.data.session;
});

it("re-entry can be switched off for a location", async () => {
  const entry = await enter(s.entry, "RJ14REENT1");
  const id = entry.body.data.session._id;
  await rules({ allowReEntry: false });
  const refused = await api("POST", `/api/parking/sessions/${id}/re-entry`, { token: s.entry, body: {} });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  await rules({ allowReEntry: true });
  const ok = await api("POST", `/api/parking/sessions/${id}/re-entry`, { token: s.entry, body: {} });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  s.reentered = ok.body.data.session;
});

it("reprints are counted on the ticket and in the audit log", async () => {
  const id = s.reentered._id;
  const one = await api("POST", `/api/parking/sessions/${id}/reprint`, { token: s.entry });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.data.reprints, 1);
  assert.equal((await api("POST", `/api/parking/sessions/${id}/reprint`, { token: s.entry })).body.data.reprints, 2);
  assert.equal((await ParkingSession.findById(id)).reprints, 2);
  assert.equal((await api("POST", `/api/parking/sessions/${id}/reprint`, {})).status, 401);
});

it("re-entry counter: the admin sets a daily limit per operator, sees the count and resets it; operators see neither", async () => {
  const reenter = () => api("POST", `/api/parking/sessions/${s.reentered._id}/re-entry`, { token: s.entry, body: {} });
  assert.equal((await rules({ reEntryLimit: -1 })).status, 400);
  assert.equal((await rules({ reEntryLimit: 2000 })).status, 400);
  assert.equal((await rules({ reEntryLimit: 1 })).status, 200);
  // Only an admin can change the limit.
  assert.equal((await api("PUT", `/api/locations/${s.loc._id}`, { token: s.entry, body: { operations: { reEntryLimit: 99 } } })).status, 403);

  // The earlier re-entry by this operator already used the one allowed today.
  const refused = await reenter();
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.match(refused.body.message, /ask an admin/i);
  assert.doesNotMatch(refused.body.message, /\d+ of|limit/i, "the count is not shown to the operator");

  const counter = await api("GET", `/api/locations/${s.loc._id}/re-entries`, { token: s.a.token });
  assert.equal(counter.status, 200, JSON.stringify(counter.body));
  assert.equal(counter.body.data.limit, 1);
  assert.equal(counter.body.data.total, 1);
  assert.equal(counter.body.data.operators[0].name, "Gate In");
  assert.equal(counter.body.data.operators[0].count, 1);
  assert.equal(counter.body.data.operators[0].atLimit, true);
  // Gate staff cannot see or reset the counter.
  assert.equal((await api("GET", `/api/locations/${s.loc._id}/re-entries`, { token: s.entry })).status, 403);
  assert.equal((await api("POST", `/api/locations/${s.loc._id}/re-entries/reset`, { token: s.entry })).status, 403);

  // After a reset the operator can go on, and the new one is counted from zero.
  const reset = await api("POST", `/api/locations/${s.loc._id}/re-entries/reset`, { token: s.a.token });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.data.total, 0);
  const ok = await reenter();
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  s.reentered = ok.body.data.session;
  const after = await api("GET", `/api/locations/${s.loc._id}/re-entries`, { token: s.a.token });
  assert.equal(after.body.data.total, 1);
  assert.equal((await reenter()).status, 403, "the limit applies again");

  // No limit: back to normal.
  await rules({ reEntryLimit: 0 });
  const free = await reenter();
  assert.equal(free.status, 201, JSON.stringify(free.body));
  s.reentered = free.body.data.session;
});

it("collection by operator: counts, money by way of payment, actual against system", async () => {
  // Close the shift 10 short of what the system expects.
  const live = await api("GET", "/api/shifts/current", { token: s.exit });
  const expected = live.body.data.totals.expectedCash;
  assert.equal(expected, s.paidCash);
  const close = await api("POST", `/api/shifts/${s.shift._id}/close`, { token: s.exit, body: { closingCash: expected - 10 } });
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.data.difference, -10);

  const res = await api("GET", `/api/reports/operator-collection?${range()}`, { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const byName = Object.fromEntries(res.body.data.rows.map((r) => [r.operator, r]));
  const entryRow = byName["Gate In"];
  const exitRow = byName["Gate Out"];
  assert.ok(entryRow.entries >= 4, "entries counted for the person who made them");
  assert.equal(entryRow.reprints, 2);
  assert.equal(exitRow.cash, 20);
  assert.equal(exitRow.paidExits, 1);
  assert.equal(exitRow.exitAmount, 20);
  assert.equal(exitRow.shifts, 1);
  assert.equal(exitRow.systemCollection, 20);
  assert.equal(exitRow.actualCollection, 10);
  assert.equal(exitRow.difference, -10);
  assert.equal(res.body.data.total.systemCollection, 20);
  assert.equal(res.body.data.total.difference, -10);

  // One person only.
  const one = await api("GET", `/api/reports/operator-collection?${range()}&operatorId=${s.exitUser._id}`, { token: s.a.token });
  assert.deepEqual(one.body.data.rows.map((r) => r.operator), ["Gate Out"]);
  assert.equal((await api("GET", "/api/reports/operator-collection?operatorId=nope", { token: s.a.token })).status, 400);
  // Downloads in every format; gate staff cannot read reports.
  for (const [format, type] of [["csv", "text/csv"], ["xlsx", "spreadsheetml"], ["pdf", "application/pdf"]]) {
    const file = await bytes("GET", `/api/reports/operator-collection?${range()}&format=${format}`, { token: s.a.token });
    assert.equal(file.status, 200, format);
    assert.ok(file.headers.get("content-type").includes(type), `${format}: ${file.headers.get("content-type")}`);
  }
  assert.equal((await api("GET", `/api/reports/operator-collection?${range()}`, { token: s.entry })).status, 403);
});

it("day summary by vehicle type, with a PDF to keep", async () => {
  const d = todayText(0).to;
  const res = await api("GET", `/api/reports/day-summary?date=${d}&locationId=${s.loc._id}`, { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const car = res.body.data.rows.find((r) => r.type === "CAR");
  assert.ok(car.entries >= 4);
  assert.equal(car.exits, 1);
  assert.ok(car.parked >= 2, "vehicles still inside are counted");
  assert.equal(car.cash, 20);
  assert.equal(car.total, 20);
  assert.equal(res.body.data.total.cash, 20);
  const pdf = await bytes("GET", `/api/reports/day-summary?date=${d}&locationId=${s.loc._id}&format=pdf`, { token: s.a.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
});

it("vehicle report: more columns and filters by operator, gate and type", async () => {
  const all = await api("GET", `/api/reports/vehicles?${range()}`, { token: s.a.token });
  assert.equal(all.status, 200);
  const keys = all.body.data.columns.map((c) => c.key);
  for (const key of ["entryBy", "exitBy", "reprints", "advance", "payable", "method", "edited"]) assert.ok(keys.includes(key), key);
  const edited = all.body.data.rows.find((r) => r.vehicle === "RJ14EDIT01");
  assert.equal(edited.entryBy, "Gate In");
  assert.equal(edited.exitBy, "Gate Out");
  assert.equal(edited.method, "CASH");
  assert.match(edited.edited, /Regular customer/);

  const byEntry = await api("GET", `/api/reports/vehicles?${range()}&entryOperatorId=${s.entryUser._id}`, { token: s.a.token });
  assert.equal(byEntry.body.data.total, all.body.data.total);
  const byExit = await api("GET", `/api/reports/vehicles?${range()}&exitOperatorId=${s.exitUser._id}`, { token: s.a.token });
  assert.equal(byExit.body.data.total, 1);
  assert.equal((await api("GET", `/api/reports/vehicles?${range()}&vehicleType=BIKE`, { token: s.a.token })).body.data.total, 0);
  assert.equal((await api("GET", `/api/reports/vehicles?${range()}&vehicleType=CAR`, { token: s.a.token })).body.data.total, all.body.data.total);
  assert.equal((await api("GET", `/api/reports/vehicles?${range()}&gate=Nowhere`, { token: s.a.token })).body.data.total, 0);
  assert.equal((await api("GET", `/api/reports/vehicles?${range()}&exitOperatorId=bad`, { token: s.a.token })).status, 400);
});

it("current and old report periods", async () => {
  const periods = await api("GET", "/api/reports/periods", { token: s.a.token });
  assert.equal(periods.status, 200);
  assert.ok(periods.body.data.days >= 7);
  assert.ok(periods.body.data.lastOldDay < periods.body.data.currentFrom);

  assert.equal((await api("GET", `/api/reports/vehicles?${range()}&period=current`, { token: s.a.token })).status, 200);
  const tooOld = await api("GET", "/api/reports/vehicles?from=2020-01-01&to=2020-01-02&period=current", { token: s.a.token });
  assert.equal(tooOld.status, 400);
  assert.match(tooOld.body.message, /Current reports cover/);
  const tooNew = await api("GET", `/api/reports/vehicles?${range()}&period=old`, { token: s.a.token });
  assert.equal(tooNew.status, 400);
  assert.match(tooNew.body.message, /Old reports cover/);
  // Old with no dates: the month before the live period, which has nothing in a new test database.
  const old = await api("GET", "/api/reports/vehicles?period=old", { token: s.a.token });
  assert.equal(old.status, 200, JSON.stringify(old.body));
  assert.equal(old.body.data.total, 0);
  assert.equal((await api("GET", "/api/reports/vehicles?period=ancient", { token: s.a.token })).status, 400);
  // Without a period nothing changes.
  assert.equal((await api("GET", "/api/reports/vehicles?from=2020-01-01&to=2020-01-02", { token: s.a.token })).status, 200);
});

it("forgotten tickets are closed by the location's switch, and the company is told", async () => {
  const e = await enter(s.entry, "RJ14FORGOT");
  const id = e.body.data.session._id;
  await backdate(id, 5 * 60);
  // Not asked for: nothing happens.
  await rules({ autoExitHours: 0 });
  assert.deepEqual(await closeForgottenTickets(), []);
  assert.equal((await ParkingSession.findById(id)).isOpen, true);

  await rules({ autoExitHours: 4 });
  const result = await closeForgottenTickets();
  assert.equal(result.length, 1);
  assert.ok(result[0].closed >= 1);
  const closed = await ParkingSession.findById(id);
  assert.equal(closed.isOpen, false);
  assert.equal(closed.status, "MANUAL_OVERRIDE");
  assert.equal(closed.autoClosed, true);
  assert.match(closed.overrideReason, /automatically/);
  // A ticket that is only a little old, or waiting for payment, is left alone.
  assert.equal((await ParkingSession.findById(s.reentered._id)).isOpen, true);
  assert.equal((await ParkingSession.findById(s.open2._id)).isOpen, true, "a ticket with a fee quoted (waiting for payment) is never touched");
  assert.ok(await Notification.findOne({ type: "AUTO_CLOSED_TICKETS", companyId: s.a.company._id }));
  assert.equal(await AuditLog.countDocuments({ action: "PARKING_AUTO_CLOSED" }) >= 1, true);
  assert.deepEqual((await closeForgottenTickets()).map((r) => r.closed), [0], "nothing more to close");
  await rules({ autoExitHours: 0 });
});

it("report recipients per location", async () => {
  const bad = await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { reportRecipients: ["not-an-email"] } });
  assert.equal(bad.status, 400);
  const ok = await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { reportRecipients: ["Owner@Example.com", "owner@example.com", "ops@example.com"] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.reportRecipients, ["owner@example.com", "ops@example.com"]);
  const { buildSummary, summaryForLocation } = require("../services/dailyReportService");
  const { localDateText } = require("../utils/time");
  const summary = await buildSummary({ companyId: s.a.company._id, dateText: localDateText() });
  const one = summaryForLocation(summary, s.loc._id);
  assert.equal(one.rows.length, 1);
  assert.equal(one.totals.collected, summary.totals.collected);
  assert.equal(summaryForLocation(summary, "000000000000000000000000").totals.collected, 0);
});

it("dashboard: by vehicle type, month, momentum, passes and the plan end", async () => {
  const res = await api("GET", "/api/dashboard", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  const car = d.byVehicleType.rows.find((r) => r.type === "CAR");
  assert.ok(car.entries >= 4);
  assert.equal(car.cash, 20);
  assert.equal(d.byVehicleType.total.cash, 20);
  assert.equal(d.month.total.cash, 20);
  assert.match(d.month.from, /^\d{4}-\d{2}-01$/);
  assert.ok(Array.isArray(d.momentum) && d.momentum.length >= 1);
  assert.ok(d.momentum.every((m) => m.inside >= 0));
  assert.equal(d.momentum[d.momentum.length - 1].inside, d.traffic.currentVehicles, "the last hour ends at the number inside now");
  assert.equal(typeof d.reprintsToday, "number");
  assert.equal(d.reprintsToday, 2);
  assert.deepEqual(Object.keys(d.passes).sort(), ["active", "activeRevenue", "endingSoon", "total"]);
  assert.equal(typeof d.passes.activeRevenue, "number");
  assert.equal(d.subscription.status, "TRIAL");
  assert.ok(d.subscription.daysLeft > 0);
  // The period starts on today, money comes hour by hour, and every location has a plan row.
  assert.equal(d.period.isToday, true);
  assert.equal(d.revenue.byHour.length, 24);
  assert.equal(Math.round(d.revenue.byHour.reduce((t, h) => t + h.amount, 0) * 100), Math.round(d.revenue.inPeriod * 100), "hours add up to the period");
  assert.ok(d.locationPlans.length >= 1 && d.locationPlans.every((p) => p.name && ["EXPIRING", "RUNNING", "EXPIRED", "NO_PLAN"].includes(p.status)));
});

it("dashboard: a period of past days, and bad periods", async () => {
  const past = await api("GET", "/api/dashboard?from=2020-01-01&to=2020-01-03", { token: s.a.token });
  assert.equal(past.status, 200, JSON.stringify(past.body));
  const d = past.body.data;
  assert.deepEqual(d.period, { from: "2020-01-01", to: "2020-01-03", days: 3, isToday: false });
  assert.equal(d.traffic.entriesToday, 0, "nobody came in then");
  assert.equal(d.revenue.inPeriod, 0);
  assert.deepEqual(d.momentum, [], "vehicles inside through the day is for today only");
  assert.equal(d.byVehicleType.total.entries, 0);
  assert.equal((await api("GET", "/api/dashboard?from=2026-03-05&to=2026-03-01", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/dashboard?from=2020-01-01&to=2026-12-31", { token: s.a.token })).status, 400);
});

it("pass companies: master, linking passes, stats, bulk change, receipts and vehicle list", async () => {
  const company = await api("POST", "/api/pass-companies", {
    token: s.a.token, body: { name: "Acme Traders", contactName: "Ravi", phone: "9812345678", gstNumber: "27ABCDE1234F1Z5" },
  });
  assert.equal(company.status, 201, JSON.stringify(company.body));
  const pc = company.body.data;
  assert.equal((await api("POST", "/api/pass-companies", { token: s.a.token, body: { name: "acme traders" } })).status, 409, "same name, any case");
  assert.equal((await api("POST", "/api/pass-companies", { token: s.a.token, body: { name: "Bad GST", gstNumber: "123" } })).status, 400);
  assert.equal((await api("POST", "/api/pass-companies", { token: s.exit, body: { name: "Nope Ltd" } })).status, 403);

  const sell = (plate, holder, extra = {}) =>
    api("POST", "/api/passes", {
      token: s.a.token,
      body: { locationId: s.loc._id, vehicleNumber: plate, vehicleType: "CAR", holderName: holder, unit: "MONTH", count: 1, amount: 1180, taxPercent: 18, method: "UPI", transactionId: `UPI-${plate}`, ...extra },
    });
  const p1 = await sell("RJ14PC0001", "Asha Rao", { passCompanyId: pc._id, extraVehicles: [{ vehicleNumber: "RJ14PC0002", vehicleType: "CAR" }], maxVehicles: 2 });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  const p2 = await sell("RJ14PC0003", "Ben Joy", { passCompanyId: pc._id });
  assert.equal(p2.status, 201);
  const p3 = await sell("RJ14PC0004", "Solo Person");
  assert.equal(p3.status, 201);
  // Another company's (or an unknown) company id is refused.
  const other = await registerCompany("gr2");
  const foreign = await api("POST", "/api/pass-companies", { token: other.token, body: { name: "Other Firm" } });
  assert.equal((await sell("RJ14PC0005", "Nobody", { passCompanyId: foreign.body.data._id })).status, 404);

  const list = await api("GET", "/api/pass-companies", { token: s.a.token });
  const mine = list.body.data.companies.find((c) => c.name === "Acme Traders");
  assert.equal(mine.stats.passes, 2);
  assert.equal(mine.stats.vehicles, 3);
  assert.equal(mine.stats.active, 2);
  assert.equal(mine.stats.revenue, 2360);
  assert.equal(list.body.data.totals.companies, 1, "another company's masters are never shown");
  assert.equal((await api("GET", "/api/pass-companies", { token: other.token })).body.data.companies.length, 1);

  const byCompany = await api("GET", `/api/passes?passCompanyId=${pc._id}`, { token: s.a.token });
  assert.equal(byCompany.body.data.total, 2);
  assert.equal((await api("GET", `/api/passes?locationId=${s.loc._id}`, { token: s.a.token })).body.data.total, 3);

  // Move a pass to the company, and take it off again.
  const move = await api("PUT", `/api/passes/${p3.body.data.pass._id}`, { token: s.a.token, body: { passCompanyId: pc._id } });
  assert.equal(move.status, 200, JSON.stringify(move.body));
  assert.equal((await api("GET", `/api/passes?passCompanyId=${pc._id}`, { token: s.a.token })).body.data.total, 3);
  await api("PUT", `/api/passes/${p3.body.data.pass._id}`, { token: s.a.token, body: { passCompanyId: "" } });
  assert.equal((await api("GET", `/api/passes?passCompanyId=${pc._id}`, { token: s.a.token })).body.data.total, 2);

  // Summary tiles.
  const sum = await api("GET", "/api/passes/summary", { token: s.a.token });
  assert.equal(sum.status, 200, JSON.stringify(sum.body));
  assert.equal(sum.body.data.passes, 3);
  assert.equal(sum.body.data.vehicles, 4);
  assert.equal(sum.body.data.companies, 1);
  assert.equal(sum.body.data.active, 3);
  assert.equal(sum.body.data.activeRevenue, 3540);

  // Every vehicle on a pass, one row each.
  const vehicles = await api("GET", "/api/passes/vehicles", { token: s.a.token });
  assert.equal(vehicles.body.data.total, 4);
  const shared = vehicles.body.data.rows.filter((r) => r.holderName === "Asha Rao");
  assert.deepEqual(shared.map((r) => r.vehicleNumber).sort(), ["RJ14PC0001", "RJ14PC0002"]);
  assert.equal(shared[0].company, "Acme Traders");
  assert.equal((await api("GET", "/api/passes/vehicles?q=rj14pc0003", { token: s.a.token })).body.data.total, 1);
  assert.equal((await api("GET", `/api/passes/vehicles?passCompanyId=${pc._id}`, { token: s.a.token })).body.data.total, 3);

  // Receipts: amount split into taxable value and tax.
  const inv = await api("GET", "/api/passes/invoices", { token: s.a.token });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.equal(inv.body.data.total, 3);
  assert.equal(inv.body.data.totals.total, 3540);
  assert.equal(inv.body.data.totals.tax, 540);
  assert.equal(inv.body.data.totals.taxable, 3000);
  const first = inv.body.data.rows.find((r) => r.holder === "Asha Rao");
  assert.equal(first.taxable, 1000);
  assert.equal(first.tax, 180);
  assert.match(first.receiptNumber, /^P-\d{6}-[A-Z0-9]{6}\/1$/);
  assert.equal(first.company, "Acme Traders");
  assert.equal(first.companyGst, "27ABCDE1234F1Z5");
  assert.equal((await api("GET", `/api/passes/invoices?passCompanyId=${pc._id}`, { token: s.a.token })).body.data.total, 2);
  assert.equal((await api("GET", "/api/passes/invoices?q=ben", { token: s.a.token })).body.data.total, 1);
  assert.equal((await api("GET", `/api/passes/invoices?locationId=${s.loc._id}`, { token: s.a.token })).body.data.total, 3);
  const csv = await bytes("GET", "/api/passes/invoices?format=csv", { token: s.a.token });
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString(), /Receipt/);
  // A renewal gets the next receipt number on the same pass.
  const renew = await api("POST", `/api/passes/${p2.body.data.pass._id}/renew`, {
    token: s.a.token, body: { locationId: s.loc._id, unit: "MONTH", count: 1, amount: 1180, taxPercent: 18, method: "CASH" },
  });
  assert.equal(renew.status, 201, JSON.stringify(renew.body));
  const rows = (await api("GET", "/api/passes/invoices?q=ben", { token: s.a.token })).body.data.rows;
  assert.deepEqual(rows.map((r) => r.receiptNumber.split("/")[1]).sort(), ["1", "2"]);

  // Bulk change.
  const ids = [p1.body.data.pass._id, p2.body.data.pass._id];
  const before = new Date(p1.body.data.pass.endDate).getTime();
  const extend = await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids, action: "EXTEND", days: 10 } });
  assert.equal(extend.status, 200, JSON.stringify(extend.body));
  assert.equal(extend.body.data.changed, 2);
  const after = (await api("GET", `/api/passes/${p1.body.data.pass._id}`, { token: s.a.token })).body.data.pass;
  assert.equal(new Date(after.endDate).getTime() - before, 10 * 86400000);
  assert.equal((await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids, action: "EXTEND" } })).status, 400, "days are needed");
  assert.equal((await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids, action: "SUSPEND" } })).status, 400, "a reason is needed");
  const suspend = await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids, action: "SUSPEND", reason: "Contract paused" } });
  assert.equal(suspend.body.data.changed, 2);
  assert.equal((await api("GET", "/api/passes?state=SUSPENDED", { token: s.a.token })).body.data.total, 2);
  const resume = await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids: [...ids, p3.body.data.pass._id], action: "RESUME" } });
  assert.equal(resume.body.data.changed, 2);
  assert.equal(resume.body.data.skipped.length, 1, "the pass that was never suspended is skipped, not failed");
  const dates = await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids: [ids[1]], action: "SET_DATES", startDate: "2030-01-01", endDate: "2030-01-31" } });
  assert.equal(dates.body.data.changed, 1);
  assert.equal((await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids: [ids[1]], action: "SET_DATES", startDate: "2030-02-01", endDate: "2030-01-01" } })).status, 400);
  // Another company's passes cannot be reached.
  const foreignBulk = await api("POST", "/api/passes/bulk", { token: other.token, body: { ids, action: "EXTEND", days: 5 } });
  assert.equal(foreignBulk.body.data.changed, 0);
  // Nothing here for gate staff.
  assert.equal((await api("GET", "/api/passes/summary", { token: s.entry })).status, 403);
  assert.equal((await api("POST", "/api/passes/bulk", { token: s.exit, body: { ids, action: "EXTEND", days: 5 } })).status, 403);
  assert.ok(await AuditLog.findOne({ action: "PASS_BULK_UPDATE" }));
});
