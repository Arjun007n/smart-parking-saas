export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  LOCATION_ADMIN: 'Location Admin',
  ENTRY_OPERATOR: 'Entry Operator',
  EXIT_OPERATOR: 'Exit Operator',
  COLLECTION_OPERATOR: 'Collection Operator',
}

const OPERATOR_ROLES = ['ENTRY_OPERATOR', 'EXIT_OPERATOR', 'COLLECTION_OPERATOR']

// Roles a user may create. The backend enforces this; the UI only offers them.
export function assignableRoles(role) {
  if (role === 'SUPER_ADMIN') return ['COMPANY_ADMIN', 'LOCATION_ADMIN', ...OPERATOR_ROLES]
  if (role === 'COMPANY_ADMIN') return ['LOCATION_ADMIN', ...OPERATOR_ROLES]
  if (role === 'LOCATION_ADMIN') return OPERATOR_ROLES
  return []
}

export const isCompanyWide = (role) => role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN'

export const isOperator = (role) => OPERATOR_ROLES.includes(role)

// Gate work. A user whose permissions are all from this list uses the simple
// gate screens; anyone with more (reports, passes, users...) gets the dashboard.
const GATE_PERMISSIONS = ['ENTRY_CREATE', 'EXIT_CREATE', 'PAYMENT_COLLECT']

// Standard operator roles always use the gate screens. A custom role on an
// operator base does so only while it adds nothing beyond gate work.
export const usesOperatorArea = (user, permissions = []) =>
  isOperator(user.role) && (!user.customRole || permissions.every((p) => GATE_PERMISSIONS.includes(p)))

// Where a user lands after logging in.
export const homePathFor = (user, permissions = []) =>
  usesOperatorArea(user, permissions) ? '/operator/dashboard' : '/dashboard'

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
