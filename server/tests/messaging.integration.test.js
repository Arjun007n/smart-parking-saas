// Text messages through the API (simulated provider): admin alerts, vehicle-owner notes, pass and booking notes,
// the phone-alert preference. Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, assert } = require("./helpers");
const messaging = require("../integrations/messaging");
const messageService = require("../services/messageService");
const { notify } = require("../services/notificationService");

setup();

const s = {};
let counter = 0;
const flush = () => messageService.flush();
const reset = () => { messaging.outbox.length = 0; };
const numbers = () => messaging.outbox.map((m) => m.to).sort();

it("setup: a company whose owner has a mobile number, one location, a tariff", async () => {
  process.env.MESSAGING_PROVIDER = "simulated";
  process.env.EMAIL_PROVIDER = "none";
  s.a = await registerCompany("sms");
  const profile = await api("PUT", "/api/auth/profile", { token: s.a.token, body: { name: "Owner", phone: "98765 43210" } });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Main", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token, body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  reset();
});

it("an urgent alert is texted to the owner's number; a warning is not (default is urgent only)", async () => {
  counter += 1;
  await notify({ companyId: s.a.company._id, locationId: s.loc._id, type: "GENERAL", severity: "critical", title: `Urgent ${counter}`, message: "Something broke.", dedupeKey: `sms-it-${counter}` });
  await flush();
  assert.deepEqual(numbers(), ["+919876543210"]);
  assert.match(messaging.outbox[0].body, /^URGENT: Urgent \d+ - Something broke\./);

  reset();
  counter += 1;
  await notify({ companyId: s.a.company._id, locationId: s.loc._id, type: "GENERAL", severity: "warning", title: `Warn ${counter}`, message: "Careful.", dedupeKey: `sms-it-${counter}` });
  await flush();
  assert.equal(messaging.outbox.length, 0);
});

it("the phone-alert choice is saved, validated, and changes who is texted", async () => {
  const bad = await api("PUT", "/api/auth/preferences", { token: s.a.token, body: { phoneAlerts: "SOMETIMES" } });
  assert.equal(bad.status, 400);
  const empty = await api("PUT", "/api/auth/preferences", { token: s.a.token, body: {} });
  assert.equal(empty.status, 400, "something must be sent");

  const saved = await api("PUT", "/api/auth/preferences", { token: s.a.token, body: { phoneAlerts: "IMPORTANT" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.user.phoneAlerts, "IMPORTANT");
  assert.equal(saved.body.data.user.emailAlerts, "CRITICAL", "the email choice is untouched");

  reset();
  counter += 1;
  await notify({ companyId: s.a.company._id, locationId: s.loc._id, type: "GENERAL", severity: "warning", title: `Warn ${counter}`, message: "Careful.", dedupeKey: `sms-it-${counter}` });
  await flush();
  assert.equal(messaging.outbox.length, 1);

  await api("PUT", "/api/auth/preferences", { token: s.a.token, body: { phoneAlerts: "OFF" } });
  reset();
  counter += 1;
  await notify({ companyId: s.a.company._id, locationId: s.loc._id, type: "GENERAL", severity: "critical", title: `Urgent ${counter}`, message: "x", dedupeKey: `sms-it-${counter}` });
  await flush();
  assert.equal(messaging.outbox.length, 0);
  await api("PUT", "/api/auth/preferences", { token: s.a.token, body: { phoneAlerts: "CRITICAL" } });
});

it("nothing is sent when messages are off, and the work still succeeds", async () => {
  process.env.MESSAGING_PROVIDER = "none";
  reset();
  const res = await api("POST", "/api/parking/entry", {
    token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "MH12SM0001", vehicleType: "CAR" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await flush();
  assert.equal(messaging.outbox.length, 0);
  process.env.MESSAGING_PROVIDER = "simulated";
});

it("vehicle owner: entry and exit notes go to the number on the vehicle record", async () => {
  const vehicle = await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "MH12SM0002", type: "CAR", phone: "91234 56789" } });
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));
  reset();
  const entry = await api("POST", "/api/parking/entry", {
    token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "MH12SM0002", vehicleType: "CAR" },
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  await flush();
  assert.deepEqual(numbers(), ["+919123456789"]);
  assert.match(messaging.outbox[0].body, /MH12SM0002 entered at \d\d:\d\d on \d+ \w+\. Ticket T-/);

  reset();
  const session = entry.body.data.session;
  const exit = await api("POST", "/api/parking/exit", { token: s.a.token, body: { locationId: s.loc._id, ticketNumber: session.ticketNumber } });
  assert.equal(exit.status, 200, JSON.stringify(exit.body));
  if (exit.body.data.paymentRequired) {
    const paid = await api("POST", "/api/payments", {
      token: s.a.token, body: { sessionId: session._id, method: "CASH", amount: exit.body.data.session.fee.total },
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
  }
  await flush();
  assert.deepEqual(numbers(), ["+919123456789"]);
  assert.match(messaging.outbox[0].body, /MH12SM0002 left at \d\d:\d\d after/);
  assert.match(messaging.outbox[0].body, new RegExp(session.ticketNumber));
});

it("vehicle owner: switching visit notes off stops them; a vehicle without a number gets nothing", async () => {
  process.env.MESSAGING_VISIT_MESSAGES = "off";
  reset();
  const off = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "MH12SM0003", vehicleType: "CAR" } });
  assert.equal(off.status, 201);
  await flush();
  assert.equal(messaging.outbox.length, 0);
  delete process.env.MESSAGING_VISIT_MESSAGES;
  await api("POST", "/api/vehicles", { token: s.a.token, body: { plateNumber: "MH12SM0004", type: "CAR" } });
  const quiet = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "MH12SM0004", vehicleType: "CAR" } });
  assert.equal(quiet.status, 201);
  await flush();
  assert.equal(messaging.outbox.length, 0);
});

it("pass holder: a number on the pass gets the sale and renewal notes; the number also works for entry notes", async () => {
  const sold = await api("POST", "/api/passes", {
    token: s.a.token,
    body: { locationId: s.loc._id, vehicleType: "CAR", holderName: "Asha Rao", months: 1, amount: 1000, method: "CASH", vehicleNumber: "MH12SM0005", phone: "90000 11111" },
  });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  await flush();
  assert.deepEqual(numbers(), ["+919000011111"]);
  assert.match(messaging.outbox[0].body, /your parking pass P-\S+ \(MH12SM0005\) is active until/);

  reset();
  const renewed = await api("POST", `/api/passes/${sold.body.data.pass._id}/renew`, {
    token: s.a.token, body: { locationId: s.loc._id, months: 1, amount: 1000, method: "CASH" },
  });
  assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
  await flush();
  assert.match(messaging.outbox[0].body, /is renewed until/);

  reset();
  const entry = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "MH12SM0005", vehicleType: "CAR" } });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  await flush();
  assert.deepEqual(numbers(), ["+919000011111"], "no vehicle record number: the pass number is used");
});

it("booking: the person who booked gets a confirmation", async () => {
  reset();
  const booked = await api("POST", "/api/bookings", {
    token: s.a.token,
    body: { locationId: s.loc._id, vehicleNumber: "MH12SM0006", vehicleType: "CAR", customerName: "Ravi", phone: "+91 80000 22222" },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  await flush();
  assert.deepEqual(numbers(), ["+918000022222"]);
  assert.match(messaging.outbox[0].body, /booking confirmed for MH12SM0006/);

  reset();
  const none = await api("POST", "/api/bookings", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "MH12SM0007", vehicleType: "CAR" } });
  assert.equal(none.status, 201);
  await flush();
  assert.equal(messaging.outbox.length, 0);
});
