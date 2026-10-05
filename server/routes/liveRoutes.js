const express = require("express");

const router = express.Router();
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const controller = require("../controllers/liveController");
const hub = require("../services/liveHub");

hub.install(); // events -> screens and gate agents

router.use(protect, tenant);
router.get("/stream", controller.stream);

module.exports = router;
