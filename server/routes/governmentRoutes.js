const router = require("express").Router();
const controller = require("../controllers/governmentController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS: P } = require("../config/permissions");

// The government officer's reports: totals and lists of vehicles that entered and left. Read-only, no money.
router.use(protect, tenant, requirePermission(P.GOVERNMENT_REPORT));

router.get("/locations", controller.places);
router.get("/summary", controller.summary);
router.get("/movements", controller.list);

module.exports = router;
