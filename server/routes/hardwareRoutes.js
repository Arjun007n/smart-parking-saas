const router = require("express").Router();
const controller = require("../controllers/hardwareController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { HARDWARE_TYPES, DIRECTIONS } = require("../models/Hardware");

const config = {
  type: "object",
  fields: {
    minConfidence: { type: "number", min: 0, max: 1 },
    pulseMs: { type: "number", integer: true, min: 100, max: 10000 },
    paperWidthMm: { type: "number", min: 58, max: 80 },
    autoPrint: { type: "boolean" },
    printQr: { type: "boolean" },
    previewUrl: { type: "string", max: 300, pattern: /^https?:\/\/\S+$/, message: "must be an http(s) address" },
  },
};

const common = (isCreate) => ({
  name: { type: "string", required: isCreate, min: 2, max: 100 },
  gate: { type: "string", max: 50 },
  direction: { type: "string", enum: DIRECTIONS },
  vendor: { type: "string", max: 80 },
  model: { type: "string", max: 80 },
  monitorOnline: { type: "boolean" },
  offlineAfterSeconds: { type: "number", integer: true, min: 30, max: 3600 },
  config,
});

router.use(protect, tenant);

const canView = requireAnyPermission(P.LOCATION_MANAGE, P.REPORT_VIEW);
const canFollow = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.LOCATION_MANAGE);

router.get("/agent-package/info", requirePermission(P.LOCATION_MANAGE), controller.agentInfo);
router.get("/agent-package", requirePermission(P.LOCATION_MANAGE), controller.downloadAgent);
router.get("/", canView, controller.listDevices);
router.post(
  "/",
  requirePermission(P.LOCATION_MANAGE),
  validateBody({
    ...common(true),
    locationId: { type: "objectId", required: true },
    type: { type: "string", required: true, enum: HARDWARE_TYPES },
  }),
  controller.createDevice
);

// Before "/:id" so "commands" is not read as an id.
router.get("/commands/:id", validateIdParam(), canFollow, controller.getCommand);

router.get("/:id", validateIdParam(), canView, controller.getDevice);
router.put(
  "/:id",
  validateIdParam(),
  requirePermission(P.LOCATION_MANAGE),
  validateBody({ ...common(false), isActive: { type: "boolean" } }),
  controller.updateDevice
);
router.post("/:id/rotate-key", validateIdParam(), requirePermission(P.LOCATION_MANAGE), controller.rotateKey);
router.get("/:id/events", validateIdParam(), canView, controller.listEvents);
router.post(
  "/:id/commands",
  validateIdParam(),
  requirePermission(P.LOCATION_MANAGE),
  validateBody({
    type: { type: "string", required: true, enum: ["BARRIER_OPEN", "BARRIER_CLOSE", "PRINT_TEST", "SNAPSHOT_TEST"] },
    reason: { type: "string", required: true, min: 5, max: 300 },
  }),
  controller.createManualCommand
);

module.exports = router;
