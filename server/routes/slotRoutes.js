const router = require("express").Router();
const controller = require("../controllers/slotController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");
const { VEHICLE_TYPES, SLOT_TYPES } = require("../models/constants");

const common = {
  zone: { type: "string", max: 50 },
  floor: { type: "string", max: 50 },
  vehicleType: { type: "string", enum: VEHICLE_TYPES },
  type: { type: "string", enum: SLOT_TYPES },
};
const locationId = { type: "objectId", required: true };

router.use(protect, tenant);

// Any signed-in user can view the layout of a location they work at.
router.get("/", controller.listSlots);

router.use(requirePermission(PERMISSIONS.LOCATION_MANAGE));

router.post(
  "/",
  validateBody({
    locationId,
    code: { type: "string", required: true, upper: true, max: 20, pattern: /^[A-Z0-9-]+$/, message: "may contain letters, digits and dashes only" },
    ...common,
  }),
  controller.createSlot
);
router.post(
  "/bulk",
  validateBody({
    locationId,
    prefix: { type: "string", upper: true, max: 10, pattern: /^[A-Z0-9-]*$/, message: "may contain letters, digits and dashes only" },
    start: { type: "number", integer: true, min: 0, max: 99999 },
    count: { type: "number", integer: true, required: true, min: 1, max: 500 },
    ...common,
  }),
  controller.createSlotsBulk
);
router.put(
  "/:id",
  validateIdParam(),
  // OCCUPIED is not accepted here: only entry and exit change it.
  validateBody({ ...common, status: { type: "string", enum: ["FREE", "MAINTENANCE"] } }),
  controller.updateSlot
);
router.delete("/:id", validateIdParam(), controller.deleteSlot);

module.exports = router;
