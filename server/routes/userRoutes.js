const router = require("express").Router();
const controller = require("../controllers/userController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam } = require("../middleware/validate");
const { ROLES, PERMISSIONS } = require("../config/permissions");

const role = { type: "string", enum: Object.values(ROLES) };
const locationIds = { type: "array", of: { type: "objectId" }, max: 200 };
const time = { type: "string", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "must be a time like 09:30" };
// Employee code and shift, kept in the Operator profile.
const operator = {
  type: "object",
  fields: {
    employeeCode: { type: "string", max: 30 },
    shift: { type: "object", fields: { name: { type: "string", max: 50 }, start: time, end: time } },
  },
};

router.use(protect, tenant, requirePermission(PERMISSIONS.USER_MANAGE));

router.get("/", controller.listUsers);
router.post(
  "/",
  requireCompany,
  validateBody({
    name: { type: "string", required: true, min: 2, max: 100 },
    email: { type: "email", required: true },
    phone: { type: "string", max: 20 },
    password: { type: "string", required: true, min: 8, max: 72 },
    role: { ...role, required: true },
    locationIds,
    operator,
  }),
  controller.createUser
);
router.get("/:id", validateIdParam(), controller.getUser);
router.put(
  "/:id",
  validateIdParam(),
  validateBody({
    name: { type: "string", min: 2, max: 100 },
    phone: { type: "string", max: 20 },
    password: { type: "string", min: 8, max: 72 },
    role,
    locationIds,
    isActive: { type: "boolean" },
    operator,
  }),
  controller.updateUser
);
router.delete("/:id", validateIdParam(), controller.deactivateUser);

module.exports = router;
