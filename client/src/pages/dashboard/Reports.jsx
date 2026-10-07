import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { locationApi, reportApi, userApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, SESSION_STATUS, VEHICLE_LABELS, dateTime, duration, money, todayInput } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import { BarChartCard } from '../../components/charts'

// Which filters each report uses, and how its chart (if any) is drawn.
const REPORTS = {
  revenue: { label: 'Revenue', range: true, groupBy: true },
  'day-summary': { label: 'Day summary', day: true },
  'operator-collection': { label: 'Collection by operator', range: true, operator: true, vehicleType: true },
  collection: { label: 'Collection', range: true, operator: true, method: true, paged: true },
  transactions: { label: 'FASTag & online', range: true, transactions: true, paged: true },
  vehicles: { label: 'Vehicle history', range: true, search: true, status: true, vehicleType: true, gate: true, entryBy: true, exitBy: true, paged: true },
  occupancy: { label: 'Occupancy', day: true },
  operators: { label: 'Operators', range: true, operator: true },
  'peak-hours': { label: 'Peak hours', range: true, by: true },
  'occupancy-trend': { label: 'Occupancy trend', range: true },
  durations: { label: 'Length of stay', range: true },
  payments: { label: 'Payment methods', range: true },
  exceptions: { label: 'Exceptions', range: true, type: true, paged: true },
  passes: { label: 'Passes', range: true, due: true, paged: true },
  hardware: { label: 'Hardware', range: true },
  'frequent-vehicles': { label: 'Repeat vehicles', range: true, min: true, search: true, paged: true },
  locations: { label: 'Locations', range: true },
}

const MONEY_KEYS = [
  'collected', 'tax', 'refunded', 'net', 'amount', 'fee', 'cash', 'fees', 'average', 'passSales', 'perEntry',
  'entryAmount', 'exitAmount', 'upi', 'card', 'online', 'fastag', 'wallet', 'systemCollection', 'actualCollection', 'difference',
  'advance', 'payable', 'total',
]
const DATE_KEYS = ['paidAt', 'entryTime', 'exitTime', 'when', 'lastVisit', 'date']
const PERCENT_KEYS = ['utilization', 'peakUtilization', 'share', 'successRate', 'readRate', 'averageConfidence']
const MINUTE_KEYS = ['durationMinutes', 'averageStayMinutes', 'averageMinutes']
const NUMBER_KEYS = [
  'payments', 'refunds', 'entries', 'exits', 'corrections', 'vehicles', 'capacity', 'peakInside', 'failed', 'passVisits',
  'daysLeft', 'commands', 'acked', 'outages', 'detections', 'corrected', 'averageEntries', 'averageSeconds',
  'visits', 'locationCount', 'lostTickets', 'insideNow',
  'transactions', 'reprints', 'passEntries', 'paidEntries', 'passExits', 'paidExits', 'shifts', 'parked', 'photos',
]

const TXN_STATUS = { PENDING: 'Pending', UNKNOWN: 'Being checked', FAILED: 'Declined or failed' }

const EXCEPTION_TYPES = {
  CANCELLED: 'Entry cancelled', OVERRIDE: 'Released by admin', LOST_TICKET: 'Lost ticket', REFUND: 'Refund',
  PAYMENT_FAILED: 'Online payment failed', PAYMENT_PROBLEM: 'Payment problem', STILL_INSIDE: 'Inside for over 24 hours',
}
const HARDWARE_TYPES = { ANPR_CAMERA: 'ANPR camera', BARRIER: 'Barrier', PRINTER: 'Printer' }

// Shows a report value the way a person reads it (the CSV keeps raw values).
function display(key, value) {
  if (value === '' || value === null || value === undefined) return '—'
  if (MONEY_KEYS.includes(key)) return money(value)
  if (DATE_KEYS.includes(key)) return dateTime(value)
  if (MINUTE_KEYS.includes(key)) return duration(value)
  if (PERCENT_KEYS.includes(key)) return `${value}%`
  if (key === 'method') return PAYMENT_LABELS[value] || value
  if (key === 'type') return VEHICLE_LABELS[value] || HARDWARE_TYPES[value] || value
  if (key === 'status') return SESSION_STATUS[value]?.label || TXN_STATUS[value] || (value === 'REFUNDED' ? 'Refunded' : value === 'SUCCESS' ? 'Paid' : value)
  return String(value)
}

const isNumeric = (key) => MONEY_KEYS.includes(key) || PERCENT_KEYS.includes(key) || MINUTE_KEYS.includes(key) || NUMBER_KEYS.includes(key)

function buildParams(name, f) {
  const spec = REPORTS[name]
  return {
    ...(spec.range ? { from: f.from, to: f.to } : {}),
    ...(spec.day ? { date: f.from } : {}),
    ...(f.locationId ? { locationId: f.locationId } : {}),
    ...(spec.groupBy ? { groupBy: f.groupBy } : {}),
    ...(spec.by ? { by: f.by } : {}),
    ...(spec.type && f.exceptionType ? { type: f.exceptionType } : {}),
    ...(spec.due ? { due: f.due } : {}),
    ...(spec.min ? { min: f.min } : {}),
    ...(spec.operator && f.operatorId ? { operatorId: f.operatorId } : {}),
    ...(spec.method && f.method ? { method: f.method } : {}),
    ...(spec.transactions ? { kind: f.kind, view: f.view, ...(f.txnStatus ? { status: f.txnStatus } : {}) } : {}),
    ...(spec.search && f.q.trim() ? { q: f.q.trim() } : {}),
    ...(spec.status && f.status ? { status: f.status } : {}),
    ...(spec.vehicleType && f.vehicleType ? { vehicleType: f.vehicleType } : {}),
    ...(spec.gate && f.gate.trim() ? { gate: f.gate.trim() } : {}),
    ...(spec.entryBy && f.entryOperatorId ? { entryOperatorId: f.entryOperatorId } : {}),
    ...(spec.exitBy && f.exitOperatorId ? { exitOperatorId: f.exitOperatorId } : {}),
    ...(f.period ? { period: f.period } : {}),
    ...(spec.paged ? { page: f.page } : {}),
  }
}

export default function Reports() {
  const { can } = useAuth()
  // A link from the dashboard can open a report ready-filtered: ?report=vehicles&from=&to=&vehicleType=&locationId=
  const [linked] = useSearchParams()
  const [name, setName] = useState(() => (REPORTS[linked.get('report')] ? linked.get('report') : 'revenue'))
  const [filters, setFilters] = useState(() => {
    const day = /^\d{4}-\d{2}-\d{2}$/
    const from = day.test(linked.get('from') || '') ? linked.get('from') : todayInput()
    const to = day.test(linked.get('to') || '') ? linked.get('to') : from
    const type = linked.get('vehicleType') || ''
    return {
      from, to, locationId: linked.get('locationId') || '', groupBy: 'day', operatorId: '', method: '', q: '', status: '', page: 1,
      by: 'hour', kind: 'fastag', view: 'list', txnStatus: '', exceptionType: '', due: '30', min: '2', vehicleType: Object.hasOwn(VEHICLE_LABELS, type) ? type : '', gate: '', entryOperatorId: '', exitOperatorId: '', period: '',
    }
  })
  const spec = REPORTS[name]
  const params = buildParams(name, filters)
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }))

  const locations = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })
  const users = useQuery({ queryKey: ['users'], queryFn: userApi.list, enabled: can('USER_MANAGE') })
  const report = useQuery({
    queryKey: ['report', name, params],
    queryFn: () => reportApi.get(name, params),
    placeholderData: keepPreviousData,
    enabled: Boolean(filters.from) && (!spec.range || Boolean(filters.to)),
  })
  const periods = useQuery({ queryKey: ['report-periods'], queryFn: reportApi.periods, staleTime: 60 * 60 * 1000 })
  const download = useMutation({ mutationFn: (format) => reportApi.download(name, params, format) })

  const data = report.data
  const pages = data?.pageSize ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Reports</h1>

      <div role="tablist" aria-label="Report" className="flex gap-1 overflow-x-auto border-b border-slate-300">
        {Object.entries(REPORTS).map(([key, r]) => (
          <button
            key={key}
            role="tab"
            aria-selected={name === key}
            onClick={() => {
              setName(key)
              set({})
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              name === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field
          label={spec.day ? 'Date' : 'From'}
          type="date"
          name="report-from"
          max={filters.period === 'old' && periods.data ? periods.data.lastOldDay : todayInput()}
          min={filters.period === 'current' && periods.data ? periods.data.currentFrom : undefined}
          value={filters.from}
          onChange={(event) => set({ from: event.target.value, ...(event.target.value > filters.to ? { to: event.target.value } : {}) })}
        />
        {spec.range && (
          <Field
            label="To"
            type="date"
            name="report-to"
            min={filters.from}
            max={filters.period === 'old' && periods.data ? periods.data.lastOldDay : todayInput()}
            value={filters.to}
            onChange={(event) => set({ to: event.target.value })}
          />
        )}
        {(locations.data || []).length > 1 && (
          <Select label="Location" name="report-location" value={filters.locationId} onChange={(event) => set({ locationId: event.target.value })}>
            <option value="">All locations</option>
            {locations.data.map((l) => (
              <option key={l._id} value={l._id}>{l.name}</option>
            ))}
          </Select>
        )}
        {periods.data && (
          <Select
            label="Period"
            name="report-period"
            value={filters.period}
            onChange={(event) => {
              const period = event.target.value
              // Old reports start on the last day of the old period; current ones on today.
              const day = period === 'old' ? periods.data.lastOldDay : todayInput()
              set({ period, ...(period ? { from: day, to: day } : {}) })
            }}
          >
            <option value="">Any dates</option>
            <option value="current">Current (last {periods.data.days} days)</option>
            <option value="old">Old (before {periods.data.currentFrom})</option>
          </Select>
        )}
        {spec.groupBy && (
          <Select label="Group by" name="report-group" value={filters.groupBy} onChange={(event) => set({ groupBy: event.target.value })}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="location">Location</option>
          </Select>
        )}
        {spec.by && (
          <Select label="Show by" name="report-by" value={filters.by} onChange={(event) => set({ by: event.target.value })}>
            <option value="hour">Hour of the day</option>
            <option value="weekday">Day of the week</option>
          </Select>
        )}
        {spec.type && (
          <Select label="What" name="report-exception" value={filters.exceptionType} onChange={(event) => set({ exceptionType: event.target.value })}>
            <option value="">Everything</option>
            {Object.entries(EXCEPTION_TYPES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        )}
        {spec.due && (
          <Select label="Ending within" name="report-due" value={filters.due} onChange={(event) => set({ due: event.target.value })}>
            {[7, 14, 30, 60, 90].map((days) => (
              <option key={days} value={days}>{days} days</option>
            ))}
          </Select>
        )}
        {spec.min && (
          <Select label="At least" name="report-min" value={filters.min} onChange={(event) => set({ min: event.target.value })}>
            {[2, 3, 5, 10, 20].map((visits) => (
              <option key={visits} value={visits}>{visits} visits</option>
            ))}
          </Select>
        )}
        {spec.operator && (users.data || []).length > 0 && (
          <Select label="Operator" name="report-operator" value={filters.operatorId} onChange={(event) => set({ operatorId: event.target.value })}>
            <option value="">All operators</option>
            {users.data.map((u) => (
              <option key={u._id} value={u._id}>{u.name}</option>
            ))}
          </Select>
        )}
        {spec.transactions && (
          <>
            <Select label="Payment" name="report-kind" value={filters.kind} onChange={(event) => set({ kind: event.target.value, txnStatus: '' })}>
              <option value="fastag">FASTag</option>
              <option value="online">Online (gateway)</option>
            </Select>
            <Select label="Show" name="report-view" value={filters.view} onChange={(event) => set({ view: event.target.value })}>
              <option value="list">Every transaction</option>
              <option value="daily">Day by day (accepted only)</option>
            </Select>
            {filters.view === 'list' && (
              <Select label="Status" name="report-txn-status" value={filters.txnStatus} onChange={(event) => set({ txnStatus: event.target.value })}>
                <option value="">All statuses</option>
                <option value="SUCCESS">Accepted</option>
                <option value="PENDING">Pending</option>
                {filters.kind === 'fastag' && <option value="UNKNOWN">Being checked</option>}
                <option value="FAILED">Declined or failed</option>
                {filters.kind === 'online' && <option value="REFUNDED">Refunded</option>}
              </Select>
            )}
          </>
        )}
        {spec.method && (
          <Select label="Paid by" name="report-method" value={filters.method} onChange={(event) => set({ method: event.target.value })}>
            <option value="">Any method</option>
            {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        )}
        {spec.search && (
          <Field label="Vehicle number starts with" name="report-q" placeholder="RJ14…" value={filters.q} onChange={(event) => set({ q: event.target.value })} />
        )}
        {spec.status && (
          <Select label="Status" name="report-status" value={filters.status} onChange={(event) => set({ status: event.target.value })}>
            <option value="">Any status</option>
            {Object.entries(SESSION_STATUS).map(([value, s]) => (
              <option key={value} value={value}>{s.label}</option>
            ))}
          </Select>
        )}
        {spec.vehicleType && (
          <Select label="Vehicle type" name="report-vehicle-type" value={filters.vehicleType} onChange={(event) => set({ vehicleType: event.target.value })}>
            <option value="">Any type</option>
            {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        )}
        {spec.gate && <Field label="Gate" name="report-gate" placeholder="Gate name" value={filters.gate} onChange={(event) => set({ gate: event.target.value })} />}
        {spec.entryBy && (users.data || []).length > 0 && (
          <Select label="Entry by" name="report-entry-by" value={filters.entryOperatorId} onChange={(event) => set({ entryOperatorId: event.target.value })}>
            <option value="">Anyone</option>
            {users.data.map((u) => (
              <option key={u._id} value={u._id}>{u.name}</option>
            ))}
          </Select>
        )}
        {spec.exitBy && (users.data || []).length > 0 && (
          <Select label="Exit by" name="report-exit-by" value={filters.exitOperatorId} onChange={(event) => set({ exitOperatorId: event.target.value })}>
            <option value="">Anyone</option>
            {users.data.map((u) => (
              <option key={u._id} value={u._id}>{u.name}</option>
            ))}
          </Select>
        )}
        <div className="flex gap-2" role="group" aria-label="Download this report">
          {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].map(([format, label]) => (
            <Button
              key={format}
              variant="secondary"
              loading={download.isPending && download.variables === format}
              disabled={!data || data.rows.length === 0 || download.isPending}
              onClick={() => download.mutate(format)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {download.error && <Alert>{errorMessage(download.error)}</Alert>}
      {report.error && <Alert>{errorMessage(report.error)}</Alert>}

      {report.isLoading ? (
        <PageLoader />
      ) : (
        data && (
          <>
            {name === 'revenue' && data.total && (
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['Collected', money(data.total.collected), `${data.total.payments} payments`],
                  ['Refunded', money(data.total.refunded), null],
                  ['Net revenue', money(data.total.net), null],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
                    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
                  </div>
                ))}
              </div>
            )}

            {name === 'revenue' && data.rows.length > 1 && (
              <Card title="Net revenue">
                <BarChartCard
                  data={data.rows}
                  xKey="period"
                  xLabel={data.columns[0].label}
                  series={[{ key: 'net', label: 'Net revenue' }]}
                  formatValue={(value) => money(value)}
                  summary={`Net revenue by ${data.groupBy}: ${money(data.total.net)} in total.`}
                />
              </Card>
            )}

            {name === 'operator-collection' && data.vehicleType && (
              <Alert type="info">
                Only {VEHICLE_LABELS[data.vehicleType] || data.vehicleType} tickets are counted. Pass sales and cash found short or over belong to a person, not a vehicle class, so they are left out.
              </Alert>
            )}

            {name === 'operator-collection' && data.total && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['System collection', money(data.total.systemCollection), `${data.total.entries || 0} entries · ${data.total.exits || 0} exits`],
                  ['Actual collection', money(data.total.actualCollection), `${data.total.shifts || 0} shift(s) closed in this period`],
                  ['Short / over', money(data.total.difference), data.total.difference < 0 ? 'Cash counted was less than expected' : data.total.difference > 0 ? 'Cash counted was more than expected' : 'Counted cash matched'],
                  ['Reprints', data.total.reprints || 0, `${data.total.passEntries || 0} pass entries`],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
                  </div>
                ))}
              </div>
            )}

            {name === 'transactions' && data.tiles && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Accepted', money(data.tiles.accepted), 'Money that went through'],
                    ['In progress', money(data.tiles.inProgress), 'Waiting for the bank or being checked'],
                    ['Declined / failed', money(data.tiles.declined), 'Not charged'],
                    ['Refunded', money(data.tiles.refunded), `${data.tiles.count} attempts in this period`],
                  ].map(([label, value, hint]) => (
                    <div key={label} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                      <p className="mt-1 text-xs text-slate-500">{hint}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-slate-600">
                  This is what our system recorded. It is not a bank statement, so compare it with your payment partner&apos;s settlement report before you reconcile.
                </p>
              </>
            )}

            {name === 'day-summary' && (
              <p className="text-sm text-slate-600">
                One day at {filters.locationId ? 'this location' : 'all locations'}, by vehicle type. Choose a location and download the PDF to keep a copy.
              </p>
            )}

            {name === 'occupancy' && data.rows.length > 0 && (
              <Card title={`Vehicles inside, by hour${data.peak ? ` · peak ${data.peak.vehicles} at ${data.peak.hour}` : ''}`}>
                <BarChartCard
                  data={data.rows}
                  xKey="hour"
                  xLabel="Hour"
                  series={[{ key: 'vehicles', label: 'Vehicles inside' }]}
                  summary={`Vehicles inside for each hour of the day. Capacity is ${data.capacity}.`}
                />
              </Card>
            )}

            {name === 'peak-hours' && (
              <Card title={`Entries by ${data.by === 'hour' ? 'hour' : 'day of the week'}${data.busiest ? ` · busiest ${data.busiest.slot}` : ''}`}>
                <BarChartCard
                  data={data.rows}
                  xKey="slot"
                  xLabel={data.by === 'hour' ? 'Hour' : 'Day'}
                  series={[{ key: 'entries', label: 'Entries' }, { key: 'exits', label: 'Exits' }]}
                  summary={`Entries and exits by ${data.by === 'hour' ? 'hour of the day' : 'day of the week'}. ${data.totalEntries} entries in total.`}
                />
              </Card>
            )}

            {name === 'occupancy-trend' && data.rows.length > 1 && (
              <Card title={`Most vehicles inside, by day${data.busiest ? ` · busiest ${data.busiest.date} (${data.busiest.peakInside})` : ''}`}>
                <BarChartCard
                  data={data.rows}
                  xKey="date"
                  xLabel="Date"
                  series={[{ key: 'peakInside', label: 'Most vehicles inside' }]}
                  summary={`The most vehicles inside at one time on each day. Capacity is ${data.capacity}.`}
                />
              </Card>
            )}

            {name === 'durations' && (
              <Card title={`How long vehicles stay · average ${duration(data.averageMinutes)} · ${data.totalVehicles} vehicles`}>
                <BarChartCard
                  data={data.rows}
                  xKey="band"
                  xLabel="Stay"
                  series={[{ key: 'vehicles', label: 'Vehicles' }]}
                  summary={`Number of vehicles by length of stay. ${data.totalVehicles} vehicles in total.`}
                />
              </Card>
            )}

            {name === 'payments' && data.total && (
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['Money taken', money(data.total.amount), `${data.total.payments} payments, passes included`],
                  ['Refunded', money(data.total.refunded), `${data.total.refundRate}% of the money`],
                  ['Top online failure', data.failureReasons[0]?.reason || 'None', data.failureReasons[0] ? `${data.failureReasons[0].count} time(s)` : null],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
                  </div>
                ))}
              </div>
            )}

            {name === 'frequent-vehicles' && data.summary && (
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['Vehicles that came back', data.summary.repeatVehicles, `of ${data.summary.vehicles} vehicles seen`],
                  ['Share of all visits', `${data.summary.repeatShare}%`, `${data.summary.repeatVisits} of ${data.summary.visits} visits`],
                  ['Fees from these vehicles', money(data.summary.repeatFees), 'A regular without a pass may want one'],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
                  </div>
                ))}
              </div>
            )}

            {name === 'locations' && data.rows.length > 1 && (
              <Card title={`Net revenue by location${data.best ? ` · best ${data.best}` : ''}`}>
                <BarChartCard
                  data={data.rows}
                  xKey="location"
                  xLabel="Location"
                  series={[{ key: 'net', label: 'Net revenue' }]}
                  formatValue={(value) => money(value)}
                  summary={`Net revenue per location: ${money(data.total.net)} in total.`}
                />
              </Card>
            )}

            {name === 'exceptions' && data.counts && Object.keys(data.counts).length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                {Object.entries(data.counts).map(([type, count]) => (
                  <span key={type} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                    {data.types[type]}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            )}

            {name === 'passes' && data.summary && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Active passes', data.summary.active, `${data.summary.endingWithin7Days} end within a week`],
                  ['Ended, not renewed', data.summary.expired, `${data.summary.suspended} suspended`],
                  ['Sold in this period', `${data.sales.newPasses} new · ${data.sales.renewals} renewals`, `${money(data.sales.amount)}${data.sales.freePasses ? ` · ${data.sales.freePasses} free` : ''}`],
                  ['Pass visits', data.passVisits, 'free exits in this period'],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
                  </div>
                ))}
              </div>
            )}

            <Card>
              {data.rows.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing found for these filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        {data.columns.map((column) => (
                          <th key={column.key} className={`whitespace-nowrap pb-2 pr-4 font-medium ${isNumeric(column.key) ? 'text-right' : ''}`}>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, i) => (
                        // Rows have no id of their own; their order is stable for one answer.
                        <tr key={i} className="border-t border-slate-200">
                          {data.columns.map((column) => (
                            <td key={column.key} className={`whitespace-nowrap py-2 pr-4 ${isNumeric(column.key) ? 'text-right' : ''}`}>
                              {display(column.key, row[column.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {spec.paged && data.total > 0 && data.pageSize && (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                  <span>{data.total} rows · page {data.page} of {pages}</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>
                      Previous
                    </Button>
                    <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </>
        )
      )}
    </div>
  )
}
