const router = require("express").Router();
const { getDashboard } = require("../controllers/dashboardController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS } = require("../config/permissions");

router.get("/", protect, tenant, requirePermission(PERMISSIONS.REPORT_VIEW), getDashboard);

module.exports = router;
