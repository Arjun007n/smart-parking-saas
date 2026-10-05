const express = require("express");

const router = express.Router();
const controller = require("../controllers/parkingController");
const photos = require("../controllers/photoController");
const photoService = require("../services/photoService");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");

const canSeeSessions = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW);
const reason = { reason: { type: "string", required: true, min: 5, max: 300 } };

router.use(protect, tenant);

router.post(
  "/entry",
  requirePermission(P.ENTRY_CREATE),
  validateBody({
    locationId: { type: "objectId", required: true },
    vehicleNumber: { type: "string", required: true, max: 20 },
    vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
    gate: { type: "string", max: 50 },
    // Any unique text made by the client for this entry attempt.
    idempotencyKey: { type: "string", min: 8, max: 100 },
    // The camera suggestion this entry settles (see /api/anpr).
    detectionId: { type: "objectId" },
    // Money taken at the gate, set against the fee when the vehicle leaves.
    // Needs the permission to collect payments.
    advance: {
      type: "object",
      fields: {
        amount: { type: "number", min: 0, max: 100000 },
        method: { type: "string", enum: ["CASH", "UPI", "CARD", "FASTAG"] },
        transactionId: { type: "string", max: 100 },
      },
    },
  }),
  controller.createEntry
);
router.get("/entries", canSeeSessions, controller.listEntries);

router.post(
  "/exit",
  requirePermission(P.EXIT_CREATE),
  validateBody({
    locationId: { type: "objectId", required: true },
    ticketNumber: { type: "string", max: 30 },
    vehicleNumber: { type: "string", max: 20 },
    lostTicket: { type: "boolean" },
    gate: { type: "string", max: 50 },
    detectionId: { type: "objectId" },
  }),
  controller.startExit
);
router.get("/exits", canSeeSessions, controller.listExits);

router.get("/sessions/:id", validateIdParam(), canSeeSessions, controller.getSession);
router.get("/sessions/:id/receipt", validateIdParam(), canSeeSessions, controller.getReceipt);

// Photos of the vehicle. The upload body is the picture itself (not JSON), read
// here with a size limit; only real JPEG, PNG and WebP files are accepted.
const canSeePhotos = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW, P.LOCATION_MANAGE);
router.post(
  "/sessions/:id/photos",
  validateIdParam(),
  requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.LOCATION_MANAGE),
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: photoService.maxBytes() }),
  photos.addPhoto
);
router.get("/sessions/:id/photos/:photoId", validateIdParam(), validateIdParam("photoId"), canSeePhotos, photos.getPhoto);
router.delete("/sessions/:id/photos/:photoId", validateIdParam(), validateIdParam("photoId"), requirePermission(P.LOCATION_MANAGE), photos.removePhoto);

const canOperate = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE);
// `gate` is only needed when a location has several devices that cannot be told apart.
const gateOnly = validateBody({ gate: { type: "string", max: 50 } });
router.post(
  "/barrier",
  canOperate,
  validateBody({
    locationId: { type: "objectId", required: true },
    direction: { type: "string", required: true, enum: ["ENTRY", "EXIT"] },
    gate: { type: "string", max: 50 },
    reason: { type: "string", max: 200 },
  }),
  controller.openBarrierByHand
);
router.post("/sessions/:id/barrier", validateIdParam(), canOperate, gateOnly, controller.requestBarrier);
router.post(
  "/sessions/:id/re-entry",
  validateIdParam(),
  requirePermission(P.ENTRY_CREATE),
  validateBody({ gate: { type: "string", max: 50 }, vehicleType: { type: "string", enum: VEHICLE_TYPES } }),
  controller.reEntry
);
router.post("/sessions/:id/print", validateIdParam(), canOperate, gateOnly, controller.printSlip);

// Corrections are for admins and are always recorded in the audit log.
router.post(
  "/sessions/:id/cancel",
  validateIdParam(),
  requirePermission(P.LOCATION_MANAGE),
  validateBody(reason),
  controller.cancelSession
);
router.post(
  "/sessions/:id/override",
  validateIdParam(),
  requirePermission(P.LOCATION_MANAGE),
  validateBody(reason),
  controller.overrideSession
);

module.exports = router;
