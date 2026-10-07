export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  LOCATION_ADMIN: 'Location Admin',
  SUPERVISOR: 'Supervisor',
  ENTRY_OPERATOR: 'Entry Operator',
  EXIT_OPERATOR: 'Exit Operator',
  COLLECTION_OPERATOR: 'Collection Operator',
  GATE_OPERATOR: 'Operator',
  VIEWER: 'Viewer',
  GOVERNMENT_OFFICER: 'Government Officer',
}

// What each built-in role is for, shown beside the role picker.
export const ROLE_HINTS = {
  LOCATION_ADMIN: 'Runs a location: users, tariffs, hardware, reports and corrections.',
  SUPERVISOR: 'Entry, exit and payments, plus reports, re-entry, cancel and release with a reason. No users, tariffs or settings.',
  ENTRY_OPERATOR: 'Entry screen only.',
  EXIT_OPERATOR: 'Exit screen and payments.',
  COLLECTION_OPERATOR: 'Takes payments and sees collection reports.',
  GATE_OPERATOR: 'One person for the whole gate: entry, exit and payments. No reports, passes or settings.',
  VIEWER: 'Read-only: sees reports and the live picture, changes nothing.',
  GOVERNMENT_OFFICER: 'Signs in on the Government login page and sees only the totals and lists of vehicles that entered and left, for the locations you choose. No money.',
}

// The one operator role that people are offered: it does entry, exit and payments.
const OPERATOR_ROLE = 'GATE_OPERATOR'
// The government officer: reports of entries and exits only, on their own login page.
const OFFICER_ROLE = 'GOVERNMENT_OFFICER'
// Older roles that split the gate work between two people. They keep working for users who
// already have them but are no longer offered when adding someone.
export const LEGACY_OPERATOR_ROLES = ['ENTRY_OPERATOR', 'EXIT_OPERATOR', 'COLLECTION_OPERATOR']
const OPERATOR_ROLES = [OPERATOR_ROLE, ...LEGACY_OPERATOR_ROLES]

// Roles a user may create. The backend enforces this; the UI only offers them.
export function assignableRoles(role) {
  if (role === 'SUPER_ADMIN') return ['COMPANY_ADMIN', 'LOCATION_ADMIN', 'SUPERVISOR', OPERATOR_ROLE, 'VIEWER', OFFICER_ROLE]
  if (role === 'COMPANY_ADMIN') return ['LOCATION_ADMIN', 'SUPERVISOR', OPERATOR_ROLE, 'VIEWER', OFFICER_ROLE]
  if (role === 'LOCATION_ADMIN') return ['SUPERVISOR', OPERATOR_ROLE, 'VIEWER', OFFICER_ROLE]
  return []
}

export const isGovernmentOfficer = (user) => user?.role === OFFICER_ROLE

export const isCompanyWide = (role) => role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN'

export const isOperator = (role) => OPERATOR_ROLES.includes(role)

// Gate work. A user whose permissions are all from this list uses the simple
// gate screens; anyone with more (reports, passes, users...) gets the dashboard.
const GATE_PERMISSIONS = ['ENTRY_CREATE', 'EXIT_CREATE', 'PAYMENT_COLLECT']

// Standard operator roles always use the gate screens. A custom role on an
// operator base does so only while it adds nothing beyond gate work.
export const usesOperatorArea = (user, permissions = []) =>
  isOperator(user.role) && (!user.customRole || permissions.every((p) => GATE_PERMISSIONS.includes(p)))

// A supervisor works the gates first (and has reports and the dashboard one click away).
const runsGates = (user, permissions) =>
  user.role === 'SUPERVISOR' && permissions.some((p) => GATE_PERMISSIONS.includes(p))

// Where a user lands after logging in.
export const homePathFor = (user, permissions = []) =>
  user.role === OFFICER_ROLE ? '/government' : usesOperatorArea(user, permissions) || runsGates(user, permissions) ? '/operator/dashboard' : '/dashboard'

// The role as people should read it: the company's own name for it when the
// user has a custom role, otherwise the built-in name.
export const roleLabel = (user) => user.customRole?.name || ROLE_LABELS[user.role] || user.role

// The role picker offers built-in roles ("ENTRY_OPERATOR") and custom roles
// ("custom:<id>") in one list. These two turn a choice into what the API
// takes, and a user back into a choice.
const CUSTOM_PREFIX = 'custom:'
export const roleChoiceOf = (user) => (user.customRole ? `${CUSTOM_PREFIX}${user.customRole.id}` : user.role)
export const roleChoicePayload = (choice) =>
  choice.startsWith(CUSTOM_PREFIX) ? { customRoleId: choice.slice(CUSTOM_PREFIX.length) } : { role: choice }
