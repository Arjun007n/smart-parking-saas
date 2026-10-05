const express = require("express");

const router = express.Router();
const controller = require("../controllers/deviceController");
const { deviceAuth } = require("../middleware/deviceAuth");
const { validateBody, validateIdParam } = require("../middleware/validate");
const photoService = require("../services/photoService");
const hub = require("../services/liveHub");
const AppError = require("../utils/AppError");

hub.install(); // events -> screens and gate agents

// Everything here is called by devices with their own key, never by users.
router.use(deviceAuth);

router.post("/heartbeat", controller.heartbeat);
// The gate agent keeps this open and is woken the moment a command is queued for the device.
router.get("/stream", (req, res, next) => {
  if (!hub.addDevice(req, res, req.device._id)) return next(new AppError("Too many live connections", 503));
  return undefined;
});
router.get("/commands", controller.nextCommands);
router.post(
  "/commands/:id/ack",
  validateIdParam(),
  validateBody({ ok: { type: "boolean", required: true }, error: { type: "string", max: 300 } }),
  controller.acknowledge
);
router.post(
  "/events",
  validateBody({
    type: { type: "string", required: true, enum: ["DEVICE_ERROR", "DEVICE_INFO"] },
    message: { type: "string", required: true, max: 300 },
    severity: { type: "string", enum: ["info", "warning", "critical"] },
  }),
  controller.reportEvent
);
router.post(
  "/anpr",
  validateBody({
    plate: { type: "string", max: 40 },
    confidence: { type: "number", min: 0, max: 100 },
    eventId: { type: "string", max: 100 },
    capturedAt: { type: "date" },
    imageUrl: { type: "string", max: 500, pattern: /^https?:\/\/\S+$/, message: "must be an http(s) address" },
    // AUTO: a camera set up for both directions lets the server decide (see anprService.ingest).
    direction: { type: "string", enum: ["ENTRY", "EXIT", "AUTO"] },
  }),
  controller.reportPlate
);

router.post(
  "/rfid",
  validateBody({
    tag: { type: "string", required: true, max: 60 },
    eventId: { type: "string", max: 100 },
    capturedAt: { type: "date" },
    direction: { type: "string", enum: ["ENTRY", "EXIT"] },
  }),
  controller.reportTag
);
router.post(
  "/fastag",
  validateBody({
    plate: { type: "string", max: 40 },
    tagId: { type: "string", max: 60 },
    confidence: { type: "number", min: 0, max: 100 },
    eventId: { type: "string", max: 100 },
    capturedAt: { type: "date" },
    direction: { type: "string", enum: ["ENTRY", "EXIT"] },
  }),
  controller.reportFastag
);
// The body is the picture itself.
router.post(
  "/snapshots",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: photoService.maxBytes() }),
  controller.uploadSnapshot
);

module.exports = router;
