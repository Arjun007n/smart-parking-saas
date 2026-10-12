import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { operatorApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateOnly, todayInput } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, Select } from '../../components/ui'
import { EnterIcon, ExitIcon } from '../../components/operator/icons'
import { CardSkeleton, CountUp, FillBar } from '../../components/motion'
import MoneyTiles from '../../components/operator/MoneyTiles'
import CollectionByType from '../../components/operator/CollectionByType'

// One card of counters: how many came in, went out, are free and are parked, with the capacity badge on top.
function Counts({ title, counts }) {
  return (
    <section className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="mb-2 flex items-center justify-center gap-2 text-sm font-bold text-[#1e3d73]">
        {title}
        <span className="rounded bg-[#1e3d73] px-2 py-0.5 text-xs font-bold text-white">{counts.capacity}</span>
      </div>
      <div className="mb-3"><FillBar used={counts.parked} total={counts.capacity} label={`${title} occupancy`} /></div>
      <dl className="grid grid-cols-2 gap-2 text-center">
        {[
          ['Entries', counts.entries, 'count-entries'],
          ['Exits', counts.exits, 'count-exits'],
          ['Available', counts.available, 'count-available'],
          ['Parked', counts.parked, 'count-parked'],
        ].map(([label, value, tone]) => (
          <div key={label} className={`rounded-lg p-3 ${tone}`}>
            <dd className="text-2xl font-bold"><CountUp value={value} /></dd>
            <dt className="text-xs font-semibold">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}

// The operator's Home: licence, the day's money, and how full the parking is.
export default function OperatorDashboard() {
  const { company, can } = useAuth()
  const { locations, defaultId } = useMyLocations()
  // The figures cover a period: from one date and time to another. It opens on today, midnight to 23:59.
  const [filters, setFilters] = useState({ from: `${todayInput()}T00:00`, to: `${todayInput()}T23:59`, locationId: '' })
  const locationId = filters.locationId || (locations.length === 1 ? defaultId : '')
  const params = { from: filters.from, to: filters.to, ...(locationId ? { locationId } : {}) }
  const backwards = Boolean(filters.from && filters.to && filters.to < filters.from)
  const isToday = filters.from === `${todayInput()}T00:00` && filters.to === `${todayInput()}T23:59`

  const { data, isLoading, error } = useQuery({
    queryKey: ['operator-summary', params],
    queryFn: () => operatorApi.summary(params),
    refetchInterval: 30_000,
    enabled: Boolean(filters.from && filters.to) && !backwards,
  })

  const license = data?.license
  const totals = data?.collection?.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-[#007bff]">{company?.name || 'Smart Parking'}</h1>
          {license?.validTill && (
            <p className="mt-1 text-sm text-slate-600">
              {license.plan ? `${license.plan} plan · ` : ''}License Valid Till: <strong className="text-lg font-bold text-red-600">{dateOnly(license.validTill)}</strong>
              {license.status && license.status !== 'ACTIVE' &&  <Badge tone="red">{license.status.toLowerCase()}</Badge>}
            </p>
          )}
        </div>
        <div className="no-print flex flex-wrap items-end gap-3">
          <Field label="From" type="datetime-local" name="home-from" max={filters.to || undefined} value={filters.from} onChange={(event) => setFilters((f) => ({ ...f, from: event.target.value }))} />
          <Field label="To" type="datetime-local" name="home-to" min={filters.from || undefined} value={filters.to} onChange={(event) => setFilters((f) => ({ ...f, to: event.target.value }))} />
          {!isToday && (
            <Button type="button" variant="secondary" onClick={() => setFilters((f) => ({ ...f, from: `${todayInput()}T00:00`, to: `${todayInput()}T23:59` }))}>Today</Button>
          )}
          {locations.length > 1 && (
            <Select label="Location" name="home-location" value={filters.locationId} onChange={(event) => setFilters((f) => ({ ...f, locationId: event.target.value }))}>
              <option value="">All my locations</option>
              {locations.map((l) => (
                <option key={l._id} value={l._id}>{l.name}</option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {backwards && <Alert>The end must be after the start.</Alert>}
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <CardSkeleton count={8} />
      ) : data && (
        <div className="print-area space-y-6">
          {totals && (
            <MoneyTiles totals={totals} />
          )}

          {data.counts.all.capacity === 0 ? (
            <Alert type="info">You are not assigned to a parking location yet. Ask your admin to assign one.</Alert>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Counts title="Total Vehicles | Capacity:" counts={data.counts.all} />
              {data.counts.types.map((row) => (
                <Counts key={row.type} title={`${VEHICLE_LABELS[row.type]} | Capacity:`} counts={row} />
              ))}
              <div className="no-print flex flex-col justify-start gap-3">
                {can('ENTRY_CREATE') && (
                  <Link to="/operator/entry" className="gate-btn-entry sp-press flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-lg font-semibold text-white">
                    <EnterIcon width={20} height={20} /> Vehicle Entry
                  </Link>
                )}
                {can('EXIT_CREATE') && (
                  <Link to="/operator/exit" className="gate-btn-exit sp-press flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-lg font-semibold text-white">
                    <ExitIcon width={20} height={20} /> Vehicle Exit
                  </Link>
                )}
                <div className="flex gap-3">
                  {can('PAYMENT_COLLECT') && (
                    <Link to="/operator/collection" className="sp-press flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1e3d73] hover:bg-slate-50">Collection List</Link>
                  )}
                  <Button variant="secondary" className="flex-1" onClick={() => window.print()}>Print</Button>
                </div>
              </div>
            </div>
          )}

          {data.collection && (
            <Card title="Collection by vehicle type">
              <CollectionByType rows={data.collection.rows} totals={data.collection.totals} />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
