import { useState } from 'react'
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
  collection: { label: 'Collection', range: true, operator: true, method: true, paged: true },
  vehicles: { label: 'Vehicle history', range: true, search: true, status: true, paged: true },
  occupancy: { label: 'Occupancy', day: true },
  operators: { label: 'Operators', range: true, operator: true },
}

const MONEY_KEYS = ['collected', 'tax', 'refunded', 'net', 'amount', 'fee', 'cash']
const DATE_KEYS = ['paidAt', 'entryTime', 'exitTime']

// Shows a report value the way a person reads it (the CSV keeps raw values).
function display(key, value) {
  if (value === '' || value === null || value === undefined) return '—'
  if (MONEY_KEYS.includes(key)) return money(value)
  if (DATE_KEYS.includes(key)) return dateTime(value)
  if (key === 'durationMinutes') return duration(value)
  if (key === 'utilization') return `${value}%`
  if (key === 'method') return PAYMENT_LABELS[value] || value
  if (key === 'type') return VEHICLE_LABELS[value] || value
  if (key === 'status') return SESSION_STATUS[value]?.label || (value === 'REFUNDED' ? 'Refunded' : value === 'SUCCESS' ? 'Paid' : value)
  return String(value)
}

const isNumeric = (key) => MONEY_KEYS.includes(key) || ['payments', 'refunds', 'entries', 'exits', 'corrections', 'vehicles', 'capacity', 'utilization'].includes(key)

function buildParams(name, f) {
  const spec = REPORTS[name]
  return {
    ...(spec.range ? { from: f.from, to: f.to } : {}),
    ...(spec.day ? { date: f.from } : {}),
    ...(f.locationId ? { locationId: f.locationId } : {}),
    ...(spec.groupBy ? { groupBy: f.groupBy } : {}),
    ...(spec.operator && f.operatorId ? { operatorId: f.operatorId } : {}),
    ...(spec.method && f.method ? { method: f.method } : {}),
    ...(spec.search && f.q.trim() ? { q: f.q.trim() } : {}),
    ...(spec.status && f.status ? { status: f.status } : {}),
    ...(spec.paged ? { page: f.page } : {}),
  }
}

export default function Reports() {
  const { can } = useAuth()
  const [name, setName] = useState('revenue')
  const [filters, setFilters] = useState({
    from: todayInput(), to: todayInput(), locationId: '', groupBy: 'day', operatorId: '', method: '', q: '', status: '', page: 1,
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
  const download = useMutation({ mutationFn: () => reportApi.download(name, params) })

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
          max={todayInput()}
          value={filters.from}
          onChange={(event) => set({ from: event.target.value, ...(event.target.value > filters.to ? { to: event.target.value } : {}) })}
        />
        {spec.range && (
          <Field
            label="To"
            type="date"
            name="report-to"
            min={filters.from}
            max={todayInput()}
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
        {spec.groupBy && (
          <Select label="Group by" name="report-group" value={filters.groupBy} onChange={(event) => set({ groupBy: event.target.value })}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="location">Location</option>
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
        <Button variant="secondary" loading={download.isPending} disabled={!data || data.rows.length === 0} onClick={() => download.mutate()}>
          Download CSV
        </Button>
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
              {spec.paged && data.total > 0 && (
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
