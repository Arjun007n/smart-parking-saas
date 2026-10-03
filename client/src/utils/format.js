export const VEHICLE_LABELS = { CAR: 'Car', BIKE: 'Bike', HEAVY: 'Heavy vehicle' }
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
export const money = (amount) => rupees.format(amount || 0)

export function duration(minutes) {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  return [days && `${days} d`, hours && `${hours} h`, (mins || (!days && !hours)) && `${mins} min`]
    .filter(Boolean)
    .join(' ')
}

// Builds the operator profile part of a user request from form values.
// Empty fields are left out so they do not overwrite saved values with blanks.
export function operatorPayload({ employeeCode, shiftName, shiftStart, shiftEnd }) {
  const shift = {
    ...(shiftName ? { name: shiftName } : {}),
    ...(shiftStart ? { start: shiftStart } : {}),
    ...(shiftEnd ? { end: shiftEnd } : {}),
  }
  const operator = {
    ...(employeeCode ? { employeeCode } : {}),
    ...(Object.keys(shift).length ? { shift } : {}),
  }
  return Object.keys(operator).length ? { operator } : {}
}

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const timeFormat = new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' })
export const dateTime = (value) => (value ? dateTimeFormat.format(new Date(value)) : '—')
export const timeOnly = (value) => (value ? timeFormat.format(new Date(value)) : '—')

export const PAYMENT_LABELS = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', GATEWAY: 'Online' }

export const SESSION_STATUS = {
  ACTIVE: { label: 'Inside', tone: 'blue' },
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'red' },
  COMPLETED: { label: 'Exited', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
  LOST_TICKET: { label: 'Exited (lost ticket)', tone: 'green' },
  PASS_EXIT: { label: 'Exited (pass)', tone: 'green' },
  MANUAL_OVERRIDE: { label: 'Exited (override)', tone: 'slate' },
}

// Today's date as YYYY-MM-DD in the browser's time zone, for date inputs.
export function todayInput() {
  const now = new Date()
  const two = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

// A unique text for one entry attempt, so a double tap makes one ticket.
export function newRequestKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
