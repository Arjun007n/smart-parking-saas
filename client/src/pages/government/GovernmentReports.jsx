import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { governmentApi } from '../../services/api'
import { usePageTitle } from '../../hooks/usePageTitle'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime, todayInput } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import { BarChartCard } from '../../components/charts'

const TYPES = Object.keys(VEHICLE_LABELS)

function Tile({ label, value, tone }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${tone}`}>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-extrabold text-slate-900">{value}</p>
    </div>
  )
}

// The only screen of a government officer: how many vehicles entered and left, and who they were.
export default function GovernmentReports() {
  usePageTitle('Government reports')
  const [filters, setFilters] = useState({ from: todayInput(), to: todayInput(), locationId: '', direction: 'ALL', vehicleType: '', q: '', page: 1, pageSize: 25 })
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }))

  const range = { from: filters.from, to: filters.to, ...(filters.locationId ? { locationId: filters.locationId } : {}) }
  const listParams = {
    ...range,
    direction: filters.direction,
    ...(filters.vehicleType ? { vehicleType: filters.vehicleType } : {}),
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
  }
  const ready = Boolean(filters.from) && Boolean(filters.to) && filters.from <= filters.to

  const places = useQuery({ queryKey: ['gov-locations'], queryFn: governmentApi.locations })
  const summary = useQuery({ queryKey: ['gov-summary', range], queryFn: () => governmentApi.summary(range), placeholderData: keepPreviousData, enabled: ready })
  const list = useQuery({
    queryKey: ['gov-movements', listParams, filters.page, filters.pageSize],
    queryFn: () => governmentApi.movements({ ...listParams, page: filters.page, pageSize: filters.pageSize }),
    placeholderData: keepPreviousData,
    enabled: ready,
  })
  const download = useMutation({ mutationFn: (format) => governmentApi.download(listParams, format) })

  const s = summary.data
  const l = list.data
  const pages = l ? Math.max(1, Math.ceil(l.total / l.pageSize)) : 1
  const error = summary.error || list.error || download.error

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="From" type="date" name="gov-from" max={todayInput()} value={filters.from} onChange={(e) => set({ from: e.target.value, ...(e.target.value > filters.to ? { to: e.target.value } : {}) })} />
        <Field label="To" type="date" name="gov-to" min={filters.from} max={todayInput()} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        {(places.data || []).length > 1 && (
          <Select label="Location" name="gov-location" value={filters.locationId} onChange={(e) => set({ locationId: e.target.value })}>
            <option value="">All my locations</option>
            {places.data.map((p) => (
              <option key={p._id} value={p._id}>{p.name}</option>
            ))}
          </Select>
        )}
      </div>

      {!ready && <Alert type="info">Choose a start date that is not after the end date.</Alert>}
      <Alert>{error ? errorMessage(error) : ''}</Alert>

      {summary.isPending && ready ? (
        <PageLoader />
      ) : s ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Vehicles entered" value={s.totals.entries} tone="border-green-300" />
            <Tile label="Vehicles exited" value={s.totals.exits} tone="border-red-300" />
            <Tile label="Inside now" value={s.totals.inside} tone="border-blue-300" />
          </div>

          <Card title="Entries and exits by day">
            <BarChartCard
              data={s.byDay}
              xKey="date"
              series={[{ key: 'entries', label: 'Entries' }, { key: 'exits', label: 'Exits' }]}
              summary="Number of vehicles that entered and exited on each day"
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="By vehicle type">
              <Table
                head={['Vehicle type', 'Entries', 'Exits', 'Inside now']}
                rows={s.byType.map((t) => [VEHICLE_LABELS[t.type] || t.type, t.entries, t.exits, t.inside])}
                empty="No vehicles in this period."
              />
            </Card>
            <Card title="By location">
              <Table
                head={['Location', 'Entries', 'Exits', 'Inside now']}
                rows={s.byLocation.map((p) => [p.name, p.entries, p.exits, p.inside])}
                empty="No locations."
              />
            </Card>
          </div>
        </>
      ) : null}

      <Card
        title="Vehicles"
        action={
          <div className="flex gap-2">
            {['xlsx', 'csv', 'pdf'].map((format) => (
              <Button key={format} variant="info" loading={download.isPending && download.variables === format} onClick={() => download.mutate(format)} disabled={!ready}>
                {format.toUpperCase()}
              </Button>
            ))}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <Select label="Show" name="gov-direction" value={filters.direction} onChange={(e) => set({ direction: e.target.value })}>
            <option value="ALL">Entries and exits</option>
            <option value="ENTRY">Entries only</option>
            <option value="EXIT">Exits only</option>
          </Select>
          <Select label="Vehicle type" name="gov-type" value={filters.vehicleType} onChange={(e) => set({ vehicleType: e.target.value })}>
            <option value="">All types</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>{VEHICLE_LABELS[type]}</option>
            ))}
          </Select>
          <Field label="Vehicle number or ticket" name="gov-search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
          <Select label="Rows" name="gov-size" value={filters.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })}>
            {(l?.pageSizes || [10, 25, 50, 100, 200]).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </div>

        {l && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    {['SNo', 'Entry / Exit', 'Time', 'Vehicle no', 'Vehicle type', 'Ticket', 'Location', 'Gate'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {l.movements.length === 0 && (
                    <tr><td colSpan={8} className="px-2 py-8 text-center text-slate-500">No vehicles match.</td></tr>
                  )}
                  {l.movements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100">
                      <td className="px-2 py-2">{m.sno}</td>
                      <td className="px-2 py-2"><Badge tone={m.direction === 'ENTRY' ? 'green' : 'red'}>{m.direction === 'ENTRY' ? 'Entry' : 'Exit'}</Badge></td>
                      <td className="whitespace-nowrap px-2 py-2">{dateTime(m.time)}</td>
                      <td className="px-2 py-2 font-semibold">{m.vehicleNumber}</td>
                      <td className="px-2 py-2">{VEHICLE_LABELS[m.vehicleType] || m.vehicleType}</td>
                      <td className="px-2 py-2">{m.ticketNumber || '—'}</td>
                      <td className="px-2 py-2">{m.locationName}</td>
                      <td className="px-2 py-2">{m.gate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>{l.total} in all</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
                <span>Page {filters.page} of {pages}</span>
                <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
              </div>
            </div>
          </>
        )}
        {!l && list.isPending && ready && <PageLoader />}
      </Card>
    </div>
  )
}

function Table({ head, rows, empty }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-slate-600">
          {head.map((h, i) => (
            <th key={h} className={`px-2 py-2 font-semibold ${i ? 'text-right' : ''}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]} className="border-b border-slate-100">
            {row.map((cell, i) => (
              <td key={i} className={`px-2 py-2 ${i ? 'text-right' : 'font-medium'}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
