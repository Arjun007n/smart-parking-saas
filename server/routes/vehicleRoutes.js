const router = require("express").Router();
const controller = require("../controllers/vehicleController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");

const details = {
  type: { type: "string", enum: VEHICLE_TYPES },
  ownerName: { type: "string", max: 100 },
  phone: { type: "string", max: 20 },
};

router.use(protect, tenant);

// Operators need to look vehicles up, so reading is open to all signed-in users.
router.get("/", controller.listVehicles);
router.get("/:id", validateIdParam(), controller.getVehicle);

router.post(
  "/",
  requirePermission(PERMISSIONS.VEHICLE_MANAGE),
  requireCompany,
  validateBody({ plateNumber: { type: "string", required: true, max: 20 }, ...details }),
  controller.createVehicle
);
router.put(
  "/:id",
  validateIdParam(),
  requirePermission(PERMISSIONS.VEHICLE_MANAGE),
  validateBody({
    ...details,
    isBlocked: { type: "boolean" },
    blockedReason: { type: "string", max: 200 },
  }),
  controller.updateVehicle
);

module.exports = router;
