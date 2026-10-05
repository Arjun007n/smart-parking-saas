const express = require("express");

const router = express.Router();
const controller = require("../controllers/bookingController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const { VEHICLE_TYPES } = require("../models/constants");

router.use(protect, tenant);

router.get("/", requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW), controller.listBookings);
router.post(
  "/",
  requirePermission(P.ENTRY_CREATE),
  validateBody({
    locationId: { type: "objectId", required: true },
    vehicleNumber: { type: "string", required: true, max: 20 },
    vehicleType: { type: "string", required: true, enum: VEHICLE_TYPES },
    customerName: { type: "string", max: 100 },
    phone: { type: "string", max: 20, pattern: /^[0-9+\-\s]{6,20}$/, message: "must be a phone number" },
    note: { type: "string", max: 300 },
    expectedAt: { type: "date" },
  }),
  controller.createBooking
);
router.post(
  "/:id/cancel",
  validateIdParam(),
  requirePermission(P.ENTRY_CREATE),
  validateBody({ reason: { type: "string", max: 300 } }),
  controller.cancelBooking
);

module.exports = router;
