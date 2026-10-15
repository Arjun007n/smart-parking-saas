process.env.NODE_ENV = "test";
process.env.APP_UTC_OFFSET_MINUTES = "330";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startingFees } = require("../utils/startingFees");

const AT = new Date("2026-03-02T10:00:00+05:30");
const car = { vehicleType: "CAR", isActive: true, gracePeriodMinutes: 10, slabs: [{ uptoMinutes: 60, rate: 20 }, { uptoMinutes: 180, rate: 50 }], additionalPerHour: 20 };
const bike = { vehicleType: "BIKE", isActive: true, slabs: [{ uptoMinutes: 120, rate: 10 }] };

test("starting fee is the first slab, after the grace period", () => {
  assert.deepEqual(startingFees([car, bike], AT), { CAR: 20, BIKE: 10 });
});

test("a flat-fee tariff shows the flat fee", () => {
  assert.deepEqual(startingFees([{ vehicleType: "CAR", isActive: true, flatFee: 100, slabs: [] }], AT), { CAR: 100 });
});

test("inactive tariffs and types without a tariff show no price", () => {
  assert.deepEqual(startingFees([{ ...car, isActive: false }], AT), {});
  assert.deepEqual(startingFees([], AT), {});
  assert.deepEqual(startingFees(undefined, AT), {});
});

test("a broken tariff does not stop the others", () => {
  const broken = { vehicleType: "TAXI", isActive: true, slabs: [{ uptoMinutes: "x", rate: "y" }] };
  assert.equal(startingFees([broken, bike], AT).BIKE, 10);
});
