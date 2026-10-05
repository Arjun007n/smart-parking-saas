// What operators see of ANPR: the list of plate suggestions and a way to reject one.
// Using one happens through the normal entry / exit requests (detectionId).
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { locationScopedFilter, locationIdFromQuery, getAccessibleLocation } = require("../utils/scope");
const { can } = require("../middleware/permission");
const { PERMISSIONS: P } = require("../config/permissions");
const anpr = require("../services/anprService");
const recognition = require("../integrations/recognition");
const photoStorage = require("../services/photoStorage");
const photoService = require("../services/photoService");
const AnprDetection = require("../models/AnprDetection");
const Hardware = require("../models/Hardware");
const { pickDevice } = require("../services/hardwareService");
const { DETECTION_STATUSES } = require("../models/AnprDetection");

// GET /api/anpr?locationId=&status=PENDING&direction=
const listDetections = async (req, res) => {
  const status = req.query.status === undefined ? "PENDING" : req.query.status;
  if (!DETECTION_STATUSES.includes(status)) throw new AppError("Unknown status", 400);
  const conditions = [locationScopedFilter(req), { status }];

  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId });
  if (req.query.direction !== undefined) {
    if (!["ENTRY", "EXIT"].includes(req.query.direction)) throw new AppError("direction must be ENTRY or EXIT", 400);
    conditions.push({ direction: req.query.direction });
  }

  const detections = await AnprDetection.find({ $and: conditions }).sort({ lastSeenAt: -1 }).limit(50);
  res.json({ success: true, data: detections });
};

// POST /api/anpr/:id/dismiss   (a wrong or irrelevant reading)
const dismissDetection = async (req, res) => {
  const found = await AnprDetection.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!found) throw new AppError("Detection not found", 404);

  const detection = await AnprDetection.findOneAndUpdate(
    { _id: found._id, status: "PENDING" },
    { $set: { status: "DISMISSED", resolvedBy: req.user._id, resolvedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!detection) throw new AppError("This detection was already handled", 409);

  await audit.record(req, "ANPR_DISMISS", {
    entity: "AnprDetection", entityId: detection._id, companyId: detection.companyId,
    meta: { cameraRead: detection.plateRaw, confidence: detection.confidence, imageUrl: detection.imageUrl },
  });
  res.json({ success: true, data: detection });
};

// GET /api/anpr/options   (does this server read plates from photos?)
const options = (req, res) => {
  res.json({
    success: true,
    data: {
      photoReading: recognition.isEnabled(), maxBytes: photoService.maxBytes(),
      simulated: recognition.isEnabled() && recognition.providerName() === "simulated",
    },
  });
};

// POST /api/anpr/read?locationId=&direction=ENTRY|EXIT
// The body is the picture (Content-Type image/jpeg, image/png or image/webp).
// The picture is sent to the recognition provider and is NOT stored. The
// answer is a suggestion; use it by sending its id as detectionId with the
// normal entry / exit request.
const readPhoto = async (req, res) => {
  const { direction } = req.query;
  if (!["ENTRY", "EXIT"].includes(direction)) throw new AppError("direction must be ENTRY or EXIT", 400);
  if (!can(req, direction === "ENTRY" ? P.ENTRY_CREATE : P.EXIT_CREATE)) {
    throw new AppError("You do not have permission to do this", 403);
  }
  if (!recognition.isEnabled()) throw new AppError("Reading plates from photos is not switched on", 503);

  const location = await getAccessibleLocation(req, req.query.locationId, { mustBeActive: true });

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError("Send the photo as the request body with Content-Type image/jpeg, image/png or image/webp", 415);
  }
  const type = photoStorage.detectType(body);
  if (!type) throw new AppError("This file is not a JPEG, PNG or WebP picture", 415);

  // Only the simulated reader looks at ?testPlate= (to try the screens with any picture).
  const hint = typeof req.query.testPlate === "string" ? req.query.testPlate.slice(0, 20) : undefined;
  const reading = await recognition.read(body, type, { hint });
  const result = await anpr.ingestPhotoReading(
    { companyId: location.companyId, locationId: location._id, direction, userId: req.user._id },
    reading
  );

  await audit.record(req, "ANPR_PHOTO_READ", {
    entity: "AnprDetection", entityId: result.detection ? result.detection._id : undefined, companyId: location.companyId,
    meta: {
      locationId: location._id, direction, provider: recognition.providerName(),
      read: result.parsed.plateRaw, confidence: result.parsed.confidence, readable: Boolean(result.parsed.plate),
    },
  });

  res.json({
    success: true,
    data: {
      detection: result.detection,
      plate: result.parsed.plate,
      confidence: result.parsed.confidence,
      reviewReasons: result.reasons,
      readable: Boolean(result.parsed.plate),
    },
  });
};

// GET /api/anpr/preview?locationId=&direction=ENTRY|EXIT&gate=
// The address of the live picture of the camera at this gate, for the entry and exit screens.
// Only people who may use that gate are told; the address carries a secret token, so another
// website that guesses the port still cannot show the picture. Answers { hasCamera, previewUrl, camera }:
// hasCamera says whether a gate camera is registered for this gate and direction (the screens then use it
// instead of the computer's own camera); previewUrl is null when it has no live picture address.
const preview = async (req, res) => {
  const { direction } = req.query;
  if (!["ENTRY", "EXIT"].includes(direction)) throw new AppError("direction must be ENTRY or EXIT", 400);
  const gate = typeof req.query.gate === "string" ? req.query.gate.slice(0, 50) : "";
  const location = await getAccessibleLocation(req, req.query.locationId);
  const cameras = await Hardware.find({ locationId: location._id, type: "ANPR_CAMERA", isActive: true }).sort({ createdAt: 1 });
  const camera = pickDevice(cameras, { gate, direction });
  const url = camera && camera.config && camera.config.previewUrl;
  // When none fits this gate, say which camera exists but is set up differently, so the screen can tell the operator what to change.
  const other = !camera && cameras[0] ? { name: cameras[0].name, direction: cameras[0].direction, gate: cameras[0].gate || "" } : null;
  res.json({ success: true, data: { hasCamera: Boolean(camera), previewUrl: url || null, camera: camera ? camera.name : null, elsewhere: other } });
};

module.exports = { listDetections, dismissDetection, options, readPhoto, preview };
