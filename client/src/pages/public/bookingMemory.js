// The address of a customer's booking page, kept in this browser so that coming back from the
// payment page (which cannot carry our secret) lands on the right booking. Storage may be blocked.
const KEY = 'sp_last_booking'

export function rememberBooking(id, token) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, token, at: Date.now() }))
  } catch {
    // Private mode or blocked storage: the customer can still use the link they were shown.
  }
}

// The booking page path for the last booking made in the last day, or null.
export function lastBookingPath() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!saved?.id || !saved?.token || Date.now() - saved.at > 24 * 3600_000) return null
    return `/booking/${saved.id}?token=${encodeURIComponent(saved.token)}`
  } catch {
    return null
  }
}
