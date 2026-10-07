export const VEHICLE_LABELS = {
  CAR: 'Car', BIKE: 'Bike', HEAVY: 'Coach / Bus / Truck', TAXI: 'Taxi', TEMPO: 'Tempo / SUV / Mini bus',
}
// The counts of a location (capacity, occupied) are keyed in lower case: car, bike, heavy, taxi, tempo.
export const VEHICLE_KEYS = Object.keys(VEHICLE_LABELS).map((type) => type.toLowerCase())
// Short names for the capacity fields and the free-space cards: ['Cars', 'car'], ...
export const CAPACITY_FIELDS = [
  ['Cars', 'car'], ['Bikes', 'bike'], ['Coach / Bus / Truck', 'heavy'], ['Taxis', 'taxi'], ['Tempo / SUV / Mini bus', 'tempo'],
]
// "YYYY-MM-DDTHH:mm" in the browser's time zone, for a datetime-local box.
export const localInput = (date) => {
  const two = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
export const money = (amount) => rupees.format(amount || 0)

// A waiting time the way a person says it: "45 minutes", "12 hours", "1 day".
export function waitText(minutes) {
  const m = Math.round(minutes)
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`
  if (m >= 60 && m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`
  return `${m} minute${m === 1 ? '' : 's'}`
}

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

export const PAYMENT_LABELS = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', GATEWAY: 'Online', FASTAG: 'FASTag', WALLET: 'Wallet', COMPLIMENTARY: 'Free' }

export const PASS_STATE = {
  ACTIVE: { label: 'Active', tone: 'green' },
  UPCOMING: { label: 'Starts later', tone: 'blue' },
  EXPIRED: { label: 'Expired', tone: 'red' },
  SUSPENDED: { label: 'Suspended', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
}

export const dateOnly = (value) =>
  value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value)) : '—'

// A pass's end date is exclusive (the first moment it no longer works), so the
// last day people think of is the day before.
export const lastDay = (endDate) => (endDate ? dateOnly(new Date(new Date(endDate).getTime() - 1)) : '—')

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

// The date `days` days before today as YYYY-MM-DD (browser time zone).
export function daysAgoInput(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const two = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

// A unique text for one entry attempt, so a double tap makes one ticket.
export function newRequestKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

// What a customer still has to pay for a session whose fee was calculated:
// the fee less any advance taken at entry (older sessions: the whole fee).
export const amountDue = (session) => (Number.isFinite(session?.fee?.due) ? session.fee.due : session?.fee?.total)

export const WALLET_TXN = {
  TOPUP: { label: 'Top-up', tone: 'green' },
  DEBIT: { label: 'Parking fee', tone: 'slate' },
  REFUND: { label: 'Refund', tone: 'blue' },
  REVERSAL: { label: 'Undone', tone: 'blue' },
  ADJUST: { label: 'Correction', tone: 'amber' },
}
