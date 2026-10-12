// At the exit, the amount received at the counter is what is recorded: no change to give back. Needs MongoDB.
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");

setup();

const s = {};

it("setup: a company, a tariff and an exit operator", async () => {
  s.a = await registerCompany("recv");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Mall", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, additionalPerHour: 50, lostTicketFee: 200 },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const made = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Gate Out", email: "recv-out@example.com", password: "Password123", role: "EXIT_OPERATOR", locationIds: [s.loc._id] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  s.exit = await login("recv-out@example.com");
});

it("cash: the amount received above the fee is recorded as the amount of the exit", async () => {
  const entry = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "RJ14RECV01", vehicleType: "CAR" } });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const id = entry.body.data.session._id;
  await ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - 90 * 60000) } });
  const calc = await api("POST", "/api/parking/exit", { token: s.exit, body: { locationId: s.loc._id, ticketNumber: entry.body.data.session.ticketNumber } });
  assert.equal(calc.status, 200, JSON.stringify(calc.body));
  const fee = calc.body.data.session.fee.total;
  assert.ok(fee > 0);

  // Less than the fee is refused.
  const less = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: id, method: "CASH", amount: fee - 1 } });
  assert.equal(less.status, 409, JSON.stringify(less.body));
  // More than the fee is accepted and recorded in full.
  const paid = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: id, method: "CASH", amount: fee + 10 } });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.data.payment.amount, fee + 10);
  assert.equal(paid.body.data.session.fee.total, fee + 10, "the ticket carries what was received");
  assert.equal(paid.body.data.session.fee.due, fee + 10);
  assert.equal(paid.body.data.session.feeEdit.calculated, fee, "the tariff amount is kept for the record");
  const stored = await Payment.find({ sessionId: id, kind: "FEE" });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].amount, fee + 10);
  assert.equal(stored[0].status, "SUCCESS", "nothing is refunded");
  // The same request again is not recorded twice.
  const again = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: id, method: "CASH", amount: fee + 10 } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(await Payment.countDocuments({ sessionId: id, kind: "FEE" }), 1);
});

it("only counter payments may exceed the fee: a wallet or online payment must match it exactly", async () => {
  const entry = await api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber: "RJ14RECV02", vehicleType: "CAR" } });
  const id = entry.body.data.session._id;
  await ParkingSession.updateOne({ _id: id }, { $set: { entryTime: new Date(Date.now() - 90 * 60000) } });
  const calc = await api("POST", "/api/parking/exit", { token: s.exit, body: { locationId: s.loc._id, ticketNumber: entry.body.data.session.ticketNumber } });
  const fee = calc.body.data.session.fee.total;
  const gateway = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: id, method: "GATEWAY", amount: fee + 5 } });
  assert.equal(gateway.status, 409, JSON.stringify(gateway.body));
  const exact = await api("POST", "/api/payments", { token: s.exit, body: { sessionId: id, method: "UPI", amount: fee } });
  assert.equal(exact.status, 201, JSON.stringify(exact.body));
  assert.equal(exact.body.data.session.fee.total, fee, "an exact amount changes nothing");
});
