// What an admin can switch off for a person at the gate (reprint, entry / exit / total collection),
// and the Users table as a file. Needs MongoDB.
const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");

setup();

const s = {};
const money = (token) => api("GET", `/api/operator/collection?locationId=${s.loc._id}`, { token });

it("setup: a company with a location, two operators and a car inside", async () => {
  s.a = await registerCompany("ua");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Hub", address: { line1: "MG Road" }, capacity: { car: 10 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", { token: s.a.token, body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", additionalPerHour: 10 } });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const make = (email, access) =>
    api("POST", "/api/users", { token: s.a.token, body: { name: email, email, password: "Password123", role: "GATE_OPERATOR", locationIds: [s.loc._id], ...(access ? { access } : {}) } });
  const open = await make("ua-open@example.com");
  assert.equal(open.status, 201, JSON.stringify(open.body));
  const limited = await make("ua-limited@example.com", { reprint: false, showEntryCollection: false, showTotalCollection: false });
  assert.equal(limited.status, 201, JSON.stringify(limited.body));
  assert.equal(limited.body.data.access.reprint, false);
  s.limitedId = limited.body.data._id;
  s.open = await login("ua-open@example.com");
  s.limited = await login("ua-limited@example.com");
  const entry = await api("POST", "/api/parking/entry", { token: s.open, body: { locationId: s.loc._id, vehicleNumber: "MP09UA0001", vehicleType: "CAR" } });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  s.session = entry.body.data.session;
});

it("access switches are validated and can be changed later", async () => {
  assert.equal((await api("PUT", `/api/users/${s.limitedId}`, { token: s.a.token, body: { access: { reprint: "no" } } })).status, 400);
  const ok = await api("PUT", `/api/users/${s.limitedId}`, { token: s.a.token, body: { access: { showExitCollection: false } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.access.showExitCollection, false);
  assert.equal(ok.body.data.access.reprint, false, "the others stay as they were");
});

it("reprint: refused when switched off, counted when allowed", async () => {
  const refused = await api("POST", `/api/parking/sessions/${s.session._id}/reprint`, { token: s.limited });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  const allowed = await api("POST", `/api/parking/sessions/${s.session._id}/reprint`, { token: s.open });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal(allowed.body.data.reprints, 1);
});

it("collection: the figures a person was switched off from are not sent", async () => {
  const full = await money(s.open);
  assert.equal(full.status, 200, JSON.stringify(full.body));
  for (const key of ["entryAmount", "exitAmount", "cash", "total"]) assert.ok(key in full.body.data.totals, `${key} is shown by default`);

  const part = await money(s.limited);
  assert.equal(part.status, 200, JSON.stringify(part.body));
  const t = part.body.data.totals;
  assert.equal("entryAmount" in t, false, "entry switched off");
  assert.equal("exitAmount" in t, false, "exit switched off");
  for (const key of ["cash", "online", "total", "net"]) assert.equal(key in t, false, `${key} goes with the total`);
  assert.ok(part.body.data.rows.every((r) => !("total" in r)));

  const file = await bytes("GET", `/api/operator/collection?locationId=${s.loc._id}&format=csv`, { token: s.limited });
  assert.equal(file.status, 200);
  const header = file.buffer.toString("utf8").split("\n").find((line) => /Vehicle type/.test(line));
  assert.ok(header && !/Total|Cash|Entry amount|Exit amount/.test(header), header);

  // The summary on the operator's home screen follows the same rule.
  const home = await api("GET", `/api/operator/summary?locationId=${s.loc._id}`, { token: s.limited });
  assert.equal(home.status, 200, JSON.stringify(home.body));
  assert.equal("total" in home.body.data.collection.totals, false);
});

it("the Users table can be downloaded", async () => {
  for (const format of ["xlsx", "csv", "pdf"]) {
    const res = await bytes("GET", `/api/users/export?format=${format}`, { token: s.a.token });
    assert.equal(res.status, 200, format);
    assert.ok(res.buffer.length > 100, format);
  }
  const csv = (await bytes("GET", "/api/users/export?format=csv", { token: s.a.token })).buffer.toString("utf8");
  assert.match(csv, /ua-limited@example.com/);
  assert.match(csv, /Operator/);
  assert.equal((await api("GET", "/api/users/export?format=doc", { token: s.a.token })).status, 400);
  assert.equal((await api("GET", "/api/users/export")).status, 401);
  // An operator may not download the user list.
  assert.equal((await api("GET", "/api/users/export", { token: s.open })).status, 403);
});
