const router = require("express").Router();
const controller = require("../controllers/locationController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");
const { VEHICLE_TYPES, VEHICLE_KEYS, VEHICLE_CLASSES } = require("../models/constants");

const text = (max = 150) => ({ type: "string", max });
const count = { type: "number", integer: true, min: 0, max: 100000 };
const time = { type: "string", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "must be a time like 09:30" };

const fields = (isCreate) => ({
  name: { type: "string", required: isCreate, min: 2, max: 150 },
  address: {
    type: "object",
    required: isCreate,
    fields: {
      line1: { type: "string", required: isCreate, min: 2, max: 200 },
      city: text(100), state: text(100), pincode: text(10),
    },
  },
  coordinates: {
    type: "object",
    fields: {
      lat: { type: "number", min: -90, max: 90 },
      lng: { type: "number", min: -180, max: 180 },
      // true removes the saved position
      clear: { type: "boolean" },
    },
  },
  contact: { type: "object", fields: { name: text(100), phone: text(20) } },
  operatingHours: {
    type: "object",
    fields: { is24x7: { type: "boolean" }, open: time, close: time },
  },
  parkingType: { type: "string", enum: ["NORMAL", "AIRPORT"] },
  vehicleTypes: { type: "array", max: 10, of: { type: "string", enum: VEHICLE_TYPES } },
  capacity: { type: "object", fields: Object.fromEntries(VEHICLE_KEYS.map((key) => [key, count])) },
  gates: {
    type: "array",
    max: 50,
    of: {
      type: "object",
      fields: {
        name: { type: "string", required: true, max: 50 },
        type: { type: "string", enum: ["ENTRY", "EXIT", "BOTH"] },
        laneCode: { type: "string", max: 30 },
        plazaId: { type: "string", max: 30 },
        fastagLaneId: { type: "string", max: 30 },
        // Sent back for lanes that already exist, so a rename is not mistaken for a removal.
        _id: { type: "objectId" },
        lane: { type: "string", max: 50 },
        vehicleClass: { type: "string", enum: VEHICLE_CLASSES },
        doorNo: { type: "string", max: 30 },
        readerNo: { type: "string", max: 30 },
        fastag: { type: "boolean" },
        gateNo: { type: "string", max: 20 },
        floorNo: { type: "string", max: 20 },
        direction: { type: "string", max: 20 },
        fastagLaneType: { type: "string", max: 30 },
        fastagLaneMode: { type: "string", max: 30 },
        cameraSerial: { type: "string", max: 60 },
        isActive: { type: "boolean" },
        vehicleType: { type: "string", enum: VEHICLE_TYPES },
      },
    },
  },
  zones: { type: "array", max: 100, of: text(50) },
  onlineBooking: {
    type: "object",
    fields: {
      enabled: { type: "boolean" },
      fees: { type: "object", fields: Object.fromEntries(VEHICLE_KEYS.map((key) => [key, { type: "number", min: 0, max: 100000 }])) },
      note: text(300),
      // How long a booking waits after its arrival time (5 minutes to 3 days). 0 = the standard 12 hours.
      waitingMinutes: { type: "number", integer: true, min: 0, max: 4320 },
      // Customers may cancel up to this many minutes before arrival. 0 = they cannot cancel online.
      cancelBeforeMinutes: { type: "number", integer: true, min: 0, max: 10080 },
    },
  },
  receiptSettings: {
    type: "object",
    fields: {
      headerNote: text(120), ticketFooter: text(200), receiptFooter: text(200),
      showAddress: { type: "boolean" }, showGst: { type: "boolean" },
      showQr: { type: "string", enum: ["DEVICE", "ON", "OFF"] },
    },
  },
  reportRecipients: { type: "array", max: 10, of: { type: "string", max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "must be an email address" } },
  operations: {
    type: "object",
    fields: {
      allowReEntry: { type: "boolean" }, exitAmountEdit: { type: "boolean" },
      autoExitHours: { type: "number", integer: true, min: 0, max: 720 },
      printTicketNumber: { type: "boolean" }, printPhoto: { type: "boolean" },
      photoAutoCapture: { type: "boolean" }, printPassReceipt: { type: "boolean" },
      autoExitRules: {
        type: "array",
        max: 10,
        of: {
          type: "object",
          fields: {
            vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
            active: { type: "boolean" },
            days: { type: "number", required: true, integer: true, min: 1, max: 365 },
            amount: { type: "number", min: 0, max: 1000000 },
          },
        },
      },
    },
  },
  ...(isCreate ? {} : { isActive: { type: "boolean" } }),
});

router.use(protect, tenant);

// Any logged-in user can see the locations they are allowed to work at.
router.get("/", controller.listLocations);
router.get("/export", controller.exportLocations);
router.post(
  "/:id/auto-exit/run",
  validateIdParam(),
  requirePermission(PERMISSIONS.LOCATION_MANAGE),
  validateBody({ vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES } }),
  controller.runAutoExit
);
// The Lanes tab: every lane with its operators and devices (?q= search, ?page=, ?limit=). The switch turns one lane on or off.
router.get("/:id/lanes", validateIdParam(), controller.listLanes);
// The Create / Edit Parking Lane form: one lane = one vehicle and one direction. Name, class and numbers follow from it.
const laneFields = (isCreate) => ({
  vehicleType: { type: "string", required: isCreate, enum: VEHICLE_TYPES },
  type: { type: "string", required: isCreate, enum: ["ENTRY", "EXIT"] },
  doorNo: { type: "string", max: 30 },
  readerNo: { type: "string", max: 30 },
  cameraSerial: { type: "string", max: 60 },
  fastag: { type: "boolean" },
  fastagLaneId: { type: "string", max: 30 },
  gateNo: { type: "string", max: 20 },
  floorNo: { type: "string", max: 20 },
  direction: { type: "string", max: 20 },
  fastagLaneType: { type: "string", max: 30 },
  fastagLaneMode: { type: "string", max: 30 },
});
router.post("/:id/lanes", validateIdParam(), requirePermission(PERMISSIONS.LOCATION_MANAGE), validateBody(laneFields(true)), controller.createLane);
router.put("/:id/lanes/:laneId", validateIdParam(), validateIdParam("laneId"), requirePermission(PERMISSIONS.LOCATION_MANAGE), validateBody(laneFields(false)), controller.updateLane);
router.patch(
  "/:id/lanes/:laneId/status",
  validateIdParam(),
  validateIdParam("laneId"),
  requirePermission(PERMISSIONS.LOCATION_MANAGE),
  validateBody({ isActive: { type: "boolean", required: true } }),
  controller.setLaneStatus
);
router.get("/:id", validateIdParam(), controller.getLocation);

router.post(
  "/",
  requirePermission(PERMISSIONS.LOCATION_MANAGE),
  requireCompany,
  validateBody(fields(true)),
  controller.createLocation
);
router.put(
  "/:id",
  validateIdParam(),
  requirePermission(PERMISSIONS.LOCATION_MANAGE),
  validateBody(fields(false)),
  controller.updateLocation
);
router.delete(
  "/:id",
  validateIdParam(),
  requirePermission(PERMISSIONS.LOCATION_MANAGE),
  controller.deactivateLocation
);

module.exports = router;
