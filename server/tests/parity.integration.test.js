// FASTag and online transactions, vehicle-type collection, pass users, bulk pass upload, the company's pass GST
// rate and the booking waiting and cancel settings, through the API. Needs MongoDB.
process.env.PUBLIC_BOOKING_RATE_MAX = "1000";
const { setup, it, api, bytes, registerCompany, assert } = require("./helpers");
const Booking = require("../models/Booking");
const AuditLog = require("../models/AuditLog");
const { todayText } = require("./reportDates");

setup();

const s = {};
const range = () => { const d = todayText(0); return `from=${d.from}&to=${d.to}`; };
const row = (extra = {}) => ({ holderName: "Ravi Kumar", phone: "9876500001", vehicleNumber: "MP09AA1001", vehicleType: "CAR", amount: "1000", method: "CASH", ...extra });

it("setup: a company with one location", async () => {
  s.a = await registerCompany("par");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Hub", address: { line1: "MG Road" }, capacity: { car: 20, bike: 10 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
});

it("transactions: FASTag and online, with a status filter, tiles and a daily view", async () => {
  for (const kind of ["fastag", "online"]) {
    const res = await api("GET", `/api/reports/transactions?kind=${kind}&${range()}`, { token: s.a.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.rows, []);
    assert.equal(res.body.data.tiles.accepted, 0);
    assert.ok(res.body.data.columns.some((c) => c.key === "reference"));
    assert.equal((await api("GET", `/api/reports/transactions?kind=${kind}&view=daily&${range()}`, { token: s.a.token })).status, 200);
    assert.equal((await api("GET", `/api/reports/transactions?kind=${kind}&status=SUCCESS&${range()}`, { token: s.a.token })).status, 200);
    assert.equal((await bytes("GET", `/api/reports/transactions?kind=${kind}&format=xlsx&${range()}`, { token: s.a.token })).status, 200);
  }
  assert.equal((await api("GET", `/api/reports/transactions?kind=fastag&status=NOPE&${range()}`, { token: s.a.token })).status, 400);
  assert.equal((await api("GET", `/api/reports/transactions?kind=fastag&${range()}`)).status, 401);
});

it("operator collection: a vehicle type can be chosen", async () => {
  const all = await api("GET", `/api/reports/operator-collection?${range()}`, { token: s.a.token });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.data.vehicleType, null);
  assert.ok(all.body.data.columns.some((c) => c.key === "wallet"));
  const car = await api("GET", `/api/reports/operator-collection?vehicleType=CAR&${range()}`, { token: s.a.token });
  assert.equal(car.status, 200, JSON.stringify(car.body));
  assert.equal(car.body.data.vehicleType, "CAR");
});

it("company pass GST: set once, used on pass sales and shown on receipts", async () => {
  const set = await api("PUT", `/api/companies/${s.a.company._id}`, { token: s.a.token, body: { passGstPercent: 18 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.passGstPercent, 18);
  assert.equal((await api("PUT", `/api/companies/${s.a.company._id}`, { token: s.a.token, body: { passGstPercent: 150 } })).status, 400);
  const sold = await api("POST", "/api/passes", {
    token: s.a.token,
    body: { locationId: s.loc._id, vehicleNumber: "MP09GST001", vehicleType: "CAR", holderName: "Gst Check", unit: "MONTH", count: 1, amount: 118, method: "CASH" },
  });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  assert.equal(sold.body.data.payment.tax, 18);
  // A rate sent with the sale still wins.
  const explicit = await api("POST", "/api/passes", {
    token: s.a.token,
    body: { locationId: s.loc._id, vehicleNumber: "MP09GST002", vehicleType: "CAR", holderName: "Gst Two", unit: "MONTH", count: 1, amount: 100, method: "CASH", taxPercent: 0 },
  });
  assert.equal(explicit.body.data.payment.tax, 0);
});

it("bulk upload: each row is its own sale and fails alone with a reason", async () => {
  const company = await api("POST", "/api/pass-companies", { token: s.a.token, body: { name: "Acme Pvt Ltd" } });
  assert.equal(company.status, 201, JSON.stringify(company.body));
  const rows = [
    row({ company: "acme pvt ltd" }),
    row({ holderName: "Meena Shah", phone: "", vehicleNumber: "MP09AA1002", vehicleType: "BIKE", amount: "0", method: "" }),
    row({ vehicleNumber: "MP09AA1001" }),
    row({ vehicleNumber: "MP09AA1003", company: "No Such Firm" }),
    row({ vehicleNumber: "MP09AA1004", vehicleType: "PLANE" }),
    row({ vehicleNumber: "MP09AA1005", amount: "-5" }),
  ];
  const res = await api("POST", "/api/passes/bulk-upload", { token: s.a.token, body: { locationId: s.loc._id, rows } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.created, 2);
  assert.equal(res.body.data.failed, 4);
  const byRow = Object.fromEntries(res.body.data.results.map((r) => [r.row, r]));
  assert.equal(byRow[1].ok, true);
  assert.equal(byRow[2].ok, true);
  assert.match(byRow[3].error, /already has pass/);
  assert.match(byRow[4].error, /company master/);
  assert.match(byRow[5].error, /Vehicle type/);
  assert.match(byRow[6].error, /Amount/);
  assert.ok(await AuditLog.findOne({ action: "PASS_BULK_UPLOAD" }));

  assert.equal((await api("POST", "/api/passes/bulk-upload", { token: s.a.token, body: { locationId: s.loc._id, rows: [] } })).status, 400);
  assert.equal((await api("POST", "/api/passes/bulk-upload", { token: s.a.token, body: { locationId: s.loc._id, rows: Array.from({ length: 201 }, () => row()) } })).status, 400);
});

it("pass users: one per phone number, with company, vehicles and counts", async () => {
  const list = await api("GET", "/api/passes/users", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const ravi = list.body.data.rows.find((r) => r.holderName === "Ravi Kumar");
  assert.ok(ravi, JSON.stringify(list.body.data.rows));
  assert.equal(ravi.company, "Acme Pvt Ltd");
  assert.equal(ravi.vehicles, 1);
  assert.equal(ravi.passes, 1);
  assert.equal(ravi.active, 1);
  assert.equal((await api("GET", "/api/passes/users?q=meena", { token: s.a.token })).body.data.total, 1);
  const csv = await bytes("GET", "/api/passes/users?format=csv", { token: s.a.token });
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString(), /Pass user/);
  const summary = await api("GET", "/api/passes/summary", { token: s.a.token });
  assert.ok(summary.body.data.users >= 2);
  // Another company sees none of them; gate staff see nothing here.
  const other = await registerCompany("par2");
  assert.equal((await api("GET", "/api/passes/users", { token: other.token })).body.data.total, 0);
  const staff = await api("POST", "/api/users", { token: s.a.token, body: { name: "Gate", email: "par-gate@example.com", password: "Password123", role: "GATE_OPERATOR", locationIds: [s.loc._id] } });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
});

it("booking settings: a waiting time, and customers cancelling until a set time before arrival", async () => {
  const set = await api("PUT", `/api/locations/${s.loc._id}`, {
    token: s.a.token, body: { onlineBooking: { enabled: true, fees: { car: 0, bike: 0 }, waitingMinutes: 45, cancelBeforeMinutes: 30 } },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.onlineBooking.waitingMinutes, 45);
  assert.equal((await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { onlineBooking: { waitingMinutes: 2 } } })).status, 200, "tiny values mean the standard time");
  assert.equal((await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { onlineBooking: { waitingMinutes: 99999 } } })).status, 400);
  await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { onlineBooking: { waitingMinutes: 45 } } });

  const offer = await api("GET", `/api/public/booking/locations/${s.loc._id}`);
  assert.equal(offer.body.data.waitingMinutes, 45);
  assert.equal(offer.body.data.cancelBeforeMinutes, 30);

  const made = await api("POST", "/api/public/booking/bookings", {
    body: { locationId: s.loc._id, vehicleNumber: "RJ14PAR001", vehicleType: "CAR", customerName: "Asha Verma", phone: "9876543210", expectedAt: new Date(Date.now() + 3 * 3600000).toISOString() },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const { id } = made.body.data.booking;
  const token = encodeURIComponent(made.body.data.token);
  const stored = await Booking.findById(id);
  assert.equal(stored.holdUntil.getTime() - stored.expectedAt.getTime(), 45 * 60000, "the booking waits 45 minutes after its arrival time");
  assert.equal(made.body.data.booking.canCancel, true);

  const cancelled = await api("POST", `/api/public/booking/bookings/${id}/cancel?token=${token}`);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.booking.status, "CANCELLED");
  assert.equal((await api("POST", `/api/public/booking/bookings/${id}/cancel?token=${token}`)).status, 409, "only once");
  assert.equal((await api("POST", `/api/public/booking/bookings/${id}/cancel?token=wrong`)).status, 404, "a wrong link finds nothing");

  // Too close to the arrival time, or cancelling switched off.
  const soon = await api("POST", "/api/public/booking/bookings", {
    body: { locationId: s.loc._id, vehicleNumber: "RJ14PAR002", vehicleType: "CAR", customerName: "Asha Verma", phone: "9876543210", expectedAt: new Date(Date.now() + 10 * 60000).toISOString() },
  });
  assert.equal(soon.status, 201, JSON.stringify(soon.body));
  assert.equal(soon.body.data.booking.canCancel, false);
  assert.equal((await api("POST", `/api/public/booking/bookings/${soon.body.data.booking.id}/cancel?token=${encodeURIComponent(soon.body.data.token)}`)).status, 409);

  await api("PUT", `/api/locations/${s.loc._id}`, { token: s.a.token, body: { onlineBooking: { cancelBeforeMinutes: 0 } } });
  const later = await api("POST", "/api/public/booking/bookings", {
    body: { locationId: s.loc._id, vehicleNumber: "RJ14PAR003", vehicleType: "CAR", customerName: "Asha Verma", phone: "9876543210", expectedAt: new Date(Date.now() + 5 * 3600000).toISOString() },
  });
  assert.equal(later.body.data.booking.canCancel, false);
  assert.equal((await api("POST", `/api/public/booking/bookings/${later.body.data.booking.id}/cancel?token=${encodeURIComponent(later.body.data.token)}`)).status, 409);
});
