const router = require("express").Router();
const controller = require("../controllers/passController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");
const { PASS_PAYMENT_METHODS } = require("../models/PassPayment");
const { PASS_TYPES, PASS_UNITS, PASS_APPROVALS, MAX_PASS_VEHICLES } = require("../models/Pass");

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
router.get("/summary", controller.passSummary);
router.get("/vehicles", controller.listPassVehicles);
router.get("/invoices", controller.passInvoices);
router.get("/users", controller.listPassUsers);
router.post(
  "/bulk-upload",
  requireCompany,
  validateBody({
    locationId: { type: "objectId", required: true },
    // Every cell is text (it comes from a CSV file); the controller turns and checks each one.
    rows: {
      type: "array", required: true, max: controller.MAX_BULK_ROWS,
      of: { type: "object", fields: Object.fromEntries(
        ["holderName", "phone", "email", "vehicleNumber", "vehicleType", "passType", "startDate", "unit", "count", "amount", "method", "company", "notes", "transactionId"]
          .map((key) => [key, { type: "string", max: 300 }])
      ) },
    },
  }),
  controller.bulkUpload
);
router.post(
  "/bulk",
  validateBody({
    ids: { type: "array", required: true, max: 200, of: { type: "objectId" } },
    action: { type: "string", required: true, enum: ["EXTEND", "SET_DATES", "UPDATE_TERM", "SUSPEND", "RESUME", "CANCEL"] },
    days: { type: "number", integer: true, min: 1, max: 366 },
    amount: { type: "number", min: 0, max: 10000000 },
    startDate: { type: "string", pattern: DATE, message: "must look like 2026-03-02" },
    endDate: { type: "string", pattern: DATE, message: "must look like 2026-03-02" },
    reason: { type: "string", max: 300 },
  }),
  controller.bulkUpdate
);
router.post(
  "/delete",
  validateBody({ ids: { type: "array", required: true, max: 200, of: { type: "objectId" } } }),
  controller.deletePasses
);
router.get("/:id", validateIdParam(), controller.getPass);
router.delete("/:id", validateIdParam(), controller.deletePass);
router.patch(
  "/:id/approval",
  validateIdParam(),
  validateBody({ approval: { type: "string", required: true, enum: PASS_APPROVALS } }),
  controller.setApproval
);

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
    passCompanyId: { type: "objectId" },
    phone: { type: "string", max: 20 },
    email: { type: "string", max: 254 },
    notes: { type: "string", max: 300 },
    startDate: { type: "string", pattern: DATE, message: "must look like 2026-03-02" },
    // With a last day the pass runs from startDate (default today) to this day, both included.
    endDate: { type: "string", pattern: DATE, message: "must look like 2026-03-02" },
    passUserId: { type: "objectId" },
    approval: { type: "string", enum: PASS_APPROVALS },
    address: { type: "string", max: 255 },
    gstNumber: { type: "string", max: 15 },
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
    // "" takes the pass off its company.
    passCompanyId: { type: "string", max: 40 },
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
