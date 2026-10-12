const router = require("express").Router();
const controller = require("../controllers/passChargeController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const needs = (...keys) => (req, res, next) => {
  for (const key of keys) {
    if (typeof req.query[key] !== "string" || !req.query[key]) return res.status(400).json({ success: false, message: `${key} is required` });
  }
  if (!VEHICLE_TYPES.includes(req.query.vehicleType)) return res.status(400).json({ success: false, message: "Choose a vehicle type" });
  for (const key of ["startDate", "endDate"]) {
    if (!DATE.test(req.query[key])) return res.status(400).json({ success: false, message: `${key} must look like 2026-10-01` });
  }
  return next();
};

router.use(protect, tenant, requirePermission(P.PASS_MANAGE));
router.get("/", controller.listCharges);
router.get("/quote", needs("locationId", "vehicleType", "startDate", "endDate"), controller.quote);
router.post(
  "/",
  requireCompany,
  validateBody({
    locationId: { type: "objectId", required: true },
    vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
    monthlyRate: { type: "number", required: true, min: 0, max: 10000000 },
    dailyRate: { type: "number", required: true, min: 0, max: 10000000 },
  }),
  controller.saveCharge
);
router.delete("/:id", validateIdParam(), controller.removeCharge);

module.exports = router;
