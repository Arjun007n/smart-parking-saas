import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi, paymentApi, shiftApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, SESSION_STATUS, duration, money, timeOnly, todayInput } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import ShiftPanel from '../../components/operator/ShiftPanel'

// Lets an admin give the money of a paid exit back.
function RefundButton({ session }) {
  const queryClient = useQueryClient()
  const refund = useMutation({
    mutationFn: (reason) => paymentApi.refund(session.paymentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection'] })
      queryClient.invalidateQueries({ queryKey: ['shift'] })
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
  })

  const ask = () => {
    const reason = window.prompt(`Refund ${money(session.fee?.total)} for ${session.vehicleNumber}? This is recorded in the audit log. Reason:`)
    if (reason === null) return
    if (reason.trim().length < 5) {
      window.alert('Please give a reason of at least 5 characters.')
      return
    }
    refund.mutate(reason.trim().slice(0, 300))
  }

  if (refund.isSuccess) return <Badge>Refunded</Badge>
  return (
    <>
      <Button variant="danger" loading={refund.isPending} onClick={ask}>Refund</Button>
      {refund.error && <span className="mt-1 block text-xs text-red-600">{errorMessage(refund.error)}</span>}
    </>
  )
}

function ShiftsOfDay({ params }) {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['shifts', params], queryFn: () => shiftApi.list(params) })
  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>
  if (data.length === 0) return <p className="text-sm text-slate-500">No shifts were started on this day.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-2 pr-4 font-medium">Operator</th>
            <th className="pb-2 pr-4 font-medium">Started</th>
            <th className="pb-2 pr-4 font-medium">Ended</th>
            <th className="pb-2 pr-4 text-right font-medium">Collected</th>
            <th className="pb-2 pr-4 text-right font-medium">Cash expected</th>
            <th className="pb-2 pr-4 text-right font-medium">Cash counted</th>
            <th className="pb-2 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {data.map((shift) => (
            <tr key={shift._id} className="border-t border-slate-200">
              <td className="py-2 pr-4">{shift.operatorName}</td>
              <td className="py-2 pr-4">{timeOnly(shift.openedAt)}</td>
              <td className="py-2 pr-4">{shift.status === 'OPEN' ? <Badge tone="blue">Open</Badge> : timeOnly(shift.closedAt)}</td>
              <td className="py-2 pr-4 text-right">{money(shift.totals?.collected)}</td>
              <td className="py-2 pr-4 text-right">{money(shift.status === 'OPEN' ? shift.totals?.expectedCash : shift.expectedCash)}</td>
              <td className="py-2 pr-4 text-right">{shift.status === 'OPEN' ? '—' : money(shift.closingCash)}</td>
              <td className="py-2 text-right font-medium">
                {shift.status === 'OPEN' ? '—' : shift.difference === 0 ? 'Matches' : `${shift.difference < 0 ? 'Short' : 'Over'} ${money(Math.abs(shift.difference))}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Collection() {
  const { can } = useAuth()
  const canRefund = can('LOCATION_MANAGE')
  const { locations, defaultId, isLoading: locationsLoading } = useMyLocations()
  const [filters, setFilters] = useState({ date: todayInput(), locationId: '' })
  const params = { date: filters.date, ...(filters.locationId ? { locationId: filters.locationId } : {}) }

  const collection = useQuery({
    queryKey: ['collection', params],
    queryFn: () => paymentApi.collection(params),
    enabled: Boolean(filters.date),
  })
  const exits = useQuery({
    queryKey: ['exits', params],
    queryFn: () => parkingApi.exits(params),
    enabled: Boolean(filters.date),
  })
  const c = collection.data

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Collection</h1>

      {!locationsLoading && locations.length > 0 && <ShiftPanel locations={locations} defaultId={defaultId} />}

      <div className="flex flex-wrap items-end gap-4">
        <Field
          label="Date"
          type="date"
          name="collection-date"
          max={todayInput()}
          value={filters.date}
          onChange={(event) => setFilters((f) => ({ ...f, date: event.target.value }))}
        />
        {locations.length > 1 && (
          <Select
            label="Location"
            name="collection-location"
            value={filters.locationId}
            onChange={(event) => setFilters((f) => ({ ...f, locationId: event.target.value }))}
          >
            <option value="">All my locations</option>
            {locations.map((l) => (
              <option key={l._id} value={l._id}>{l.name}</option>
            ))}
          </Select>
        )}
      </div>

      {collection.error && <Alert>{errorMessage(collection.error)}</Alert>}
      {collection.isLoading ? (
        <PageLoader />
      ) : (
        c && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Total collected</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{money(c.total.amount)}</p>
              </div>
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Payments</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{c.total.count}</p>
              </div>
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Net after refunds</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{money(c.net)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {c.refunded.count} refund{c.refunded.count === 1 ? '' : 's'}: {money(c.refunded.amount)} · tax in total {money(c.total.tax)}
                </p>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card title="By payment method">
                {c.byMethod.length === 0 ? (
                  <p className="text-sm text-slate-500">No payments on this day.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="pb-2 font-medium">Method</th>
                        <th className="pb-2 text-right font-medium">Payments</th>
                        <th className="pb-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.byMethod.map((row) => (
                        <tr key={row.key} className="border-t border-slate-200">
                          <td className="py-2">{PAYMENT_LABELS[row.key] || row.key}</td>
                          <td className="py-2 text-right">{row.count}</td>
                          <td className="py-2 text-right font-medium">{money(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
              <Card title="By operator">
                {c.byOperator.length === 0 ? (
                  <p className="text-sm text-slate-500">No payments on this day.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="pb-2 font-medium">Operator</th>
                        <th className="pb-2 text-right font-medium">Payments</th>
                        <th className="pb-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.byOperator.map((row) => (
                        <tr key={row.key || 'online'} className="border-t border-slate-200">
                          <td className="py-2">{row.name}</td>
                          <td className="py-2 text-right">{row.count}</td>
                          <td className="py-2 text-right font-medium">{money(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </>
        )
      )}

      <Card title="Exits on this day">
        {exits.error && <Alert>{errorMessage(exits.error)}</Alert>}
        {exits.isLoading ? (
          <PageLoader />
        ) : exits.data && exits.data.sessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Vehicle / ticket</th>
                  <th className="pb-2 pr-4 font-medium">Exit</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 text-right font-medium">Fee</th>
                  <th className="pb-2 font-medium"><span className="sr-only">Receipt</span></th>
                </tr>
              </thead>
              <tbody>
                {exits.data.sessions.map((session) => (
                  <tr key={session._id} className="border-t border-slate-200">
                    <td className="py-2 pr-4">
                      <span className="font-semibold text-slate-900">{session.vehicleNumber}</span>
                      <span className="block font-mono text-xs text-slate-500">{session.ticketNumber}</span>
                    </td>
                    <td className="py-2 pr-4">{timeOnly(session.exitTime)}</td>
                    <td className="py-2 pr-4">{session.durationMinutes != null ? duration(session.durationMinutes) : '—'}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={SESSION_STATUS[session.status].tone}>{SESSION_STATUS[session.status].label}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right">{money(session.fee?.total)}</td>
                    <td className="py-2 text-right">
                      <Link to={`/operator/receipt/${session._id}`} className="text-blue-700 hover:underline">
                        Receipt
                      </Link>
                      {canRefund && session.paymentId && (
                        <span className="ml-3 inline-block align-middle"><RefundButton session={session} /></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {exits.data.total > exits.data.sessions.length && (
              <p className="mt-3 text-sm text-slate-500">
                Showing the latest {exits.data.sessions.length} of {exits.data.total} exits.
              </p>
            )}
          </div>
        ) : (
          !exits.error && <p className="text-sm text-slate-500">No exits on this day.</p>
        )}
      </Card>

      <Card title="Shifts on this day">
        <ShiftsOfDay params={params} />
      </Card>
    </div>
  )
}
