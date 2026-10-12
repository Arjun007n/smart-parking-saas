// The Phase 2 reports through the API, on a day with a bit of everything.
// Needs MongoDB (see tests/helpers.js).
process.env.PAYMENT_PROVIDER = "simulated";
process.env.PAYMENT_WEBHOOK_SECRET = "reports-test-webhook-secret-123456";

const { setup, it, api, raw, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const { todayText } = require("./reportDates");

setup();

const s = {};
let plate = 0;
const backdate = (id, minutes) =>
  ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - minutes * 60000) } });
const enter = async (locationId, minutesAgo = 0, vehicleNumber) => {
  plate += 1;
  const res = await api("POST", "/api/parking/entry", {
    token: s.entryToken,
    body: { locationId, vehicleNumber: vehicleNumber || `RJ14RP${String(plate).padStart(4, "0")}`, vehicleType: "CAR" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  if (minutesAgo) await backdate(res.body.data.session._id, minutesAgo);
  return res.body.data.session;
};
const leave = (session, extra = {}) =>
  api("POST", "/api/parking/exit", {
    token: s.exitToken, body: { locationId: session.locationId, ticketNumber: session.ticketNumber, ...extra },
  });
const payCash = async (session, method = "CASH") => {
  const out = await leave(session);
  assert.equal(out.body.data.paymentRequired, true, JSON.stringify(out.body));
  const paid = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: session._id, method, amount: out.body.data.session.fee.total },
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  return paid.body.data.payment;
};
const range = () => `from=${s.from}&to=${s.to}`;
const report = (name, query = "", token = s.a.token) => api("GET", `/api/reports/${name}?${range()}${query ? `&${query}` : ""}`, { token });

it("setup: two locations, gate staff, a location admin and a day of activity", async () => {
  ({ from: s.from, to: s.to } = todayText(3));
  s.a = await registerCompany("rpa");
  s.b = await registerCompany("rpb");
  const make = async (name) => {
    const loc = await api("POST", "/api/locations", {
      token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } },
    });
    assert.equal(loc.status, 201, JSON.stringify(loc.body));
    const tariff = await api("POST", "/api/tariffs", {
      token: s.a.token,
      body: { locationId: loc.body.data._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
    });
    assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
    return loc.body.data;
  };
  s.main = await make("Main");
  s.annex = await make("Annex");
  const staff = (name, email, role, ids) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds: ids } });
  await staff("Gate", "rp-entry@example.com", "ENTRY_OPERATOR", [s.main._id, s.annex._id]);
  await staff("Exit", "rp-exit@example.com", "EXIT_OPERATOR", [s.main._id, s.annex._id]);
  await staff("Site", "rp-site@example.com", "LOCATION_ADMIN", [s.main._id]);
  s.entryToken = await login("rp-entry@example.com");
  s.exitToken = await login("rp-exit@example.com");
  s.site = await login("rp-site@example.com");

  // Main: paid in cash, paid by UPI, lost ticket, cancelled, released by admin, still inside for 30 hours.
  s.cash = await payCash(await enter(s.main._id, 90));
  s.upi = await payCash(await enter(s.main._id, 45), "UPI");
  const lostCar = await enter(s.main._id, 120, "RJ14LOST01");
  const lost = await leave(lostCar, { ticketNumber: undefined, vehicleNumber: "RJ14LOST01", lostTicket: true });
  assert.equal(lost.body.data.paymentRequired, true, JSON.stringify(lost.body));
  assert.equal((await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: lostCar._id, method: "CASH", amount: lost.body.data.session.fee.total },
  })).status, 201);
  const wrong = await enter(s.main._id);
  assert.equal((await api("POST", `/api/parking/sessions/${wrong._id}/cancel`, { token: s.a.token, body: { reason: "Entered by mistake" } })).status, 200);
  const stuck = await enter(s.main._id, 100);
  assert.equal((await leave(stuck)).status, 200);
  assert.equal((await api("POST", `/api/parking/sessions/${stuck._id}/override`, { token: s.a.token, body: { reason: "Barrier stuck, let him go" } })).status, 200);
  s.old = await enter(s.main._id, 30 * 60, "RJ14OLD001"); // 30 hours ago and still inside

  // A pass holder.
  const sold = await api("POST", "/api/passes", {
    token: s.a.token,
    body: { locationId: s.main._id, vehicleNumber: "RJ14PASS01", vehicleType: "CAR", holderName: "Asha Rao", months: 1, amount: 1000, method: "CASH" },
  });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  s.pass = sold.body.data.pass;
  const holder = await enter(s.main._id, 300, "RJ14PASS01");
  assert.equal((await leave(holder)).body.data.session.status, "PASS_EXIT");

  // Annex: one paid visit.
  s.annexPayment = await payCash(await enter(s.annex._id, 70));

  // One refund (the UPI payment), one failed online payment.
  const refund = await api("POST", `/api/payments/${s.upi._id}/refund`, { token: s.a.token, body: { reason: "Customer was overcharged" } });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));
  const waiting = await enter(s.main._id, 80);
  const quote = await leave(waiting);
  const online = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: waiting._id, method: "GATEWAY", amount: quote.body.data.session.fee.total },
  });
  assert.equal(online.status, 202, JSON.stringify(online.body));
  assert.equal((await api("POST", `/api/payments/${online.body.data.payment._id}/simulate`, { token: s.exitToken, body: { outcome: "FAILED" } })).status, 200);
});

it("reports: operators without report access are refused, and other companies see nothing", async () => {
  for (const name of ["peak-hours", "occupancy-trend", "exceptions", "payments", "durations", "passes", "hardware"]) {
    assert.equal((await report(name, "", s.entryToken)).status, 403, `${name} for entry staff`);
    const other = await report(name, "", s.b.token);
    assert.equal(other.status, 200, `${name} for another company: ${JSON.stringify(other.body)}`);
    assert.equal(other.body.data.rows.length === 0 || other.body.data.rows.every((r) => !r.entries && !r.payments && !r.vehicles && !r.commands), true, `${name} leaks nothing`);
  }
  assert.equal((await api("GET", "/api/reports/peak-hours")).status, 401);
});

it("peak hours: every entry is counted once, by hour and by weekday; cancelled entries are not", async () => {
  const byHour = await report("peak-hours");
  assert.equal(byHour.status, 200, JSON.stringify(byHour.body));
  assert.equal(byHour.body.data.rows.length, 24);
  const entered = await ParkingSession.countDocuments({ companyId: s.a.company._id, status: { $ne: "CANCELLED" } });
  assert.equal(byHour.body.data.totalEntries, entered);
  assert.ok(byHour.body.data.busiest.entries >= 1);

  const byDay = await report("peak-hours", "by=weekday");
  assert.equal(byDay.body.data.rows.length, 7);
  assert.equal(byDay.body.data.totalEntries, entered);
  assert.equal(byDay.body.data.rows[0].slot, "Sunday");

  const annexOnly = await report("peak-hours", `locationId=${s.annex._id}`);
  assert.equal(annexOnly.body.data.totalEntries, 1);
});

it("occupancy trend: a row per day with entries, exits and the busiest moment", async () => {
  const res = await report("occupancy-trend");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { rows, capacity } = res.body.data;
  assert.equal(capacity, 40);
  assert.equal(rows.length, 4, "three days back plus today");
  const entered = await ParkingSession.countDocuments({ companyId: s.a.company._id, status: { $ne: "CANCELLED" } });
  assert.equal(rows.reduce((t, r) => t + r.entries, 0), entered);
  assert.ok(rows.every((r) => r.peakUtilization === Math.round((r.peakInside / 40) * 100)));
  assert.ok(Math.max(...rows.map((r) => r.peakInside)) >= 2);
  assert.equal((await report("occupancy-trend", `locationId=${s.annex._id}`)).body.data.capacity, 20);
  assert.equal((await api("GET", `/api/reports/occupancy-trend?from=${s.to}&to=2000-01-01`, { token: s.a.token })).status, 400);
});

it("exceptions: cancellations, releases, lost tickets, failed payments and long stays, each once", async () => {
  const res = await report("exceptions");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { counts, rows, total } = res.body.data;
  assert.deepEqual(counts, { CANCELLED: 1, OVERRIDE: 1, LOST_TICKET: 1, PAYMENT_FAILED: 1, STILL_INSIDE: 1 });
  assert.equal(total, 5);
  assert.equal(rows.length, 5);
  const by = (what) => rows.find((r) => r.type === what);
  assert.equal(by("Entry cancelled").detail, "Entered by mistake");
  assert.equal(by("Released by admin").detail, "Barrier stuck, let him go");
  assert.equal(by("Refund"), undefined, "refunds are not an exceptions type");
  assert.equal(by("Lost ticket").vehicle, "RJ14LOST01");
  assert.equal(by("Inside for over 24 hours").vehicle, "RJ14OLD001");
  assert.equal(by("Online payment failed").detail, "Declined in the simulator");
  assert.equal(by("Entry cancelled").by, "Admin rpa");

  assert.equal((await report("exceptions", "type=REFUND")).status, 400);
  assert.equal((await report("exceptions", "type=NOPE")).status, 400);

  // A location admin sees their own location; everything above happened at Main.
  assert.equal((await report("exceptions", "", s.site)).body.data.total, total, "everything above happened at Main");
  assert.equal((await report("exceptions", `locationId=${s.annex._id}`)).body.data.total, 0);

  const csv = await raw(`/api/reports/exceptions?${range()}&format=csv`, s.a.token);
  assert.equal(csv.status, 200);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.text, /Entry cancelled/);
  assert.match(csv.text, /Online payment failed/);
});

it("exceptions: a payment problem (paid twice) shows up with the right vehicle", async () => {
  const car = await enter(s.main._id, 90);
  const quote = await leave(car);
  const online = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: car._id, method: "GATEWAY", amount: quote.body.data.session.fee.total },
  });
  await api("POST", "/api/payments", { token: s.exitToken, body: { sessionId: car._id, method: "CASH", amount: quote.body.data.session.fee.total } });
  const simulated = await api("POST", `/api/payments/${online.body.data.payment._id}/simulate`, { token: s.exitToken, body: { outcome: "SUCCESS" } });
  assert.equal(simulated.body.data.outcome, "duplicate");

  const res = await report("exceptions", "type=PAYMENT_PROBLEM");
  assert.equal(res.body.data.rows.length, 1);
  assert.equal(res.body.data.rows[0].vehicle, car.vehicleNumber);
  assert.equal(res.body.data.rows[0].detail, "Customer paid twice");
  assert.equal((await report("exceptions", "type=PAYMENT_PROBLEM", s.b.token)).body.data.rows.length, 0);
});

it("payments: share by method and online success rate", async () => {
  const res = await report("payments");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { rows, total, failureReasons } = res.body.data;
  const row = (m) => rows.find((r) => r.method === m);
  assert.ok(row("CASH").amount > 0);
  assert.equal(row("UPI").refunds, undefined, "no refund columns");
  assert.equal(row("GATEWAY").payments, 0);
  assert.ok(row("GATEWAY").failed >= 1);
  assert.equal(row("GATEWAY").successRate, 0);
  assert.equal(row("CASH").successRate, "");
  assert.ok(Math.abs(rows.reduce((t, r) => t + r.share, 0) - 100) < 0.5);
  assert.equal(total.refunded, undefined);
  assert.equal(total.refundRate, undefined);
  assert.ok(failureReasons.some((r) => r.reason === "Declined in the simulator" && r.count === 1));
  // The pass sale (1000, cash) is money too.
  assert.ok(row("CASH").amount >= 1000);
  assert.equal(row("COMPLIMENTARY"), undefined);
});

it("durations: every exited vehicle falls in exactly one band", async () => {
  const res = await report("durations");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { rows, totalVehicles } = res.body.data;
  assert.equal(rows.length, 7);
  const exited = await ParkingSession.countDocuments({
    companyId: s.a.company._id, isOpen: false, status: { $in: ["COMPLETED", "LOST_TICKET", "PASS_EXIT"] },
  });
  assert.equal(totalVehicles, exited);
  assert.equal(rows.reduce((t, r) => t + r.vehicles, 0), exited);
  assert.ok(rows.find((r) => r.band === "1 to 2 h").vehicles >= 1);
  assert.equal(rows.find((r) => r.band === "4 to 8 h").passVisits, 1, "the pass holder stayed 5 hours");
  assert.ok(res.body.data.averageMinutes > 0);
});

it("passes: summary, what was sold, pass visits, and who to call about renewing", async () => {
  const res = await report("passes", "due=60");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.equal(d.summary.active, 1);
  assert.equal(d.sales.newPasses, 1);
  assert.equal(d.sales.amount, 1000);
  assert.equal(d.passVisits, 1);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].passNumber, s.pass.passNumber);
  assert.equal(d.rows[0].holder, "Asha Rao");
  assert.equal(d.rows[0].state, "Ending soon");
  assert.ok(d.rows[0].daysLeft > 20);

  assert.equal((await report("passes", "due=7")).body.data.rows.length, 0, "not ending within a week");
  // A location admin of Annex, which this company-wide pass also covers, is not shown it as theirs;
  // the Main admin cannot manage a company-wide pass either.
  assert.equal((await report("passes", "due=60", s.site)).body.data.rows.length, 0);
});

it("hardware: lists the site's devices with their numbers (empty until devices exist)", async () => {
  const none = await report("hardware");
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.data.rows, []);

  const device = await api("POST", "/api/hardware", {
    token: s.a.token, body: { locationId: s.main._id, name: "Gate printer", type: "PRINTER", direction: "BOTH" },
  });
  assert.equal(device.status, 201, JSON.stringify(device.body));
  const listed = await report("hardware");
  assert.equal(listed.body.data.rows.length, 1);
  assert.equal(listed.body.data.rows[0].device, "Gate printer");
  assert.equal(listed.body.data.rows[0].commands, 0);
  assert.equal(listed.body.data.rows[0].detections, "");
  assert.equal((await report("hardware", "", s.b.token)).body.data.rows.length, 0);
});
