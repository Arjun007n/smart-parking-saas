import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { companyApi, dashboardApi, locationApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, money, timeOnly } from '../../utils/format'
import { ROLE_LABELS } from '../../utils/roles'
import { Alert, Badge, Card, PageLoader, Select } from '../../components/ui'
import { CardSkeleton, CountUp, FillBar, Reveal } from '../../components/motion'
import { useLiveStatus } from '../../hooks/useLive'
import { BarChartCard } from '../../components/charts'
import TrendsPanel from '../../components/dashboard/TrendsPanel'

const SEVERITY = {
  critical: { tone: 'red', label: 'Urgent' },
  warning: { tone: 'red', label: 'Warning' },
  info: { tone: 'blue', label: 'Note' },
}

// A colourful tile. `gradient` is one of the gradient-* classes of the stylesheet.
function Stat({ label, value, hint, bar, gradient = 'gradient-blue' }) {
  return (
    <div className={`tile-gradient sp-lift !text-left !p-5 ${gradient}`}>
      <p className="text-sm font-semibold opacity-90">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
      {bar}
      {hint && <p className="mt-1 text-xs opacity-90">{hint}</p>}
    </div>
  )
}

function Onboarding({ companyId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['onboarding', companyId],
    queryFn: () => companyApi.onboarding(companyId),
  })

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>
  // Once everything is set up the checklist is no longer needed.
  if (data.readyToGoLive) return null

  return (
    <Card title="Getting started" action={<Badge tone="blue">{data.completed} of {data.total} done</Badge>}>
      <ol className="space-y-2">
        {data.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {step.done ? '✓' : ''}
            </span>
            <span className={step.done ? 'text-slate-500' : 'font-medium text-slate-900'}>
              {step.label}
              <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function Operations({ locations }) {
  const [locationId, setLocationId] = useState('')
  const { data: d, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard', locationId],
    queryFn: () => dashboardApi.get(locationId ? { locationId } : {}),
    // Keeps the figures current without reloading the page.
    refetchInterval: 20_000,
  })

  const live = useLiveStatus() === 'live'
  if (isLoading) return <CardSkeleton count={4} />
  if (error) return <Alert>{errorMessage(error)}</Alert>

  const hourly = d.traffic.hourly.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }))
  const week = d.revenue.last7Days.map((day) => ({ ...day, label: day.date.slice(5) }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {locations.length > 1 ? (
          <Select label="Location" name="dashboard-location" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l._id} value={l._id}>{l.name}</option>
            ))}
          </Select>
        ) : (
          <span />
        )}
        <p className="text-xs text-slate-500">Updated {timeOnly(dataUpdatedAt)} · {live ? 'live' : 'refreshes every 20 seconds'}</p>
      </div>

      {d.alerts.length > 0 && (
        <Card title="Alerts">
          <ul className="space-y-2">
            {d.alerts.map((alert) => (
              <li key={`${alert.type}-${alert.message}`} className="flex items-start gap-3 text-sm">
                <Badge tone={SEVERITY[alert.severity].tone}>{SEVERITY[alert.severity].label}</Badge>
                <span className="text-slate-800">{alert.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          gradient="gradient-green"
          label="Occupied now"
          value={<><CountUp value={d.occupancy.totalOccupied} /> / {d.occupancy.totalCapacity}</>}
          bar={<div className="mt-2"><FillBar used={d.occupancy.totalOccupied} total={d.occupancy.totalCapacity} label="Parking occupancy" /></div>}
          hint={`${d.occupancy.utilization}% full · ${d.occupancy.available} free${d.occupancy.reserved ? ` · ${d.occupancy.reserved} reserved slots` : ''}`}
        />
        <Stat gradient="gradient-blue" label="Entries today" value={<CountUp value={d.traffic.entriesToday} />} hint={`${d.traffic.exitsToday} exits · ${d.traffic.currentVehicles} inside now`} />
        <Stat gradient="gradient-purple" label="Revenue today" value={<CountUp value={d.revenue.today} format={money} />} hint="After refunds" />
        <Stat gradient="gradient-dark" label="Revenue this month" value={<CountUp value={d.revenue.month} format={money} />} hint={`Last 7 days: ${money(d.revenue.week)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal><Card title="Traffic today, by hour">
          <BarChartCard
            data={hourly}
            xKey="label"
            xLabel="Hour"
            series={[{ key: 'entries', label: 'Entries' }, { key: 'exits', label: 'Exits' }]}
            summary={`Entries and exits per hour today: ${d.traffic.entriesToday} entries and ${d.traffic.exitsToday} exits in total.`}
          />
        </Card></Reveal>
        <Reveal delay={100}><Card title="Revenue, last 7 days">
          <BarChartCard
            data={week}
            xKey="label"
            xLabel="Date"
            series={[{ key: 'amount', label: 'Revenue' }]}
            formatValue={(value) => money(value)}
            summary={`Revenue per day for the last 7 days: ${money(d.revenue.week)} in total.`}
          />
        </Card></Reveal>
      </div>

      <TrendsPanel locationId={locationId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Payments today">
          {d.revenue.byMethod.length === 0 ? (
            <p className="text-sm text-slate-500">No payments yet today.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Method</th>
                  <th className="pb-2 text-right font-medium">Payments</th>
                  <th className="pb-2 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody>
                {d.revenue.byMethod.map((row) => (
                  <tr key={row.method} className="sp-row-in border-t border-slate-200">
                    <td className="py-2">{PAYMENT_LABELS[row.method] || row.method}</td>
                    <td className="py-2 text-right">{row.count}</td>
                    <td className="py-2 text-right font-medium">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Exceptions today">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Exits without payment', d.exceptions.overrides],
              ['Cancelled entries', d.exceptions.cancelled],
              ['Lost tickets', d.exceptions.lostTickets],
              ['Failed online payments', d.exceptions.failedPayments],
              ['Waiting long for payment', d.exceptions.paymentPendingTooLong],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-xl font-bold text-slate-900"><CountUp value={value} /></dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title="Operator activity today">
        {d.operators.length === 0 ? (
          <p className="text-sm text-slate-500">No activity yet today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Operator</th>
                  <th className="pb-2 pr-4 text-right font-medium">Entries</th>
                  <th className="pb-2 pr-4 text-right font-medium">Exits</th>
                  <th className="pb-2 pr-4 text-right font-medium">Payments</th>
                  <th className="pb-2 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody>
                {d.operators.map((o) => (
                  <tr key={o.operatorId} className="sp-row-in border-t border-slate-200">
                    <td className="py-2 pr-4">
                      {o.name}
                      <span className="block text-xs text-slate-500">{ROLE_LABELS[o.role] || ''}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">{o.entries}</td>
                    <td className="py-2 pr-4 text-right">{o.exits}</td>
                    <td className="py-2 pr-4 text-right">{o.payments}</td>
                    <td className="py-2 text-right font-medium">{money(o.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {d.locations.length > 1 && (
        <Card title="Locations compared">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Location</th>
                  <th className="pb-2 pr-4 text-right font-medium">Occupied</th>
                  <th className="pb-2 pr-4 text-right font-medium">Full</th>
                  <th className="pb-2 pr-4 text-right font-medium">Entries today</th>
                  <th className="pb-2 text-right font-medium">Collected today</th>
                </tr>
              </thead>
              <tbody>
                {d.locations.map((l) => (
                  <tr key={l._id} className="sp-row-in border-t border-slate-200">
                    <td className="py-2 pr-4">
                      <Link to={`/dashboard/locations/${l._id}`} className="text-blue-700 hover:underline">{l.name}</Link>
                    </td>
                    <td className="py-2 pr-4 text-right">{l.occupied} / {l.capacity}</td>
                    <td className="py-2 pr-4 text-right">{l.utilization}%</td>
                    <td className="py-2 pr-4 text-right">{l.entriesToday}</td>
                    <td className="py-2 text-right font-medium">{money(l.collectedToday)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export default function Overview() {
  const { user, company, can } = useAuth()
  const locations = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })
  const active = (locations.data || []).filter((l) => l.isActive)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user.name}</h1>
        {company && (
          <p className="mt-1 text-sm text-slate-600">
            {company.name} · Plan: {company.plan.name} · <Badge>{company.subscriptionStatus}</Badge>
          </p>
        )}
      </div>

      {locations.error && <Alert>{errorMessage(locations.error)}</Alert>}

      {!locations.isLoading && active.length === 0 && can('LOCATION_MANAGE') && company && (
        <Alert type="info">
          You have no parking locations yet.{' '}
          <Link to="/dashboard/locations" className="font-semibold underline">
            Create your first parking
          </Link>
        </Alert>
      )}

      {company && can('COMPANY_MANAGE') && <Onboarding companyId={company._id} />}
      {can('REPORT_VIEW') && active.length > 0 && <Operations locations={active} />}
    </div>
  )
}
