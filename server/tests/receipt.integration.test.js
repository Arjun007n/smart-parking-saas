// Receipt settings per location: saved through the location API, returned with
// the receipt, and kept apart between locations and companies.
// Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, assert } = require("./helpers");

setup();

const s = {};
const makeLocation = (name) =>
  api("POST", "/api/locations", {
    token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 5, bike: 5 } },
  });
const visit = async (location, plate) => {
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: {
      locationId: location._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 30,
      slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, lostTicketFee: 200, taxPercent: 0, taxInclusive: true,
    },
  });
  assert.ok([201, 409].includes(tariff.status), JSON.stringify(tariff.body));
  const entry = await api("POST", "/api/parking/entry", {
    token: s.a.token, body: { locationId: location._id, vehicleNumber: plate, vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const session = entry.body.data.session;
  const out = await api("POST", "/api/parking/exit", { token: s.a.token, body: { locationId: location._id, ticketNumber: session.ticketNumber } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  return (await api("GET", `/api/parking/sessions/${session._id}/receipt`, { token: s.a.token })).body.data;
};

it("setup: a company with two locations", async () => {
  s.a = await registerCompany("rcpt");
  s.b = await registerCompany("rcptb");
  const one = await makeLocation("Receipt Lot One");
  const two = await makeLocation("Receipt Lot Two");
  assert.equal(one.status, 201, JSON.stringify(one.body));
  assert.equal(two.status, 201, JSON.stringify(two.body));
  s.one = one.body.data;
  s.two = two.body.data;
});

it("a location without settings gives the default receipt settings", async () => {
  const r = await visit(s.one, "RJ14RC0001");
  assert.equal(r.settings.showAddress, true);
  assert.equal(r.settings.showGst, true);
  assert.equal(r.settings.showQr, "DEVICE");
  assert.equal(r.settings.headerNote, "");
  assert.match(r.settings.receiptFooter, /Thank you/);
});

it("settings are saved on one location and appear on its receipts only", async () => {
  const put = await api("PUT", `/api/locations/${s.one._id}`, {
    token: s.a.token,
    body: { receiptSettings: { headerNote: "Open 24 hours", receiptFooter: "See you soon", showGst: false, showQr: "OFF" } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.data.receiptSettings.headerNote, "Open 24 hours");

  const r = await visit(s.one, "RJ14RC0002");
  assert.equal(r.settings.headerNote, "Open 24 hours");
  assert.equal(r.settings.receiptFooter, "See you soon");
  assert.equal(r.settings.showGst, false);
  assert.equal(r.settings.showQr, "OFF");
  assert.equal(r.settings.showAddress, true, "what was not changed stays as it was");

  const other = await visit(s.two, "RJ14RC0003");
  assert.equal(other.settings.headerNote, "");
  assert.equal(other.settings.showQr, "DEVICE");
});

it("bad values are refused, a footer can be reset, and other companies cannot change it", async () => {
  const bad = (receiptSettings) => api("PUT", `/api/locations/${s.one._id}`, { token: s.a.token, body: { receiptSettings } });
  assert.equal((await bad({ showQr: "SOMETIMES" })).status, 400);
  assert.equal((await bad({ headerNote: "x".repeat(121) })).status, 400);
  assert.equal((await bad({ showGst: "no" })).status, 400);

  assert.equal((await bad({ receiptFooter: "" })).status, 200);
  const r = await visit(s.one, "RJ14RC0004");
  assert.match(r.settings.receiptFooter, /Thank you/, "an empty footer means the default again");

  const foreign = await api("PUT", `/api/locations/${s.one._id}`, { token: s.b.token, body: { receiptSettings: { headerNote: "hacked" } } });
  assert.ok([403, 404].includes(foreign.status), String(foreign.status));
  const again = await api("GET", `/api/locations/${s.one._id}`, { token: s.a.token });
  assert.equal(again.body.data.receiptSettings.headerNote, "Open 24 hours");
});
