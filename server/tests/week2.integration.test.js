// API tests for Week 2: location details, slots, vehicles, tariffs, fee
// preview and operators. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, withCode, assert } = require("./helpers");

setup();

const s = {};
const ist = (text) => new Date(`${text}:00+05:30`).toISOString();
const parking = (name) => ({ name, address: { line1: "MG Road", city: "Jaipur" }, capacity: { car: 100, bike: 50 } });

it("setup: two companies, locations and staff", async () => {
  s.a = await registerCompany("w2a");
  s.b = await registerCompany("w2b");

  const loc1 = await api("POST", "/api/locations", { token: s.a.token, body: parking("Mall Parking") });
  const loc2 = await api("POST", "/api/locations", { token: s.a.token, body: parking("Airport Parking") });
  assert.equal(loc1.status, 201, JSON.stringify(loc1.body));
  assert.equal(loc2.status, 201);
  s.loc1 = loc1.body.data;
  s.loc2 = loc2.body.data;

  const locAdmin = await api("POST", "/api/users", {
    token: s.a.token,
    body: { name: "Loc Admin", email: "w2-locadmin@example.com", password: "Password123", role: "LOCATION_ADMIN", locationIds: [s.loc1._id] },
  });
  assert.equal(locAdmin.status, 201, JSON.stringify(locAdmin.body));
  s.locAdminToken = await login("w2-locadmin@example.com");
});

it("location details: hours, gates, zones and coordinates can be edited", async () => {
  const res = await api("PUT", `/api/locations/${s.loc1._id}`, {
    token: s.a.token,
    body: {
      operatingHours: { is24x7: false, open: "08:00", close: "22:30" },
      gates: [{ name: "Gate 1", type: "ENTRY" }, { name: "Gate 2", type: "EXIT" }],
      zones: ["Basement 1", "Basement 2"],
      vehicleTypes: ["CAR", "BIKE", "HEAVY"],
      coordinates: { lat: 26.9124, lng: 75.7873 },
      contact: { name: "Site Manager", phone: "9999999999" },
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.operatingHours.close, "22:30");
  assert.equal(res.body.data.gates.length, 2);
  assert.deepEqual(res.body.data.zones, ["Basement 1", "Basement 2"]);
  assert.equal(res.body.data.address.city, "Jaipur"); // untouched

  const bad = await api("PUT", `/api/locations/${s.loc1._id}`, {
    token: s.a.token, body: { operatingHours: { open: "25:00" } },
  });
  assert.equal(bad.status, 400);
});

it("slots: bulk create, skip duplicates, update, delete", async () => {
  const body = { locationId: s.loc1._id, prefix: "a", count: 10, zone: "Basement 1", type: "NORMAL" };
  const first = await api("POST", "/api/slots/bulk", { token: s.a.token, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.created, 10);

  const again = await api("POST", "/api/slots/bulk", { token: s.a.token, body: { ...body, count: 12 } });
  assert.equal(again.body.data.created, 2);
  assert.equal(again.body.data.skipped.length, 10);

  const single = await api("POST", "/api/slots", {
    token: s.a.token, body: { locationId: s.loc1._id, code: "ev-1", type: "EV" },
  });
  assert.equal(single.status, 201);
  assert.equal(single.body.data.code, "EV-1");
  const duplicate = await api("POST", "/api/slots", { token: s.a.token, body: { locationId: s.loc1._id, code: "EV-1" } });
  assert.equal(duplicate.status, 409);

  const list = await api("GET", `/api/slots?locationId=${s.loc1._id}`, { token: s.a.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.summary.total, 13);
  assert.equal(list.body.data.summary.FREE, 13);
  assert.equal(list.body.data.slots[0].code, "A01");
  const slot = list.body.data.slots[0];

  const maintenance = await api("PUT", `/api/slots/${slot._id}`, { token: s.a.token, body: { status: "MAINTENANCE", type: "VIP" } });
  assert.equal(maintenance.status, 200);
  assert.equal(maintenance.body.data.status, "MAINTENANCE");
  assert.equal(maintenance.body.data.type, "VIP");

  // OCCUPIED can only be set by entry/exit.
  assert.equal((await api("PUT", `/api/slots/${slot._id}`, { token: s.a.token, body: { status: "OCCUPIED" } })).status, 400);

  assert.equal((await api("DELETE", `/api/slots/${slot._id}`, { token: s.a.token })).status, 200);
  const after = await api("GET", `/api/slots?locationId=${s.loc1._id}`, { token: s.a.token });
  assert.equal(after.body.data.summary.total, 12);

  assert.equal((await api("GET", "/api/slots", { token: s.a.token })).status, 400);
  s.slot = after.body.data.slots[0];
});

it("slots: tenant and location isolation", async () => {
  assert.equal((await api("GET", `/api/slots?locationId=${s.loc1._id}`, { token: s.b.token })).status, 404);
  assert.equal(
    (await api("POST", "/api/slots", { token: s.b.token, body: { locationId: s.loc1._id, code: "X1" } })).status,
    404
  );
  assert.equal((await api("PUT", `/api/slots/${s.slot._id}`, { token: s.b.token, body: { zone: "Hacked" } })).status, 404);
  assert.equal((await api("DELETE", `/api/slots/${s.slot._id}`, { token: s.b.token })).status, 404);

  // Location admin of loc1 cannot touch loc2.
  assert.equal(
    (await api("POST", "/api/slots", { token: s.locAdminToken, body: { locationId: s.loc2._id, code: "X1" } })).status,
    404
  );
  assert.equal(
    (await api("POST", "/api/slots", { token: s.locAdminToken, body: { locationId: s.loc1._id, code: "X1" } })).status,
    201
  );
});

it("vehicles: create, normalise, search, block and unblock", async () => {
  const create = await api("POST", "/api/vehicles", {
    token: s.a.token, body: { plateNumber: "rj14 ab-1234", type: "CAR", ownerName: "Ravi", phone: "9876543210" },
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.data.plateNumber, "RJ14AB1234");
  s.vehicle = create.body.data;

  assert.equal((await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "RJ14AB1234" } })).status, 409);
  assert.equal((await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "!!" } })).status, 400);
  await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "DL01XY9999", type: "BIKE" } });

  const byPlate = await api("GET", "/api/vehicles?q=rj14 ab", { token: s.a.token });
  assert.deepEqual(byPlate.body.data.vehicles.map((v) => v.plateNumber), ["RJ14AB1234"]);
  const byPhone = await api("GET", "/api/vehicles?q=9876543210", { token: s.a.token });
  assert.equal(byPhone.body.data.total, 1);
  // Regex characters in the search are treated as plain text.
  const weird = await api("GET", `/api/vehicles?q=${encodeURIComponent(".*")}`, { token: s.a.token });
  assert.equal(weird.status, 200);
  assert.equal(weird.body.data.total, 0);
  assert.equal((await api("GET", "/api/vehicles", { token: s.a.token })).body.data.total, 2);

  const path = `/api/vehicles/${s.vehicle._id}`;
  assert.equal((await api("PUT", path, { token: s.a.token, body: { isBlocked: true } })).status, 400);
  const blocked = await api("PUT", path, { token: s.a.token, body: { isBlocked: true, blockedReason: "Unpaid dues" } });
  assert.equal(blocked.body.data.isBlocked, true);
  assert.equal((await api("GET", "/api/vehicles?blocked=true", { token: s.a.token })).body.data.total, 1);
  const unblocked = await api("PUT", path, { token: s.a.token, body: { isBlocked: false } });
  assert.equal(unblocked.body.data.isBlocked, false);
  assert.equal(unblocked.body.data.blockedReason, undefined);

  // Other company: sees nothing, cannot edit, and may register the same number.
  assert.equal((await api("GET", "/api/vehicles", { token: s.b.token })).body.data.total, 0);
  assert.equal((await api("GET", path, { token: s.b.token })).status, 404);
  assert.equal((await api("PUT", path, { token: s.b.token, body: { ownerName: "Hacked" } })).status, 404);
  assert.equal((await api("POST", "/api/vehicles", { token: s.b.token, body: { plateNumber: "RJ14AB1234" } })).status, 201);
});

const carTariff = (locationId, extra = {}) => ({
  locationId, name: "Car standard", vehicleType: "CAR", gracePeriodMinutes: 10,
  slabs: [{ uptoMinutes: 180, rate: 50 }, { uptoMinutes: 60, rate: 20 }],
  additionalPerHour: 20, maxDailyFee: 100, lostTicketFee: 200,
  taxPercent: 18, taxInclusive: true, ...extra,
});

it("tariffs: create, validate and update", async () => {
  const create = await api("POST", "/api/tariffs", { token: s.a.token, body: carTariff(s.loc1._id) });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  s.tariff = create.body.data;
  assert.deepEqual(s.tariff.slabs.map((x) => x.uptoMinutes), [60, 180]); // sorted
  assert.equal(s.tariff.companyId, s.a.company._id);

  const badSlabs = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: carTariff(s.loc1._id, { slabs: [{ uptoMinutes: 60, rate: 50 }, { uptoMinutes: 120, rate: 20 }] }),
  });
  assert.equal(badSlabs.status, 400);
  const empty = await api("POST", "/api/tariffs", {
    token: s.a.token, body: { locationId: s.loc1._id, name: "Empty", vehicleType: "CAR" },
  });
  assert.equal(empty.status, 400);
  const negative = await api("POST", "/api/tariffs", {
    token: s.a.token, body: carTariff(s.loc1._id, { additionalPerHour: -5 }),
  });
  assert.equal(negative.status, 400);

  const update = await api("PUT", `/api/tariffs/${s.tariff._id}`, {
    token: s.a.token, body: { name: "Car standard 2026", maxDailyFee: null, minimumFee: 10 },
  });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  assert.equal(update.body.data.name, "Car standard 2026");
  assert.equal(update.body.data.maxDailyFee, undefined); // cleared
  assert.equal(update.body.data.minimumFee, 10);
  assert.equal(update.body.data.lostTicketFee, 200); // untouched

  const list = await api("GET", `/api/tariffs?locationId=${s.loc1._id}&vehicleType=CAR`, { token: s.a.token });
  assert.equal(list.body.data.length, 1);
});

it("fee preview uses the fee engine and picks the right tariff", async () => {
  const preview = (body, token = s.a.token) =>
    api("POST", "/api/tariffs/preview", { token, body: { locationId: s.loc1._id, vehicleType: "CAR", ...body } });

  // Monday 2 March 2026.
  const twoHours = await preview({ entryTime: ist("2026-03-02T10:00"), exitTime: ist("2026-03-02T12:00") });
  assert.equal(twoHours.status, 200, JSON.stringify(twoHours.body));
  assert.equal(twoHours.body.data.fee.total, 50);
  assert.equal(twoHours.body.data.fee.tax, 7.63);
  assert.equal(twoHours.body.data.tariff.name, "Car standard 2026");

  const grace = await preview({ entryTime: ist("2026-03-02T10:00"), exitTime: ist("2026-03-02T10:08") });
  assert.equal(grace.body.data.fee.total, 0);
  assert.equal(grace.body.data.fee.reason, "GRACE_PERIOD");

  const lost = await preview({ entryTime: ist("2026-03-02T10:00"), exitTime: ist("2026-03-02T12:00"), lostTicket: true });
  assert.equal(lost.body.data.fee.total, 250);

  // A weekend tariff takes over on Saturday and Sunday only.
  const weekend = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc1._id, name: "Car weekend", vehicleType: "CAR", additionalPerHour: 40, daysOfWeek: [0, 6] },
  });
  assert.equal(weekend.status, 201);
  const sunday = await preview({ entryTime: ist("2026-03-08T10:00"), exitTime: ist("2026-03-08T12:00") });
  assert.equal(sunday.body.data.tariff.name, "Car weekend");
  assert.equal(sunday.body.data.fee.total, 80);
  const monday = await preview({ entryTime: ist("2026-03-09T10:00"), exitTime: ist("2026-03-09T12:00") });
  assert.equal(monday.body.data.tariff.name, "Car standard 2026");

  const backwards = await preview({ entryTime: ist("2026-03-02T12:00"), exitTime: ist("2026-03-02T10:00") });
  assert.equal(backwards.status, 400);
  const noTariff = await api("POST", "/api/tariffs/preview", {
    token: s.a.token,
    body: { locationId: s.loc1._id, vehicleType: "BIKE", entryTime: ist("2026-03-02T10:00"), exitTime: ist("2026-03-02T12:00") },
  });
  assert.equal(noTariff.status, 409);
});

it("tariffs: tenant and location isolation, deactivation", async () => {
  const path = `/api/tariffs/${s.tariff._id}`;
  assert.equal((await api("GET", "/api/tariffs", { token: s.b.token })).body.data.length, 0);
  assert.equal((await api("GET", path, { token: s.b.token })).status, 404);
  assert.equal((await api("PUT", path, { token: s.b.token, body: { name: "Hacked" } })).status, 404);
  assert.equal((await api("DELETE", path, { token: s.b.token })).status, 404);
  assert.equal((await api("POST", "/api/tariffs", { token: s.b.token, body: carTariff(s.loc1._id) })).status, 404);

  // Location admin: own location yes, other location no.
  assert.equal((await api("POST", "/api/tariffs", { token: s.locAdminToken, body: carTariff(s.loc2._id) })).status, 404);
  const own = await api("POST", "/api/tariffs", {
    token: s.locAdminToken, body: carTariff(s.loc1._id, { name: "Bike standard", vehicleType: "BIKE" }),
  });
  assert.equal(own.status, 201, JSON.stringify(own.body));
  const loc2Tariff = await api("POST", "/api/tariffs", { token: s.a.token, body: carTariff(s.loc2._id) });
  assert.equal((await api("GET", `/api/tariffs/${loc2Tariff.body.data._id}`, { token: s.locAdminToken })).status, 404);
  const visible = await api("GET", "/api/tariffs", { token: s.locAdminToken });
  assert.ok(visible.body.data.every((t) => t.locationId === s.loc1._id));

  const off = await api("DELETE", `/api/tariffs/${own.body.data._id}`, { token: s.a.token });
  assert.equal(off.body.data.isActive, false);
  const preview = await api("POST", "/api/tariffs/preview", {
    token: s.a.token,
    body: { locationId: s.loc1._id, vehicleType: "BIKE", entryTime: ist("2026-03-02T10:00"), exitTime: ist("2026-03-02T12:00") },
  });
  assert.equal(preview.status, 409); // the only bike tariff is switched off
});

it("operators: profile, shift, reassignment and access reset", async () => {
  const create = await api("POST", "/api/users", {
    token: s.a.token,
    body: {
      name: "Entry Op", email: "w2-entry@example.com", password: "Password123",
      role: "ENTRY_OPERATOR", locationIds: [s.loc1._id],
      operator: { employeeCode: "EMP-001", shift: { name: "Morning", start: "06:00", end: "14:00" } },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.data.operator.employeeCode, "EMP-001");
  assert.equal(create.body.data.operator.shift.start, "06:00");
  assert.equal(create.body.data.password, undefined);
  s.op = create.body.data;

  const opToken = await login("w2-entry@example.com");

  // What an entry operator can and cannot do.
  assert.equal((await api("GET", "/api/vehicles?q=RJ14", { token: opToken })).status, 200);
  assert.equal((await api("GET", `/api/slots?locationId=${s.loc1._id}`, { token: opToken })).status, 200);
  assert.equal((await api("GET", `/api/slots?locationId=${s.loc2._id}`, { token: opToken })).status, 404);
  assert.equal((await api("GET", "/api/tariffs", { token: opToken })).status, 403);
  assert.equal((await api("POST", "/api/vehicles", { token: opToken, body: { plateNumber: "MH01AA0001" } })).status, 403);
  assert.equal((await api("POST", "/api/slots", { token: opToken, body: { locationId: s.loc1._id, code: "Z1" } })).status, 403);

  // Change shift only: the profile is merged and the session stays valid.
  const shift = await api("PUT", `/api/users/${s.op._id}`, {
    token: s.a.token, body: { operator: { shift: { name: "Evening", start: "14:00", end: "22:00" } } },
  });
  assert.equal(shift.status, 200, JSON.stringify(shift.body));
  assert.equal(shift.body.data.operator.shift.name, "Evening");
  assert.equal(shift.body.data.operator.employeeCode, "EMP-001");
  assert.equal((await api("GET", "/api/auth/me", { token: opToken })).status, 200);

  const list = await api("GET", "/api/users", { token: s.a.token });
  const listed = list.body.data.find((u) => u._id === s.op._id);
  assert.equal(listed.operator.shift.end, "22:00");
  assert.equal(list.body.data.find((u) => u.role === "LOCATION_ADMIN").operator, null);

  // Reassign to the other location: old session ends, new one sees loc2 only.
  const move = await api("PUT", `/api/users/${s.op._id}`, {
    token: s.a.token, body: { role: "EXIT_OPERATOR", locationIds: [s.loc2._id] },
  });
  assert.equal(move.body.data.role, "EXIT_OPERATOR");
  assert.equal((await api("GET", "/api/auth/me", { token: opToken })).status, 401);
  const movedToken = await login("w2-entry@example.com");
  const visible = await api("GET", "/api/locations", { token: movedToken });
  assert.deepEqual(visible.body.data.map((l) => l._id), [s.loc2._id]);

  // Reset access: new password works, old one does not.
  const reset = await api("PUT", `/api/users/${s.op._id}`, { token: s.a.token, body: { password: "NewPassword456" } });
  assert.equal(reset.status, 200);
  assert.equal((await api("GET", "/api/auth/me", { token: movedToken })).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { body: await withCode({ email: "w2-entry@example.com", password: "Password123" }) })).status, 401);
  await login("w2-entry@example.com", "NewPassword456");

  // Deactivate and reactivate.
  await api("PUT", `/api/users/${s.op._id}`, { token: s.a.token, body: { isActive: false } });
  assert.equal((await api("POST", "/api/auth/login", { body: await withCode({ email: "w2-entry@example.com", password: "NewPassword456" }) })).status, 403);
  await api("PUT", `/api/users/${s.op._id}`, { token: s.a.token, body: { isActive: true } });
  await login("w2-entry@example.com", "NewPassword456");

  // The other company cannot see or edit this operator.
  assert.equal((await api("PUT", `/api/users/${s.op._id}`, { token: s.b.token, body: { operator: { employeeCode: "X" } } })).status, 404);
});

it("week 2 flow: company -> location -> capacity -> vehicle -> tariff -> operator", async () => {
  const onboarding = await api("GET", `/api/companies/${s.a.company._id}/onboarding`, { token: s.a.token });
  const done = Object.fromEntries(onboarding.body.data.steps.map((step) => [step.key, step.done]));
  assert.equal(done.location, true);
  assert.equal(done.capacity, true);
  assert.equal(done.tariff, true);
  assert.equal(done.operators, true);
});
