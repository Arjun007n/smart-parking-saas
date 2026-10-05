// Unit tests for Week 3 logic that needs no database: the session state
// machine, ticket numbers, local-day ranges and webhook signatures.
process.env.NODE_ENV = "test";
process.env.APP_UTC_OFFSET_MINUTES = "330";
process.env.PAYMENT_WEBHOOK_SECRET = "unit-test-webhook-secret-123456";

const test = require("node:test");
const assert = require("node:assert/strict");
const sessions = require("../services/sessionService");
const { dayRange, localDateStamp } = require("../utils/time");
const gateway = require("../integrations/payment");
const { SESSION_STATUSES } = require("../models/constants");
const { requireAnyPermission } = require("../middleware/permission");
const { ROLES, PERMISSIONS } = require("../config/permissions");

test("state machine covers every status and final statuses never change", () => {
  assert.deepEqual(Object.keys(sessions.TRANSITIONS).sort(), [...SESSION_STATUSES].sort());
  for (const status of ["COMPLETED", "CANCELLED", "LOST_TICKET", "PASS_EXIT", "MANUAL_OVERRIDE"]) {
    assert.deepEqual(sessions.TRANSITIONS[status], [], `${status} must be final`);
    assert.equal(sessions.isOpenStatus(status), false);
  }
  assert.ok(sessions.isOpenStatus("ACTIVE"));
  assert.ok(sessions.isOpenStatus("PAYMENT_PENDING"));
});

test("state machine: allowed and refused moves", () => {
  assert.ok(sessions.canTransition("ACTIVE", "PAYMENT_PENDING"));
  assert.ok(sessions.canTransition("ACTIVE", "COMPLETED")); // nothing to pay
  assert.ok(sessions.canTransition("ACTIVE", "CANCELLED"));
  assert.ok(sessions.canTransition("PAYMENT_PENDING", "COMPLETED"));
  assert.ok(sessions.canTransition("PAYMENT_PENDING", "LOST_TICKET"));
  assert.ok(sessions.canTransition("PAYMENT_PENDING", "MANUAL_OVERRIDE"));

  assert.ok(!sessions.canTransition("PAYMENT_PENDING", "CANCELLED")); // fee already quoted
  assert.ok(!sessions.canTransition("ACTIVE", "LOST_TICKET")); // must be paid first
  assert.ok(!sessions.canTransition("COMPLETED", "ACTIVE")); // no re-opening
  assert.ok(!sessions.canTransition("COMPLETED", "COMPLETED")); // no double exit
  assert.ok(!sessions.canTransition("NOPE", "ACTIVE"));

  assert.throws(() => sessions.assertTransition("COMPLETED", "CANCELLED"), /cannot become/);
  assert.doesNotThrow(() => sessions.assertTransition("ACTIVE", "CANCELLED"));
  assert.deepEqual(sessions.allowedFrom("LOST_TICKET"), ["PAYMENT_PENDING"]);
  assert.deepEqual(sessions.allowedFrom("COMPLETED").sort(), ["ACTIVE", "PAYMENT_PENDING"]);
  // A pass sold after the fee was quoted still lets the vehicle out as a pass exit.
  assert.deepEqual(sessions.allowedFrom("PASS_EXIT").sort(), ["ACTIVE", "PAYMENT_PENDING"]);
});

test("closeSession refuses a status that is not final", async () => {
  await assert.rejects(() => sessions.closeSession("x", "ACTIVE"), /not a final status/);
});

test("ticket numbers: format, date in local time, uniqueness", () => {
  // 20:00 UTC on 1 March is already 2 March in India.
  const ticket = sessions.generateTicketNumber(new Date("2026-03-01T20:00:00Z"));
  assert.match(ticket, sessions.TICKET_PATTERN);
  assert.ok(ticket.startsWith("T-260302-"));
  assert.ok(!/[01IO]/.test(ticket.slice(9)), "no look-alike characters in the random part");

  const many = new Set(Array.from({ length: 2000 }, () => sessions.generateTicketNumber()));
  assert.equal(many.size, 2000);
});

test("ticket numbers typed or scanned in any form are understood", () => {
  assert.equal(sessions.normalizeTicket("t-260302-k7qxmp"), "T-260302-K7QXMP");
  assert.equal(sessions.normalizeTicket(" T260302K7QXMP "), "T-260302-K7QXMP");
  assert.equal(sessions.normalizeTicket("T 260302 K7QXMP"), "T-260302-K7QXMP");
  assert.equal(sessions.normalizeTicket("RJ14AB1234"), null); // a vehicle number, not a ticket
  assert.equal(sessions.normalizeTicket(""), null);
  assert.equal(sessions.normalizeTicket(undefined), null);
});

test("dayRange: a local day in UTC instants", () => {
  const { start, end } = dayRange("2026-03-02");
  assert.equal(start.toISOString(), "2026-03-01T18:30:00.000Z"); // midnight IST
  assert.equal(end.toISOString(), "2026-03-02T18:30:00.000Z");

  // "Today" just after midnight IST is still yesterday in UTC.
  const today = dayRange(undefined, new Date("2026-03-01T19:00:00Z"));
  assert.equal(today.start.toISOString(), "2026-03-01T18:30:00.000Z");

  assert.throws(() => dayRange("02-03-2026"), /must look like/);
  assert.throws(() => dayRange("2026-02-30"), /not a real calendar date/);
  assert.throws(() => dayRange({ $gt: "" }), /must look like/);
  assert.equal(localDateStamp(new Date("2026-12-31T19:00:00Z")), "270101");
});

test("payment webhook signature", () => {
  const body = Buffer.from(JSON.stringify({ transactionId: "ORD-1", status: "SUCCESS" }));
  const good = gateway.sign(body);
  assert.ok(gateway.isGatewayConfigured());
  assert.ok(gateway.verifyWebhookSignature(body, good));

  assert.ok(!gateway.verifyWebhookSignature(body, good.replace(/.$/, "0") === good ? good.replace(/.$/, "1") : good.replace(/.$/, "0")));
  assert.ok(!gateway.verifyWebhookSignature(Buffer.from('{"transactionId":"ORD-1","status":"FAILED"}'), good));
  assert.ok(!gateway.verifyWebhookSignature(body, undefined));
  assert.ok(!gateway.verifyWebhookSignature(body, ["a"]));
  assert.ok(!gateway.verifyWebhookSignature(undefined, good));
  assert.ok(!gateway.verifyWebhookSignature(body, gateway.sign(body, "some-other-secret-0000")));
});

test("payment webhook is refused when no secret is configured", () => {
  const saved = process.env.PAYMENT_WEBHOOK_SECRET;
  const body = Buffer.from("{}");
  process.env.PAYMENT_WEBHOOK_SECRET = "";
  try {
    assert.ok(!gateway.isGatewayConfigured());
    assert.ok(!gateway.verifyWebhookSignature(body, gateway.sign(body, "")));
  } finally {
    process.env.PAYMENT_WEBHOOK_SECRET = saved;
  }
});

test("payment methods: cash, UPI and card are operator-confirmed", () => {
  assert.ok(gateway.isManual("CASH"));
  assert.ok(gateway.isManual("UPI"));
  assert.ok(gateway.isManual("CARD"));
  assert.ok(!gateway.isManual("GATEWAY"));
});

test("requireAnyPermission passes with one matching permission", () => {
  const guard = requireAnyPermission(PERMISSIONS.ENTRY_CREATE, PERMISSIONS.EXIT_CREATE);
  const run = (req) => { let out; guard(req, {}, (e) => { out = e || null; }); return out; };
  assert.equal(run({ user: { role: ROLES.ENTRY_OPERATOR } }), null);
  assert.equal(run({ user: { role: ROLES.EXIT_OPERATOR } }), null);
  assert.equal(run({ user: { role: ROLES.COLLECTION_OPERATOR } }).statusCode, 403);
  assert.equal(run({}).statusCode, 401);
});
