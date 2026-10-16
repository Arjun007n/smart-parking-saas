// Live updates over Server-Sent Events (SSE): one-way, plain HTTP, no extra package.
//
// Two kinds of listener:
//
//  * People's screens (GET /api/live/stream). They are told THAT something changed
//    ("a plate was seen", "a payment arrived") with only ids, never the data itself;
//    the screen then asks the normal API, which applies every permission rule as usual.
//    A screen only hears about its own company and, unless it is company-wide, its own
//    locations.
//  * Gate agents (GET /api/device/stream). A device is told "a command is waiting", so a
//    barrier or printer acts at once instead of at the next poll. The agent keeps polling
//    as a fallback, so a lost stream only costs speed.
//
// Everything here lives in memory of this one server process. With several server
// instances behind a load balancer, events would need a shared channel (for example
// Redis); until then run one instance or rely on the polling fallback.
//
// Rules: a failing client never breaks the code that published an event; a client that
// stops listening is dropped; the number of open streams is capped.

const { subscribe, EVENTS } = require("./eventBus");

const HEARTBEAT_MS = 25 * 1000;
const MAX_PER_USER = 6;
const MAX_TOTAL = Number(process.env.LIVE_MAX_STREAMS) || 500;
// One company cannot use more than this many screens' streams (the others would be starved), and screens can
// never take the last DEVICE_RESERVE places, which stay free for gate agents.
const MAX_PER_COMPANY = Number(process.env.LIVE_MAX_PER_COMPANY) || 60;
const DEVICE_RESERVE = Math.min(
  Math.max(0, process.env.LIVE_DEVICE_RESERVE === undefined || process.env.LIVE_DEVICE_RESERVE === "" ? Math.floor(MAX_TOTAL / 5) : Number(process.env.LIVE_DEVICE_RESERVE) || 0),
  MAX_TOTAL - 1
);
// An open stream is checked again this often: is the person still active, and which locations may they see now?
const RECHECK_MS = Number(process.env.LIVE_RECHECK_MS) || 10 * 60 * 1000;

const people = new Set(); // { res, userId, companyId, locationIds, recheck, checkedAt, checking }
const devices = new Map(); // hardwareId -> { res }
let timer = null;
let unsubscribers = [];

// ---------------------------------------------------------------- writing

const write = (res, text) => {
  try {
    if (res.writableEnded || res.destroyed) return false;
    res.write(text);
    return true;
  } catch {
    return false;
  }
};

// One SSE message. `data` is JSON, always on a single line.
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data === undefined ? {} : data)}\n\n`;

const drop = (client) => {
  people.delete(client);
  try {
    client.res.end();
  } catch {
    // already closed
  }
};

// Asks each screen's `recheck` (when it has one) whether the person may still listen. false = close the stream;
// { locationIds } = the places they may see now. A failing check (database down) changes nothing.
const sweepPeople = async (now = Date.now()) => {
  for (const client of [...people]) {
    if (!client.recheck || client.checking || now - client.checkedAt < RECHECK_MS) continue;
    client.checking = true;
    client.checkedAt = now;
    try {
      const verdict = await client.recheck();
      if (verdict === false) drop(client);
      else if (verdict && typeof verdict === "object" && "locationIds" in verdict) {
        client.locationIds = verdict.locationIds ? verdict.locationIds.map(String) : null;
      }
    } catch {
      // keep the stream; it is checked again next time
    } finally {
      client.checking = false;
    }
  }
};

const startTimer = () => {
  if (timer) return;
  timer = setInterval(() => {
    for (const client of [...people]) if (!write(client.res, ": ping\n\n")) drop(client);
    sweepPeople().catch(() => {});
    for (const [id, entry] of [...devices]) {
      if (!write(entry.res, ": ping\n\n")) {
        devices.delete(id);
        try { entry.res.end(); } catch { /* closed */ }
      }
    }
    if (!people.size && !devices.size) {
      clearInterval(timer);
      timer = null;
    }
  }, HEARTBEAT_MS);
  timer.unref();
};

// Headers that keep proxies from holding the stream back.
const openStream = (req, res) => {
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  write(res, "retry: 3000\n\n");
};

const total = () => people.size + devices.size;

// ----------------------------------------------------------------- people

// locationIds: null = every location of the company; otherwise the ones allowed.
// companyId: null = every company (a platform admin who has not picked one).
// Returns the client, or null when the server is full.
const addPerson = (req, res, { userId, companyId, locationIds, recheck }) => {
  // Screens may not take the places kept for gate agents.
  if (total() >= MAX_TOTAL - DEVICE_RESERVE) return null;
  const company = companyId ? String(companyId) : null;
  if (company && [...people].filter((c) => c.companyId === company).length >= MAX_PER_COMPANY) return null;
  const mine = [...people].filter((c) => c.userId === String(userId));
  // Someone with too many tabs open loses the oldest stream; the page reconnects by itself.
  while (mine.length >= MAX_PER_USER) drop(mine.shift());

  openStream(req, res);
  const client = {
    res,
    userId: String(userId),
    companyId: company,
    locationIds: locationIds ? locationIds.map(String) : null,
    recheck: typeof recheck === "function" ? recheck : null,
    checkedAt: Date.now(),
    checking: false,
  };
  people.add(client);
  write(res, frame("hello", { ok: true }));
  startTimer();
  res.on("close", () => people.delete(client));
  return client;
};

// Closes every screen stream of one person (for example when their account is switched off).
const closeUser = (userId) => {
  let closed = 0;
  for (const client of [...people]) {
    if (client.userId === String(userId)) {
      drop(client);
      closed += 1;
    }
  }
  return closed;
};

const hears = (client, event) => {
  // An event that does not say which company it belongs to is heard by nobody (never by everybody).
  if (!event || !event.companyId) return false;
  if (client.companyId && client.companyId !== String(event.companyId)) return false;
  if (client.locationIds && event.locationId && !client.locationIds.includes(String(event.locationId))) return false;
  return true;
};

// Sends to every screen that may hear it. `message` carries ids only.
const broadcast = (event, message) => {
  const text = frame(event.type || "update", message);
  let sent = 0;
  for (const client of [...people]) {
    if (!hears(client, event)) continue;
    if (write(client.res, text)) sent += 1;
    else drop(client);
  }
  return sent;
};

// ---------------------------------------------------------------- devices

// One stream per device: a new one replaces the old (the agent reconnected).
const addDevice = (req, res, hardwareId) => {
  const id = String(hardwareId);
  if (!devices.has(id) && total() >= MAX_TOTAL) return null;
  const older = devices.get(id);
  if (older) {
    try { older.res.end(); } catch { /* closed */ }
  }
  openStream(req, res);
  const entry = { res };
  devices.set(id, entry);
  write(res, frame("ready", { ok: true }));
  // Anything queued while the agent was away is picked up right now.
  write(res, frame("wake", {}));
  startTimer();
  res.on("close", () => {
    if (devices.get(id) === entry) devices.delete(id);
  });
  return entry;
};

const wakeDevice = (hardwareId) => {
  const entry = devices.get(String(hardwareId));
  if (!entry) return false;
  if (write(entry.res, frame("wake", {}))) return true;
  devices.delete(String(hardwareId));
  return false;
};

// ------------------------------------------------- events from the platform

// The few facts a screen needs to know what to reload. Never names, plates or amounts.
const messages = {
  [EVENTS.ENTRY_CREATED]: (e) => ({ type: "entry", gate: e.session && e.session.entryGate, sessionId: e.session && e.session._id }),
  [EVENTS.EXIT_COMPLETED]: (e) => ({ type: "exit", gate: e.session && e.session.exitGate, sessionId: e.session && e.session._id }),
  [EVENTS.OCCUPANCY_UPDATED]: () => ({ type: "occupancy" }),
  [EVENTS.PAYMENT_RECEIVED]: (e) => ({ type: "payment", status: "SUCCESS", sessionId: e.payment && e.payment.sessionId, paymentId: e.payment && e.payment._id }),
  [EVENTS.PAYMENT_FAILED]: (e) => ({ type: "payment", status: "FAILED", sessionId: e.payment && e.payment.sessionId, paymentId: e.payment && e.payment._id }),
  [EVENTS.ANPR_DETECTED]: (e) => ({
    type: "anpr", detectionId: e.detection && e.detection._id, direction: e.detection && e.detection.direction, gate: e.detection && e.detection.gate,
  }),
  [EVENTS.NOTIFICATION_NEW]: () => ({ type: "notification" }),
  [EVENTS.HARDWARE_ONLINE]: (e) => ({ type: "hardware", hardwareId: e.hardwareId }),
  [EVENTS.HARDWARE_OFFLINE]: (e) => ({ type: "hardware", hardwareId: e.hardwareId }),
  [EVENTS.HARDWARE_EVENT]: (e) => ({ type: "hardware", hardwareId: e.hardwareId }),
  [EVENTS.HARDWARE_COMMAND_QUEUED]: (e) => ({ type: "command", commandId: e.commandId, status: "PENDING" }),
  [EVENTS.HARDWARE_COMMAND_DONE]: (e) => ({ type: "command", commandId: e.commandId, status: e.status }),
};

// Connects the hub to the platform's event bus (once). Returns a function that disconnects it.
const install = () => {
  if (unsubscribers.length) return uninstall;
  for (const [name, toMessage] of Object.entries(messages)) {
    unsubscribers.push(subscribe(name, (event) => {
      const message = toMessage(event || {});
      broadcast({ type: message.type, companyId: event && event.companyId, locationId: event && event.locationId }, message);
    }));
  }
  unsubscribers.push(subscribe(EVENTS.HARDWARE_COMMAND_QUEUED, (event) => {
    if (event && event.hardwareId) wakeDevice(event.hardwareId);
  }));
  return uninstall;
};

const uninstall = () => {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
};

// For a clean shutdown and for tests.
const closeAll = () => {
  for (const client of [...people]) drop(client);
  for (const [id, entry] of [...devices]) {
    devices.delete(id);
    try { entry.res.end(); } catch { /* closed */ }
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

const stats = () => ({ people: people.size, devices: devices.size });

module.exports = {
  HEARTBEAT_MS, MAX_PER_USER, MAX_TOTAL, MAX_PER_COMPANY, DEVICE_RESERVE, RECHECK_MS,
  frame, addPerson, closeUser, sweepPeople, addDevice, broadcast, wakeDevice, hears, install, uninstall, closeAll, stats,
};
