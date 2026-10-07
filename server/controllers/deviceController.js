// Endpoints called BY devices (and the gate agent), authenticated with a device key.
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const hardware = require("../services/hardwareService");
const anpr = require("../services/anprService");
const { publish, EVENTS } = require("../services/eventBus");
const storage = require("../services/photoStorage");
const { MAX_PHOTOS } = require("../services/photoService");
const ParkingSession = require("../models/ParkingSession");
const HardwareCommand = require("../models/HardwareCommand");
const Hardware = require("../models/Hardware");

const POLL_MS = 2000;

// POST /api/device/heartbeat
// "I am alive." Authenticating already recorded it; the answer tells the
// device who it is and how often to ask for work.
const PREVIEW_URL = /^https?:\/\/\S{1,290}$/;

const heartbeat = async (req, res) => {
  const device = req.device;
  // An ANPR camera (or the gate agent for it) may tell where its live picture is, so the Entry and Exit screens find
  // it without anyone pasting the address. Only the camera's own key can set it, and only http(s).
  const url = req.body && req.body.previewUrl;
  if (device.type === "ANPR_CAMERA" && typeof url === "string" && PREVIEW_URL.test(url) && (device.config || {}).previewUrl !== url) {
    await Hardware.updateOne({ _id: device._id }, { $set: { "config.previewUrl": url } });
  }
  res.json({
    success: true,
    data: {
      serverTime: new Date().toISOString(),
      device: { id: device._id, name: device.name, type: device.type, gate: device.gate, direction: device.direction },
      pollMs: POLL_MS,
    },
  });
};

// GET /api/device/commands
// The device asks for work. Anything it is given must be confirmed through
// POST /api/device/commands/:id/ack or it is offered again.
const nextCommands = async (req, res) => {
  const commands = await hardware.claimCommands(req.device, 5);
  res.json({
    success: true,
    data: {
      commands: commands.map((c) => ({
        id: c._id, type: c.type, payload: c.payload, attempt: c.attempts, expiresAt: c.expiresAt,
      })),
    },
  });
};

// POST /api/device/commands/:id/ack   { ok, error? }
const acknowledge = async (req, res) => {
  const device = req.device;
  const result = await hardware.completeCommand(device, req.params.id, req.body);
  if (!result) throw new AppError("Command not found", 404);
  if (result.notDelivered) throw new AppError("This command was not given to the device", 409);

  const { command, repeated } = result;
  if (!repeated && command.status === "ACKED" && command.type.startsWith("BARRIER_")) {
    // A barrier moved: that is always recorded.
    await audit.record(req, command.type === "BARRIER_OPEN" ? "BARRIER_OPENED" : "BARRIER_CLOSED", {
      companyId: command.companyId, email: `device:${device.name}`,
      entity: "HardwareCommand", entityId: command._id,
      meta: { hardwareId: device._id, sessionId: command.sessionId, requestedBy: command.requestedBy, reason: command.reason },
    });
  }
  if (!repeated) {
    publish(EVENTS.HARDWARE_EVENT, {
      companyId: device.companyId, locationId: device.locationId, hardwareId: device._id,
      event: { type: `COMMAND_${command.status}`, commandId: command._id, commandType: command.type },
    });
  }
  res.json({ success: true, data: { id: command._id, status: command.status, repeated } });
};

// POST /api/device/events   { type, message, severity? }
// The device reports a problem (paper out, relay board not answering...).
const reportEvent = async (req, res) => {
  const { type, message, severity } = req.body;
  await hardware.recordEvent(req.device, type, {
    message, severity: severity || (type === "DEVICE_ERROR" ? "warning" : "info"),
  });
  res.status(201).json({ success: true });
};

// POST /api/device/anpr
// A camera (or the gate agent on its behalf) reports a number plate.
const reportPlate = async (req, res) => {
  if (req.device.type !== "ANPR_CAMERA") throw new AppError("Only an ANPR camera can report plates", 403);
  const { detection, duplicate } = await anpr.ingest(req.device, req.body);
  res.status(duplicate ? 200 : 201).json({
    success: true,
    data: {
      id: detection._id, duplicate, plate: detection.plate, direction: detection.direction, vehicleType: detection.vehicleType, needsReview: detection.needsReview,
      reviewReasons: detection.reviewReasons, hits: detection.hits,
    },
  });
};

// POST /api/device/rfid
// A UHF / RFID reader (or the gate agent for it) reports a tag it read.
const reportTag = async (req, res) => {
  if (req.device.type !== "RFID_READER") throw new AppError("Only an RFID reader can report tags", 403);
  const result = await anpr.ingestTag(req.device, req.body);
  if (result.unknown) return res.json({ success: true, data: { known: false } });
  const { detection, duplicate, pass } = result;
  res.status(duplicate ? 200 : 201).json({
    success: true,
    data: {
      known: true, id: detection._id, duplicate, plate: detection.plate, passNumber: pass.passNumber,
      needsReview: detection.needsReview, reviewReasons: detection.reviewReasons, hits: detection.hits,
    },
  });
};

// POST /api/device/fastag
// A FASTag reader (or the gate agent for it) reports a tag and the vehicle number.
const reportFastag = async (req, res) => {
  if (req.device.type !== "FASTAG_READER") throw new AppError("Only a FASTag reader can report FASTags", 403);
  const { detection, duplicate } = await anpr.ingestFastag(req.device, req.body);
  res.status(duplicate ? 200 : 201).json({
    success: true,
    data: {
      id: detection._id, duplicate, plate: detection.plate, needsReview: detection.needsReview,
      reviewReasons: detection.reviewReasons, hits: detection.hits,
    },
  });
};

// POST /api/device/snapshots?commandId=...
// The CCTV camera's picture for a CAPTURE_SNAPSHOT command it was given. The body is the
// picture itself. It is filed under the ticket's photos (ENTRY or EXIT). Sending the same
// picture again for the same command adds nothing. The agent confirms the command afterwards.
const uploadSnapshot = async (req, res) => {
  const device = req.device;
  if (device.type !== "CCTV_CAMERA") throw new AppError("Only a CCTV camera can send snapshots", 403);
  if (!mongoose.isValidObjectId(req.query.commandId)) throw new AppError("commandId is required", 400);

  const command = await HardwareCommand.findOne({ _id: req.query.commandId, hardwareId: device._id, type: "CAPTURE_SNAPSHOT" });
  if (!command) throw new AppError("Command not found", 404);
  if (!command.sentAt) throw new AppError("This command was not given to the device", 409);
  if (command.status === "FAILED") throw new AppError("This command has already failed", 409);

  const session = await ParkingSession.findOne({ _id: command.sessionId, companyId: device.companyId });
  if (!session) throw new AppError("Parking session not found", 404);
  const sameCommand = (s) => (s.photos || []).find((p) => String(p.deviceCommandId) === String(command._id));
  const again = sameCommand(session);
  if (again) return res.json({ success: true, data: { photo: again, repeated: true } });

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError("Send the picture as the request body with Content-Type image/jpeg, image/png or image/webp", 415);
  }
  const type = storage.detectType(body);
  const said = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!type || type.contentType !== said) throw new AppError("This is not a valid JPEG, PNG or WebP picture", 415);

  const key = await storage.save(session.companyId, body, type.ext);
  const photo = {
    _id: new mongoose.Types.ObjectId(),
    kind: (command.payload && command.payload.kind) === "EXIT" ? "EXIT" : "ENTRY",
    file: key, contentType: type.contentType, bytes: body.length,
    takenByDevice: device.name, deviceCommandId: command._id,
  };
  // Checked in the same step as the insert: two uploads cannot both slip past the limit or the repeat check.
  const updated = await ParkingSession.findOneAndUpdate(
    {
      _id: session._id,
      "photos.deviceCommandId": { $ne: command._id },
      $expr: { $lt: [{ $size: { $ifNull: ["$photos", []] } }, MAX_PHOTOS] },
    },
    { $push: { photos: photo } },
    { returnDocument: "after" }
  );
  if (!updated) {
    await storage.remove(key);
    const latest = await ParkingSession.findById(session._id);
    const stored = latest && sameCommand(latest);
    if (stored) return res.json({ success: true, data: { photo: stored, repeated: true } });
    throw new AppError(`This ticket already has the most photos allowed (${MAX_PHOTOS})`, 409);
  }
  res.status(201).json({ success: true, data: { photo: updated.photos.id(photo._id), repeated: false } });
};

module.exports = { heartbeat, nextCommands, acknowledge, reportEvent, reportPlate, reportTag, reportFastag, uploadSnapshot, POLL_MS };
