import { Link, Navigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { lastBookingPath } from './bookingMemory'

// Where the payment page sends the customer back to. It cannot carry our secret link, so the booking
// is looked up from what this browser remembered.
export default function BookingReturn() {
  usePageTitle('Your booking')
  const path = lastBookingPath()
  if (path) return <Navigate to={path} replace />
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Thank you</h1>
      <p className="mt-3 text-slate-600">
        If you paid, your booking is confirmed and we have sent you a message. Show your vehicle number at the gate.
      </p>
      <p className="mt-6"><Link to="/book" className="text-blue-700 hover:underline">Book another parking</Link></p>
    </div>
  )
}
