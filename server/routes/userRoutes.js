const router = require("express").Router();
const controller = require("../controllers/userController");
const { protect } = require("../middleware/auth");
const { tenant, requireCompany } = require("../middleware/tenant");
const { requirePermission } = require("../middleware/permission");
const { validateBody, validateIdParam, collectCleared } = require("../middleware/validate");
const { ROLES, PERMISSIONS } = require("../config/permissions");

const role = { type: "string", enum: Object.values(ROLES) };
const locationIds = { type: "array", of: { type: "objectId" }, max: 200 };
// Lanes (gates) the user is limited to; a location without any listed is open to all its lanes.
const lanes = {
  type: "array",
  max: 100,
  of: { type: "object", fields: { locationId: { type: "objectId", required: true }, gate: { type: "string", required: true, max: 50 } } },
};
const time = { type: "string", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "must be a time like 09:30" };
// Employee code and shift, kept in the Operator profile.
const operator = {
  type: "object",
  fields: {
    employeeCode: { type: "string", max: 30 },
    shift: { type: "object", fields: { name: { type: "string", max: 50 }, start: time, end: time } },
  },
};

// What the person may see and do at the gate. Each one is a yes or no.
const access = {
  type: "object",
  fields: {
    reprint: { type: "boolean" },
    showEntryCollection: { type: "boolean" },
    showExitCollection: { type: "boolean" },
    showTotalCollection: { type: "boolean" },
  },
};

router.use(protect, tenant, requirePermission(PERMISSIONS.USER_MANAGE));

router.get("/", controller.listUsers);
router.get("/licences", controller.listLicences);
router.get("/export", controller.exportUsers);
// Sharing the plan's users out between locations is a company-level decision.
router.put(
  "/licences/:locationId",
  requireCompany,
  requirePermission(PERMISSIONS.COMPANY_MANAGE),
  validateIdParam("locationId"),
  validateBody({ limit: { type: "number", integer: true, min: 0, max: 100000 } }),
  controller.setLicence
);
router.post(
  "/",
  requireCompany,
  validateBody({
    name: { type: "string", required: true, min: 2, max: 100 },
    // An email, a Login ID, or both (the controller needs at least one).
    email: { type: "email" },
    loginId: { type: "string", max: 40 },
    phone: { type: "string", max: 20 },
    password: { type: "string", required: true, min: 8, max: 72 },
    lanes,
    role,
    customRoleId: { type: "objectId" },
    locationIds,
    operator,
    access,
  }),
  controller.createUser
);
router.get("/:id", validateIdParam(), controller.getUser);
router.put(
  "/:id",
  validateIdParam(),
  collectCleared(["customRoleId"]),
  validateBody({
    name: { type: "string", min: 2, max: 100 },
    phone: { type: "string", max: 20 },
    password: { type: "string", min: 8, max: 72 },
    loginId: { type: "string", max: 40 },
    lanes,
    role,
    customRoleId: { type: "objectId" },
    locationIds,
    isActive: { type: "boolean" },
    operator,
    access,
  }),
  controller.updateUser
);
router.delete("/:id", validateIdParam(), controller.deactivateUser);

module.exports = router;
