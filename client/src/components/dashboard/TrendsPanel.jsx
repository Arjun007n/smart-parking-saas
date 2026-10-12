import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, daysAgoInput, money, todayInput } from '../../utils/format'
import { Alert, Card, PageLoader, Select } from '../ui'
import { BarChartCard } from '../charts'

const PERIODS = [
  [7, 'Last 7 days'],
  [14, 'Last 14 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
]

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

// Trends over a chosen period: revenue, entries and exits, how full it gets,
// busy hours, how people pay and how passes are used. Built from the reports,
// so the figures match them.
export default function TrendsPanel({ locationId }) {
  const [days, setDays] = useState(14)
  const params = {
    from: daysAgoInput(days - 1),
    to: todayInput(),
    ...(locationId ? { locationId } : {}),
  }
  const reportQuery = (name, extra = {}) => ({
    queryKey: ['trends', name, days, locationId, extra],
    queryFn: () => reportApi.get(name, { ...params, ...extra }),
  })
  const revenue = useQuery(reportQuery('revenue', { groupBy: 'day' }))
  const traffic = useQuery(reportQuery('occupancy-trend'))
  const hours = useQuery(reportQuery('peak-hours', { by: 'hour' }))
  const payments = useQuery(reportQuery('payments'))
  const passes = useQuery(reportQuery('passes'))

  const queries = [revenue, traffic, hours, payments, passes]
  const failed = queries.find((q) => q.error)
  const loading = queries.some((q) => q.isLoading)

  return (
    <section className="space-y-6" aria-label="Trends">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Trends</h2>
        <Select label="Period" name="trend-period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {PERIODS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </div>

      {failed && <Alert>{errorMessage(failed.error)}</Alert>}
      {loading ? (
        <PageLoader />
      ) : (
        !failed && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Net revenue"
                value={money(revenue.data.total.net)}
                hint={`${revenue.data.total.payments} payments`}
              />
              <Stat
                label="Busiest day"
                value={traffic.data.busiest ? traffic.data.busiest.date.slice(5) : '—'}
                hint={traffic.data.busiest ? `${traffic.data.busiest.peakInside} vehicles inside at once (${traffic.data.busiest.peakUtilization}% full)` : 'No traffic yet'}
              />
              <Stat
                label="Busiest hour"
                value={hours.data.busiest ? hours.data.busiest.slot : '—'}
                hint={hours.data.busiest ? `${hours.data.busiest.averageEntries} entries per day on average` : null}
              />
              <Stat
                label="Pass visits"
                value={passes.data.passVisits}
                hint={`${passes.data.summary.active} active passes · ${passes.data.summary.endingWithin7Days} end within a week`}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Revenue per day">
                <BarChartCard
                  data={revenue.data.rows}
                  xKey="period"
                  xLabel="Date"
                  series={[{ key: 'net', label: 'Net revenue' }]}
                  formatValue={(value) => money(value)}
                  summary={`Net revenue per day over ${days} days: ${money(revenue.data.total.net)} in total.`}
                />
              </Card>
              <Card title="Entries and exits per day">
                <BarChartCard
                  data={traffic.data.rows}
                  xKey="date"
                  xLabel="Date"
                  series={[{ key: 'entries', label: 'Entries' }, { key: 'exits', label: 'Exits' }]}
                  summary={`Entries and exits per day over ${days} days.`}
                />
              </Card>
              <Card title={`Most vehicles inside, per day · capacity ${traffic.data.capacity}`}>
                <BarChartCard
                  data={traffic.data.rows}
                  xKey="date"
                  xLabel="Date"
                  series={[{ key: 'peakInside', label: 'Most vehicles inside' }]}
                  summary={`The most vehicles inside at one time on each day. Capacity is ${traffic.data.capacity}.`}
                />
              </Card>
              <Card title="Entries by hour of the day">
                <BarChartCard
                  data={hours.data.rows}
                  xKey="slot"
                  xLabel="Hour"
                  series={[{ key: 'entries', label: 'Entries' }]}
                  summary={`Entries by hour of the day over ${days} days: ${hours.data.totalEntries} in total.`}
                />
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="How people pay">
                {payments.data.rows.length === 0 ? (
                  <p className="text-sm text-slate-500">No payments in this period.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="pb-2 font-medium">Method</th>
                        <th className="pb-2 text-right font-medium">Payments</th>
                        <th className="pb-2 text-right font-medium">Money</th>
                        <th className="pb-2 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.data.rows.map((row) => (
                        <tr key={row.method} className="border-t border-slate-200">
                          <td className="py-2">{PAYMENT_LABELS[row.method] || row.method}</td>
                          <td className="py-2 text-right">{row.payments}</td>
                          <td className="py-2 text-right font-medium">{money(row.amount)}</td>
                          <td className="py-2 text-right">{row.share}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
              <Card title="Pass usage">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Free pass visits', passes.data.passVisits],
                    ['Sold or renewed', `${passes.data.sales.newPasses + passes.data.sales.renewals}`],
                    ['Pass money', money(passes.data.sales.amount)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-3">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="text-xl font-bold text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          </>
        )
      )}
    </section>
  )
}
