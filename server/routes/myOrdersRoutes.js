const router = require("express").Router();
const controller = require("../controllers/myOrdersController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS: P } = require("../config/permissions");

// Dashboard > My Orders: one list of the company's subscription, plan and hardware orders.
router.use(protect, tenant, requireCompany, requirePermission(P.COMPANY_MANAGE));
router.get("/", controller.list);
router.get("/all", controller.everything);

module.exports = router;
