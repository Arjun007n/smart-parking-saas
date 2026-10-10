// Words and colours for the subscription screens.
export const STATE_TEXT = { ACTIVE: 'Active', UPCOMING: 'Upcoming', EXPIRED: 'Expired', CANCELLED: 'Cancelled', NONE: 'No subscription' }
export const STATE_TONE = { ACTIVE: 'green', UPCOMING: 'blue', EXPIRED: 'red', CANCELLED: 'slate', NONE: 'slate' }

export const ORDER_KIND_TEXT = { PURCHASE: 'Purchase', RENEWAL: 'Renewal', UPDATE: 'License Update' }
export const ORDER_NOTE = { PURCHASE: 'Subscription Purchase', RENEWAL: 'Subscription Renewal', UPDATE: 'License Update' }
export const PAY_TEXT = { PAID: 'Paid', PENDING: 'Waiting for payment', FAILED: 'Not paid', CANCELLED: 'Replaced' }
export const PAY_TONE = { PAID: 'green', PENDING: 'blue', FAILED: 'red', CANCELLED: 'slate' }

export const monthsText = (months) => (months ? `${months} month${months === 1 ? '' : 's'}` : '-')

// "06-10-2026" like ismartparking; the last day is the day before the end date stored.
export const dmy = (value) => {
  if (!value) return '-'
  const d = new Date(value)
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}
// "06-10-2026 08:28 PM"
export const dmyTime = (value) => {
  if (!value) return '-'
  const d = new Date(value)
  const hours = d.getHours() % 12 || 12
  return `${dmy(d)} ${String(hours).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}
export const lastDayOf = (end) => (end ? new Date(new Date(end).getTime() - 1) : null)
export const validity = (sub) => (sub ? `${dmy(sub.periodStart)} To ${dmy(lastDayOf(sub.periodEnd))}` : '-')

// The tenure choices as ismartparking words them: "3 Month (5 % Off)".
export const tenureLabel = (t) => `${t.months} Month${t.discount ? ` (${t.discount} % Off)` : ''}`
