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

// Where a user lands after logging in.
export const homePathFor = (role) => (isOperator(role) ? '/operator/dashboard' : '/dashboard')
