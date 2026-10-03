// Roles and permissions for backend RBAC (Day 5 of the plan).
// The backend is the only place these are enforced; the UI just hides things.

const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  COMPANY_ADMIN: "COMPANY_ADMIN",
  LOCATION_ADMIN: "LOCATION_ADMIN",
  ENTRY_OPERATOR: "ENTRY_OPERATOR",
  EXIT_OPERATOR: "EXIT_OPERATOR",
  COLLECTION_OPERATOR: "COLLECTION_OPERATOR",
});

const PERMISSIONS = Object.freeze({
  ENTRY_CREATE: "ENTRY_CREATE",
  EXIT_CREATE: "EXIT_CREATE",
  PAYMENT_COLLECT: "PAYMENT_COLLECT",
  REPORT_VIEW: "REPORT_VIEW",
  USER_MANAGE: "USER_MANAGE",
  LOCATION_MANAGE: "LOCATION_MANAGE",
  TARIFF_MANAGE: "TARIFF_MANAGE",
  PASS_MANAGE: "PASS_MANAGE",
  VEHICLE_MANAGE: "VEHICLE_MANAGE",
  COMPANY_MANAGE: "COMPANY_MANAGE",
  PLATFORM_MANAGE: "PLATFORM_MANAGE",
});

const P = PERMISSIONS;

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.values(P),
  [ROLES.COMPANY_ADMIN]: [
    P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW,
    P.USER_MANAGE, P.LOCATION_MANAGE, P.TARIFF_MANAGE, P.PASS_MANAGE,
    P.VEHICLE_MANAGE, P.COMPANY_MANAGE,
  ],
  [ROLES.LOCATION_ADMIN]: [
    P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW,
    P.USER_MANAGE, P.LOCATION_MANAGE, P.TARIFF_MANAGE, P.PASS_MANAGE,
    P.VEHICLE_MANAGE,
  ],
  [ROLES.ENTRY_OPERATOR]: [P.ENTRY_CREATE],
  [ROLES.EXIT_OPERATOR]: [P.EXIT_CREATE, P.PAYMENT_COLLECT],
  [ROLES.COLLECTION_OPERATOR]: [P.PAYMENT_COLLECT, P.REPORT_VIEW],
});

// Higher rank can manage lower rank. Equal ranks cannot manage each other.
const ROLE_RANK = Object.freeze({
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.COMPANY_ADMIN]: 80,
  [ROLES.LOCATION_ADMIN]: 60,
  [ROLES.ENTRY_OPERATOR]: 20,
  [ROLES.EXIT_OPERATOR]: 20,
  [ROLES.COLLECTION_OPERATOR]: 20,
});

const permissionsFor = (role) => ROLE_PERMISSIONS[role] || [];
const hasPermission = (role, permission) => permissionsFor(role).includes(permission);
const canManageRole = (actorRole, targetRole) =>
  (ROLE_RANK[actorRole] || 0) > (ROLE_RANK[targetRole] || Infinity);

// Roles that see every location of their company (others are limited to
// the locations assigned to them).
const isCompanyWide = (role) =>
  role === ROLES.SUPER_ADMIN || role === ROLES.COMPANY_ADMIN;

module.exports = {
  ROLES, PERMISSIONS, ROLE_PERMISSIONS, ROLE_RANK,
  permissionsFor, hasPermission, canManageRole, isCompanyWide,
};
