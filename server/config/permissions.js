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
  WALLET_MANAGE: "WALLET_MANAGE",
  COMPANY_MANAGE: "COMPANY_MANAGE",
  PLATFORM_MANAGE: "PLATFORM_MANAGE",
  ROLE_MANAGE: "ROLE_MANAGE",
});

const P = PERMISSIONS;

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.values(P),
  [ROLES.COMPANY_ADMIN]: [
    P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW,
    P.USER_MANAGE, P.LOCATION_MANAGE, P.TARIFF_MANAGE, P.PASS_MANAGE,
    P.VEHICLE_MANAGE, P.WALLET_MANAGE, P.COMPANY_MANAGE, P.ROLE_MANAGE,
  ],
  [ROLES.LOCATION_ADMIN]: [
    P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW,
    P.USER_MANAGE, P.LOCATION_MANAGE, P.TARIFF_MANAGE, P.PASS_MANAGE,
    P.VEHICLE_MANAGE, P.WALLET_MANAGE,
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

// Custom roles (Phase 2): a company can bundle permissions under its own name.
// A custom role is built on one of the roles below. The base role still decides
// rank (who can manage whom) and whether the user sees one location or all of
// them; the custom role decides which permissions the user actually has.
// Company-wide roles cannot be a base: a user of equal rank to the company
// admin could not be managed by anyone but the platform.
const CUSTOM_BASE_ROLES = Object.freeze([
  ROLES.LOCATION_ADMIN, ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR, ROLES.COLLECTION_OPERATOR,
]);

// Permissions a custom role may carry. Company settings, role editing and
// platform control stay with the company admin and the platform.
const GRANTABLE_PERMISSIONS = Object.freeze([
  P.ENTRY_CREATE, P.EXIT_CREATE, P.PAYMENT_COLLECT, P.REPORT_VIEW, P.USER_MANAGE,
  P.LOCATION_MANAGE, P.TARIFF_MANAGE, P.PASS_MANAGE, P.VEHICLE_MANAGE, P.WALLET_MANAGE,
]);

// Plain-language names for the permission picker.
const PERMISSION_INFO = Object.freeze({
  [P.ENTRY_CREATE]: { label: "Register entries", description: "Issue tickets at the entry gate and use the entry screen." },
  [P.EXIT_CREATE]: { label: "Process exits", description: "Look up tickets, calculate fees and close sessions at the exit gate." },
  [P.PAYMENT_COLLECT]: { label: "Collect payments", description: "Take cash, UPI and online payments; open and close shifts." },
  [P.REPORT_VIEW]: { label: "View reports", description: "See reports, collections and shift summaries of the assigned locations." },
  [P.USER_MANAGE]: { label: "Manage users", description: "Create and edit users of a lower rank than the base role." },
  [P.LOCATION_MANAGE]: { label: "Manage locations", description: "Edit locations, slots and hardware devices; delete vehicle photos." },
  [P.TARIFF_MANAGE]: { label: "Manage tariffs", description: "Create and change parking tariffs." },
  [P.PASS_MANAGE]: { label: "Manage monthly passes", description: "Sell, renew, suspend and cancel passes." },
  [P.VEHICLE_MANAGE]: { label: "Manage vehicles", description: "Edit vehicle records, blacklists and watch lists." },
  [P.WALLET_MANAGE]: { label: "Manage wallets", description: "Create prepaid wallets, block them and correct their balance. (Topping up and paying from a wallet needs Collect payments.)" },
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
  CUSTOM_BASE_ROLES, GRANTABLE_PERMISSIONS, PERMISSION_INFO,
  permissionsFor, hasPermission, canManageRole, isCompanyWide,
};
