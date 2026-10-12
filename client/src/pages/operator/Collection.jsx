import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { operatorApi, parkingApi, paymentApi, shiftApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, SESSION_STATUS, duration, money, timeOnly, todayInput } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import ShiftPanel from '../../components/operator/ShiftPanel'
import CollectionByType from '../../components/operator/CollectionByType'
import MoneyTiles from '../../components/operator/MoneyTiles'

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
  const byType = useQuery({
    queryKey: ['operator-collection', params],
    queryFn: () => operatorApi.collection(params),
    enabled: Boolean(filters.date),
  })
  const download = useMutation({ mutationFn: (format) => operatorApi.download('collection', params, format) })
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
            <MoneyTiles totals={byType.data?.totals} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Total collected</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{money(c.total.amount)}</p>
              </div>
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Payments</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{c.total.count}</p>
                {c.passes?.count > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    of which pass sales: {c.passes.count} ({money(c.passes.amount)})
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">Tax in total</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{money(c.total.tax)}</p>
              </div>
            </div>

            <Card
              title="Collection List"
              action={
                <div className="no-print flex gap-2">
                  <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate('xlsx')}>Download Excel</Button>
                  <Button variant="secondary" onClick={() => window.print()}>Print</Button>
                </div>
              }
            >
              {byType.error && <Alert>{errorMessage(byType.error)}</Alert>}
              {download.error && <Alert>{errorMessage(download.error)}</Alert>}
              {byType.isLoading ? <PageLoader /> : <CollectionByType rows={byType.data?.rows} totals={byType.data?.totals} />}
            </Card>

            {c.walletTopups?.count > 0 && (
              <Alert type="info">
                Money put into wallets today: {money(c.walletTopups.amount)} ({c.walletTopups.byMethod.map((m) => `${PAYMENT_LABELS[m.key] || m.key} ${money(m.amount)}`).join(', ')}).
                It is not counted in the totals above: it becomes income when a parking fee is paid from a wallet.
              </Alert>
            )}

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
