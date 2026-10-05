// A camera that watches both ways decides the direction of a plate by itself ("AUTO").
const test = require("node:test");
const assert = require("node:assert/strict");
const ParkingSession = require("../models/ParkingSession");
const { inferDirection } = require("../services/anprService");

const device = { companyId: "c1", locationId: "l1" };
const saved = { findOne: ParkingSession.findOne, minutes: process.env.AUTO_EXIT_AFTER_MINUTES };
test.afterEach(() => {
  ParkingSession.findOne = saved.findOne;
  if (saved.minutes === undefined) delete process.env.AUTO_EXIT_AFTER_MINUTES;
  else process.env.AUTO_EXIT_AFTER_MINUTES = saved.minutes;
});

// A stand-in for the database: one open ticket that started `minutesAgo` minutes ago (or none).
const openTicket = (minutesAgo, asked = []) => {
  ParkingSession.findOne = (filter) => {
    asked.push(filter);
    return { select: async () => (minutesAgo === null ? null : { entryTime: new Date(Date.now() - minutesAgo * 60000) }) };
  };
  return asked;
};

test("a plate with no open ticket is arriving", async () => {
  openTicket(null);
  assert.equal(await inferDirection(device, "MH12AB1234"), "ENTRY");
});

test("a plate with an open ticket of a few minutes is still arriving (it is still in front of the camera)", async () => {
  openTicket(2);
  assert.equal(await inferDirection(device, "MH12AB1234"), "ENTRY");
});

test("a plate that has been inside for a while is leaving", async () => {
  const asked = openTicket(30);
  assert.equal(await inferDirection(device, "MH12AB1234"), "EXIT");
  assert.deepEqual(asked[0], { companyId: "c1", locationId: "l1", vehicleNumber: "MH12AB1234", isOpen: true }, "only this location's open ticket counts");
});

test("how long counts as a while can be set", async () => {
  process.env.AUTO_EXIT_AFTER_MINUTES = "1";
  openTicket(2);
  assert.equal(await inferDirection(device, "MH12AB1234"), "EXIT");
});

test("an unreadable plate is never an exit, and the database is not asked", async () => {
  const asked = openTicket(60);
  assert.equal(await inferDirection(device, ""), "ENTRY");
  assert.equal(asked.length, 0);
});
