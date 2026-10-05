const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const { WakeStream, parseSse } = require("../lib/wakeStream");
const { DeviceWorker } = require("../lib/worker");

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return check();
};

// A stand-in for GET /api/device/stream. `streams` holds every open response.
const fakeServer = (options = {}) => {
  const state = { streams: [], keys: [], hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    state.keys.push(req.headers["x-device-key"]);
    if (options.status) {
      res.writeHead(options.status, { "content-type": "application/json" });
      return res.end("{}");
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("retry: 3000\n\nevent: ready\ndata: {}\n\n");
    if (!options.silent) res.write("event: wake\ndata: {}\n\n");
    state.streams.push(res);
  });
  return { server, state };
};

test("parseSse: complete messages, comments ignored, unfinished tail kept", () => {
  const { events, rest } = parseSse(": ping\n\nevent: wake\ndata: {}\n\nevent: rea");
  assert.deepEqual(events, [{ event: "wake" }]);
  assert.equal(rest, "event: rea");
  assert.deepEqual(parseSse("event: ready\r\ndata: {}\r\n\r\n").events, [{ event: "ready" }]);
});

test("wake stream: sends the device key, calls onWake for each wake message", async () => {
  const { server, state } = fakeServer();
  const port = await listen(server);
  let wakes = 0;
  const stream = new WakeStream({ serverUrl: `http://127.0.0.1:${port}/`, key: "hwk_abc", onWake: () => { wakes += 1; } });
  stream.start();
  try {
    assert.ok(await until(() => wakes === 1), "wakes once when it connects");
    assert.equal(state.keys[0], "hwk_abc");
    assert.ok(await until(() => stream.connected));
    state.streams[0].write("event: wake\ndata: {}\n\n");
    state.streams[0].write(": ping\n\n");
    assert.ok(await until(() => wakes === 2));
  } finally {
    stream.stop();
    state.streams.forEach((r) => r.end());
    server.close();
  }
});

test("wake stream: reconnects by itself after the server hangs up", async () => {
  const { server, state } = fakeServer();
  const port = await listen(server);
  let wakes = 0;
  const stream = new WakeStream({ serverUrl: `http://127.0.0.1:${port}`, key: "hwk_abc", onWake: () => { wakes += 1; }, minDelay: 20, maxDelay: 50 });
  stream.start();
  try {
    assert.ok(await until(() => wakes === 1));
    state.streams[0].end();
    assert.ok(await until(() => wakes === 2), "woken again on the new connection");
    assert.equal(state.hits, 2);
  } finally {
    stream.stop();
    state.streams.forEach((r) => r.end());
    server.close();
  }
});

test("wake stream: a silent, dead line is dropped and opened again", async () => {
  const { server, state } = fakeServer({ silent: true });
  const port = await listen(server);
  const stream = new WakeStream({ serverUrl: `http://127.0.0.1:${port}`, key: "hwk_abc", onWake: () => {}, minDelay: 20, maxDelay: 50, silenceMs: 150 });
  stream.start();
  try {
    assert.ok(await until(() => state.hits >= 2, 3000), "no message for a while means: connect again");
  } finally {
    stream.stop();
    state.streams.forEach((r) => r.end());
    server.close();
  }
});

test("wake stream: a refused key or an old server just means normal polling, and stop() ends it", async () => {
  const { server, state } = fakeServer({ status: 401 });
  const port = await listen(server);
  let wakes = 0;
  const stream = new WakeStream({ serverUrl: `http://127.0.0.1:${port}`, key: "hwk_bad", onWake: () => { wakes += 1; }, minDelay: 10, maxDelay: 5000 });
  stream.start();
  try {
    assert.ok(await until(() => state.hits >= 1));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(state.hits, 1, "does not hammer the server");
    assert.equal(wakes, 0);
  } finally {
    stream.stop();
    server.close();
  }
  const hits = state.hits;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(state.hits, hits);
});

const barrier = { name: "B", key: "hwk_x", type: "BARRIER", driver: "simulated" };

test("worker: a wake-up message makes it ask for commands at once, long before the next poll", async () => {
  const { server, state } = fakeServer({ silent: true });
  const port = await listen(server);
  const queue = [];
  const client = {
    heartbeat: async () => {},
    commands: async () => ({ commands: queue.splice(0) }),
    ack: async () => {},
  };
  const worker = new DeviceWorker({
    serverUrl: `http://127.0.0.1:${port}`, device: barrier, client, instant: true, pollMs: 60000, heartbeatMs: 60000, wakeOptions: { minDelay: 20 },
  });
  const opened = [];
  worker.driver = { open: async (o) => opened.push(o), close: async () => {} };
  worker.start();
  try {
    assert.ok(await until(() => state.streams.length === 1));
    await new Promise((r) => setTimeout(r, 50)); // the first poll has run; the next is a minute away
    queue.push({ id: "c1", type: "BARRIER_OPEN", payload: { pulseMs: 100 } });
    const asked = Date.now();
    state.streams[0].write("event: wake\ndata: {}\n\n");
    assert.ok(await until(() => opened.length === 1, 1500));
    assert.ok(Date.now() - asked < 1500);
  } finally {
    worker.stop();
    state.streams.forEach((r) => r.end());
    server.close();
  }
});

test("worker: wake-ups never make two polls run at the same time; one more run follows a busy one", async () => {
  let running = 0;
  let overlapped = false;
  let polls = 0;
  const client = {
    heartbeat: async () => {},
    commands: async () => {
      polls += 1;
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, 40));
      running -= 1;
      return { commands: [] };
    },
    ack: async () => {},
  };
  const worker = new DeviceWorker({ serverUrl: "http://x", device: barrier, client, pollMs: 60000, heartbeatMs: 60000 });
  worker.start();
  try {
    await new Promise((r) => setTimeout(r, 5)); // first poll is running
    const nudge = worker.nudges[0];
    nudge(); nudge(); nudge(); // three wake-ups while busy
    assert.ok(await until(() => polls === 2 && running === 0, 1000));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(polls, 2, "three wake-ups while busy cause exactly one more poll");
    assert.equal(overlapped, false);
    nudge(); // idle: runs now, not in a minute
    assert.ok(await until(() => polls === 3, 1000));
  } finally {
    worker.stop();
  }
});

test("worker: devices that take no commands open no wake stream; a test client opens none either", () => {
  const camera = new DeviceWorker({ serverUrl: "http://127.0.0.1:1", device: { name: "C", key: "hwk_x", type: "ANPR_CAMERA" }, instant: true });
  camera.start();
  assert.equal(camera.wake, null);
  camera.stop();
  const fake = new DeviceWorker({ serverUrl: "http://127.0.0.1:1", device: barrier, client: { heartbeat: async () => {}, commands: async () => ({ commands: [] }) } });
  fake.start();
  assert.equal(fake.wake, null);
  fake.stop();
});

test("worker: stop() closes the wake stream", async () => {
  const { server, state } = fakeServer({ silent: true });
  const port = await listen(server);
  const client = { heartbeat: async () => {}, commands: async () => ({ commands: [] }), ack: async () => {} };
  const worker = new DeviceWorker({ serverUrl: `http://127.0.0.1:${port}`, device: barrier, client, instant: true, pollMs: 60000, heartbeatMs: 60000 });
  worker.start();
  assert.ok(await until(() => state.streams.length === 1));
  const closed = new Promise((r) => state.streams[0].on("close", r));
  worker.stop();
  await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error("stream stayed open")), 1500))]);
  server.close();
});
