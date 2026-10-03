const router = require("express").Router();
const controller = require("../controllers/notificationController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody } = require("../middleware/validate");
const { PERMISSIONS } = require("../config/permissions");

// Operational alerts are for admins.
router.use(protect, tenant, requirePermission(PERMISSIONS.LOCATION_MANAGE));

router.get("/", controller.listNotifications);
router.post(
  "/read",
  requireCompany,
  validateBody({ ids: { type: "array", max: 100, of: { type: "objectId" } }, all: { type: "boolean" } }),
  controller.markRead
);

module.exports = router;
