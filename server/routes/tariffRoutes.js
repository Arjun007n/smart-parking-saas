const router = require("express").Router();
const controller = require("../controllers/tariffController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam, collectCleared } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");

const money = { type: "number", min: 0, max: 1000000 };
const vehicleType = { type: "string", enum: VEHICLE_TYPES };

const fields = (isCreate) => ({
  ...(isCreate ? { locationId: { type: "objectId", required: true } } : { isActive: { type: "boolean" } }),
  name: { type: "string", required: isCreate, min: 2, max: 100 },
  ...(isCreate ? { vehicleType: { ...vehicleType, required: true } } : {}),
  gracePeriodMinutes: { type: "number", integer: true, min: 0, max: 1440 },
  slabs: {
    type: "array",
    max: 20,
    of: {
      type: "object",
      fields: {
        uptoMinutes: { type: "number", integer: true, required: true, min: 1, max: 1440 },
        rate: { ...money, required: true },
      },
    },
  },
  additionalPerHour: money,
  minimumFee: money,
  maxDailyFee: money,
  overnightFee: money,
  lostTicketFee: money,
  taxPercent: { type: "number", min: 0, max: 100 },
  taxInclusive: { type: "boolean" },
  daysOfWeek: { type: "array", max: 7, of: { type: "number", integer: true, min: 0, max: 6 } },
  validFrom: { type: "date" },
  validTo: { type: "date" },
});

router.use(protect, tenant, requirePermission(PERMISSIONS.TARIFF_MANAGE));

router.get("/", controller.listTariffs);
router.post("/", validateBody(fields(true)), controller.createTariff);
router.post(
  "/preview",
  validateBody({
    locationId: { type: "objectId", required: true },
    vehicleType: { ...vehicleType, required: true },
    entryTime: { type: "date", required: true },
    exitTime: { type: "date", required: true },
    lostTicket: { type: "boolean" },
    hasValidPass: { type: "boolean" },
    discountPercent: { type: "number", min: 0, max: 100 },
  }),
  controller.previewFee
);
router.get("/:id", validateIdParam(), controller.getTariff);
router.put(
  "/:id",
  validateIdParam(),
  collectCleared(["maxDailyFee", "overnightFee", "lostTicketFee", "validFrom", "validTo"]),
  validateBody(fields(false)),
  controller.updateTariff
);
router.delete("/:id", validateIdParam(), controller.deactivateTariff);

module.exports = router;
