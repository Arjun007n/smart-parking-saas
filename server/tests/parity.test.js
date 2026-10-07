// Rules behind the booking waiting and cancel times and the transaction groups. No database needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const bookings = require("../services/bookingService");
const online = require("../services/onlineBookingService");
const { groupOf } = require("../controllers/transactionReportController");
const { ROLES, ROLE_PERMISSIONS } = require("../config/permissions");

const at = (minutes, from = new Date("2026-10-06T10:00:00Z")) => new Date(from.getTime() + minutes * 60000);

test("waiting time: a location's own time, else the standard one", () => {
  assert.equal(bookings.waitingMinutesOf(null), bookings.GRACE_HOURS * 60);
  assert.equal(bookings.waitingMinutesOf({ onlineBooking: {} }), bookings.GRACE_HOURS * 60);
  assert.equal(bookings.waitingMinutesOf({ onlineBooking: { waitingMinutes: 0 } }), bookings.GRACE_HOURS * 60);
  assert.equal(bookings.waitingMinutesOf({ onlineBooking: { waitingMinutes: 3 } }), bookings.GRACE_HOURS * 60, "under 5 minutes is not a waiting time");
  assert.equal(bookings.waitingMinutesOf({ onlineBooking: { waitingMinutes: 45 } }), 45);
  assert.equal(bookings.waitingMinutesOf({ onlineBooking: { waitingMinutes: 999999 } }), bookings.MAX_WAITING_MINUTES);
});

test("a booking is held until its arrival time plus the waiting time", () => {
  const expected = new Date("2026-10-06T12:00:00Z");
  assert.equal(bookings.holdUntilFor({ onlineBooking: { waitingMinutes: 30 } }, expected).toISOString(), "2026-10-06T12:30:00.000Z");
  const standard = bookings.holdUntilFor({}, expected);
  assert.equal(standard.getTime() - expected.getTime(), bookings.GRACE_HOURS * 3600000);
  // The cut-off for "the arrival time has already passed" follows the same time.
  const now = new Date("2026-10-06T12:00:00Z");
  assert.equal(now.getTime() - bookings.graceCutoff(now, { onlineBooking: { waitingMinutes: 20 } }).getTime(), 20 * 60000);
});

test("customer cancel: only a confirmed booking, only until the set time before arrival", () => {
  const location = { onlineBooking: { cancelBeforeMinutes: 60 } };
  const now = new Date("2026-10-06T10:00:00Z");
  const booking = (status, minutesAway) => ({ status, expectedAt: at(minutesAway, now) });
  assert.equal(online.cancelBeforeOf(location), 60);
  assert.equal(online.cancelBeforeOf({ onlineBooking: {} }), 0);
  assert.equal(online.canCustomerCancel(booking("BOOKED", 120), location, now), true);
  assert.equal(online.canCustomerCancel(booking("BOOKED", 60), location, now), true, "exactly at the limit still counts");
  assert.equal(online.canCustomerCancel(booking("BOOKED", 59), location, now), false);
  assert.equal(online.canCustomerCancel(booking("ARRIVED", 500), location, now), false);
  assert.equal(online.canCustomerCancel(booking("AWAITING_PAYMENT", 500), location, now), false);
  assert.equal(online.canCustomerCancel(booking("BOOKED", 500), { onlineBooking: { cancelBeforeMinutes: 0 } }, now), false, "0 means customers cannot cancel");
});

test("transactions: statuses fall into the tile groups", () => {
  assert.equal(groupOf("SUCCESS"), "ACCEPTED");
  assert.equal(groupOf("PENDING"), "IN_PROGRESS");
  assert.equal(groupOf("UNKNOWN"), "IN_PROGRESS");
  assert.equal(groupOf("FAILED"), "DECLINED");
  assert.equal(groupOf("REFUNDED"), "REFUNDED");
});

test("the Operator role still has only gate permissions", () => {
  assert.deepEqual([...ROLE_PERMISSIONS[ROLES.GATE_OPERATOR]].sort(), ["ENTRY_CREATE", "EXIT_CREATE", "PAYMENT_COLLECT"]);
});
