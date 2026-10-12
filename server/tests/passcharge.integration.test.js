// The Pass Charges table through the API: set a rate, see the total for dates, change and remove it. Needs MongoDB.
const { setup, it, api, registerCompany, login, assert } = require("./helpers");

setup();

const s = {};

it("setup: a company, a location and a gate operator", async () => {
  s.a = await registerCompany("pcharge");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Mall", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const made = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Gate In", email: "pcharge-in@example.com", password: "Password123", role: "ENTRY_OPERATOR", locationIds: [s.loc._id] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.entry = await login("pcharge-in@example.com");
});

it("a rate is saved once per location and vehicle type, and listed", async () => {
  const body = { locationId: s.loc._id, vehicleType: "CAR", monthlyRate: 1500, dailyRate: 60 };
  assert.equal((await api("POST", "/api/pass-charges", { token: s.a.token, body })).status, 201);
  // The same location and vehicle again changes the rate, it does not add a second row.
  assert.equal((await api("POST", "/api/pass-charges", { token: s.a.token, body: { ...body, monthlyRate: 1600 } })).status, 201);
  assert.equal((await api("POST", "/api/pass-charges", { token: s.a.token, body: { ...body, vehicleType: "BIKE", monthlyRate: 500, dailyRate: 20 } })).status, 201);
  const list = await api("GET", "/api/pass-charges", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.charges.length, 2);
  const car = list.body.data.charges.find((c) => c.vehicleType === "CAR");
  assert.equal(car.monthlyRate, 1600);
  assert.equal(car.locationName, "Mall");
  s.carRate = car;
  // Bad rates are refused.
  assert.equal((await api("POST", "/api/pass-charges", { token: s.a.token, body: { ...body, dailyRate: -1 } })).status, 400);
  assert.equal((await api("POST", "/api/pass-charges", { token: s.a.token, body: { ...body, vehicleType: "SPACESHIP" } })).status, 400);
});

it("the total is worked out from the dates", async () => {
  const q = (extra) => api("GET", `/api/pass-charges/quote?locationId=${s.loc._id}&vehicleType=CAR&startDate=2026-10-01&endDate=2026-10-31${extra || ""}`, { token: s.a.token });
  const month = await q();
  assert.equal(month.status, 200, JSON.stringify(month.body));
  assert.deepEqual([month.body.data.months, month.body.data.days, month.body.data.amount], [1, 0, 1600]);
  const longer = await api("GET", `/api/pass-charges/quote?locationId=${s.loc._id}&vehicleType=CAR&startDate=2026-10-01&endDate=2026-12-10`, { token: s.a.token });
  assert.equal(longer.body.data.amount, 2 * 1600 + 10 * 60);
  // No rate for a vehicle type that has none.
  const none = await api("GET", `/api/pass-charges/quote?locationId=${s.loc._id}&vehicleType=HEAVY&startDate=2026-10-01&endDate=2026-10-31`, { token: s.a.token });
  assert.equal(none.body.data.found, false);
  // Missing or wrong dates.
  assert.equal((await api("GET", `/api/pass-charges/quote?locationId=${s.loc._id}&vehicleType=CAR&startDate=2026-10-31&endDate=2026-10-01`, { token: s.a.token })).status, 400);
  assert.equal((await api("GET", `/api/pass-charges/quote?locationId=${s.loc._id}&vehicleType=CAR&startDate=bad&endDate=2026-10-01`, { token: s.a.token })).status, 400);
});

it("only people who manage passes can see or change the table; a rate can be removed", async () => {
  assert.equal((await api("GET", "/api/pass-charges", { token: s.entry })).status, 403);
  assert.equal((await api("POST", "/api/pass-charges", { token: s.entry, body: { locationId: s.loc._id, vehicleType: "CAR", monthlyRate: 1, dailyRate: 1 } })).status, 403);
  assert.equal((await api("DELETE", `/api/pass-charges/${s.carRate._id}`, { token: s.entry })).status, 403);
  assert.equal((await api("DELETE", `/api/pass-charges/${s.carRate._id}`, { token: s.a.token })).status, 200);
  const list = await api("GET", "/api/pass-charges", { token: s.a.token });
  assert.equal(list.body.data.charges.length, 1);
});
