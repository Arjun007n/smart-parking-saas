const router = require("express").Router();
const controller = require("../controllers/roleController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission, requireAnyPermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { CUSTOM_BASE_ROLES, PERMISSIONS } = require("../config/permissions");

const permissions = { type: "array", of: { type: "string", max: 40 }, max: 20 };

router.use(protect, tenant);

// Anyone who can manage users may see the roles (to give them out);
// only those who manage roles may change them.
router.get("/", requireAnyPermission(PERMISSIONS.ROLE_MANAGE, PERMISSIONS.USER_MANAGE), controller.listRoles);
router.get("/catalog", requirePermission(PERMISSIONS.ROLE_MANAGE), controller.catalog);

router.use(requirePermission(PERMISSIONS.ROLE_MANAGE));

router.post(
  "/",
  requireCompany,
  validateBody({
    name: { type: "string", required: true, min: 2, max: 60 },
    description: { type: "string", max: 300 },
    baseRole: { type: "string", required: true, enum: CUSTOM_BASE_ROLES },
    permissions,
  }),
  controller.createRole
);
router.put(
  "/:id",
  validateIdParam(),
  validateBody({
    name: { type: "string", min: 2, max: 60 },
    description: { type: "string", max: 300 },
    permissions,
  }),
  controller.updateRole
);
router.delete("/:id", validateIdParam(), controller.deleteRole);

module.exports = router;
