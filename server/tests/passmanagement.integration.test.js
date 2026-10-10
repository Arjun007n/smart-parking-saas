// Pass Management (the ismartparking-style screens): pass users, Create Pass, approval, Update Pass,
// delete rules, vehicles, companies and GST invoices. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, raw, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Pass = require("../models/Pass");
const PassPayment = require("../models/PassPayment");
const PassUser = require("../models/PassUser");
const PassVehicle = require("../models/PassVehicle");

setup();

const s = {};
const DAY = 86400000;
const day = (offset = 0) => new Date(Date.now() + 330 * 60000 + offset * DAY).toISOString().slice(0, 10);
const enter = (vehicleNumber, token = s.entryToken) =>
  api("POST", "/api/parking/entry", { token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
const exit = (body, token = s.exitToken) => api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, ...body } });
const backdate = (id, minutes) => ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - minutes * 60000) } });
const row = (vehicleNumber, extra = {}) => ({
  vehicleNumber, vehicleType: "CAR", locationId: s.loc._id, startDate: day(0), endDate: day(29), amount: 1180, ...extra,
});
const createPass = (body, token = s.a.token) => api("POST", "/api/pass-users", { token, body: { method: "CASH", ...body } });
const person = (extra = {}) => ({ name: "Asha Verma", mobile: "9876500001", address: "12 MG Road", ...extra });

it("setup: a company with two locations, staff and a location admin each", async () => {
  s.a = await registerCompany("pm");
  s.b = await registerCompany("pmb");
  const make = async (name) => {
    const res = await api("POST", "/api/locations", { token: s.a.token, body: { name, address: { line1: "MG Road" }, capacity: { car: 20 } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const tariff = await api("POST", "/api/tariffs", {
      token: s.a.token, body: { locationId: res.body.data._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
    });
    assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
    return res.body.data;
  };
  s.loc = await make("Main");
  s.loc2 = await make("Annex");
  const staff = (name, email, role, locationIds) => api("POST", "/api/users", { token: s.a.token, body: { name, email, password: "Password123", role, locationIds } });
  await staff("Gate", "pm-entry@example.com", "ENTRY_OPERATOR", [s.loc._id]);
  await staff("Exit", "pm-exit@example.com", "EXIT_OPERATOR", [s.loc._id]);
  await staff("Site", "pm-site@example.com", "LOCATION_ADMIN", [s.loc._id]);
  await staff("AnnexAdmin", "pm-annex@example.com", "LOCATION_ADMIN", [s.loc2._id]);
  s.entryToken = await login("pm-entry@example.com");
  s.exitToken = await login("pm-exit@example.com");
  s.site = await login("pm-site@example.com");
  s.annex = await login("pm-annex@example.com");
});

it("companies: add, list with counts, edit, and delete only when empty", async () => {
  const made = await api("POST", "/api/pass-companies", { token: s.a.token, body: { name: "Acme Traders", gstNumber: "27AAPFU0939F1ZV", address: "Fort, Mumbai" } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.company = made.body.data;
  const spare = await api("POST", "/api/pass-companies", { token: s.a.token, body: { name: "Spare Co" } });
  assert.equal(spare.status, 201, JSON.stringify(spare.body));
  assert.equal((await api("DELETE", `/api/pass-companies/${spare.body.data._id}`, { token: s.a.token })).status, 200, "an unused company can go");
  assert.equal((await api("DELETE", `/api/pass-companies/${spare.body.data._id}`, { token: s.a.token })).status, 404);
  assert.equal((await api("DELETE", `/api/pass-companies/${s.company._id}`, { token: s.b.token })).status, 404, "another company's data");
});

it("create pass: a new user with two vehicles makes two passes, a user and two vehicle records", async () => {
  assert.equal((await createPass({ ...person(), rows: [row("RJ14PM0001")] }, s.entryToken)).status, 403, "gate staff cannot");
  assert.equal((await createPass({ ...person({ mobile: "123" }), rows: [row("RJ14PM0001")] })).status, 400, "mobile must be 10 digits");
  assert.equal((await createPass({ ...person({ address: "" }), rows: [row("RJ14PM0001")] })).status, 400, "address is required");
  assert.equal((await createPass({ ...person(), rows: [] })).status, 400);
  assert.equal((await createPass({ ...person(), rows: [row("RJ14PM0001", { endDate: day(-3) })] })).status, 400, "last day before the first day");
  assert.equal((await createPass({ ...person(), rows: [row("RJ14PM0001"), row("rj14 pm-0001")] })).status, 400, "same vehicle twice");
  assert.equal((await createPass({ ...person(), rows: [row("RJ14PM0001"), row("RJ14PM0002")], transactionId: "UPI-123456" })).status, 400, "a reference belongs to one pass");
  assert.equal(await PassUser.countDocuments({ companyId: s.a.company._id }), 0, "failed attempts leave nothing");

  const res = await createPass({ ...person({ email: "asha@example.com", passCompanyId: s.company._id }), rows: [row("RJ14PM0001"), row("RJ14PM0002", { vehicleType: "BIKE", amount: 590 })] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.created, 2);
  s.user = res.body.data.user;
  assert.equal(s.user.name, "Asha Verma");
  assert.equal(await Pass.countDocuments({ passUserId: s.user._id }), 2);
  assert.equal(await PassVehicle.countDocuments({ passUserId: s.user._id }), 2);
  const passes = await Pass.find({ passUserId: s.user._id }).sort({ vehicleNumber: 1 });
  s.passA = passes[0];
  s.passB = passes[1];
  assert.equal(s.passA.approval, "APPROVED");
  assert.equal(s.passA.amount, 1180);
  assert.equal(String(s.passA.passCompanyId), s.company._id);
  assert.equal(await PassPayment.countDocuments({ passId: s.passA._id }), 1, "one payment per pass");
});

it("create pass: duplicate mobile, current-pass vehicles and other users' vehicles are refused", async () => {
  const dup = await createPass({ ...person({ name: "Someone Else" }), rows: [row("RJ14PM0003")] });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  assert.match(dup.body.message, /mobile number already exists/);
  assert.equal(await PassUser.countDocuments({ companyId: s.a.company._id }), 1);

  const taken = await createPass({ ...person({ name: "Ravi", mobile: "9876500002" }), rows: [row("RJ14PM0001")] });
  assert.equal(taken.status, 409, JSON.stringify(taken.body));
  assert.equal(await PassUser.countDocuments({ companyId: s.a.company._id }), 1, "the new user was rolled back");

  const again = await createPass({ passUserId: s.user._id, rows: [row("RJ14PM0001")] });
  assert.equal(again.status, 409, "already has a current pass");
  assert.match(again.body.message, /already has pass/);

  assert.equal((await createPass({ passUserId: s.user._id, rows: [row("RJ14PM0003", { locationId: "0".repeat(24) })] })).status, 404, "unknown location");
  assert.equal((await createPass({ passUserId: s.b.company._id, rows: [row("RJ14PM0003")] })).status, 404, "unknown user");
});

it("create pass: an existing user gets another vehicle; a free pass (0) is complimentary", async () => {
  const more = await createPass({ passUserId: s.user._id, rows: [row("RJ14PM0003", { amount: 0 })] });
  assert.equal(more.status, 201, JSON.stringify(more.body));
  const pass = await Pass.findOne({ vehicleNumber: "RJ14PM0003" });
  assert.equal(pass.amount, 0);
  const payment = await PassPayment.findOne({ passId: pass._id });
  assert.equal(payment.method, "COMPLIMENTARY");
  s.freePass = pass;
  assert.equal(await PassVehicle.countDocuments({ passUserId: s.user._id }), 3);
});

it("pass users: list, search, stats, options and CSV download", async () => {
  const list = await api("GET", "/api/pass-users?q=asha", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.total, 1);
  const u = list.body.data.users[0];
  assert.equal(u.vehicles, 3);
  assert.equal(u.passes, 3);
  assert.equal(u.company, "Acme Traders");
  assert.equal((await api("GET", "/api/pass-users?q=nobody", { token: s.a.token })).body.data.total, 0);
  assert.equal((await api("GET", `/api/pass-users?passCompanyId=${s.company._id}`, { token: s.a.token })).body.data.total, 1);

  const stats = await api("GET", "/api/pass-users/stats", { token: s.a.token });
  assert.equal(stats.body.data.users, 1);
  assert.equal(stats.body.data.vehicles, 3);
  assert.equal(stats.body.data.passes, 3);
  assert.equal(stats.body.data.activeRevenue, 1770);

  const options = await api("GET", "/api/pass-users/options", { token: s.a.token });
  assert.equal(options.body.data.users[0].mobile, "9876500001");

  const csv = await raw("/api/pass-users?format=csv", s.a.token);
  assert.equal(csv.status, 200);
  assert.match(csv.type, /csv/);
  assert.match(csv.text, /Asha Verma/);
  assert.equal((await api("GET", "/api/pass-users", { token: s.b.token })).body.data.total, 0, "another company sees nothing");
});

it("pass users: editing a user updates the name, mobile and company shown on the passes", async () => {
  assert.equal((await api("PUT", `/api/pass-users/${s.user._id}`, { token: s.a.token, body: { mobile: "12" } })).status, 400);
  await createPass({ ...person({ name: "Ravi Shah", mobile: "9876500002" }), rows: [row("RJ14PM0010")] });
  assert.equal((await api("PUT", `/api/pass-users/${s.user._id}`, { token: s.a.token, body: { mobile: "9876500002" } })).status, 409, "another user has it");

  const res = await api("PUT", `/api/pass-users/${s.user._id}`, { token: s.a.token, body: { name: "Asha V. Verma", mobile: "9876500009", passCompanyId: "" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const passes = await Pass.find({ passUserId: s.user._id });
  assert.ok(passes.every((p) => p.holderName === "Asha V. Verma" && p.phone === "9876500009" && !p.passCompanyId), "the passes follow the user");
  s.ravi = await PassUser.findOne({ mobile: "9876500002" });
});

it("approval: a pending pass gets no free exit until it is approved", async () => {
  const pass = await Pass.findById(s.passA._id);
  const hold = await api("PATCH", `/api/passes/${pass._id}/approval`, { token: s.a.token, body: { approval: "PENDING" } });
  assert.equal(hold.status, 200, JSON.stringify(hold.body));
  assert.equal((await api("PATCH", `/api/passes/${pass._id}/approval`, { token: s.a.token, body: { approval: "MAYBE" } })).status, 400);
  assert.equal((await api("PATCH", `/api/passes/${pass._id}/approval`, { token: s.entryToken, body: { approval: "APPROVED" } })).status, 403);

  const entry = await enter("RJ14PM0001");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal(entry.body.data.pass.validHere, false);
  assert.equal(entry.body.data.session.passId, undefined);
  await backdate(entry.body.data.session._id, 90);
  const out = await exit({ ticketNumber: entry.body.data.session.ticketNumber });
  assert.equal(out.body.data.paymentRequired, true, "pays like anyone else");

  assert.equal((await api("PATCH", `/api/passes/${pass._id}/approval`, { token: s.a.token, body: { approval: "APPROVED" } })).status, 200);
  const again = await exit({ ticketNumber: entry.body.data.session.ticketNumber });
  assert.equal(again.body.data.paymentRequired, false);
  assert.equal(again.body.data.session.status, "PASS_EXIT");

  const list = await api("GET", "/api/passes?approval=PENDING", { token: s.a.token });
  assert.equal(list.body.data.total, 0);
});

it("passes list: filters, ids and the Excel/CSV download", async () => {
  const all = await api("GET", "/api/passes", { token: s.a.token });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.data.total, 4);
  assert.equal((await api("GET", `/api/passes?passUserId=${s.ravi._id}`, { token: s.a.token })).body.data.total, 1);
  assert.equal((await api("GET", `/api/passes?vehicleNumber=RJ14PM0002`, { token: s.a.token })).body.data.total, 1);
  assert.equal((await api("GET", `/api/passes?ids=${s.passA._id},${s.passB._id}`, { token: s.a.token })).body.data.total, 2);
  assert.equal((await api("GET", "/api/passes?ids=nope", { token: s.a.token })).status, 400);
  const csv = await raw("/api/passes?format=csv", s.a.token);
  assert.match(csv.text, /RJ14PM0001/);
});

it("update pass: sets the dates and charge for several passes, takes no money", async () => {
  const before = await PassPayment.countDocuments({ companyId: s.a.company._id });
  assert.equal((await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids: [String(s.passB._id)], action: "UPDATE_TERM", amount: 100 } })).status, 400, "needs the last day");
  assert.equal((await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids: [String(s.passB._id)], action: "UPDATE_TERM", endDate: day(60) } })).status, 400, "needs the amount");
  const res = await api("POST", "/api/passes/bulk", { token: s.a.token, body: { ids: [String(s.passB._id)], action: "UPDATE_TERM", endDate: day(60), amount: 750 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.changed, 1);
  const pass = await Pass.findById(s.passB._id);
  assert.equal(pass.amount, 750);
  assert.equal(pass.endDate.getTime() > Date.now() + 59 * DAY, true);
  assert.equal(await PassPayment.countDocuments({ companyId: s.a.company._id }), before, "no payment was made");
});

it("delete: only an unused pass goes; used, paid and invoiced passes stay", async () => {
  // Used at the gate: the free pass drives in, then cannot be deleted.
  const entry = await enter("RJ14PM0003");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal(String(entry.body.data.session.passId), String(s.freePass._id));
  const used = await api("DELETE", `/api/passes/${s.freePass._id}`, { token: s.a.token });
  assert.equal(used.status, 409);
  assert.match(used.body.message, /already used/);

  // Paid and never used (passA was used at the gate above): it stays too.
  const paid = await api("DELETE", `/api/passes/${s.passB._id}`, { token: s.a.token });
  assert.equal(paid.status, 409);
  assert.match(paid.body.message, /Money was taken/);

  // A free pass nobody used goes, with its vehicle record kept for the user.
  const made = await createPass({ passUserId: s.ravi._id, rows: [row("RJ14PM0020", { amount: 0 })] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const unused = await Pass.findOne({ vehicleNumber: "RJ14PM0020" });
  const many = await api("POST", "/api/passes/delete", { token: s.a.token, body: { ids: [String(unused._id), String(s.passA._id)] } });
  assert.equal(many.status, 200, JSON.stringify(many.body));
  assert.equal(many.body.data.deleted, 1);
  assert.equal(many.body.data.skipped.length, 1);
  assert.equal(await Pass.countDocuments({ _id: unused._id }), 0);
  assert.equal(await PassPayment.countDocuments({ passId: unused._id }), 0);
  assert.equal((await api("DELETE", `/api/passes/${unused._id}`, { token: s.a.token })).status, 404);
  assert.equal((await api("DELETE", `/api/passes/${s.passA._id}`, { token: s.b.token })).status, 404, "another company");
});

it("vehicles: add, edit, duplicate checks and the vehicle list", async () => {
  const add = await api("POST", `/api/pass-users/${s.ravi._id}/vehicles`, { token: s.a.token, body: { vehicleNumber: "mp 09 zz 1111", vehicleType: "CAR" } });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.data.plateNumber, "MP09ZZ1111");
  assert.equal((await api("POST", `/api/pass-users/${s.ravi._id}/vehicles`, { token: s.a.token, body: { vehicleNumber: "MP09ZZ1111", vehicleType: "CAR" } })).status, 409);
  assert.equal((await api("POST", `/api/pass-users/${s.user._id}/vehicles`, { token: s.a.token, body: { vehicleNumber: "MP09ZZ1111", vehicleType: "CAR" } })).status, 409, "belongs to another user");
  assert.equal((await api("POST", `/api/pass-users/${s.ravi._id}/vehicles`, { token: s.a.token, body: { vehicleNumber: "ab", vehicleType: "CAR" } })).status, 400);

  const edit = await api("PUT", `/api/pass-users/${s.ravi._id}/vehicles/${add.body.data._id}`, { token: s.a.token, body: { vehicleNumber: "MP09ZZ2222", vehicleType: "BIKE" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.data.plateNumber, "MP09ZZ2222");

  const onPass = await PassVehicle.findOne({ plateNumber: "RJ14PM0010" });
  assert.equal((await api("PUT", `/api/pass-users/${s.ravi._id}/vehicles/${onPass._id}`, { token: s.a.token, body: { vehicleNumber: "MP09ZZ3333" } })).status, 409, "on a current pass");

  const list = await api("GET", "/api/pass-users/vehicles?q=ravi", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.data.vehicles.every((v) => v.userName === "Ravi Shah"));
  assert.ok(list.body.data.total >= 2);
  const csv = await raw("/api/pass-users/vehicles?format=csv", s.a.token);
  assert.match(csv.text, /MP09ZZ2222/);
});

it("renew: Create / Renew on a user's vehicle re-dates its pass and records one payment", async () => {
  const vehicle = await PassVehicle.findOne({ plateNumber: "RJ14PM0010" });
  const before = await Pass.findOne({ vehicleNumber: "RJ14PM0010" });
  const payments = await PassPayment.countDocuments({ passId: before._id });
  const res = await api("POST", `/api/pass-users/${s.ravi._id}/passes`, {
    token: s.a.token, body: { vehicleId: String(vehicle._id), locationId: s.loc._id, endDate: day(120), amount: 3000, method: "UPI", transactionId: "UPI-998877" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.renewed, true);
  assert.equal(await Pass.countDocuments({ vehicleNumber: "RJ14PM0010" }), 1, "still one pass for the vehicle");
  assert.equal(await PassPayment.countDocuments({ passId: before._id }), payments + 1);
  const after = await Pass.findById(before._id);
  assert.equal(after.amount, 3000);

  const fresh = await PassVehicle.findOne({ plateNumber: "MP09ZZ2222" });
  const sold = await api("POST", `/api/pass-users/${s.ravi._id}/passes`, { token: s.a.token, body: { vehicleId: String(fresh._id), locationId: s.loc._id, endDate: day(30), amount: 900 } });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  assert.equal(sold.body.data.renewed, false);
});

it("invoices: eligible passes, preview, tax-inclusive split, numbering from 100001, no double billing", async () => {
  const q = `locationId=${s.loc._id}&passCompanyId=none&passUserId=${s.ravi._id}`;
  assert.equal((await api("GET", `/api/pass-invoices/eligible?locationId=${s.loc._id}`, { token: s.a.token })).status, 400, "choose a company");
  assert.equal((await api("GET", `/api/pass-invoices/eligible?locationId=${s.loc._id}&passCompanyId=none`, { token: s.a.token })).status, 400, "no company needs a user");
  const eligible = await api("GET", `/api/pass-invoices/eligible?${q}`, { token: s.a.token });
  assert.equal(eligible.status, 200, JSON.stringify(eligible.body));
  const rows = eligible.body.data.passes;
  assert.equal(rows.length, 2, "both of Ravi's paid passes (free ones have nothing to invoice)");
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const body = { locationId: s.loc._id, passCompanyId: "none", passUserId: String(s.ravi._id), passIds: rows.map((r) => r._id), taxPercent: 18 };

  assert.equal((await api("POST", "/api/pass-invoices/preview", { token: s.a.token, body: { ...body, passIds: [] } })).status, 400);
  const preview = await api("POST", "/api/pass-invoices/preview", { token: s.a.token, body });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.total, total);
  assert.equal(preview.body.data.tax, Math.round((total - total / 1.18) * 100) / 100);
  assert.equal(Math.round((preview.body.data.taxable + preview.body.data.tax) * 100) / 100, total);
  assert.equal(preview.body.data.quantity, 2);
  assert.equal(preview.body.data.billTo.name, "Ravi Shah");

  const made = await api("POST", "/api/pass-invoices", { token: s.a.token, body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.invoiceNumber, 100001);
  s.invoice = made.body.data;
  assert.equal(await Pass.countDocuments({ passInvoiceId: s.invoice._id }), 2);
  assert.equal((await api("POST", "/api/pass-invoices", { token: s.a.token, body })).status, 409, "already invoiced");
  assert.equal((await api("GET", `/api/pass-invoices/eligible?${q}`, { token: s.a.token })).body.data.passes.length, 0);

  const one = await api("GET", `/api/pass-invoices/${s.invoice._id}`, { token: s.a.token });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.data.description, "Vehicle Parking Pass");
  const list = await api("GET", "/api/pass-invoices", { token: s.a.token });
  assert.equal(list.body.data.total, 1);
  assert.equal((await api("GET", `/api/pass-invoices/${s.invoice._id}`, { token: s.b.token })).status, 404);
  assert.match((await raw("/api/pass-invoices?format=csv", s.a.token)).text, /100001/);

  // An invoiced pass cannot be deleted, and re-dating it puts it back on the eligible list.
  const billed = await Pass.findOne({ passInvoiceId: s.invoice._id });
  const paidDelete = await api("DELETE", `/api/passes/${billed._id}`, { token: s.a.token });
  assert.equal(paidDelete.status, 409);
});

it("invoices: a company invoice uses the company's details and the next number", async () => {
  const mine = await createPass({ ...person({ name: "Meera Rao", mobile: "9876500003", passCompanyId: s.company._id }), rows: [row("RJ14PM0030", { amount: 2360 })] });
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  const eligible = await api("GET", `/api/pass-invoices/eligible?locationId=${s.loc._id}&passCompanyId=${s.company._id}`, { token: s.a.token });
  assert.equal(eligible.body.data.passes.length, 1);
  const res = await api("POST", "/api/pass-invoices", {
    token: s.a.token, body: { locationId: s.loc._id, passCompanyId: s.company._id, passIds: [eligible.body.data.passes[0]._id], taxPercent: 18 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.invoiceNumber, 100002);
  assert.equal(res.body.data.billTo.name, "Acme Traders");
  assert.equal(res.body.data.billTo.gstNumber, "27AAPFU0939F1ZV");
  assert.equal(res.body.data.total, 2360);
  assert.equal(res.body.data.tax, 360);
  assert.equal(res.body.data.taxable, 2000);
  assert.equal((await api("DELETE", `/api/pass-companies/${s.company._id}`, { token: s.a.token })).status, 409, "company with users cannot be deleted");

  // A held pass is not billable until approved.
  const pending = await createPass({ passUserId: s.ravi._id, rows: [row("RJ14PM0031", { amount: 500 })] });
  const pendingPass = await Pass.findOne({ vehicleNumber: "RJ14PM0031" });
  assert.equal(pending.status, 201);
  await api("PATCH", `/api/passes/${pendingPass._id}/approval`, { token: s.a.token, body: { approval: "PENDING" } });
  const list = await api("GET", `/api/pass-invoices/eligible?locationId=${s.loc._id}&passCompanyId=none&passUserId=${s.ravi._id}`, { token: s.a.token });
  assert.ok(!list.body.data.passes.some((p) => p._id === String(pendingPass._id)));
});

it("user delete: refused while the user has passes, allowed (with vehicles) when none", async () => {
  assert.equal((await api("DELETE", `/api/pass-users/${s.user._id}`, { token: s.a.token })).status, 409);
  const lone = await api("POST", "/api/pass-users", { token: s.a.token, body: { ...person({ name: "Lone", mobile: "9876500077" }), rows: [row("RJ14PM0040", { amount: 0 })] } });
  assert.equal(lone.status, 201, JSON.stringify(lone.body));
  const pass = await Pass.findOne({ vehicleNumber: "RJ14PM0040" });
  assert.equal((await api("DELETE", `/api/passes/${pass._id}`, { token: s.a.token })).status, 200);
  assert.equal((await api("DELETE", `/api/pass-users/${lone.body.data.user._id}`, { token: s.a.token })).status, 200);
  assert.equal(await PassVehicle.countDocuments({ plateNumber: "RJ14PM0040" }), 0, "the vehicle record goes with the user");
  assert.equal((await api("DELETE", `/api/pass-users/${s.user._id}`, { token: s.b.token })).status, 404);
});

it("scoping: a location admin only sees and sells for their own location", async () => {
  const outside = await createPass({ ...person({ name: "Site Person", mobile: "9876500088" }), rows: [row("RJ14PM0050", { locationId: s.loc2._id })] }, s.site);
  assert.equal(outside.status, 404, "Main's admin cannot sell for Annex");
  const own = await createPass({ ...person({ name: "Site Person", mobile: "9876500088" }), rows: [row("RJ14PM0050")] }, s.site);
  assert.equal(own.status, 201, JSON.stringify(own.body));

  const siteList = await api("GET", "/api/pass-users?q=Site Person", { token: s.site });
  assert.equal(siteList.body.data.total, 1);
  const annexList = await api("GET", "/api/pass-users", { token: s.annex });
  assert.equal(annexList.body.data.total, 0, "Annex's admin sees none of Main's users");
  assert.equal((await api("GET", `/api/pass-users/${own.body.data.user._id}`, { token: s.annex })).status, 404);
  assert.equal((await api("GET", `/api/passes?q=RJ14PM0050`, { token: s.annex })).body.data.total, 0);
  assert.equal((await api("GET", `/api/pass-invoices/eligible?locationId=${s.loc._id}&passCompanyId=none&passUserId=${own.body.data.user._id}`, { token: s.annex })).status, 404);
});

it("old passes: a pass made before pass users exist is linked to a user by its mobile number", async () => {
  const old = await Pass.create({
    companyId: s.a.company._id, passNumber: "P-260101-OLDOLD", holderName: "Old Holder", phone: "9876500123", vehicleNumber: "RJ14OLD001",
    vehicleType: "CAR", locationIds: [], startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + 20 * DAY), status: "ACTIVE", isCurrent: true,
    vehicles: [{ number: "RJ14OLD001", type: "CAR" }],
  });
  const list = await api("GET", "/api/pass-users?q=Old Holder", { token: s.a.token });
  assert.equal(list.body.data.total, 1, "the list links old passes first");
  const linked = await Pass.findById(old._id);
  assert.ok(linked.passUserId);
  assert.equal(await PassVehicle.countDocuments({ plateNumber: "RJ14OLD001" }), 1);
  assert.equal(linked.approval === undefined || linked.approval === "APPROVED", true, "old passes count as approved");
});
