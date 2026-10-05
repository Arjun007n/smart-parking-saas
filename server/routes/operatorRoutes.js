const express = require("express");

const router = express.Router();
const controller = require("../controllers/operatorController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requireAnyPermission } = require("../middleware/permission");
const { PERMISSIONS: P } = require("../config/permissions");

const canSeeSessions = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW);

router.use(protect, tenant);

// Home numbers (money only for people who collect payments or read reports).
router.get("/summary", canSeeSessions, controller.summary);
// The day's money by vehicle type (checks the money permission itself).
router.get("/collection", canSeeSessions, controller.collection);
// Vehicles that came in / left on a day, with search, page size and file download.
router.get("/entries", canSeeSessions, controller.entryList);
router.get("/exits", canSeeSessions, controller.exitList);

module.exports = router;
