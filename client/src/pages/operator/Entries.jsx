import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { SESSION_STATUS, VEHICLE_LABELS, dateTime, duration } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'

// Minutes a vehicle has been inside, measured when the list was loaded.
const minutesSince = (entryTime, loadedAt) => Math.max(0, Math.ceil((loadedAt - new Date(entryTime).getTime()) / 60000))

function SessionRow({ session, locationNames, loadedAt, canCorrect }) {
  const queryClient = useQueryClient()
  const correct = useMutation({
    mutationFn: ({ action, reason }) => parkingApi[action](session._id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries'] })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })

  const ask = (action, question) => {
    const reason = window.prompt(question)
    if (reason === null) return
    if (reason.trim().length < 5) {
      window.alert('Please give a reason of at least 5 characters.')
      return
    }
    correct.mutate({ action, reason: reason.trim().slice(0, 300) })
  }

  const status = SESSION_STATUS[session.status]

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="py-3 pr-4">
        <p className="font-semibold text-slate-900">{session.vehicleNumber}</p>
        <p className="font-mono text-xs text-slate-500">{session.ticketNumber}</p>
      </td>
      <td className="py-3 pr-4">{VEHICLE_LABELS[session.vehicleType]}</td>
      <td className="py-3 pr-4 text-slate-600">{locationNames[session.locationId] || '—'}</td>
      <td className="py-3 pr-4 text-slate-600">
        {dateTime(session.entryTime)}
        <span className="block text-xs text-slate-500">{duration(minutesSince(session.entryTime, loadedAt))} ago</span>
      </td>
      <td className="py-3 pr-4">
        <Badge tone={status.tone}>{status.label}</Badge>
      </td>
      {canCorrect && (
        <td className="py-3 text-right">
          <div className="flex flex-wrap justify-end gap-2">
            {session.status === 'ACTIVE' && (
              <Button
                variant="secondary"
                loading={correct.isPending}
                onClick={() => ask('cancel', `Cancel the entry of ${session.vehicleNumber}? Use this only for an entry made by mistake. Reason:`)}
              >
                Cancel entry
              </Button>
            )}
            <Button
              variant="danger"
              loading={correct.isPending}
              onClick={() => ask('override', `Let ${session.vehicleNumber} out WITHOUT payment? This is recorded in the audit log. Reason:`)}
            >
              Exit without payment
            </Button>
          </div>
          {correct.error && <p className="mt-1 text-sm text-red-600">{errorMessage(correct.error)}</p>}
        </td>
      )}
    </tr>
  )
}

export default function Entries() {
  const { can } = useAuth()
  const canCorrect = can('LOCATION_MANAGE')
  const { locations } = useMyLocations()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState({ q: '', locationId: '', page: 1 })

  const { data, isLoading, isFetching, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['entries', search],
    queryFn: () =>
      parkingApi.entries({
        ...(search.q ? { q: search.q } : {}),
        ...(search.locationId ? { locationId: search.locationId } : {}),
        page: search.page,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })

  const locationNames = Object.fromEntries(locations.map((l) => [l._id, l.name]))
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Vehicles Inside</h1>

      <Card>
        <form
          role="search"
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch((s) => ({ ...s, q: input.trim(), page: 1 }))
          }}
        >
          <Field
            className="min-w-56 flex-1"
            label="Vehicle number or ticket"
            name="session-search"
            placeholder="RJ14… or T-260302-…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {locations.length > 1 && (
            <Select
              label="Location"
              name="location-filter"
              value={search.locationId}
              onChange={(event) => setSearch((s) => ({ ...s, locationId: event.target.value, page: 1 }))}
            >
              <option value="">All my locations</option>
              {locations.map((l) => (
                <option key={l._id} value={l._id}>{l.name}</option>
              ))}
            </Select>
          )}
          <Button type="submit">Search</Button>
          <Button type="button" variant="secondary" loading={isFetching} onClick={() => refetch()}>
            Refresh
          </Button>
        </form>

        {error && <Alert>{errorMessage(error)}</Alert>}
        {isLoading ? (
          <PageLoader />
        ) : data && data.sessions.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Vehicle / ticket</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Location</th>
                    <th className="pb-2 pr-4 font-medium">Entered</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    {canCorrect && <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((session) => (
                    <SessionRow
                      key={session._id}
                      session={session}
                      locationNames={locationNames}
                      loadedAt={dataUpdatedAt}
                      canCorrect={canCorrect}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>{data.total} vehicles inside · page {data.page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={search.page <= 1} onClick={() => setSearch((s) => ({ ...s, page: s.page - 1 }))}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={search.page >= pages} onClick={() => setSearch((s) => ({ ...s, page: s.page + 1 }))}>
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          !error && <p className="text-sm text-slate-500">No vehicles inside{search.q ? ' match this search' : ''}.</p>
        )}
      </Card>
    </div>
  )
}
