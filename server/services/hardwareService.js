// Everything the platform does with devices: keys, online/offline tracking,
// the command queue and the "after entry / after exit" automation.
//
// Rule of the house: hardware is unreliable. Nothing here may break an entry,
// an exit or a payment. Automation failures are logged and reported to the
// operator, who always has the manual process.

const crypto = require("crypto");
const Hardware = require("../models/Hardware");
const HardwareEvent = require("../models/HardwareEvent");
const HardwareCommand = require("../models/HardwareCommand");
const AnprDetection = require("../models/AnprDetection");
const Company = require("../models/Company");
const Location = require("../models/Location");
const { publish, EVENTS } = require("./eventBus");
const { notifyHardwareOffline } = require("./notificationService");
const barrier = require("../integrations/barrier");
const printer = require("../integrations/printer");
const cctv = require("../integrations/cctv");

const KEY_PREFIX = "hwk_";
const hashKey = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

// The raw key is shown to the admin once; only the hash is stored.
const generateDeviceKey = () => {
  const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 12) };
};

// ONLINE / OFFLINE / UNMONITORED / NEVER_SEEN / DISABLED, from the device's own
// last contact (so it is right even between two sweeps).
const statusOf = (device, now = new Date()) => {
  if (!device.isActive) return "DISABLED";
  if (!device.lastSeenAt) return "NEVER_SEEN";
  const ageSeconds = (now.getTime() - new Date(device.lastSeenAt).getTime()) / 1000;
  const fresh = ageSeconds <= (device.offlineAfterSeconds || 120);
  if (device.monitorOnline === false) return "UNMONITORED";
  return fresh ? "ONLINE" : "OFFLINE";
};

const withStatus = (device, now = new Date()) => ({ ...device.toJSON(), status: statusOf(device, now) });

// Records something worth knowing about a device. Never throws.
const recordEvent = async (device, type, { severity = "info", message, data } = {}) => {
  try {
    const event = await HardwareEvent.create({
      companyId: device.companyId, locationId: device.locationId, hardwareId: device._id,
      type, severity, message, data,
    });
    publish(EVENTS.HARDWARE_EVENT, { companyId: device.companyId, locationId: device.locationId, hardwareId: device._id, event });
    return event;
  } catch (error) {
    console.error(`Hardware event failed (${type}):`, error.message);
    return null;
  }
};

// Called whenever a device contacts the server: it is alive.
const touchDevice = async (device, { ip, agentVersion } = {}) => {
  const now = new Date();
  const before = await Hardware.findOneAndUpdate(
    { _id: device._id },
    { $set: { lastSeenAt: now, isOnline: true, lastIp: ip, ...(agentVersion ? { agentVersion } : {}) } },
    { returnDocument: "before" }
  );
  if (before && !before.isOnline) {
    publish(EVENTS.HARDWARE_ONLINE, { companyId: device.companyId, locationId: device.locationId, hardwareId: device._id });
    await recordEvent(before, "ONLINE", { message: `${before.name} is online` });
  }
};

// ---------------------------------------------------------------- commands

const isDuplicateKey = (error) => error && error.code === 11000;

// Queues a command. The same idempotencyKey for the same device returns the
// command that already exists.
const createCommand = async (device, spec, { sessionId, requestedBy, reason, idempotencyKey } = {}) => {
  const now = new Date();
  const doc = {
    companyId: device.companyId,
    locationId: device.locationId,
    hardwareId: device._id,
    type: spec.type,
    payload: spec.payload,
    maxAttempts: spec.maxAttempts,
    ackTimeoutSeconds: spec.ackTimeoutSeconds,
    availableAt: now,
    expiresAt: new Date(now.getTime() + spec.ttlSeconds * 1000),
    sessionId, requestedBy, reason, idempotencyKey,
  };
  try {
    const command = await HardwareCommand.create(doc);
    // Wakes the device's gate agent at once (it still polls, as a fallback) and tells screens.
    publish(EVENTS.HARDWARE_COMMAND_QUEUED, {
      companyId: device.companyId, locationId: device.locationId, hardwareId: device._id, commandId: command._id, commandType: command.type,
    });
    return { command, repeated: false };
  } catch (error) {
    if (!isDuplicateKey(error) || !idempotencyKey) throw error;
    const existing = await HardwareCommand.findOne({ hardwareId: device._id, idempotencyKey });
    return { command: existing, repeated: true };
  }
};

// Hands a device its next commands. A command that was handed out but never
// confirmed becomes available again after its ack timeout, up to maxAttempts.
const claimCommands = async (device, limit = 5) => {
  const claimed = [];
  // A few extra rounds allow for losing a race to another poll of the same device.
  for (let round = 0; round < limit * 2 && claimed.length < limit; round += 1) {
    const now = new Date();
    const candidate = await HardwareCommand.findOne({
      hardwareId: device._id,
      status: { $in: ["PENDING", "SENT"] },
      availableAt: { $lte: now },
      expiresAt: { $gt: now },
      $expr: { $lt: ["$attempts", "$maxAttempts"] },
    }).sort({ createdAt: 1 });
    if (!candidate) break;

    // Guarded on the values just read, so two polls can never both get it.
    const command = await HardwareCommand.findOneAndUpdate(
      { _id: candidate._id, status: candidate.status, attempts: candidate.attempts },
      {
        $set: {
          status: "SENT",
          sentAt: now,
          availableAt: new Date(now.getTime() + candidate.ackTimeoutSeconds * 1000),
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" }
    );
    if (command) claimed.push(command);
  }
  return claimed;
};

// The device reports the result. Reporting twice is harmless.
// Returns { command, repeated } or null when the command is not this device's.
const completeCommand = async (device, commandId, { ok, error }) => {
  const now = new Date();
  const command = await HardwareCommand.findOne({ _id: commandId, hardwareId: device._id });
  if (!command) return null;
  if (command.status === "ACKED" || command.status === "FAILED") return { command, repeated: true };
  if (!command.sentAt) return { command, notDelivered: true };

  const message = typeof error === "string" ? error.slice(0, 300) : undefined;
  let updated;
  if (ok) {
    // Also accepted after the deadline, or while it waits to be handed out
    // again: the action really happened.
    updated = await HardwareCommand.findOneAndUpdate(
      { _id: command._id, status: { $in: ["SENT", "EXPIRED", "PENDING"] } },
      { $set: { status: "ACKED", completedAt: now }, $unset: { error: "" } },
      { returnDocument: "after" }
    );
  } else {
    const retry = command.attempts < command.maxAttempts && command.expiresAt > now;
    updated = await HardwareCommand.findOneAndUpdate(
      { _id: command._id, status: "SENT" },
      {
        $set: retry
          ? { status: "PENDING", availableAt: new Date(now.getTime() + 2000), error: message }
          : { status: "FAILED", completedAt: now, error: message },
      },
      { returnDocument: "after" }
    );
    if (updated && updated.status === "FAILED") {
      await recordEvent(device, "COMMAND_FAILED", {
        severity: "warning", message: `${command.type} failed: ${message || "no reason given"}`,
        data: { commandId: command._id, sessionId: command.sessionId },
      });
    }
  }
  const latest = updated || (await HardwareCommand.findById(command._id));
  if (updated && latest) {
    publish(EVENTS.HARDWARE_COMMAND_DONE, {
      companyId: device.companyId, locationId: device.locationId, hardwareId: device._id, commandId: latest._id, status: latest.status,
    });
  }
  return { command: latest, repeated: !updated };
};

// ---------------------------------------------- choosing the right device

// Picks the device for a gate. A device must be active and suit the direction
// (an exit-only barrier is never used for an entry). Then, best first:
// the device tied to this gate; a device for exactly this direction; a device
// for both directions. A device tied to a different gate is never used.
//
// If two devices tie for the best place, the answer is "none": lifting the
// wrong barrier is worse than asking the operator to lift the right one.
// (Fix it by giving each device its own gate name.)
const pickDevice = (devices, { gate, direction }) => {
  const rank = (d) => {
    if (gate && d.gate === gate) return 0;
    if (d.direction === direction) return d.gate ? 2 : 1;
    return 3; // BOTH
  };
  const usable = devices.filter(
    (d) => d.isActive && (d.direction === "BOTH" || d.direction === direction) && (!gate || !d.gate || d.gate === gate)
  );
  if (usable.length === 0) return null;
  const best = Math.min(...usable.map(rank));
  const top = usable.filter((d) => rank(d) === best);
  if (top.length > 1) {
    console.warn(`Hardware: ${top.length} devices match ${direction} gate "${gate || "any"}"; none used (give each its own gate)`);
    return null;
  }
  return top[0];
};

const devicesAt = (locationId, type) => Hardware.find({ locationId, type, isActive: true }).sort({ createdAt: 1 });

// -------------------------------------------------------- barrier & print

// A command that can still be delivered: waiting or handed out, not past its
// deadline, with attempts left.
const isLive = (command, now = new Date()) =>
  ["PENDING", "SENT"].includes(command.status) && command.expiresAt > now && command.attempts < command.maxAttempts;

const MAX_BARRIER_REQUESTS = 4; // the first one and three retries

// Asks the barrier at a gate to open for a session that is cleared to pass:
// a new entry (direction ENTRY) or a completed exit (direction EXIT).
//
// Safe to call twice: while a request is still live, or once one worked, the
// same command comes back. Only after every earlier request failed or timed
// out is a new one queued (an operator pressing retry), and then the key is
// numbered, so two taps at the same moment still make just one.
const requestBarrierOpen = async ({ session, direction, gate, requestedBy, reason }) => {
  const device = pickDevice(await devicesAt(session.locationId, "BARRIER"), { gate, direction });
  if (!device) return null;

  const base = `open:${direction}:${session._id}`;
  const spec = barrier.buildBarrierCommand("BARRIER_OPEN", device);
  const earlier = await HardwareCommand.find({
    hardwareId: device._id, sessionId: session._id, type: "BARRIER_OPEN",
    idempotencyKey: { $regex: `^${base}(:|$)` },
  }).sort({ createdAt: 1 });

  const now = new Date();
  const worked = earlier.find((c) => c.status === "ACKED");
  if (worked) return { device, command: worked, repeated: true };
  const live = earlier.find((c) => isLive(c, now));
  if (live) return { device, command: live, repeated: true };
  if (earlier.length >= MAX_BARRIER_REQUESTS) {
    return { device, command: earlier[earlier.length - 1], repeated: true };
  }

  const key = earlier.length === 0 ? base : `${base}:retry:${earlier.length}`;
  const created = await createCommand(device, spec, {
    sessionId: session._id, requestedBy, reason, idempotencyKey: key,
  });
  return { device, command: created.command, repeated: created.repeated };
};

// Lifts a barrier by hand, with no vehicle or ticket behind it (the "Open barrier" button, for a
// vehicle the system cannot see, a test, or a failed automatic lift). Taps within MANUAL_WINDOW_SECONDS
// by the same person on the same barrier are one command. Returns null when no single barrier matches.
const MANUAL_WINDOW_SECONDS = 5;
const requestManualBarrier = async ({ locationId, direction, gate, requestedBy, reason }) => {
  const device = pickDevice(await devicesAt(locationId, "BARRIER"), { gate, direction });
  if (!device) return null;
  const spec = barrier.buildBarrierCommand("BARRIER_OPEN", device);
  const slot = Math.floor(Date.now() / (MANUAL_WINDOW_SECONDS * 1000));
  const created = await createCommand(device, spec, {
    requestedBy, reason: reason || "Opened by hand", idempotencyKey: `manual:${direction}:${requestedBy}:${slot}`,
  });
  return { device, command: created.command, repeated: created.repeated };
};

// Automatic prints are made once per session (a repeated request returns the
// same job). A person asking again gets a new slip, except that tapping twice
// while the first slip is still waiting is one slip.
const requestPrint = async ({ type, session, build, gate, direction, requestedBy, auto = false }) => {
  const device = pickDevice(await devicesAt(session.locationId, "PRINTER"), { gate, direction });
  if (!device) return null;
  if (auto && device.config && device.config.autoPrint === false) return null;

  if (!auto) {
    const waiting = await HardwareCommand.findOne({
      hardwareId: device._id, sessionId: session._id, type, status: { $in: ["PENDING", "SENT"] }, expiresAt: { $gt: new Date() },
      $expr: { $lt: ["$attempts", "$maxAttempts"] },
    });
    if (waiting) return { device, command: waiting, repeated: true };
  }

  const options = { paperWidthMm: device.config && device.config.paperWidthMm, printQr: Boolean(device.config && device.config.printQr) };
  const spec = { type, payload: printer.toPayload(await build(options)), ...printer.COMMAND_DEFAULTS[type] };
  const { command, repeated } = await createCommand(device, spec, {
    sessionId: session._id, requestedBy, idempotencyKey: auto ? `print:auto:${type}:${session._id}` : undefined,
  });
  return { device, command, repeated };
};

const requestTicketPrint = (args) => {
  const { session } = args;
  return requestPrint({
    ...args, type: "PRINT_TICKET", direction: "ENTRY", gate: args.gate || session.entryGate,
    build: async (options) => {
      const [company, location] = await Promise.all([
        Company.findById(session.companyId).select("name gstNumber"),
        Location.findById(session.locationId).select("name address receiptSettings operations"),
      ]);
      return printer.buildTicket({ company, location, session, settings: location && location.receiptSettings, operations: location && location.operations }, options);
    },
  });
};

const requestReceiptPrint = (args) => {
  const { session, receipt } = args;
  return requestPrint({
    ...args, type: "PRINT_RECEIPT", direction: "EXIT", gate: args.gate || session.exitGate,
    // `receipt` may be the receipt itself or a function that builds it.
    build: async (options) => printer.buildReceipt(typeof receipt === "function" ? await receipt() : receipt, options),
  });
};

// Asks the CCTV camera at a gate for a picture of this vehicle. The picture arrives
// later (the gate agent uploads it) and is filed under the ticket's photos. Once per
// session and direction; a missing or silent camera never matters to the caller.
const requestSnapshot = async ({ session, direction, gate }) => {
  const device = pickDevice(await devicesAt(session.locationId, "CCTV_CAMERA"), { gate, direction });
  if (!device) return null;
  const spec = cctv.buildSnapshotCommand({ kind: direction, sessionId: session._id });
  const { command, repeated } = await createCommand(device, spec, {
    sessionId: session._id, idempotencyKey: `snap:${direction}:${session._id}`,
  });
  return { device, command, repeated };
};

const summarize = (result) =>
  result ? { deviceName: result.device.name, commandId: result.command._id, status: result.command.status } : null;

// Never lets a device problem reach the caller. Returns { result, problem }:
// `problem` is true when something broke (as opposed to "no device set up"),
// so the screen can tell the operator to do it by hand.
const safely = async (label, work) => {
  try {
    return { result: summarize(await work()), problem: false };
  } catch (error) {
    console.error(`${label} failed:`, error.message);
    return { result: null, problem: true };
  }
};

const settle = ([barrierOutcome, printOutcome]) => ({
  barrier: barrierOutcome.result,
  print: printOutcome ? printOutcome.result : null,
  problem: Boolean(barrierOutcome.problem || (printOutcome && printOutcome.problem)),
});

// After a ticket was issued: raise the entry barrier and print the ticket.
const afterEntry = async ({ session, requestedBy }) => {
  // The CCTV picture is a bonus: it is asked for, but its outcome never changes the answer.
  const snapshot = safely("Entry snapshot", () => requestSnapshot({ session, direction: "ENTRY", gate: session.entryGate }));
  const outcome = settle(await Promise.all([
    safely("Entry barrier", () =>
      requestBarrierOpen({ session, direction: "ENTRY", gate: session.entryGate, requestedBy })),
    safely("Ticket printing", () =>
      requestTicketPrint({ session, requestedBy, auto: true })),
  ]));
  await snapshot;
  return outcome;
};

// After a vehicle was cleared to leave (paid, free or overridden): raise the exit barrier.
// The receipt is NOT printed by itself: the operator prints it with the "Print bill" button
// (pass `print: true` to print it automatically).
const afterExit = async ({ session, requestedBy, print = false }) => {
  const { buildReceipt } = require("./receiptService");
  const snapshot = safely("Exit snapshot", () => requestSnapshot({ session, direction: "EXIT", gate: session.exitGate }));
  const outcome = settle(await Promise.all([
    safely("Exit barrier", () =>
      requestBarrierOpen({ session, direction: "EXIT", gate: session.exitGate, requestedBy })),
    print
      ? safely("Receipt printing", () =>
          requestReceiptPrint({ session, receipt: () => buildReceipt(session), requestedBy, auto: true }))
      : null,
  ]));
  await snapshot;
  return outcome;
};

// The barrier and printer commands raised for a session after it was paid, in
// the same shape afterExit returns. For screens that did not start the payment
// themselves (an online payment confirmed by the gateway while they waited).
const summaryForSession = async (sessionId) => {
  const commands = await HardwareCommand.find({ sessionId, type: { $in: ["BARRIER_OPEN", "PRINT_RECEIPT"] } })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("hardwareId", "name");
  const latest = (type) => {
    const command = commands.find((c) => c.type === type);
    return command
      ? { deviceName: command.hardwareId?.name, commandId: command._id, status: command.status }
      : null;
  };
  return { barrier: latest("BARRIER_OPEN"), print: latest("PRINT_RECEIPT"), problem: false };
};

// ------------------------------------------------------------------ sweep

const ANPR_PENDING_MINUTES = 15;

// Housekeeping, run every half minute: marks silent devices offline, expires
// commands that missed their deadline and drops stale plate suggestions.
const sweep = async (now = new Date()) => {
  let offline = 0;
  let expired = 0;

  const online = await Hardware.find({ isActive: true, monitorOnline: true, isOnline: true });
  for (const device of online) {
    if (!device.lastSeenAt) continue;
    const silentFor = now.getTime() - device.lastSeenAt.getTime();
    if (silentFor <= (device.offlineAfterSeconds || 120) * 1000) continue;
    // Guarded: if it just spoke again, leave it online.
    const changed = await Hardware.findOneAndUpdate(
      { _id: device._id, isOnline: true, lastSeenAt: device.lastSeenAt },
      { $set: { isOnline: false } },
      { returnDocument: "after" }
    );
    if (!changed) continue;
    offline += 1;
    publish(EVENTS.HARDWARE_OFFLINE, { companyId: device.companyId, locationId: device.locationId, hardwareId: device._id });
    await recordEvent(device, "OFFLINE", { severity: "warning", message: `${device.name} stopped reporting` });
    await notifyHardwareOffline(device);
  }

  // Handed out as often as allowed and never confirmed: it has failed.
  const spent = await HardwareCommand.find({
    status: "SENT", availableAt: { $lte: now }, expiresAt: { $gt: now },
    $expr: { $gte: ["$attempts", "$maxAttempts"] },
  }).limit(200);
  let failed = 0;
  for (const command of spent) {
    const changed = await HardwareCommand.findOneAndUpdate(
      { _id: command._id, status: "SENT", attempts: command.attempts },
      { $set: { status: "FAILED", completedAt: now, error: command.error || "The device never confirmed it" } },
      { returnDocument: "after" }
    );
    if (!changed) continue;
    failed += 1;
    const device = await Hardware.findById(command.hardwareId);
    if (device) {
      await recordEvent(device, "COMMAND_FAILED", {
        severity: "warning", message: `${command.type} was handed out ${command.attempts} times and never confirmed`,
        data: { commandId: command._id, sessionId: command.sessionId },
      });
    }
  }

  const late = await HardwareCommand.find({ status: { $in: ["PENDING", "SENT"] }, expiresAt: { $lte: now } }).limit(200);
  for (const command of late) {
    const changed = await HardwareCommand.findOneAndUpdate(
      { _id: command._id, status: { $in: ["PENDING", "SENT"] } },
      { $set: { status: "EXPIRED", completedAt: now, error: command.error || "Not completed in time" } },
      { returnDocument: "after" }
    );
    if (!changed) continue;
    expired += 1;
    const device = await Hardware.findById(command.hardwareId);
    if (device) {
      await recordEvent(device, "COMMAND_EXPIRED", {
        severity: "warning", message: `${command.type} was not completed in time`,
        data: { commandId: command._id, sessionId: command.sessionId },
      });
    }
  }

  const stale = new Date(now.getTime() - ANPR_PENDING_MINUTES * 60000);
  const detections = await AnprDetection.updateMany(
    { status: "PENDING", lastSeenAt: { $lt: stale } },
    { $set: { status: "EXPIRED" } }
  );

  return { offline, expired, failed, detectionsExpired: detections.modifiedCount || 0 };
};

module.exports = {
  KEY_PREFIX, hashKey, generateDeviceKey, statusOf, withStatus, recordEvent, touchDevice,
  createCommand, claimCommands, completeCommand, pickDevice, devicesAt,
  requestBarrierOpen, requestManualBarrier, requestTicketPrint, requestReceiptPrint, requestSnapshot, afterEntry, afterExit, summaryForSession, sweep,
};
