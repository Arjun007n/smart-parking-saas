// Pass types (a label for filtering and reports) and purchase terms.
export const PASS_TYPE_LABELS = {
  REGULAR: 'Regular',
  EMPLOYEE: 'Employee',
  RESIDENT: 'Resident',
  VIP: 'VIP',
  CORPORATE: 'Corporate',
}

export const PASS_UNITS = [
  ['DAY', 'Days'],
  ['WEEK', 'Weeks'],
  ['MONTH', 'Months'],
]
export const UNIT_MAX = { DAY: 366, WEEK: 156, MONTH: 36 }
export const MAX_PASS_VEHICLES = 10

// "3 days", "1 week", "2 months".
export function termText(unit = 'MONTH', count = 1) {
  const word = unit.toLowerCase()
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// Leaves empty optional fields out of a pass sale or renewal request.
export function passMoneyPayload({ locationId, unit, count, amount, method, transactionId }) {
  return { locationId, unit, count, amount, method, ...(transactionId ? { transactionId } : {}) }
}

// "RJ14AB1234" or "RJ14AB1234 +1 more"
export function vehicleList(pass) {
  const extra = (pass.vehicles?.length || 1) - 1
  return extra > 0 ? `${pass.vehicleNumber} +${extra} more` : pass.vehicleNumber
}
