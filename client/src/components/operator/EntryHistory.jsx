import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { SESSION_STATUS, VEHICLE_LABELS, dateTime, money } from '../../utils/format'
import { Alert, Badge, Button, Card, Field } from '../ui'
import { Skeleton } from '../motion'

// The vehicles inside this location, newest first, with a search box and a
// Print button on every row (the ticket opens beside the form, ready to print).
function ReEntryButton({ session, onDone }) {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState(false)
  const again = useMutation({
    mutationFn: () => parkingApi.reEntry(session._id),
    onSuccess: (data) => {
      setAsking(false)
      queryClient.invalidateQueries({ queryKey: ['entries'] })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      onDone(data)
    },
  })
  if (!asking) {
    return (
      <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setAsking(true)} title="Cancel this ticket and issue a new one">
        Re-entry
      </Button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-700">Cancel {session.ticketNumber} and issue a new ticket?</span>
      <Button className="px-3 py-1 text-xs" loading={again.isPending} onClick={() => again.mutate()}>
        Yes, re-enter
      </Button>
      <Button variant="secondary" className="px-3 py-1 text-xs" disabled={again.isPending} onClick={() => setAsking(false)}>
        No
      </Button>
      {again.error && <span className="w-full text-xs font-medium text-red-700">{errorMessage(again.error)}</span>}
    </span>
  )
}

export default function EntryHistory({ locationId, onPrint, onReEntry }) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  // Search while typing, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [text])

  const { data, isLoading, error } = useQuery({
    queryKey: ['entries', { locationId, q, page, view: 'gate' }],
    queryFn: () => parkingApi.entries({ locationId, page, ...(q ? { q } : {}) }),
    enabled: Boolean(locationId),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  })

  if (!locationId) return null
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const first = data ? (data.page - 1) * data.pageSize : 0

  return (
    <Card title="Entry History" className="no-print">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-500">Vehicles inside now{data ? ` · ${data.total}` : ''}</p>
        <Field
          className="w-full sm:w-64"
          label="Search"
          name="entry-search"
          placeholder="Vehicle number or ticket"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
      ) : data && data.sessions.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Print</th>
                  <th className="px-3 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">In time</th>
                  <th className="px-3 py-2 font-medium">Advance</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session, index) => {
                  const status = SESSION_STATUS[session.status]
                  return (
                    <tr key={session._id} className="sp-row-in border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-500">{first + index + 1}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => onPrint(session)}>
                            Print
                          </Button>
                          {onReEntry && session.status === 'ACTIVE' && <ReEntryButton session={session} onDone={onReEntry} />}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-900">{session.vehicleNumber}</p>
                        <p className="font-mono text-xs text-slate-500">{session.ticketNumber}</p>
                      </td>
                      <td className="px-3 py-2">{VEHICLE_LABELS[session.vehicleType]}</td>
                      <td className="px-3 py-2 text-slate-600">{dateTime(session.entryTime)}</td>
                      <td className="px-3 py-2 text-slate-600">{session.advance?.amount ? money(session.advance.amount) : '—'}</td>
                      <td className="px-3 py-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>Page {data.page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      ) : (
        !error && <p className="text-sm text-slate-500">No vehicles inside{q ? ' match this search' : ''}.</p>
      )}
    </Card>
  )
}
