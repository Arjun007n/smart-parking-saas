// The government officer: a separate login, and reports of vehicles that entered and left, with no money and
// nothing else reachable. Needs MongoDB.
const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");

setup();

const s = {};
const officerLogin = (body) => api("POST", "/api/auth/login", { body: { companyCode: s.a.company.code, ...body } });
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const report = (path, token = s.officer) => api("GET", `/api/government${path}`, { token });

it("setup: a company with two locations, vehicles that came in and left, and an officer for one location", async () => {
  s.a = await registerCompany("gv");
  const place = async (name) => {
    const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20, bike: 20 }, vehicleTypes: ["CAR", "BIKE"] } });
    assert.equal(loc.status, 201, JSON.stringify(loc.body));
    for (const vehicleType of ["CAR", "BIKE"]) {
      const tariff = await api("POST", "/api/tariffs", { token: s.a.token, body: { locationId: loc.body.data._id, name: vehicleType, vehicleType, gracePeriodMinutes: 60, additionalPerHour: 10 } });
      assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
    }
    return loc.body.data;
  };
  s.l1 = await place("Mall");
  s.l2 = await place("Airport");

  const gate = await api("POST", "/api/users", { token: s.a.token, body: { name: "Gate", email: "gv-gate@example.com", password: "Password123", role: "GATE_OPERATOR", locationIds: [s.l1._id, s.l2._id] } });
  assert.equal(gate.status, 201, JSON.stringify(gate.body));
  s.gate = await login("gv-gate@example.com");

  const enter = (locationId, vehicleNumber, vehicleType = "CAR") =>
    api("POST", "/api/parking/entry", { token: s.gate, body: { locationId, vehicleNumber, vehicleType } });
  // Mall: two cars and a bike come in, one car leaves. Airport: one car comes in.
  const a = await enter(s.l1._id, "MP09GV0001");
  const b = await enter(s.l1._id, "MP09GV0002");
  const c = await enter(s.l1._id, "MP09GV0003", "BIKE");
  const d = await enter(s.l2._id, "MP09GV0004");
  for (const r of [a, b, c, d]) assert.equal(r.status, 201, JSON.stringify(r.body));
  const out = await api("POST", "/api/parking/exit", { token: s.gate, body: { locationId: s.l1._id, ticketNumber: a.body.data.session.ticketNumber } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  // A ticket that was cancelled never parked: it counts as neither.
  const cancelled = await enter(s.l1._id, "MP09GV0005");
  const cancel = await api("POST", `/api/parking/sessions/${cancelled.body.data.session._id}/cancel`, { token: s.a.token, body: { reason: "wrong plate typed" } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
});

it("an admin adds an officer: locations are required, and no seat is used", async () => {
  const body = { name: "Officer One", loginId: "gov1", password: "Password123", role: "GOVERNMENT_OFFICER" };
  assert.equal((await api("POST", "/api/users", { token: s.a.token, body })).status, 400, "an officer without locations is refused");
  const made = await api("POST", "/api/users", { token: s.a.token, body: { ...body, locationIds: [s.l1._id] } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.role, "GOVERNMENT_OFFICER");
  // The gate operator cannot add one.
  assert.equal((await api("POST", "/api/users", { token: s.gate, body: { ...body, loginId: "gov2", locationIds: [s.l1._id] } })).status, 403);
  // A licence of one seat at the Mall is already full with nobody else: the officer still fits.
  const licences = await api("GET", "/api/users/licences", { token: s.a.token });
  const mall = licences.body.data.locations.find((l) => l.name === "Mall");
  assert.equal(mall.used, 1, "only the gate operator takes a seat");
});

it("login: officers use the Government page only, and nobody else may use it", async () => {
  const plain = await officerLogin({ loginId: "gov1", password: "Password123" });
  assert.equal(plain.status, 403, JSON.stringify(plain.body));
  assert.match(plain.body.message, /Government login page/);
  const wrong = await officerLogin({ loginId: "gov1", password: "Wrong-password1", portal: "government" });
  assert.equal(wrong.status, 401);
  const ok = await officerLogin({ loginId: "gov1", password: "Password123", portal: "government" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.user.role, "GOVERNMENT_OFFICER");
  assert.deepEqual(ok.body.data.permissions, ["GOVERNMENT_REPORT"]);
  s.officer = ok.body.data.token;
  // An admin or an operator cannot sign in on the Government page.
  const admin = await api("POST", "/api/auth/login", { body: { companyCode: s.a.company.code, email: "admin-gv@example.com", password: "Password123", portal: "government" } });
  assert.equal(admin.status, 401, JSON.stringify(admin.body));
});

it("summary: the entries and exits of the officer's location only, with no money", async () => {
  const res = await report(`/summary?from=${today()}&to=${today()}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.deepEqual(d.locations.map((l) => l.name), ["Mall"], "the Airport is not theirs");
  assert.equal(d.totals.entries, 3, "three vehicles came in at the Mall (the cancelled ticket does not count)");
  assert.equal(d.totals.exits, 1);
  assert.equal(d.totals.inside, 2);
  assert.equal(d.byDay.length, 1);
  assert.deepEqual({ entries: d.byDay[0].entries, exits: d.byDay[0].exits }, { entries: 3, exits: 1 });
  const car = d.byType.find((t) => t.type === "CAR");
  const bike = d.byType.find((t) => t.type === "BIKE");
  assert.deepEqual({ e: car.entries, x: car.exits, i: car.inside }, { e: 2, x: 1, i: 1 });
  assert.deepEqual({ e: bike.entries, x: bike.exits, i: bike.inside }, { e: 1, x: 0, i: 1 });
  assert.equal(d.byLocation.length, 1);
  assert.doesNotMatch(JSON.stringify(res.body), /amount|fee|paid|cash|payable|revenue/i, "no money in the answer");
  const places = await report(`/locations?locationId=${s.l2._id}`);
  assert.deepEqual(places.body.data.map((l) => l.name), ["Mall"], "the location list is only theirs, whatever is asked");
  // Asking for the other location by id is refused.
  assert.equal((await report(`/summary?locationId=${s.l2._id}`)).status, 404);
  // A period that is too long or the wrong way round.
  assert.equal((await report("/summary?from=2020-01-01&to=2026-12-31")).status, 400);
  assert.equal((await report("/summary?from=2026-03-05&to=2026-03-01")).status, 400);
});

it("movements: entries and exits with vehicle numbers, search, paging and a file", async () => {
  const all = await report(`/movements?from=${today()}&to=${today()}`);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.data.total, 4, "three entries and one exit");
  const rows = all.body.data.movements;
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.vehicleNumber.startsWith("MP09GV") && r.locationName === "Mall"));
  assert.ok(rows.every((r) => !("fee" in r) && !("amount" in r) && !("payable" in r)));
  assert.equal(rows.filter((r) => r.direction === "EXIT").length, 1);
  assert.ok(!rows.some((r) => r.vehicleNumber === "MP09GV0004"), "the Airport car is not shown");
  assert.ok(!rows.some((r) => r.vehicleNumber === "MP09GV0005"), "the cancelled ticket is not shown");

  const exits = await report(`/movements?from=${today()}&to=${today()}&direction=EXIT`);
  assert.equal(exits.body.data.total, 1);
  assert.equal(exits.body.data.movements[0].vehicleNumber, "MP09GV0001");
  const bikes = await report(`/movements?from=${today()}&to=${today()}&vehicleType=BIKE`);
  assert.equal(bikes.body.data.total, 1);
  const found = await report(`/movements?from=${today()}&to=${today()}&q=gv0002`);
  assert.equal(found.body.data.total, 1);
  const page = await report(`/movements?from=${today()}&to=${today()}&pageSize=10&page=1`);
  assert.equal(page.body.data.pageSize, 10);
  assert.equal((await report("/movements?direction=SIDEWAYS")).status, 400);

  const csv = await bytes("GET", `/api/government/movements?from=${today()}&to=${today()}&format=csv`, { token: s.officer });
  assert.equal(csv.status, 200);
  const text = csv.buffer.toString("utf8");
  assert.match(text, /MP09GV0002/);
  assert.doesNotMatch(text, /MP09GV0004/);
  const pdf = await bytes("GET", `/api/government/movements?from=${today()}&to=${today()}&format=pdf`, { token: s.officer });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.slice(0, 4).toString(), "%PDF");
});

it("an officer can reach nothing but the government reports and their own account", async () => {
  const closed = [
    ["GET", "/api/locations"], ["GET", "/api/parking/entries"], ["GET", "/api/operator/summary"], ["GET", "/api/operator/entries"],
    ["GET", "/api/reports/revenue"], ["GET", "/api/dashboard"], ["GET", "/api/users"], ["GET", "/api/vehicles"], ["GET", "/api/passes"],
    ["GET", "/api/payments"], ["GET", "/api/audit-logs"], ["GET", "/api/hardware"], ["GET", "/api/live"],
    ["POST", "/api/parking/entry"], ["POST", "/api/parking/exit"],
  ];
  for (const [method, path] of closed) {
    const res = await api(method, path, { token: s.officer, ...(method === "POST" ? { body: {} } : {}) });
    assert.equal(res.status, 403, `${method} ${path} should be closed, got ${res.status}`);
  }
  // Their own account still works.
  const me = await api("GET", "/api/auth/me", { token: s.officer });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.role, "GOVERNMENT_OFFICER");
  // And others cannot read the officer's reports: an operator has no such permission.
  assert.equal((await api("GET", "/api/government/summary", { token: s.gate })).status, 403);
});

it("an admin can switch an officer off, and the session ends", async () => {
  const list = await api("GET", "/api/users", { token: s.a.token });
  const officer = list.body.data.find((u) => u.loginId === "gov1");
  const off = await api("PUT", `/api/users/${officer._id}`, { token: s.a.token, body: { isActive: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal((await report(`/summary`)).status, 401);
  assert.equal((await officerLogin({ loginId: "gov1", password: "Password123", portal: "government" })).status, 403);
});
