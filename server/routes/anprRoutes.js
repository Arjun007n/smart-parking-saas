const express = require("express");
const router = express.Router();
const controller = require("../controllers/anprController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requireAnyPermission } = require("../middleware/permission");
const { validateIdParam } = require("../middleware/validate");
const { PERMISSIONS: P } = require("../config/permissions");
const rateLimit = require("../middleware/rateLimit");
const photoService = require("../services/photoService");

const canSee = requireAnyPermission(P.ENTRY_CREATE, P.EXIT_CREATE, P.LOCATION_MANAGE);

router.use(protect, tenant);

// Every picture read costs a call to the recognition service, so it has its own limit.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => Number(process.env.RECOGNITION_RATE_LIMIT_MAX) || 30,
  message: "Too many plate readings. Please wait a minute or type the number.",
});

router.get("/options", canSee, controller.options);
router.post(
  "/read",
  canSee,
  readLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: photoService.maxBytes() }),
  controller.readPhoto
);
router.get("/preview", canSee, controller.preview);
router.get("/", canSee, controller.listDetections);
router.post("/:id/dismiss", validateIdParam(), canSee, controller.dismissDetection);

module.exports = router;
