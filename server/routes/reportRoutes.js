const router = require("express").Router();
const controller = require("../controllers/reportController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS } = require("../config/permissions");

// Every report accepts ?format=csv to download the same rows as a file.
router.use(protect, tenant, requirePermission(PERMISSIONS.REPORT_VIEW));

router.get("/revenue", controller.revenueReport);
router.get("/collection", controller.collectionReport);
router.get("/vehicles", controller.vehicleReport);
router.get("/occupancy", controller.occupancyReport);
router.get("/operators", controller.operatorReport);

module.exports = router;
