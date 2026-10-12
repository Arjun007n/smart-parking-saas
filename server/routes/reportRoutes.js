const router = require("express").Router();
const controller = require("../controllers/reportController");
const advanced = require("../controllers/advancedReportController");
const collectionReports = require("../controllers/collectionReportController");
const transactions = require("../controllers/transactionReportController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS } = require("../config/permissions");
const { currentDays, currentSince } = require("../utils/reportPeriod");
const { localDateText, addDaysLocal } = require("../utils/time");

// Every report accepts ?format=csv, xlsx or pdf to download the same rows as a file.
router.use(protect, tenant, requirePermission(PERMISSIONS.REPORT_VIEW));

// What "Current" and "Old" mean today, so the screen can offer the right dates.
router.get("/periods", (req, res) => {
  const since = currentSince();
  res.json({ success: true, data: { days: currentDays(), currentFrom: localDateText(since), lastOldDay: localDateText(addDaysLocal(since, -1)) } });
});
router.get("/revenue", controller.revenueReport);
router.get("/collection", controller.collectionReport);
router.get("/vehicles", controller.vehicleReport);
router.get("/occupancy", controller.occupancyReport);
router.get("/operators", controller.operatorReport);
router.get("/operator-collection", collectionReports.operatorCollectionReport);
router.get("/day-summary", collectionReports.daySummaryReport);
router.get("/transactions", transactions.transactionsReport);
router.get("/peak-hours", advanced.peakHoursReport);
router.get("/occupancy-trend", advanced.occupancyTrendReport);
router.get("/exceptions", advanced.exceptionsReport);
// Admins only (the controller checks LOCATION_MANAGE): who replaced which tickets, who printed which again.
router.get("/re-entries", advanced.reEntriesReport);
router.get("/reprints", advanced.reprintsReport);
router.get("/payments", advanced.paymentsReport);
router.get("/durations", advanced.durationsReport);
router.get("/passes", advanced.passesReport);
router.get("/hardware", advanced.hardwareReport);
router.get("/frequent-vehicles", advanced.frequentVehiclesReport);
router.get("/locations", advanced.locationsReport);

module.exports = router;
