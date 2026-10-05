const router = require("express").Router();
const controller = require("../controllers/reportController");
const advanced = require("../controllers/advancedReportController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS } = require("../config/permissions");

// Every report accepts ?format=csv, xlsx or pdf to download the same rows as a file.
router.use(protect, tenant, requirePermission(PERMISSIONS.REPORT_VIEW));

router.get("/revenue", controller.revenueReport);
router.get("/collection", controller.collectionReport);
router.get("/vehicles", controller.vehicleReport);
router.get("/occupancy", controller.occupancyReport);
router.get("/operators", controller.operatorReport);
router.get("/peak-hours", advanced.peakHoursReport);
router.get("/occupancy-trend", advanced.occupancyTrendReport);
router.get("/exceptions", advanced.exceptionsReport);
router.get("/payments", advanced.paymentsReport);
router.get("/durations", advanced.durationsReport);
router.get("/passes", advanced.passesReport);
router.get("/hardware", advanced.hardwareReport);
router.get("/frequent-vehicles", advanced.frequentVehiclesReport);
router.get("/locations", advanced.locationsReport);

module.exports = router;
