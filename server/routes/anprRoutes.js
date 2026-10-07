const express = require("express");
const router = express.Router();
const controller = require("../controllers/anprController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requireAnyPermission } = require("../middleware/permission");
const { validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");

const canSee = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.LOCATION_MANAGE);

router.use(protect, tenant);

router.get("/preview", canSee, controller.preview);
router.get("/", canSee, controller.listDetections);
router.post("/:id/dismiss", validateIdParam(), canSee, controller.dismissDetection);

module.exports = router;
