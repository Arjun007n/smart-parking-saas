// API tests for Week 4: shifts and reconciliation, refunds, dashboard,
// reports with CSV, audit log and notifications. Needs MongoDB.
const { setup, it, api, raw, registerCompany, login, assert } = require("./helpers");
const Company = require("../models/Company");
const Notification = require("../models/Notification");
const { checkSubscriptions } = require("../services/notificationService");

setup();

const s = {};

// Parks a car, then exits and pays as the collector. Returns the payment.
const visit = async (vehicleNumber, method, extra = {}) => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.a.token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const exit = await api("POST", "/api/parking/exit", {
    token: s.collector, body: { locationId: s.loc._id, ticketNumber: entry.body.data.session.ticketNumber },
  });
  assert.equal(exit.body.data.session.fee.total, 20, JSON.stringify(exit.body));
  const paid = await api("POST", "/api/payments", {
    token: s.collector, body: { sessionId: entry.body.data.session._id, method, amount: 20, ...extra },
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  return paid.body.data.payment;
};

it("setup: company, two locations, a flat tariff and staff", async () => {
  s.a = await registerCompany("w4a");
  s.b = await registerCompany("w4b");

  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Main", address: { line1: "MG Road" }, capacity: { car: 10 } },
  });
  const small = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Small", address: { line1: "Side Road" }, capacity: { car: 1 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  s.small = small.body.data;

  for (const location of [s.loc, s.small]) {
    const tariff = await api("POST", "/api/tariffs", {
      token: s.a.token, body: { locationId: location._id, name: "Flat", vehicleType: "CAR", additionalPerHour: 20 },
    });
    assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  }

  const staff = (name, email, role) =>
    api("POST", "/api/users", {
      token: s.a.token, body: { name, email, password: "Password123", role, locationIds: [s.loc._id] },
    });
  s.collectorUser = (await staff("Collector", "w4-collector@example.com", "EXIT_OPERATOR")).body.data;
  await staff("Gate", "w4-gate@example.com", "ENTRY_OPERATOR");
  await staff("Site Admin", "w4-siteadmin@example.com", "LOCATION_ADMIN");
  s.collector = await login("w4-collector@example.com");
  s.gate = await login("w4-gate@example.com");
  s.siteAdmin = await login("w4-siteadmin@example.com");
});

it("shift: open with opening cash; only one open shift per operator", async () => {
  assert.equal((await api("GET", "/api/shifts/current", { token: s.collector })).body.data, null);

  const open = await api("POST", "/api/shifts", { token: s.collector, body: { locationId: s.loc._id, openingCash: 500 } });
  assert.equal(open.status, 201, JSON.stringify(open.body));
  s.shift = open.body.data;
  assert.equal(s.shift.status, "OPEN");
  assert.equal(s.shift.totals.expectedCash, 500);

  assert.equal((await api("POST", "/api/shifts", { token: s.collector, body: { locationId: s.loc._id, openingCash: 0 } })).status, 409);
  assert.equal((await api("POST", "/api/shifts", { token: s.gate, body: { locationId: s.loc._id, openingCash: 0 } })).status, 403);
  assert.equal((await api("POST", "/api/shifts", { token: s.collector, body: { locationId: s.small._id, openingCash: 0 } })).status, 404);
  assert.equal((await api("POST", "/api/shifts", { token: s.collector, body: { locationId: s.loc._id, openingCash: -5 } })).status, 400);
});

it("payments taken during the shift are counted in it", async () => {
  s.cash1 = await visit("RJ14AA0001", "CASH");
  s.upi = await visit("RJ14AA0002", "UPI", { transactionId: "UPI-W4-0001" });
  s.cash2 = await visit("RJ14AA0003", "CASH");
  assert.equal(s.cash1.shiftId, s.shift._id);

  const current = await api("GET", "/api/shifts/current", { token: s.collector });
  const t = current.body.data.totals;
  assert.equal(t.collected, 60);
  assert.equal(t.payments, 3);
  assert.equal(t.cashCollected, 40);
  assert.equal(t.expectedCash, 540);
  assert.deepEqual(t.byMethod.map((m) => [m.method, m.amount]), [["CASH", 40], ["UPI", 20]]);
});

it("refund: admins only, needs a reason, only once; cash comes out of the drawer", async () => {
  const path = `/api/payments/${s.cash1._id}/refund`;
  assert.equal((await api("POST", path, { token: s.collector, body: { reason: "Charged twice" } })).status, 403);
  assert.equal((await api("POST", path, { token: s.a.token, body: {} })).status, 400);
  assert.equal((await api("POST", path, { token: s.b.token, body: { reason: "Charged twice" } })).status, 404);

  const refund = await api("POST", path, { token: s.a.token, body: { reason: "Charged twice" } });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));
  assert.equal(refund.body.data.status, "REFUNDED");
  assert.equal(refund.body.data.refund.amount, 20);
  assert.equal(refund.body.data.refund.shiftId, s.shift._id);

  assert.equal((await api("POST", path, { token: s.a.token, body: { reason: "Charged twice" } })).status, 409);

  const t = (await api("GET", "/api/shifts/current", { token: s.collector })).body.data.totals;
  assert.equal(t.cashRefunded, 20);
  assert.equal(t.expectedCash, 520);
});

it("adjustment: an admin records cash added to the drawer", async () => {
  const path = `/api/shifts/${s.shift._id}/adjustments`;
  assert.equal((await api("POST", path, { token: s.collector, body: { amount: 100, reason: "Change added" } })).status, 403);
  assert.equal((await api("POST", path, { token: s.a.token, body: { amount: 100 } })).status, 400);
  assert.equal((await api("POST", path, { token: s.b.token, body: { amount: 100, reason: "Change added" } })).status, 404);

  const added = await api("POST", path, { token: s.a.token, body: { amount: 100, reason: "Change added by manager" } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.data.totals.adjustments, 100);
  assert.equal(added.body.data.totals.expectedCash, 620);
});

it("shift close: counted cash is compared with expected cash", async () => {
  const path = `/api/shifts/${s.shift._id}/close`;
  assert.equal((await api("POST", path, { token: s.gate, body: { closingCash: 620 } })).status, 403);
  assert.equal((await api("POST", path, { token: s.b.token, body: { closingCash: 620 } })).status, 404);
  assert.equal((await api("POST", path, { token: s.collector, body: {} })).status, 400);

  const closed = await api("POST", path, { token: s.collector, body: { closingCash: 610, notes: "Ten short" } });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.data.status, "CLOSED");
  assert.equal(closed.body.data.expectedCash, 620);
  assert.equal(closed.body.data.difference, -10);
  assert.equal(closed.body.data.totals.collected, 60);

  assert.equal((await api("POST", path, { token: s.collector, body: { closingCash: 620 } })).status, 409);
  assert.equal((await api("POST", `/api/shifts/${s.shift._id}/adjustments`, { token: s.a.token, body: { amount: 10, reason: "Too late now" } })).status, 409);
  assert.equal((await api("GET", "/api/shifts/current", { token: s.collector })).body.data, null);

  // A payment after the shift closed is not part of it, and its totals stay frozen.
  const later = await visit("RJ14AA0004", "CASH");
  assert.equal(later.shiftId, undefined);
  const list = await api("GET", "/api/shifts", { token: s.a.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].operatorName, "Collector");
  assert.equal(list.body.data[0].totals.collected, 60);

  assert.equal((await api("GET", "/api/shifts", { token: s.gate })).status, 403);
  assert.equal((await api("GET", "/api/shifts", { token: s.b.token })).body.data.length, 0);
});

it("collection: collected, refunded and net", async () => {
  const res = await api("GET", "/api/payments/collection", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.total.amount, 80); // four payments of 20
  assert.equal(res.body.data.refunded.amount, 20);
  assert.equal(res.body.data.refunded.count, 1);
  assert.equal(res.body.data.net, 60);
});

it("capacity alert: raised once when a location fills up", async () => {
  const enter = () =>
    api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.small._id, vehicleNumber: "RJ14SM0001", vehicleType: "CAR" } });
  const first = await enter();
  assert.equal(first.status, 201);

  // Free the space and fill it again in the same hour: still one alert.
  await api("POST", `/api/parking/sessions/${first.body.data.session._id}/cancel`, { token: s.a.token, body: { reason: "Testing alerts" } });
  assert.equal((await enter()).status, 201);

  const alerts = await Notification.find({ companyId: s.a.company._id, type: "CAPACITY" });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "critical");
  assert.equal(String(alerts[0].locationId), s.small._id);
});

it("dashboard: occupancy, traffic, revenue, operators, locations and alerts", async () => {
  const res = await api("GET", "/api/dashboard", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;

  assert.equal(d.occupancy.totalCapacity, 11);
  assert.equal(d.occupancy.totalOccupied, 1); // the car in "Small"
  assert.equal(d.occupancy.available, 10);
  assert.equal(d.occupancy.utilization, 9);
  assert.equal(d.traffic.currentVehicles, 1);
  assert.equal(d.traffic.entriesToday, 6); // 4 at Main, 2 at Small
  assert.equal(d.traffic.exitsToday, 4); // the cancelled entry is not an exit
  assert.equal(d.traffic.hourly.length, 24);
  assert.equal(d.traffic.hourly.reduce((t, h) => t + h.entries, 0), 6);

  assert.equal(d.revenue.today, 60);
  assert.equal(d.revenue.week, 60);
  assert.equal(d.revenue.month, 60);
  assert.equal(d.revenue.last7Days.length, 7);
  assert.equal(d.revenue.last7Days[6].amount, 60);
  assert.deepEqual(d.revenue.byMethod.map((m) => [m.method, m.amount, m.count]), [["CASH", 60, 3], ["UPI", 20, 1]]);

  const collector = d.operators.find((o) => o.name === "Collector");
  assert.equal(collector.exits, 4);
  assert.equal(collector.payments, 4);
  assert.equal(collector.collected, 80);
  assert.equal(d.operators.find((o) => o.name === "Admin w4a").entries, 6);

  assert.equal(d.exceptions.cancelled, 1);
  assert.equal(d.exceptions.overrides, 0);
  const main = d.locations.find((l) => l.name === "Main");
  assert.equal(main.entriesToday, 4);
  assert.equal(main.collectedToday, 80);
  assert.equal(d.locations.find((l) => l.name === "Small").utilization, 100);
  assert.ok(d.alerts.some((a) => a.type === "CAPACITY" && a.severity === "critical"));

  // One location only.
  const one = await api("GET", `/api/dashboard?locationId=${s.loc._id}`, { token: s.a.token });
  assert.equal(one.body.data.occupancy.totalCapacity, 10);
  assert.equal(one.body.data.traffic.entriesToday, 4);
  assert.equal(one.body.data.alerts.filter((a) => a.type === "CAPACITY").length, 0);

  // A location admin only sees their own location.
  const site = await api("GET", "/api/dashboard", { token: s.siteAdmin });
  assert.deepEqual(site.body.data.locations.map((l) => l.name), ["Main"]);
  assert.equal((await api("GET", `/api/dashboard?locationId=${s.small._id}`, { token: s.siteAdmin })).status, 404);

  // Other company and roles without report access.
  const other = await api("GET", "/api/dashboard", { token: s.b.token });
  assert.equal(other.body.data.traffic.entriesToday, 0);
  assert.equal(other.body.data.revenue.today, 0);
  assert.equal((await api("GET", `/api/dashboard?locationId=${s.loc._id}`, { token: s.b.token })).status, 404);
  assert.equal((await api("GET", "/api/dashboard", { token: s.gate })).status, 403);
});

it("reports: revenue by day and by location", async () => {
  const byDay = await api("GET", "/api/reports/revenue", { token: s.a.token });
  assert.equal(byDay.status, 200, JSON.stringify(byDay.body));
  assert.equal(byDay.body.data.rows.length, 1);
  const row = byDay.body.data.rows[0];
  assert.deepEqual([row.payments, row.collected, row.refunds, row.refunded, row.net], [4, 80, 1, 20, 60]);
  assert.equal(byDay.body.data.total.net, 60);

  for (const groupBy of ["week", "month"]) {
    const res = await api("GET", `/api/reports/revenue?groupBy=${groupBy}`, { token: s.a.token });
    assert.equal(res.body.data.rows.length, 1, groupBy);
    assert.equal(res.body.data.rows[0].net, 60, groupBy);
  }
  const byLocation = await api("GET", "/api/reports/revenue?groupBy=location", { token: s.a.token });
  assert.deepEqual(byLocation.body.data.rows.map((r) => [r.period, r.net]), [["Main", 60]]);

  assert.equal((await api("GET", "/api/reports/revenue?from=2026-03-07&to=2026-03-01", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/reports/revenue?from=2020-01-01&to=2026-01-01", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/reports/revenue?from=2020-01-01&to=2020-01-31", { token: s.a.token })).body.data.rows.length, 0);
  assert.equal((await api("GET", "/api/reports/revenue", { token: s.b.token })).body.data.rows.length, 0);
  assert.equal((await api("GET", "/api/reports/revenue", { token: s.gate })).status, 403);
});

it("reports: collection, vehicle history, occupancy and operators, with filters", async () => {
  const collection = await api("GET", "/api/reports/collection", { token: s.a.token });
  assert.equal(collection.body.data.total, 4);
  const refunded = collection.body.data.rows.find((r) => r.status === "REFUNDED");
  assert.equal(refunded.refundReason, "Charged twice");
  assert.equal(refunded.vehicle, "RJ14AA0001");
  assert.equal(refunded.operator, "Collector");
  assert.equal((await api("GET", "/api/reports/collection?method=UPI", { token: s.a.token })).body.data.total, 1);
  assert.equal((await api("GET", `/api/reports/collection?operatorId=${s.collectorUser._id}`, { token: s.a.token })).body.data.total, 4);
  assert.equal((await api("GET", `/api/reports/collection?operatorId=${s.a.user._id}`, { token: s.a.token })).body.data.total, 0);
  assert.equal((await api("GET", "/api/reports/collection?operatorId=nope", { token: s.a.token })).status, 400);

  const vehicles = await api("GET", "/api/reports/vehicles", { token: s.a.token });
  assert.equal(vehicles.body.data.total, 6);
  assert.equal((await api("GET", "/api/reports/vehicles?q=rj14 aa", { token: s.a.token })).body.data.total, 4);
  assert.equal((await api("GET", "/api/reports/vehicles?status=CANCELLED", { token: s.a.token })).body.data.total, 1);
  assert.equal((await api("GET", `/api/reports/vehicles?locationId=${s.small._id}`, { token: s.a.token })).body.data.total, 2);
  assert.equal((await api("GET", "/api/reports/vehicles", { token: s.siteAdmin })).body.data.total, 4); // Main only

  const occupancy = await api("GET", "/api/reports/occupancy", { token: s.a.token });
  assert.equal(occupancy.status, 200, JSON.stringify(occupancy.body));
  const hours = occupancy.body.data.rows;
  assert.ok(hours.length >= 1 && hours.length <= 24);
  assert.equal(hours[hours.length - 1].capacity, 11);
  assert.ok(hours[hours.length - 1].vehicles >= 1);
  assert.ok(occupancy.body.data.peak.vehicles >= 1);

  const operators = await api("GET", "/api/reports/operators", { token: s.a.token });
  const collector = operators.body.data.rows.find((r) => r.operator === "Collector");
  assert.deepEqual([collector.exits, collector.payments, collector.collected, collector.cash], [4, 4, 80, 60]);
  const admin = operators.body.data.rows.find((r) => r.operator === "Admin w4a");
  assert.deepEqual([admin.entries, admin.refunds, admin.refunded, admin.corrections], [6, 1, 20, 1]);
});

it("reports: CSV download", async () => {
  const csv = await raw("/api/reports/revenue?format=csv", s.a.token);
  assert.equal(csv.status, 200);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.disposition, /attachment; filename="revenue-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = csv.text.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines[0], "Date,Payments,Collected,Of which passes,Tax,Refunds,Refunded,Net");
  assert.match(lines[1], /^\d{4}-\d{2}-\d{2},4,80,0,0,1,20,60$/);

  const collection = await raw("/api/reports/collection?format=csv", s.a.token);
  assert.equal(collection.text.replace(/^﻿/, "").split("\r\n").length, 5); // header + 4 payments
  assert.match(collection.text, /RJ14AA0001/);

  assert.equal((await raw("/api/reports/revenue?format=csv", s.gate)).status, 403);
  const other = await raw("/api/reports/collection?format=csv", s.b.token);
  assert.equal(other.text.replace(/^﻿/, "").split("\r\n").length, 1); // header only
});

it("audit log: readable by company admins, filterable, never editable", async () => {
  const res = await api("GET", "/api/audit-logs", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const action of ["SHIFT_OPEN", "SHIFT_CLOSE", "SHIFT_ADJUSTMENT", "PAYMENT_REFUNDED", "PARKING_ENTRY", "PAYMENT_RECEIVED"]) {
    assert.ok(res.body.data.actions.includes(action), `missing ${action}`);
  }
  assert.ok(res.body.data.logs.every((log) => log.companyId === s.a.company._id));

  const refunds = await api("GET", "/api/audit-logs?action=PAYMENT_REFUNDED", { token: s.a.token });
  assert.equal(refunds.body.data.total, 1);
  assert.equal(refunds.body.data.logs[0].meta.reason, "Charged twice");
  assert.equal(refunds.body.data.logs[0].actorEmail, "admin-w4a@example.com");
  const byActor = await api("GET", "/api/audit-logs?actor=w4-collector@example.com", { token: s.a.token });
  assert.ok(byActor.body.data.total >= 1);
  assert.ok(byActor.body.data.logs.every((log) => log.actorEmail === "w4-collector@example.com"));

  // Other company sees only its own entries; lower roles see none.
  const other = await api("GET", "/api/audit-logs", { token: s.b.token });
  assert.ok(other.body.data.logs.every((log) => log.companyId === s.b.company._id));
  assert.ok(!other.body.data.actions.includes("PAYMENT_REFUNDED"));
  assert.equal((await api("GET", "/api/audit-logs", { token: s.siteAdmin })).status, 403);
  assert.equal((await api("GET", "/api/audit-logs", { token: s.collector })).status, 403);

  // There is no way to change or remove entries through the API.
  const id = refunds.body.data.logs[0]._id;
  assert.equal((await api("DELETE", `/api/audit-logs/${id}`, { token: s.a.token })).status, 404);
  assert.equal((await api("PUT", `/api/audit-logs/${id}`, { token: s.a.token, body: { action: "X" } })).status, 404);

  const csv = await raw("/api/audit-logs?format=csv&action=PAYMENT_REFUNDED", s.a.token);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.text, /PAYMENT_REFUNDED/);
});

it("notifications: admins see alerts for their scope and can mark them read", async () => {
  const list = await api("GET", "/api/notifications", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const types = list.body.data.notifications.map((n) => n.type).sort();
  assert.deepEqual(types, ["CAPACITY", "SHIFT_DIFFERENCE"]);
  assert.equal(list.body.data.unreadCount, 2);
  assert.ok(list.body.data.notifications.every((n) => n.read === false && n.readBy === undefined));

  // Site admin of "Main" does not see the alert of "Small".
  const site = await api("GET", "/api/notifications", { token: s.siteAdmin });
  assert.deepEqual(site.body.data.notifications.map((n) => n.type), ["SHIFT_DIFFERENCE"]);

  const shiftAlert = list.body.data.notifications.find((n) => n.type === "SHIFT_DIFFERENCE");
  assert.match(shiftAlert.title, /short by 10/);
  const read = await api("POST", "/api/notifications/read", { token: s.a.token, body: { ids: [shiftAlert._id] } });
  assert.equal(read.body.data.updated, 1);
  assert.equal((await api("GET", "/api/notifications", { token: s.a.token })).body.data.unreadCount, 1);
  assert.equal((await api("GET", "/api/notifications?unread=true", { token: s.a.token })).body.data.notifications.length, 1);
  // Reading is per user.
  assert.equal((await api("GET", "/api/notifications", { token: s.siteAdmin })).body.data.unreadCount, 1);

  assert.equal((await api("POST", "/api/notifications/read", { token: s.a.token, body: { all: true } })).status, 200);
  assert.equal((await api("GET", "/api/notifications", { token: s.a.token })).body.data.unreadCount, 0);
  assert.equal((await api("POST", "/api/notifications/read", { token: s.a.token, body: {} })).status, 400);

  // Other company cannot see or mark them; operators have no access.
  assert.equal((await api("GET", "/api/notifications", { token: s.b.token })).body.data.notifications.length, 0);
  assert.equal((await api("POST", "/api/notifications/read", { token: s.b.token, body: { ids: [shiftAlert._id] } })).body.data.updated, 0);
  assert.equal((await api("GET", "/api/notifications", { token: s.collector })).status, 403);
});

it("subscription alert: raised once a day when a trial is about to end", async () => {
  assert.equal(await checkSubscriptions(), 0); // both trials have 14 days left

  await Company.updateOne({ _id: s.a.company._id }, { trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) });
  assert.equal(await checkSubscriptions(), 1);
  assert.equal(await checkSubscriptions(), 0); // not repeated the same day

  const list = await api("GET", "/api/notifications?unread=true", { token: s.a.token });
  assert.deepEqual(list.body.data.notifications.map((n) => n.type), ["SUBSCRIPTION_EXPIRY"]);
  assert.match(list.body.data.notifications[0].title, /trial ends in 3 days/);
  // It is a company-level alert, so a site admin sees it too.
  assert.ok((await api("GET", "/api/notifications", { token: s.siteAdmin })).body.data.notifications.some((n) => n.type === "SUBSCRIPTION_EXPIRY"));

  const dashboard = await api("GET", "/api/dashboard", { token: s.a.token });
  assert.ok(dashboard.body.data.alerts.some((a) => a.type === "SUBSCRIPTION_EXPIRY"));
});
