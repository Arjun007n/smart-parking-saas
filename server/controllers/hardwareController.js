// Admin and operator endpoints for devices (called by logged-in users).
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const agentPackage = require("../services/agentPackage");
const hardware = require("../services/hardwareService");
const barrier = require("../integrations/barrier");
const printer = require("../integrations/printer");
const cctv = require("../integrations/cctv");
const { locationScopedFilter, getAccessibleLocation, locationIdFromQuery } = require("../utils/scope");
const Hardware = require("../models/Hardware");
const HardwareEvent = require("../models/HardwareEvent");
const HardwareCommand = require("../models/HardwareCommand");
const { HARDWARE_TYPES } = require("../models/Hardware");

const findInScope = async (req) => {
  const device = await Hardware.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!device) throw new AppError("Device not found", 404);
  return device;
};

// Only the config fields a client may set.
const configPaths = (config = {}) => {
  const out = {};
  for (const key of ["minConfidence", "pulseMs", "paperWidthMm", "autoPrint", "printQr", "previewUrl"]) {
    if (config[key] !== undefined) out[`config.${key}`] = config[key];
  }
  return out;
};

// An entry-only device cannot sit at an exit gate, and the other way round.
const assertGateFits = (location, gate, direction) => {
  if (!gate || !direction || direction === "BOTH") return;
  const found = (location.gates || []).find((g) => g.name === gate);
  if (found && found.type !== "BOTH" && found.type !== direction) {
    throw new AppError(`Gate "${gate}" is an ${found.type.toLowerCase()} gate, but this device is for ${direction.toLowerCase()}`, 400);
  }
};

// Device keys must never be cached by a browser or a proxy.
const noStore = (res) => res.set("Cache-Control", "no-store");

// GET /api/hardware?locationId=&type=
const listDevices = async (req, res) => {
  const conditions = [locationScopedFilter(req)];
  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId });
  if (req.query.type !== undefined) {
    if (!HARDWARE_TYPES.includes(req.query.type)) throw new AppError("Unknown device type", 400);
    conditions.push({ type: req.query.type });
  }
  const devices = await Hardware.find({ $and: conditions }).sort({ locationId: 1, name: 1 }).limit(500);
  const now = new Date();
  res.json({ success: true, data: devices.map((d) => hardware.withStatus(d, now)) });
};

// POST /api/hardware
// The device key is in the answer ONCE. It cannot be shown again.
const createDevice = async (req, res) => {
  const { locationId, gate, config, ...fields } = req.body;
  const location = await getAccessibleLocation(req, locationId);
  if (gate && location.gates.length && !location.gates.some((g) => g.name === gate)) {
    throw new AppError("That gate does not exist at this location", 400);
  }
  assertGateFits(location, gate, fields.direction);

  const key = hardware.generateDeviceKey();
  let device;
  try {
    device = await Hardware.create({
      ...fields,
      gate,
      config,
      companyId: location.companyId,
      locationId: location._id,
      keyHash: key.hash,
      keyPrefix: key.prefix,
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("A device with this name already exists at this location", 409);
    throw error;
  }

  await audit.record(req, "HARDWARE_CREATE", {
    entity: "Hardware", entityId: device._id, companyId: device.companyId,
    meta: { name: device.name, type: device.type, locationId: device.locationId },
  });
  noStore(res);
  res.status(201).json({ success: true, data: { device: hardware.withStatus(device), deviceKey: key.raw } });
};

// GET /api/hardware/:id
const getDevice = async (req, res) => {
  const device = await findInScope(req);
  const [events, commands] = await Promise.all([
    HardwareEvent.find({ hardwareId: device._id }).sort({ createdAt: -1 }).limit(20),
    HardwareCommand.find({ hardwareId: device._id }).sort({ createdAt: -1 }).limit(10).select("-payload"),
  ]);
  res.json({ success: true, data: { device: hardware.withStatus(device), events, commands } });
};

// PUT /api/hardware/:id
const updateDevice = async (req, res) => {
  const device = await findInScope(req);
  const { config, gate, ...fields } = req.body;

  if ((gate !== undefined && gate) || fields.direction !== undefined || gate !== undefined) {
    const location = await getAccessibleLocation(req, device.locationId);
    if (gate && location.gates.length && !location.gates.some((g) => g.name === gate)) {
      throw new AppError("That gate does not exist at this location", 400);
    }
    assertGateFits(location, gate !== undefined ? gate : device.gate, fields.direction || device.direction);
  }
  device.set({ ...fields, ...(gate !== undefined ? { gate } : {}), ...configPaths(config) });
  if (fields.isActive === false) device.isOnline = false;

  try {
    await device.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("A device with this name already exists at this location", 409);
    throw error;
  }
  await audit.record(req, "HARDWARE_UPDATE", {
    entity: "Hardware", entityId: device._id, companyId: device.companyId,
    meta: { changed: Object.keys(req.body) },
  });
  res.json({ success: true, data: hardware.withStatus(device) });
};

// POST /api/hardware/:id/rotate-key
// Use when a key may have leaked or a device was replaced. The old key stops
// working at once.
const rotateKey = async (req, res) => {
  const device = await findInScope(req);
  const key = hardware.generateDeviceKey();
  device.keyHash = key.hash;
  device.keyPrefix = key.prefix;
  device.isOnline = false;
  await device.save();

  await audit.record(req, "HARDWARE_KEY_ROTATE", {
    entity: "Hardware", entityId: device._id, companyId: device.companyId, meta: { name: device.name },
  });
  await hardware.recordEvent(device, "KEY_ROTATED", { message: "A new device key was issued" });
  noStore(res);
  res.json({ success: true, data: { device: hardware.withStatus(device), deviceKey: key.raw } });
};

// GET /api/hardware/:id/events
const listEvents = async (req, res) => {
  const device = await findInScope(req);
  const events = await HardwareEvent.find({ hardwareId: device._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: events });
};

// POST /api/hardware/:id/commands   { type, reason }
// An admin acts on a device by hand (open the barrier, print a test slip).
// Always recorded in the audit log with the reason.
const MANUAL_TYPES = { BARRIER: ["BARRIER_OPEN", "BARRIER_CLOSE"], PRINTER: ["PRINT_TEST"], CCTV_CAMERA: ["SNAPSHOT_TEST"] };

const createManualCommand = async (req, res) => {
  const device = await findInScope(req);
  const { type, reason } = req.body;
  if (!device.isActive) throw new AppError("This device is switched off", 409);
  if (!(MANUAL_TYPES[device.type] || []).includes(type)) {
    throw new AppError(`${type} cannot be sent to a ${device.type.replace("_", " ").toLowerCase()}`, 400);
  }

  const spec = type.startsWith("BARRIER_")
    ? barrier.buildBarrierCommand(type, device)
    : type === "SNAPSHOT_TEST"
      ? cctv.buildSnapshotTest()
      : { type, payload: printer.toPayload(printer.buildTest(device, { paperWidthMm: device.config.paperWidthMm })), ...printer.COMMAND_DEFAULTS[type] };
  const { command } = await hardware.createCommand(device, spec, { requestedBy: req.user._id, reason });

  await audit.record(req, "HARDWARE_COMMAND", {
    entity: "HardwareCommand", entityId: command._id, companyId: device.companyId,
    meta: { hardwareId: device._id, deviceName: device.name, type, reason },
  });
  res.status(201).json({ success: true, data: { id: command._id, status: command.status } });
};

// GET /api/hardware/commands/:id
// Lets the screen follow "opening barrier..." until the device confirms.
const getCommand = async (req, res) => {
  const command = await HardwareCommand.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] })
    .select("-payload");
  if (!command) throw new AppError("Command not found", 404);
  const device = await Hardware.findById(command.hardwareId).select("name");
  res.json({
    success: true,
    data: {
      id: command._id, type: command.type, status: command.status, attempts: command.attempts,
      error: command.error, deviceName: device && device.name, expiresAt: command.expiresAt,
      completedAt: command.completedAt,
    },
  });
};

// GET /api/hardware/agent-package   (zip of the gate agent, with this server's address filled in)
const downloadAgent = (req, res) => {
  const configured = String(process.env.PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  const host = String(req.get("host") || "");
  const serverUrl = /^https?:\/\/[\w.\-:]+$/i.test(configured)
    ? configured
    : /^[\w.\-]+(:\d{1,5})?$/.test(host) ? `${req.protocol}://${host}` : "http://localhost:5000";
  let built;
  try {
    built = agentPackage.build({ serverUrl });
  } catch (error) {
    if (error.status === 404) throw new AppError(error.message, 404);
    throw error;
  }
  audit.record(req, "AGENT_DOWNLOADED", { entity: "Hardware", meta: { bytes: built.data.length } });
  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${built.name}"`,
    "Content-Length": String(built.data.length),
    "Cache-Control": "no-store",
  });
  res.send(built.data);
};

// GET /api/hardware/agent-package/info   (is the download offered by this server?)
const agentInfo = (req, res) => {
  res.json({ success: true, data: { available: agentPackage.isAvailable() } });
};

module.exports = {
  downloadAgent, agentInfo,
  listDevices, createDevice, getDevice, updateDevice, rotateKey, listEvents, createManualCommand, getCommand,
};
