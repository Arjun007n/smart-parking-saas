// Live updates (SSE): who hears what, device wake-ups, limits. No database needed:
// a stand-in for the login step supplies the user, the rest is the real handler and hub.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const hub = require("../services/liveHub");
const controller = require("../controllers/liveController");
const { publish, EVENTS } = require("../services/eventBus");
const { errorHandler } = require("../middleware/errorHandler");

const C1 = "64b000000000000000000001";
const C2 = "64b000000000000000000002";
const L1 = "64b0000000000000000000a1";
const L2 = "64b0000000000000000000a2";
const H1 = "64b0000000000000000000b1";
const H2 = "64b0000000000000000000b2";

let server;
let base;
let actor = {};

test.before(async () => {
  hub.install();
  const app = express();
  app.use((req, res, next) => {
    req.user = actor.user;
    req.companyId = actor.companyId;
    req.device = actor.device;
    next();
  });
  app.get("/stream", controller.stream);
  app.get("/device-stream", (req, res) => hub.addDevice(req, res, req.device._id));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  hub.closeAll();
  hub.uninstall();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test.afterEach(() => hub.closeAll());

// Opens a stream and collects what arrives.
const listen = async (path, as) => {
  actor = as;
  const controller = new AbortController();
  const res = await fetch(`${base}${path}`, { signal: controller.signal });
  const seen = { status: res.status, type: res.headers.get("content-type"), text: "", ended: false };
  if (res.status !== 200) {
    seen.text = await res.text();
    return { seen, stop: () => controller.abort() };
  }
  (async () => {
    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        seen.text += decoder.decode(value, { stream: true });
      }
    } catch {
      // aborted
    }
    seen.ended = true;
  })();
  return { seen, stop: () => controller.abort() };
};

const until = async (check, ms = 1500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return check();
};
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const count = (text, needle) => text.split(needle).length - 1;

const locationAdmin = (locations, companyId = C1) => ({
  user: { _id: `u-${Math.random()}`, role: "LOCATION_ADMIN", locationIds: locations },
  companyId,
});
const companyAdmin = (companyId = C1) => ({ user: { _id: `u-${Math.random()}`, role: "COMPANY_ADMIN", locationIds: [] }, companyId });

test("frame writes one SSE message on one line", () => {
  assert.equal(hub.frame("anpr", { a: 1 }), 'event: anpr\ndata: {"a":1}\n\n');
  assert.equal(hub.frame("wake"), "event: wake\ndata: {}\n\n");
  assert.ok(!hub.frame("x", { text: "a\nb" }).slice(0, -2).includes("\n\n"));
});

test("hears: own company, and for restricted people only their locations", () => {
  const person = { companyId: C1, locationIds: [L1] };
  assert.equal(hub.hears(person, { companyId: C1, locationId: L1 }), true);
  assert.equal(hub.hears(person, { companyId: C1, locationId: L2 }), false);
  assert.equal(hub.hears(person, { companyId: C2, locationId: L1 }), false);
  assert.equal(hub.hears(person, { companyId: C1 }), true, "company-level events reach everyone in the company");
  assert.equal(hub.hears({ companyId: C1, locationIds: null }, { companyId: C1, locationId: L2 }), true);
  assert.equal(hub.hears({ companyId: null, locationIds: null }, { companyId: C2, locationId: L2 }), true, "a platform admin without a company hears all");
});

test("a screen hears its own location only, and the message holds ids but no plates", async () => {
  const { seen } = await listen("/stream", locationAdmin([L1]));
  assert.equal(seen.status, 200);
  assert.match(seen.type, /text\/event-stream/);
  assert.ok(await until(() => seen.text.includes("event: hello")));

  const session = { _id: "s1", vehicleNumber: "RJ14AB1234", entryGate: "Gate 1" };
  publish(EVENTS.ENTRY_CREATED, { companyId: C1, locationId: L1, session });
  publish(EVENTS.ENTRY_CREATED, { companyId: C1, locationId: L2, session: { ...session, _id: "s2" } });
  publish(EVENTS.ENTRY_CREATED, { companyId: C2, locationId: L1, session: { ...session, _id: "s3" } });
  assert.ok(await until(() => seen.text.includes('"sessionId":"s1"')));
  await pause();
  assert.equal(count(seen.text, "event: entry"), 1);
  assert.ok(!seen.text.includes("s2") && !seen.text.includes("s3"));
  assert.ok(!seen.text.includes("RJ14AB1234"), "no plate numbers in the stream");
  assert.match(seen.text, /"gate":"Gate 1"/);
});

test("a company admin hears every location of the own company, never another company", async () => {
  const { seen } = await listen("/stream", companyAdmin());
  assert.ok(await until(() => seen.text.includes("event: hello")));
  publish(EVENTS.ANPR_DETECTED, { companyId: C1, locationId: L1, detection: { _id: "d1", direction: "ENTRY", gate: "G" } });
  publish(EVENTS.ANPR_DETECTED, { companyId: C1, locationId: L2, detection: { _id: "d2", direction: "EXIT" } });
  publish(EVENTS.ANPR_DETECTED, { companyId: C2, locationId: L1, detection: { _id: "d3", direction: "ENTRY" } });
  assert.ok(await until(() => count(seen.text, "event: anpr") === 2));
  await pause();
  assert.equal(count(seen.text, "event: anpr"), 2);
  assert.ok(!seen.text.includes("d3"));
});

test("payment and command events are mapped to small messages", async () => {
  const { seen } = await listen("/stream", companyAdmin());
  assert.ok(await until(() => seen.text.includes("event: hello")));
  publish(EVENTS.PAYMENT_RECEIVED, { companyId: C1, locationId: L1, payment: { _id: "p1", sessionId: "s9", amount: 500 } });
  publish(EVENTS.PAYMENT_FAILED, { companyId: C1, locationId: L1, payment: { _id: "p2", sessionId: "s9" } });
  publish(EVENTS.HARDWARE_COMMAND_DONE, { companyId: C1, locationId: L1, hardwareId: H1, commandId: "c1", status: "ACKED" });
  assert.ok(await until(() => seen.text.includes('"status":"ACKED"')));
  assert.match(seen.text, /event: payment\ndata: \{"type":"payment","status":"SUCCESS","sessionId":"s9","paymentId":"p1"\}/);
  assert.match(seen.text, /"status":"FAILED"/);
  assert.ok(!seen.text.includes("500"), "no amounts in the stream");
});

test("narrowing to one location, and refusing a location the person may not see", async () => {
  const narrowed = await listen(`/stream?locationId=${L1}`, companyAdmin());
  assert.ok(await until(() => narrowed.seen.text.includes("event: hello")));
  publish(EVENTS.OCCUPANCY_UPDATED, { companyId: C1, locationId: L2 });
  publish(EVENTS.OCCUPANCY_UPDATED, { companyId: C1, locationId: L1 });
  assert.ok(await until(() => count(narrowed.seen.text, "event: occupancy") === 1));
  await pause();
  assert.equal(count(narrowed.seen.text, "event: occupancy"), 1);

  const forbidden = await listen(`/stream?locationId=${L2}`, locationAdmin([L1]));
  assert.equal(forbidden.seen.status, 403);
  const bad = await listen("/stream?locationId=nope", companyAdmin());
  assert.equal(bad.seen.status, 400);
});

test("one person can keep only a few streams open; the oldest is closed", async () => {
  const me = companyAdmin();
  me.user._id = "same-person";
  const streams = [];
  for (let i = 0; i < hub.MAX_PER_USER + 1; i += 1) {
    streams.push(await listen("/stream", me));
    assert.ok(await until(() => streams[i].seen.text.includes("event: hello")));
  }
  assert.ok(await until(() => streams[0].seen.ended), "the oldest stream was closed");
  assert.equal(streams[hub.MAX_PER_USER].seen.ended, false);
  assert.equal(hub.stats().people, hub.MAX_PER_USER);
});

test("a gate agent is woken on connect and when a command is queued for its own device only", async () => {
  const mine = await listen("/device-stream", { device: { _id: H1 } });
  const other = await listen("/device-stream", { device: { _id: H2 } });
  assert.ok(await until(() => count(mine.seen.text, "event: wake") === 1), "wakes on connect to pick up waiting work");
  await pause();

  publish(EVENTS.HARDWARE_COMMAND_QUEUED, { companyId: C1, locationId: L1, hardwareId: H1, commandId: "c5", commandType: "BARRIER_OPEN" });
  assert.ok(await until(() => count(mine.seen.text, "event: wake") === 2));
  await pause();
  assert.equal(count(other.seen.text, "event: wake"), 1, "the other device slept through it");
  assert.ok(!mine.seen.text.includes("BARRIER_OPEN"), "a wake-up carries nothing to act on");
  assert.equal(hub.wakeDevice("64b0000000000000000000ff"), false);
});

test("a device that reconnects replaces its older stream", async () => {
  const first = await listen("/device-stream", { device: { _id: H1 } });
  assert.ok(await until(() => first.seen.text.includes("event: ready")));
  const second = await listen("/device-stream", { device: { _id: H1 } });
  assert.ok(await until(() => first.seen.ended));
  assert.equal(second.seen.ended, false);
  assert.equal(hub.stats().devices, 1);
});

test("closeAll ends every stream (clean shutdown)", async () => {
  const a = await listen("/stream", companyAdmin());
  const b = await listen("/device-stream", { device: { _id: H1 } });
  assert.ok(await until(() => a.seen.text.includes("hello") && b.seen.text.includes("ready")));
  hub.closeAll();
  assert.ok(await until(() => a.seen.ended && b.seen.ended));
  assert.deepEqual(hub.stats(), { people: 0, devices: 0 });
});
