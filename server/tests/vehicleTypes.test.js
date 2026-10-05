// The five vehicle classes: names, counts and the helpers that add them up.
const test = require("node:test");
const assert = require("node:assert/strict");
const { VEHICLE_TYPES, VEHICLE_KEYS, sumCounts } = require("../models/constants");
const Location = require("../models/Location");

test("five classes, with the old three first so stored data keeps its meaning", () => {
  assert.deepEqual(VEHICLE_TYPES, ["CAR", "BIKE", "HEAVY", "TAXI", "TEMPO"]);
  assert.deepEqual(VEHICLE_KEYS, ["car", "bike", "heavy", "taxi", "tempo"]);
});

test("sumCounts adds every class and treats a missing count as zero (old records)", () => {
  assert.equal(sumCounts({ car: 10, bike: 5, heavy: 2, taxi: 3, tempo: 4 }), 24);
  assert.equal(sumCounts({ car: 10, bike: 5, heavy: 2 }), 17, "an old location has no taxi or tempo yet");
  assert.equal(sumCounts({}), 0);
  assert.equal(sumCounts(undefined), 0);
});

test("a new location starts with zero capacity and zero occupied for every class", () => {
  const location = new Location({ companyId: "64b000000000000000000001", name: "X", address: { line1: "Y" } });
  for (const key of VEHICLE_KEYS) {
    assert.equal(location.capacity[key], 0, `capacity.${key}`);
    assert.equal(location.occupied[key], 0, `occupied.${key}`);
  }
  assert.deepEqual(location.vehicleTypes.toObject ? location.vehicleTypes.toObject() : [...location.vehicleTypes], ["CAR", "BIKE"]);
});
