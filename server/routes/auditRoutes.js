const router = require("express").Router();
const { listAuditLogs } = require("../controllers/auditController");
const { protect } = require("../middleware/auth");
const { tenant } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { PERMISSIONS } = require("../config/permissions");

// Company admins (and Super Admin) only. The audit log can be read, never changed.
router.get("/", protect, tenant, requirePermission(PERMISSIONS.COMPANY_MANAGE), listAuditLogs);

module.exports = router;
