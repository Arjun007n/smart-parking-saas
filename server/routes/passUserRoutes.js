const router = require("express").Router();
const controller = require("../controllers/passUserController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = { type: "string", pattern: DATE, message: "must look like 2026-03-02" };
const METHODS = ["CASH", "UPI", "CARD"];

const person = (isCreate) => ({
  name: { type: "string", required: isCreate, max: 100 },
  mobile: { type: "string", required: isCreate, max: 20 },
  address: { type: "string", required: isCreate, max: 255 },
  email: { type: "string", max: 254 },
  gstNumber: { type: "string", max: 15 },
  // "" takes the user off its company.
  passCompanyId: { type: "string", max: 40 },
});

const row = {
  type: "object",
  fields: {
    vehicleNumber: { type: "string", required: true, max: 20 },
    vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
    locationId: { type: "objectId", required: true },
    startDate: date,
    endDate: { ...date, required: true },
    amount: { type: "number", required: true, min: 0, max: 10000000 },
  },
};

const plate = { type: "string", required: true, max: 20 };

router.use(protect, tenant, requirePermission(P.PASS_MANAGE));
router.get("/stats", controller.stats);
router.get("/options", controller.options);
router.get("/vehicles", controller.vehicleList);
router.get("/", controller.list);
router.post(
  "/",
  requireCompany,
  validateBody({
    ...person(false),
    passUserId: { type: "objectId" },
    method: { type: "string", enum: METHODS },
    transactionId: { type: "string", min: 4, max: 100 },
    rows: { type: "array", required: true, max: 20, of: row },
  }),
  controller.create
);
router.get("/:id", validateIdParam(), controller.getOne);
router.put("/:id", validateIdParam(), validateBody(person(false)), controller.update);
router.delete("/:id", validateIdParam(), controller.remove);
router.post("/:id/vehicles", validateIdParam(), validateBody({ vehicleNumber: plate, vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES } }), controller.addVehicle);
router.put(
  "/:id/vehicles/:vehicleId",
  validateIdParam(),
  validateBody({ vehicleNumber: { type: "string", max: 20 }, vehicleType: { type: "string", enum: VEHICLE_TYPES } }),
  controller.updateVehicle
);
router.post(
  "/:id/passes",
  validateIdParam(),
  requireCompany,
  validateBody({
    vehicleId: { type: "objectId", required: true },
    locationId: { type: "objectId", required: true },
    startDate: date,
    endDate: { ...date, required: true },
    amount: { type: "number", required: true, min: 0, max: 10000000 },
    method: { type: "string", enum: METHODS },
    transactionId: { type: "string", min: 4, max: 100 },
  }),
  controller.createOrRenew
);

module.exports = router;
