// Advance payments: the pure rules (no database needed).
const test = require("node:test");
const assert = require("node:assert/strict");
const advances = require("../services/advanceService");
const AppError = require("../utils/AppError");

test("split: the advance pays the fee first, the customer pays the rest", () => {
  assert.deepEqual(advances.split(40, 15), { applied: 15, due: 25, excess: 0 });
  assert.deepEqual(advances.split(40, 40), { applied: 40, due: 0, excess: 0 });
  assert.deepEqual(advances.split(40, 100), { applied: 40, due: 0, excess: 60 });
  assert.deepEqual(advances.split(40, 0), { applied: 0, due: 40, excess: 0 });
});

test("split: a free exit gives the whole advance back", () => {
  assert.deepEqual(advances.split(0, 50), { applied: 0, due: 0, excess: 50 });
});

test("split: amounts are rounded to paise and never negative", () => {
  assert.deepEqual(advances.split(33.9, 10.1), { applied: 10.1, due: 23.8, excess: 0 });
  assert.deepEqual(advances.split(0.3, 0.1 + 0.2), { applied: 0.3, due: 0, excess: 0 });
  assert.deepEqual(advances.split(-5, -5), { applied: 0, due: 0, excess: 0 });
  assert.deepEqual(advances.split("x", undefined), { applied: 0, due: 0, excess: 0 });
});

test("amountDue: the fee less the advance, or the whole fee for older sessions", () => {
  assert.equal(advances.amountDue({ fee: { total: 40, due: 25 } }), 25);
  assert.equal(advances.amountDue({ fee: { total: 40, due: 0 } }), 0);
  assert.equal(advances.amountDue({ fee: { total: 40 } }), 40);
});

test("checkAdvance: nothing, or a clean { amount, method, transactionId }", () => {
  assert.equal(advances.checkAdvance(undefined, true), null);
  assert.equal(advances.checkAdvance(null, true), null);
  assert.equal(advances.checkAdvance({ amount: 0 }, true), null, "an amount of 0 is no advance");
  assert.deepEqual(advances.checkAdvance({ amount: 50 }, true), { amount: 50, method: "CASH" });
  assert.deepEqual(advances.checkAdvance({ amount: 50.456, method: "UPI", transactionId: "  U-1 " }, true), {
    amount: 50.46, method: "UPI", transactionId: "U-1",
  });
});

test("checkAdvance: needs the permission, a sensible amount and an offline method", () => {
  assert.throws(() => advances.checkAdvance({ amount: 50 }, false), (e) => e instanceof AppError && e.statusCode === 403);
  assert.throws(() => advances.checkAdvance({ amount: advances.MAX_ADVANCE + 1 }, true), (e) => e.statusCode === 400);
  assert.throws(() => advances.checkAdvance({ amount: 50, method: "GATEWAY" }, true), (e) => e.statusCode === 400);
  // No permission needed when there is no advance.
  assert.equal(advances.checkAdvance({ amount: 0 }, false), null);
});
