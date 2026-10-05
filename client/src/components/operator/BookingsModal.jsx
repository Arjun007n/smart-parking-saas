import { useEffect, useMemo, useState } from 'react'
import { useBookings } from '../../hooks/useBookings'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime } from '../../utils/format'
import { Alert, Button, Field } from '../ui'

// The header "Bookings" list: every customer who booked ahead and has not
// arrived yet, at all of the signed-in user's locations, soonest first.
export default function BookingsModal({ onClose }) {
  const { bookings, isLoading, error } = useBookings('all')
  const { locations } = useMyLocations()
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const names = useMemo(() => Object.fromEntries(locations.map((l) => [l._id, l.name])), [locations])
  const text = search.trim().toLowerCase()
  const rows = bookings.filter(
    (b) => !text || [b.vehicleNumber, b.customerName, b.phone].some((value) => (value || '').toLowerCase().includes(text)),
  )

  return (
    <div className="no-print fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Customer bookings" className="mt-10 w-full max-w-4xl rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Customer bookings</h2>
            <p className="text-xs text-slate-500">Sorted by upcoming arrival time</p>
          </div>
          <Field label="Search" name="booking-search" type="search" placeholder="Search customer or vehicle" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        {error && <Alert>{errorMessage(error)}</Alert>}
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-slate-500">No active customer bookings. Confirmed bookings will appear here.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No bookings match your search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Customer</th>
                  <th className="pb-2 pr-3 font-medium">Vehicle</th>
                  <th className="pb-2 pr-3 font-medium">Arrival</th>
                  <th className="pb-2 pr-3 font-medium">Location</th>
                  <th className="pb-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b, index) => (
                  <tr key={b._id} className="sp-row-in border-t border-slate-200">
                    <td className="py-2 pr-3">{index + 1}</td>
                    <td className="py-2 pr-3">
                      {b.customerName || '—'}
                      {b.phone && <span className="block text-xs text-slate-500">{b.phone}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono font-bold tracking-wider text-slate-900">{b.vehicleNumber}</span>{' '}
                      <span className="text-slate-500">{VEHICLE_LABELS[b.vehicleType] || b.vehicleType}</span>
                    </td>
                    <td className="py-2 pr-3">{dateTime(b.expectedAt)}</td>
                    <td className="py-2 pr-3">{names[b.locationId] || '—'}</td>
                    <td className="py-2 text-slate-600">{b.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-right">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}
