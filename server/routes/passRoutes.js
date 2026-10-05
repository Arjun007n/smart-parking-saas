const router = require("express").Router();
const controller = require("../controllers/passController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");
const { PASS_PAYMENT_METHODS } = require("../models/PassPayment");
const { PASS_TYPES, PASS_UNITS, MAX_PASS_VEHICLES } = require("../models/Pass");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = {
  amount: { type: "number", required: true, min: 0, max: 10000000 },
  method: { type: "string", required: true, enum: PASS_PAYMENT_METHODS },
  transactionId: { type: "string", min: 4, max: 100 },
  taxPercent: { type: "number", min: 0, max: 100 },
  // How long: `months` (older clients), or `unit` + `count`.
  months: { type: "number", integer: true, min: 1, max: 36 },
  unit: { type: "string", enum: PASS_UNITS },
  count: { type: "number", integer: true, min: 1, max: 366 },
  // Where the money was taken (and which shift's cash it counts in).
  locationId: { type: "objectId", required: true },
};
const plate = { type: "string", required: true, max: 20 };
const maxVehicles = { type: "number", integer: true, min: 1, max: MAX_PASS_VEHICLES };
const reason = { reason: { type: "string", required: true, min: 5, max: 300 } };

router.use(protect, tenant);

// Gate staff check whether a vehicle has a valid pass.
router.get("/lookup", requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.PASS_MANAGE), controller.lookupPass);

router.use(requirePermission(P.PASS_MANAGE));
router.get("/", controller.listPasses);
router.get("/:id", validateIdParam(), controller.getPass);

router.post(
  "/",
  requireCompany,
  validateBody({
    ...money,
    vehicleNumber: plate,
    vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
    // More vehicles that share the pass (the main vehicle is the one above).
    extraVehicles: {
      type: "array", max: MAX_PASS_VEHICLES - 1,
      of: { type: "object", fields: { vehicleNumber: plate, vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES } } },
    },
    maxVehicles,
    passType: { type: "string", enum: PASS_TYPES },
    holderName: { type: "string", required: true, min: 2, max: 100 },
    phone: { type: "string", max: 20 },
    email: { type: "string", max: 254 },
    notes: { type: "string", max: 300 },
    startDate: { type: "string", pattern: DATE, message: "must look like 2026-03-02" },
    locationIds: { type: "array", of: { type: "objectId" }, max: 50 },
  }),
  controller.createPass
);
router.post("/:id/renew", validateIdParam(), validateBody(money), controller.renewPass);
router.post("/:id/suspend", validateIdParam(), validateBody(reason), controller.suspendPass);
router.post("/:id/resume", validateIdParam(), controller.resumePass);
router.post("/:id/cancel", validateIdParam(), validateBody(reason), controller.cancelPass);
router.post(
  "/:id/vehicles",
  validateIdParam(),
  validateBody({ vehicleNumber: plate, vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES }, reason: { type: "string", max: 300 } }),
  controller.addVehicle
);
router.post("/:id/vehicles/remove", validateIdParam(), validateBody({ vehicleNumber: plate, ...reason }), controller.removeVehicle);
// Sets (or, with an empty tag, clears) the UHF / RFID tag of one vehicle on the pass.
router.put(
  "/:id/vehicles/tag",
  validateIdParam(),
  validateBody({ vehicleNumber: plate, tag: { type: "string", max: 60 } }),
  controller.setVehicleTag
);
router.post(
  "/:id/vehicles/replace",
  validateIdParam(),
  validateBody({ from: plate, to: plate, vehicleType: { type: "string", enum: VEHICLE_TYPES }, ...reason }),
  controller.replaceVehicle
);
router.put(
  "/:id",
  validateIdParam(),
  validateBody({
    holderName: { type: "string", min: 2, max: 100 },
    phone: { type: "string", max: 20 },
    email: { type: "string", max: 254 },
    notes: { type: "string", max: 300 },
    locationIds: { type: "array", of: { type: "objectId" }, max: 50 },
    passType: { type: "string", enum: PASS_TYPES },
    maxVehicles,
  }),
  controller.updatePass
);

module.exports = router;
