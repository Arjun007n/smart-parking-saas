import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime } from '../../utils/format'
import { Alert, Button, Field } from '../ui'

// "Exit Parked Vehicle" on the dashboard: an admin finds a vehicle that is still inside and lets it out
// without payment (a correction: the reason is required and goes in the audit log). It is the same action
// as "Exit without payment" on the Vehicles Inside list; it takes no money and does not run the gate.
export default function ExitParkedModal({ locationId, onClose }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(null)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = search.trim()
  const inside = useQuery({
    queryKey: ['exit-parked', locationId, q],
    queryFn: () => parkingApi.entries({ ...(locationId ? { locationId } : {}), ...(q ? { q, match: 'contains' } : {}) }),
    placeholderData: keepPreviousData,
  })

  const release = useMutation({
    mutationFn: () => parkingApi.override(chosen._id, reason.trim().slice(0, 300)),
    onSuccess: () => {
      setDone(`${chosen.vehicleNumber} has been let out.`)
      setChosen(null)
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['exit-parked'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['entries'] })
    },
  })

  const rows = inside.data?.sessions || []

  return (
    <div className="no-print fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Exit parked vehicle" className="mt-10 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Exit Parked Vehicle</h2>
            <p className="text-xs text-slate-500">Lets a vehicle that is still inside out without payment. The reason is recorded in the audit log.</p>
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>

        <Alert type="success">{done}</Alert>
        <Alert>{release.error ? errorMessage(release.error) : inside.error ? errorMessage(inside.error) : ''}</Alert>

        {chosen ? (
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              release.mutate()
            }}
          >
            <p className="text-sm text-slate-800">
              Let <strong>{chosen.vehicleNumber}</strong> ({VEHICLE_LABELS[chosen.vehicleType] || chosen.vehicleType}, ticket {chosen.ticketNumber}, in since {dateTime(chosen.entryTime)}) out <strong>without payment</strong>?
            </p>
            <Field
              label="Reason"
              name="exit-reason"
              autoFocus
              minLength={5}
              maxLength={300}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint="At least 5 characters."
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" loading={release.isPending} disabled={reason.trim().length < 5}>Exit without payment</Button>
              <Button type="button" variant="secondary" onClick={() => { setChosen(null); setReason('') }}>Back</Button>
            </div>
          </form>
        ) : (
          <>
            <div className="mt-3 max-w-sm">
              <Field label="Search" name="exit-parked-search" type="search" placeholder="Vehicle number or ticket" autoComplete="off" value={search} onChange={(event) => { setSearch(event.target.value); setDone('') }} />
            </div>
            {inside.isPending ? (
              <p className="mt-3 text-sm text-slate-500">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{q ? 'No vehicle inside matches.' : 'No vehicles are inside.'}</p>
            ) : (
              <div className="mt-3 max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Vehicle</th>
                      <th className="pb-2 pr-3 font-medium">Type</th>
                      <th className="pb-2 pr-3 font-medium">In time</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((session) => (
                      <tr key={session._id} className="border-t border-slate-200">
                        <td className="py-2 pr-3">
                          <span className="font-semibold text-slate-900">{session.vehicleNumber}</span>
                          <span className="block font-mono text-xs text-slate-500">{session.ticketNumber}</span>
                        </td>
                        <td className="py-2 pr-3">{VEHICLE_LABELS[session.vehicleType] || session.vehicleType}</td>
                        <td className="py-2 pr-3 text-slate-600">{dateTime(session.entryTime)}</td>
                        <td className="py-2 text-right">
                          <Button variant="danger" onClick={() => { setChosen(session); setDone('') }}>Exit</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {inside.data.total > rows.length && (
                  <p className="mt-2 text-xs text-slate-500">Showing the latest {rows.length} of {inside.data.total}. Search to narrow the list.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
