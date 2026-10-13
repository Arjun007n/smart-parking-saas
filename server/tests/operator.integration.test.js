// The gate staff screens: Home numbers, collection by vehicle type, entry and
// exit lists (with downloads), FASTag as a payment mode, and customer bookings.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, raw, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Booking = require("../models/Booking");

setup();

const s = {};
const backdate = (sessionId, minutes) =>
  ParkingSession.updateOne({ _id: sessionId }, { $set: { entryTime: new Date(Date.now() - minutes * 60 * 1000) } });
const enter = (vehicleNumber, extra = {}, vehicleType = "CAR", token = s.a.token) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType, ...extra } });
const exit = (body, token = s.a.token) => api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, ...body } });
const pay = (body, token = s.a.token) => api("POST", "/api/payments", { token, body });
const FEE = 40; // a 90 minute stay
const STAY = 89.5;

it("setup: company, location, tariff, staff and an open shift", async () => {
  s.a = await registerCompany("opr");
  s.b = await registerCompany("oprb");
  const loc = await api("POST", "/api/locations", {
    token: s.a.token, body: { name: "Operator Lot", address: { line1: "MG Road" }, capacity: { car: 3, bike: 2 } },
  });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: {
      locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10,
      slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, lostTicketFee: 200, taxPercent: 18, taxInclusive: true,
    },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const staff = (name, email, role) =>
    api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds: [s.loc._id] } });
  assert.equal((await staff("Entry Op", "opr-entry@example.com", "ENTRY_OPERATOR")).status, 201);
  assert.equal((await staff("Exit Op", "opr-exit@example.com", "EXIT_OPERATOR")).status, 201);
  s.entryToken = await login("opr-entry@example.com");
  s.exitToken = await login("opr-exit@example.com");
  assert.equal((await api("POST", "/api/shifts", { token: s.a.token, body: { locationId: s.loc._id, openingCash: 0 } })).status, 201);
});

it("FASTag: accepted as an advance and as the payment at exit, recorded like UPI", async () => {
  const v1 = await enter("RJ14OP0001", { advance: { amount: 100, method: "CASH" } });
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  s.v1 = v1.body.data.session;
  const bike = await enter("RJ14OP0002", {}, "BIKE");
  assert.equal(bike.status, 201, JSON.stringify(bike.body));

  const v3 = await enter("RJ14OP0003", { advance: { amount: 50, method: "FASTAG" } });
  assert.equal(v3.status, 201, JSON.stringify(v3.body));
  assert.equal(v3.body.data.session.advance.method, "FASTAG");
  s.v3 = v3.body.data.session;
  await backdate(s.v3._id, STAY);
  const out3 = await exit({ ticketNumber: s.v3.ticketNumber });
  assert.equal(out3.body.data.paymentRequired, false);
  assert.equal(out3.body.data.advance.refund, 10);

  const v4 = (await enter("RJ14OP0004")).body.data.session;
  await backdate(v4._id, STAY);
  await exit({ ticketNumber: v4.ticketNumber });
  assert.equal((await pay({ sessionId: v4._id, method: "UPI", amount: FEE })).status, 201);

  const v5 = (await enter("RJ14OP0005")).body.data.session;
  await backdate(v5._id, STAY);
  await exit({ ticketNumber: v5.ticketNumber });
  const paid = await pay({ sessionId: v5._id, method: "FASTAG", amount: FEE });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.data.payment.method, "FASTAG");
  assert.equal((await pay({ sessionId: v5._id, method: "BITCOIN", amount: FEE })).status, 400);
  s.v4 = v4;
  s.v5 = v5;
});

it("Home: counts of entries, exits, parked and free spaces per vehicle type", async () => {
  const res = await api("GET", `/api/operator/summary?locationId=${s.loc._id}`, { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { counts, license } = res.body.data;
  assert.deepEqual(counts.all, { capacity: 5, parked: 2, available: 3, entries: 5, exits: 3 });
  const car = counts.types.find((t) => t.type === "CAR");
  assert.deepEqual(car, { type: "CAR", capacity: 3, parked: 1, available: 2, entries: 4, exits: 3 });
  const bike = counts.types.find((t) => t.type === "BIKE");
  assert.deepEqual(bike, { type: "BIKE", capacity: 2, parked: 1, available: 1, entries: 1, exits: 0 });
  assert.ok(license.plan, "the licence block names the plan");
});

it("Home: a period from one date and time to another", async () => {
  const text = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 16);
  const day = 86400000;
  const around = await api("GET", `/api/operator/summary?locationId=${s.loc._id}&from=${text(-day)}&to=${text(day)}`, { token: s.a.token });
  assert.equal(around.status, 200, JSON.stringify(around.body));
  assert.deepEqual(around.body.data.counts.all, { capacity: 5, parked: 2, available: 3, entries: 5, exits: 3 });
  // Before anything happened: nothing came in or left (the vehicles still parked are counted as parked).
  const before = await api("GET", `/api/operator/summary?locationId=${s.loc._id}&from=2020-01-01T00:00&to=2020-01-02T10:30`, { token: s.a.token });
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.data.counts.all.entries, 0);
  assert.equal(before.body.data.counts.all.exits, 0);
  assert.equal((await api("GET", `/api/operator/summary?from=${text(day)}&to=${text(-day)}`, { token: s.a.token })).status, 400);
  assert.equal((await api("GET", `/api/operator/summary?from=${text(-day)}`, { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/operator/summary?from=2026-10-01&to=2026-10-02", { token: s.a.token })).status, 400);
});

it("Home: money by vehicle type and payment mode, advances and exit payments apart", async () => {
  const res = await api("GET", `/api/operator/summary?locationId=${s.loc._id}`, { token: s.a.token });
  const { rows, totals } = res.body.data.collection;
  const car = rows.find((r) => r.type === "CAR");
  assert.deepEqual(car, {
    type: "CAR", entryAmount: 150, exitAmount: 80, cash: 100, online: 0, upi: 40, card: 0, fastag: 90, wallet: 0,
    total: 230, refunded: 10, net: 220, payments: 4,
  });
  const bike = rows.find((r) => r.type === "BIKE");
  assert.equal(bike.total, 0);
  assert.equal(totals.total, 230);
  assert.equal(totals.entryAmount, 150);
  assert.equal(totals.exitAmount, 80);
  assert.equal(totals.net, 220);

  const same = await api("GET", `/api/operator/collection?locationId=${s.loc._id}`, { token: s.exitToken });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.data.totals.total, 230);
});

it("Home: staff who cannot handle money get counts only; other companies see nothing", async () => {
  const entryOnly = await api("GET", "/api/operator/summary", { token: s.entryToken });
  assert.equal(entryOnly.status, 200);
  assert.equal(entryOnly.body.data.collection, null);
  assert.equal(entryOnly.body.data.counts.all.entries, 5);
  assert.equal((await api("GET", "/api/operator/collection", { token: s.entryToken })).status, 403);

  const other = await api("GET", "/api/operator/summary", { token: s.b.token });
  assert.equal(other.body.data.counts.all.entries, 0);
  assert.equal(other.body.data.collection.totals.total, 0);
  assert.equal((await api("GET", "/api/operator/summary?locationId=" + s.loc._id, { token: s.b.token })).status, 404);
  assert.equal((await api("GET", "/api/operator/summary?date=nope", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/operator/summary")).status, 401);
  const past = await api("GET", "/api/operator/summary?date=2020-01-01", { token: s.a.token });
  assert.equal(past.body.data.counts.all.entries, 0);
  assert.equal(past.body.data.collection.totals.total, 0);
});

it("Entry list: a day's entries with payment mode, advance and paging", async () => {
  const res = await api("GET", "/api/operator/entries?pageSize=10", { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.total, 5);
  assert.equal(res.body.data.pageSize, 10);
  const row = res.body.data.sessions.find((r) => r.vehicle === "RJ14OP0003");
  assert.equal(row.method, "FASTAG");
  assert.equal(row.advance, 50);
  assert.equal(row.type, "CAR");
  assert.match(row.ticket, /^T-\d{6}-/);
  assert.equal(res.body.data.sessions[0].sno, 1);

  const paged = await api("GET", "/api/operator/entries?pageSize=10&page=2", { token: s.a.token });
  assert.equal(paged.body.data.sessions.length, 0);
  const small = await api("GET", "/api/operator/entries?pageSize=3", { token: s.a.token });
  assert.equal(small.body.data.pageSize, 25, "an unknown page size falls back to 25");
  const found = await api("GET", "/api/operator/entries?q=RJ14OP000", { token: s.a.token });
  assert.equal(found.body.data.total, 5);
  const one = await api("GET", `/api/operator/entries?q=${s.v1.ticketNumber}`, { token: s.a.token });
  assert.equal(one.body.data.total, 1);
  assert.equal(one.body.data.sessions[0].vehicle, "RJ14OP0001");
  assert.equal((await api("GET", "/api/operator/entries", { token: s.b.token })).body.data.total, 0);
});

it("Exit list: payable, advance and paid amounts for each vehicle that left", async () => {
  const res = await api("GET", "/api/operator/exits", { token: s.exitToken });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.total, 3);
  const byPlate = Object.fromEntries(res.body.data.sessions.map((r) => [r.vehicle, r]));
  assert.equal(byPlate.RJ14OP0003.advance, 50);
  assert.equal(byPlate.RJ14OP0003.paid, 0);
  assert.equal(byPlate.RJ14OP0003.payable, FEE);
  assert.equal(byPlate.RJ14OP0003.method, "FASTAG");
  assert.equal(byPlate.RJ14OP0004.method, "UPI");
  assert.equal(byPlate.RJ14OP0004.paid, FEE);
  assert.equal(byPlate.RJ14OP0004.totalMinutes, 90);
  assert.ok(byPlate.RJ14OP0004.outTime);
  // Vehicles still inside are not in the exit list.
  assert.equal(byPlate.RJ14OP0001, undefined);
});

it("Entry and exit lists: filter by payment mode and by vehicle type", async () => {
  const get = (path, token = s.a.token) => api("GET", path, { token });
  const plates = (res) => res.body.data.sessions.map((r) => r.vehicle).sort();

  // Entry list: the way the advance was paid.
  const fastagIn = await get("/api/operator/entries?method=FASTAG");
  assert.equal(fastagIn.status, 200, JSON.stringify(fastagIn.body));
  assert.deepEqual(plates(fastagIn), ["RJ14OP0003"]);
  const cashIn = await get("/api/operator/entries?method=CASH");
  assert.ok(plates(cashIn).includes("RJ14OP0001"));
  assert.ok(!plates(cashIn).includes("RJ14OP0003"));
  assert.equal((await get("/api/operator/entries?type=CAR")).body.data.total, 4);
  assert.deepEqual(plates(await get("/api/operator/entries?type=BIKE")), ["RJ14OP0002"]);

  // Exit list: the way the fee was paid (an advance that covered the fee counts as its own way of paying).
  assert.deepEqual(plates(await get("/api/operator/exits?method=UPI")), ["RJ14OP0004"]);
  assert.deepEqual(plates(await get("/api/operator/exits?method=FASTAG")), ["RJ14OP0003", "RJ14OP0005"]);
  assert.equal((await get("/api/operator/exits?method=CASH")).body.data.total, 0);
  assert.equal((await get("/api/operator/exits?type=CAR")).body.data.total, 3);
  assert.equal((await get("/api/operator/exits?type=BIKE&method=UPI")).body.data.total, 0, "both filters together");
  assert.equal((await get("/api/operator/exits?method=NA")).body.data.total, 0, "nobody left without paying here");
  assert.equal((await get("/api/operator/exits?method=PASS")).body.data.total, 0);

  // Bad values are refused; NA only means something on the exit list; other companies see nothing.
  assert.equal((await get("/api/operator/exits?method=BITCOIN")).status, 400);
  assert.equal((await get("/api/operator/entries?method=NA")).status, 400);
  assert.equal((await get("/api/operator/entries?type=SPACESHIP")).status, 400);
  assert.equal((await get("/api/operator/exits?method=UPI", s.b.token)).body.data.total, 0);
  // The downloaded file follows the filter too.
  const csv = await raw("/api/operator/exits?method=UPI&format=csv", s.a.token);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /RJ14OP0004/);
  assert.doesNotMatch(csv.text, /RJ14OP0005/);
});

it("lists download as Excel, CSV and PDF, and only for people who may see them", async () => {
  const xlsx = await raw("/api/operator/entries?format=xlsx", s.a.token);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.type, /spreadsheetml/);
  assert.match(xlsx.disposition, /entry-list-today\.xlsx/);
  const csv = await raw("/api/operator/exits?format=csv", s.a.token);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Vehicle no/);
  assert.match(csv.text, /RJ14OP0004/);
  const pdf = await raw("/api/operator/collection?format=pdf", s.a.token);
  assert.equal(pdf.status, 200);
  assert.match(pdf.type, /pdf/);
  assert.equal((await raw("/api/operator/collection?format=xlsx", s.entryToken)).status, 403);
  assert.equal((await raw("/api/operator/entries?format=exe", s.a.token)).status, 400);
});

it("bookings: made by entry staff, one waiting booking per vehicle", async () => {
  const body = { locationId: s.loc._id, vehicleNumber: "rj14 bk 0001", vehicleType: "CAR", customerName: "Asha", phone: "9876543210" };
  assert.equal((await api("POST", "/api/bookings", { token: s.exitToken, body })).status, 403);
  assert.equal((await api("POST", "/api/bookings", { token: s.entryToken, body: { ...body, phone: "abc" } })).status, 400);
  assert.equal((await api("POST", "/api/bookings", { token: s.entryToken, body: { ...body, vehicleType: "HEAVY" } })).status, 400);
  const day = 24 * 3600 * 1000;
  assert.equal((await api("POST", "/api/bookings", { token: s.entryToken, body: { ...body, expectedAt: new Date(Date.now() - 2 * day).toISOString() } })).status, 400);
  assert.equal((await api("POST", "/api/bookings", { token: s.entryToken, body: { ...body, expectedAt: new Date(Date.now() + 60 * day).toISOString() } })).status, 400);

  const made = await api("POST", "/api/bookings", { token: s.entryToken, body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.vehicleNumber, "RJ14BK0001");
  assert.equal(made.body.data.status, "BOOKED");
  s.booking = made.body.data;
  assert.equal((await api("POST", "/api/bookings", { token: s.entryToken, body })).status, 409);
  // A vehicle that is already inside cannot be booked.
  assert.equal((await api("POST", "/api/bookings", { token: s.entryToken, body: { ...body, vehicleNumber: "RJ14OP0001" } })).status, 409);

  const list = await api("GET", `/api/bookings?locationId=${s.loc._id}`, { token: s.exitToken });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.bookings.length, 1);
  assert.equal((await api("GET", "/api/bookings", { token: s.b.token })).body.data.bookings.length, 0);
});

it("bookings: the entry of a booked vehicle marks it as arrived and says who is coming", async () => {
  const entry = await enter("RJ14BK0001", {}, "CAR", s.entryToken);
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal(entry.body.data.booking.customerName, "Asha");
  const booking = await Booking.findById(s.booking._id);
  assert.equal(booking.status, "ARRIVED");
  assert.equal(String(booking.sessionId), entry.body.data.session._id);
  const waiting = await api("GET", "/api/bookings", { token: s.a.token });
  assert.equal(waiting.body.data.bookings.length, 0);
  const all = await api("GET", "/api/bookings?status=all", { token: s.a.token });
  assert.equal(all.body.data.bookings.length, 1);
  // An entry with no booking has no booking in the answer.
  const plain = await enter("RJ14BK0009", {}, "BIKE", s.entryToken);
  assert.equal(plain.body.data.booking, undefined);
});

it("bookings: cancel once, other companies cannot touch them, old ones expire", async () => {
  const made = await api("POST", "/api/bookings", {
    token: s.entryToken, body: { locationId: s.loc._id, vehicleNumber: "RJ14BK0002", vehicleType: "BIKE" },
  });
  const id = made.body.data._id;
  assert.equal((await api("POST", `/api/bookings/${id}/cancel`, { token: s.b.token, body: {} })).status, 404);
  assert.equal((await api("POST", `/api/bookings/${id}/cancel`, { token: s.exitToken, body: {} })).status, 403);
  const cancelled = await api("POST", `/api/bookings/${id}/cancel`, { token: s.entryToken, body: { reason: "Customer called" } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "CANCELLED");
  assert.equal((await api("POST", `/api/bookings/${id}/cancel`, { token: s.entryToken, body: {} })).status, 409);
  // After a cancel the vehicle can be booked again.
  const again = await api("POST", "/api/bookings", {
    token: s.entryToken, body: { locationId: s.loc._id, vehicleNumber: "RJ14BK0002", vehicleType: "BIKE" },
  });
  assert.equal(again.status, 201);

  await Booking.updateOne({ _id: again.body.data._id }, { $set: { expectedAt: new Date(Date.now() - 13 * 3600 * 1000), holdUntil: new Date(Date.now() - 1 * 3600 * 1000) } });
  const list = await api("GET", "/api/bookings", { token: s.a.token });
  assert.equal(list.body.data.bookings.length, 0);
  assert.equal((await Booking.findById(again.body.data._id)).status, "EXPIRED");
});
