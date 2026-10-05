// Repeat-vehicle and location-comparison reports, and the Excel and PDF
// downloads of every report. Needs MongoDB (see tests/helpers.js).
const zlib = require("zlib");
const { setup, it, api, bytes, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const { todayText } = require("./reportDates");

setup();

const s = { paid: {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backdate = (id, minutes) =>
  ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - minutes * 60000) } });

// One complete visit: in, a while later out, paid in cash (or free on a pass).
const visit = async (locationId, vehicleNumber, minutes = 90) => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.entryToken, body: { locationId, vehicleNumber, vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const session = entry.body.data.session;
  await backdate(session._id, minutes);
  const out = await api("POST", "/api/parking/exit", {
    token: s.exitToken, body: { locationId, ticketNumber: session.ticketNumber },
  });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  if (!out.body.data.paymentRequired) return 0;
  const fee = out.body.data.session.fee.total;
  const paid = await api("POST", "/api/payments", {
    token: s.exitToken, body: { sessionId: session._id, method: "CASH", amount: fee },
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  return fee;
};
const range = () => `from=${s.from}&to=${s.to}`;
const get = (path, token = s.a.token) => api("GET", `/api/reports/${path}${path.includes("?") ? "&" : "?"}${range()}`, { token });
const download = (path, token = s.a.token) => bytes("GET", `/api/reports/${path}${path.includes("?") ? "&" : "?"}${range()}`, { token });

// Reads our own ZIP files back (the .xlsx) and returns the sheet XML.
const sheetOf = (buffer) => {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  let p = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i += 1) {
    const packed = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLength);
    if (name === "xl/worksheets/sheet1.xml") {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      return zlib.inflateRawSync(buffer.subarray(start, start + packed)).toString("utf8");
    }
    p += 46 + nameLength;
  }
  throw new Error("no sheet in the workbook");
};
// All the text drawn on a PDF's pages.
const pdfText = (buffer) =>
  [...buffer.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map((m) => zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"))
    .join("\n");

it("setup: two locations, staff, repeat visitors, a pass holder", async () => {
  ({ from: s.from, to: s.to } = todayText(2));
  s.a = await registerCompany("rxa");
  s.b = await registerCompany("rxb");
  const make = async (name) => {
    const loc = await api("POST", "/api/locations", {
      token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 10 } },
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
  await staff("Gate", "rx-entry@example.com", "ENTRY_OPERATOR", [s.main._id, s.annex._id]);
  await staff("Exit", "rx-exit@example.com", "EXIT_OPERATOR", [s.main._id, s.annex._id]);
  await staff("Site", "rx-site@example.com", "LOCATION_ADMIN", [s.main._id]);
  s.entryToken = await login("rx-entry@example.com");
  s.exitToken = await login("rx-exit@example.com");
  s.site = await login("rx-site@example.com");

  // RJ14REPEAT: three paid visits, one of them at the Annex. RJ14ONCE01: a single visit.
  s.paid.repeat = [await visit(s.main._id, "RJ14REPEAT", 90), await visit(s.main._id, "RJ14REPEAT", 130), await visit(s.annex._id, "RJ14REPEAT", 70)];
  s.paid.once = await visit(s.main._id, "RJ14ONCE01", 60);
  s.paid.annexOnly = await visit(s.annex._id, "RJ14ANNEX01", 100);
  assert.ok(s.paid.repeat.every((fee) => fee > 0));

  // A pass holder with two free visits.
  const sold = await api("POST", "/api/passes", {
    token: s.a.token,
    body: { locationId: s.main._id, vehicleNumber: "RJ14PASSRP", vehicleType: "CAR", holderName: "Asha Rao", unit: "WEEK", count: 2, amount: 400, method: "UPI", transactionId: "UPI-RX-1" },
  });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  s.pass = sold.body.data.pass;
  assert.equal(await visit(s.main._id, "RJ14PASSRP", 200), 0);
  assert.equal(await visit(s.main._id, "RJ14PASSRP", 50), 0);
});

it("repeat vehicles: lists vehicles that came back, most visits first", async () => {
  const res = await get("frequent-vehicles");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rows = res.body.data.rows;
  assert.deepEqual(rows.map((r) => r.vehicle), ["RJ14REPEAT", "RJ14PASSRP"], "visits first; single-visit vehicles are left out");
  const repeat = rows[0];
  assert.equal(repeat.visits, 3);
  assert.equal(repeat.locationCount, 2);
  assert.equal(repeat.fees, s.paid.repeat.reduce((t, f) => t + f, 0));
  assert.equal(repeat.pass, "", "no pass");
  assert.ok(repeat.averageStayMinutes >= 60);

  const holder = rows[1];
  assert.equal(holder.visits, 2);
  assert.equal(holder.passVisits, 2);
  assert.equal(holder.fees, 0);
  assert.equal(holder.pass, s.pass.passNumber, "the pass is named");

  const { summary } = res.body.data;
  assert.equal(summary.vehicles, 4);
  assert.equal(summary.visits, 7);
  assert.equal(summary.repeatVehicles, 2);
  assert.equal(summary.repeatVisits, 5);
  assert.equal(summary.repeatShare, Math.round((5 / 7) * 1000) / 10);
  assert.equal(res.body.data.total, 2);
  assert.equal(res.body.data.min, 2);
});

it("repeat vehicles: the minimum visits and the plate search filter the list", async () => {
  const three = await get("frequent-vehicles?min=3");
  assert.deepEqual(three.body.data.rows.map((r) => r.vehicle), ["RJ14REPEAT"]);
  assert.equal(three.body.data.min, 3);
  const odd = await get("frequent-vehicles?min=7");
  assert.equal(odd.body.data.min, 2, "an unlisted minimum falls back to 2");
  const search = await get("frequent-vehicles?q=rj14 pass");
  assert.deepEqual(search.body.data.rows.map((r) => r.vehicle), ["RJ14PASSRP"]);
  const none = await get("frequent-vehicles?min=20");
  assert.deepEqual(none.body.data.rows, []);
  assert.equal(none.body.data.summary.repeatShare, 0);
  const main = await get(`frequent-vehicles?locationId=${s.main._id}`);
  const repeatAtMain = main.body.data.rows.find((r) => r.vehicle === "RJ14REPEAT");
  assert.equal(repeatAtMain.visits, 2, "only the Main visits");
  assert.equal(repeatAtMain.locationCount, 1);
  assert.equal((await get("frequent-vehicles?locationId=bad")).status, 400);
});

it("repeat vehicles: a location admin sees only their own location, other companies see nothing", async () => {
  const site = await get("frequent-vehicles", s.site);
  assert.equal(site.status, 200);
  const repeat = site.body.data.rows.find((r) => r.vehicle === "RJ14REPEAT");
  assert.equal(repeat.visits, 2, "the Annex visit is not theirs");
  assert.equal(repeat.locationCount, 1);
  assert.equal((await get(`frequent-vehicles?locationId=${s.annex._id}`, s.site)).status, 404);
  const other = await get("frequent-vehicles", s.b.token);
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.data.rows, []);
  assert.equal((await get("frequent-vehicles", s.entryToken)).status, 403);
});

it("locations: compares every location for the period", async () => {
  const res = await get("locations");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const byName = Object.fromEntries(res.body.data.rows.map((r) => [r.location, r]));
  assert.deepEqual(Object.keys(byName).sort(), ["Annex", "Main"]);

  const main = byName.Main;
  const annex = byName.Annex;
  assert.equal(main.entries, 5, "REPEAT twice, ONCE, PASS twice");
  assert.equal(main.exits, 5);
  assert.equal(main.passVisits, 2);
  assert.equal(main.capacity, 10);
  assert.equal(main.insideNow, 0);
  assert.equal(main.passSales, 400);
  const mainParking = s.paid.repeat[0] + s.paid.repeat[1] + s.paid.once;
  assert.equal(main.collected, mainParking + 400, "parking fees plus the pass sale");
  assert.equal(main.net, mainParking + 400);
  assert.equal(main.perEntry, Math.round(((mainParking + 400) / 5) * 100) / 100);

  assert.equal(annex.entries, 2);
  assert.equal(annex.passSales, 0);
  assert.equal(annex.collected, s.paid.repeat[2] + s.paid.annexOnly);

  const { total } = res.body.data;
  assert.equal(total.entries, 7);
  assert.equal(total.collected, main.collected + annex.collected);
  assert.equal(res.body.data.rows[0].location, "Main", "best net first");
  assert.equal(res.body.data.best, "Main");
});

it("locations: shows who is inside now, and respects scope", async () => {
  const entry = await api("POST", "/api/parking/entry", {
    token: s.entryToken, body: { locationId: s.annex._id, vehicleNumber: "RJ14INSIDE1", vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201);
  const res = await get("locations");
  const annex = res.body.data.rows.find((r) => r.location === "Annex");
  assert.equal(annex.insideNow, 1);
  assert.equal(annex.utilization, 10);

  const site = await get("locations", s.site);
  assert.deepEqual(site.body.data.rows.map((r) => r.location), ["Main"], "a location admin sees only their location");
  const one = await get(`locations?locationId=${s.annex._id}`);
  assert.deepEqual(one.body.data.rows.map((r) => r.location), ["Annex"]);
  assert.deepEqual((await get("locations", s.b.token)).body.data.rows, []);
  assert.equal((await get("locations", s.exitToken)).status, 403);
});

it("downloads: every report can be taken as CSV, Excel or PDF", async () => {
  for (const name of ["revenue", "collection", "vehicles", "operators", "peak-hours", "occupancy-trend", "durations", "payments", "exceptions", "passes", "hardware", "frequent-vehicles", "locations"]) {
    const xlsx = await download(`${name}?format=xlsx`);
    assert.equal(xlsx.status, 200, `${name} xlsx`);
    assert.match(xlsx.headers.get("content-type"), /spreadsheetml\.sheet/);
    assert.match(xlsx.headers.get("content-disposition"), /attachment; filename="[A-Za-z0-9._-]+\.xlsx"/);
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), "PK", `${name} is a zip`);
    assert.match(sheetOf(xlsx.buffer), /Generated \d{4}-\d{2}-\d{2}/);

    const pdf = await download(`${name}?format=pdf`);
    assert.equal(pdf.status, 200, `${name} pdf`);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition"), /\.pdf"/);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");

    const csv = await download(`${name}?format=csv`);
    assert.equal(csv.status, 200, `${name} csv`);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
  }
  const day = await bytes("GET", `/api/reports/occupancy?date=${s.to}&format=pdf`, { token: s.a.token });
  assert.equal(day.status, 200);
  assert.equal(day.buffer.subarray(0, 5).toString(), "%PDF-");
});

it("downloads: the file holds the same rows, with readable words and the filters applied", async () => {
  const all = sheetOf((await download("collection?format=xlsx")).buffer);
  assert.match(all, /RJ14REPEAT/);
  assert.match(all, />Cash</, "codes are shown as words in Excel");
  assert.doesNotMatch(all, />CASH</);

  const filtered = sheetOf((await download(`collection?format=xlsx&locationId=${s.annex._id}`)).buffer);
  assert.match(filtered, /RJ14ANNEX01/);
  assert.doesNotMatch(filtered, /RJ14ONCE01/, "the Main visits are filtered out");
  assert.match(filtered, /Annex/);

  const upi = sheetOf((await download("collection?format=xlsx&method=UPI")).buffer);
  assert.doesNotMatch(upi, /RJ14REPEAT/, "no UPI payments for parking in this data");

  const repeat = pdfText((await download("frequent-vehicles?format=pdf&min=3")).buffer);
  assert.match(repeat, /RJ14REPEAT/);
  assert.doesNotMatch(repeat, /RJ14PASSRP/);
  assert.match(repeat, /Repeat vehicles/);
  assert.match(repeat, /Company rxa/);
});

it("downloads: numbers in Excel are numbers, and the CSV keeps its codes", async () => {
  const sheet = sheetOf((await download("locations?format=xlsx")).buffer);
  const main = s.paid.repeat[0] + s.paid.repeat[1] + s.paid.once + 400;
  assert.match(sheet, new RegExp(`<v>${main}</v>`), "the net amount is a numeric cell");
  const csv = await download("collection?format=csv");
  assert.match(csv.buffer.toString("utf8"), /CASH/);
});

it("downloads: access rules are the same as for the screen", async () => {
  assert.equal((await download("revenue?format=xlsx", s.entryToken)).status, 403);
  assert.equal((await download("revenue?format=pdf", s.exitToken)).status, 403);
  assert.equal((await bytes("GET", `/api/reports/revenue?${range()}&format=xlsx`, {})).status, 401);

  const site = sheetOf((await download("collection?format=xlsx", s.site)).buffer);
  assert.match(site, /RJ14ONCE01/);
  assert.doesNotMatch(site, /RJ14ANNEX01/, "a location admin gets only their own location's rows");
  assert.equal((await download(`collection?format=xlsx&locationId=${s.annex._id}`, s.site)).status, 404);

  const other = sheetOf((await download("collection?format=xlsx", s.b.token)).buffer);
  assert.doesNotMatch(other, /RJ14/, "another company's file holds none of this data");
  const otherPdf = pdfText((await download("collection?format=pdf", s.b.token)).buffer);
  assert.doesNotMatch(otherPdf, /RJ14/);
  assert.match(otherPdf, /Nothing found/);
});

it("downloads: an unknown format is refused", async () => {
  const res = await api("GET", `/api/reports/revenue?${range()}&format=docx`, { token: s.a.token });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Unknown format/);
  const json = await api("GET", `/api/reports/revenue?${range()}`, { token: s.a.token });
  assert.equal(json.status, 200, "no format still answers with JSON");
});

it("audit: downloads are recorded with the report, format and who", async () => {
  let entry;
  for (let tries = 0; tries < 20 && !entry; tries += 1) {
    const logs = await api("GET", "/api/audit-logs?action=REPORT_EXPORT", { token: s.a.token });
    assert.equal(logs.status, 200);
    entry = (logs.body.data.logs || logs.body.data.items || logs.body.data.rows || []).find((l) => l.meta && l.meta.format === "xlsx");
    if (!entry) await sleep(100);
  }
  assert.ok(entry, "a REPORT_EXPORT entry for an Excel download");
  assert.ok(entry.meta.report);
  assert.ok(entry.actorEmail);
});
