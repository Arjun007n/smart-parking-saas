import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { companyApi, dashboardApi, locationApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, dateOnly, money, timeOnly, todayInput } from '../../utils/format'
import { ROLE_LABELS } from '../../utils/roles'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import { CardSkeleton, CountUp, Reveal } from '../../components/motion'
import AdminIcon from '../../components/AdminIcon'
import { useLiveStatus } from '../../hooks/useLive'
import { BarChartCard } from '../../components/charts'
import TrendsPanel from '../../components/dashboard/TrendsPanel'
import ExitParkedModal from '../../components/dashboard/ExitParkedModal'

const SEVERITY = {
  critical: { tone: 'red', label: 'Urgent' },
  warning: { tone: 'red', label: 'Warning' },
  info: { tone: 'blue', label: 'Note' },
}

// A small card at the top of the dashboard: an icon, the figure, what it is, and an optional tag.
function KpiCard({ icon, value, label, hint, tag, to }) {
  const body = (
    <>
      <span className="kpi-icon"><AdminIcon name={icon} className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="kpi-value block">{value}</span>
        <span className="kpi-label block">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
      {tag && <span className="kpi-tag">{tag}</span>}
    </>
  )
  return to ? <Link to={to} className="kpi-card hover:border-blue-400">{body}</Link> : <div className="kpi-card">{body}</div>
}

// One tinted figure of the month. `tone` is one of the pastel-* classes of the stylesheet.
function PastelTile({ tone, value, label }) {
  return (
    <div className={`pastel-tile ${tone}`}>
      <dd className="pastel-value">{value}</dd>
      <dt className="pastel-label">{label}</dt>
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

// A plan (or trial) that is about to end, or has ended.
function RenewBanner({ subscription }) {
  const { can } = useAuth()
  if (!subscription || subscription.daysLeft === null || subscription.daysLeft > 15) return null
  const ended = subscription.expired
  return (
    <Alert type={ended ? 'error' : 'info'}>
      <span className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {ended
            ? `Your plan ended on ${dateOnly(subscription.validUpto)}. Renew to keep every screen working.`
            : `Your plan ends on ${dateOnly(subscription.validUpto)} (${subscription.daysLeft} day${subscription.daysLeft === 1 ? '' : 's'} left).`}
        </span>
        {can('COMPANY_MANAGE') && (
          <Link to="/dashboard/subscriptions" className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 ring-1 ring-blue-300 hover:bg-blue-50">
            Renew now
          </Link>
        )}
      </span>
    </Alert>
  )
}

// Vehicles and money by vehicle type, for the chosen period. Same numbers as Reports > Day summary.
// The Card column appears only when someone paid by card in the period; the Action link opens that
// type's vehicles in Reports.
function TypeTable({ summary, title, period, locationId }) {
  if (!summary || summary.rows.length === 0) return null
  const withCard = summary.total.card > 0
  const cols = [
    ['Cash Payment', 'cash'], ['Online Payment', 'online'], ['UPI QR Payment', 'upi'],
    ...(withCard ? [['Card Payment', 'card']] : []),
    ['FASTag Payment', 'fastag'], ['Total Revenue', 'total'],
  ]
  const reportLink = (type) => {
    const params = new URLSearchParams({ report: 'vehicles', from: period.from, to: period.to, vehicleType: type })
    if (locationId) params.set('locationId', locationId)
    return `/dashboard/reports?${params}`
  }
  return (
    <Card title={title}>
      <div className="overflow-x-auto">
        <table className="table-navy w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Vehicle Type</th>
              <th className="text-center">Entry</th>
              <th className="text-center">Exit</th>
              <th className="text-center">Currently Parked</th>
              {cols.map(([label]) => <th key={label} className="text-right">{label}</th>)}
              <th className="text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r, i) => (
              <tr key={r.type} className="sp-row-in">
                <td>{i + 1}</td>
                <td>{VEHICLE_LABELS[r.type] || r.type}</td>
                <td className="text-center font-bold text-green-600">{r.entries}</td>
                <td className="text-center font-bold text-red-600">{r.exits}</td>
                <td className="text-center font-bold text-cyan-700">{r.parked}</td>
                {cols.map(([label, key]) => <td key={label} className="text-right">{money(r[key])}</td>)}
                <td className="text-center">
                  {r.entries + r.exits + r.parked > 0 ? (
                    <Link to={reportLink(r.type)} className="font-semibold text-blue-700 hover:underline">View</Link>
                  ) : '-'}
                </td>
              </tr>
            ))}
            <tr className="row-total">
              <td colSpan={2} className="text-center">Total</td>
              <td className="text-center text-green-600">{summary.total.entries}</td>
              <td className="text-center text-red-600">{summary.total.exits}</td>
              <td className="text-center text-cyan-700">{summary.total.parked}</td>
              {cols.map(([label, key]) => <td key={label} className="text-right">{money(summary.total[key])}</td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-blue-800">
        Note: only vehicle types with a rate are shown here. Set them up in Parking Locations &gt; Tariffs.
      </p>
    </Card>
  )
}

const PLAN_STATUS = {
  RUNNING: { tone: 'green', label: () => 'Running' },
  EXPIRING: { tone: 'amber', label: (p) => `Expiring Soon (${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'})` },
  EXPIRED: { tone: 'red', label: () => 'Expired' },
  NO_PLAN: { tone: 'slate', label: () => 'No plan' },
}

// Every location with the plan it runs on and when that ends. One plan is bought for the whole company,
// so the rows share a date; Renew goes to the Billing page for the people who can buy.
function LocationPlans({ plans, canRenew }) {
  if (!plans || plans.length === 0) return null
  return (
    <Card title="Individual Location Summary">
      <div className="overflow-x-auto">
        <table className="table-navy w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Location Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Expiry Date</th>
              <th>Running / Upcoming Subscription</th>
              <th className="text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => {
              const st = PLAN_STATUS[p.status]
              return (
                <tr key={p._id} className="sp-row-in">
                  <td>{i + 1}</td>
                  <td><Link to={`/dashboard/locations/${p._id}`} className="text-blue-700 hover:underline">{p.name}</Link></td>
                  <td>{p.parkingType}</td>
                  <td><Badge tone={st.tone}>{st.label(p)}</Badge></td>
                  <td>{p.expiresOn ? dateOnly(p.expiresOn) : '—'}</td>
                  <td>
                    {p.package ? (
                      <span className="text-xs leading-5">
                        <span className="font-semibold text-green-700">Running</span>
                        <span className="block">Package: {p.package}</span>
                        <span className="block">Validity: {p.validFrom ? dateOnly(p.validFrom) : '—'} - {p.validTo ? dateOnly(p.validTo) : '—'}</span>
                      </span>
                    ) : 'No Subscription'}
                  </td>
                  <td className="text-center">
                    {canRenew ? (
                      <Link to="/dashboard/subscriptions" className="rounded bg-[#28a745] px-3 py-1 text-xs font-semibold text-white hover:bg-[#218838]">Renew</Link>
                    ) : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Operations({ locations }) {
  const { can } = useAuth()
  const [locationId, setLocationId] = useState('')
  // The period of the day figures. It starts on today, like the date range of the old dashboard.
  const [range, setRange] = useState(() => ({ from: todayInput(), to: todayInput() }))
  const [exitOpen, setExitOpen] = useState(false)
  const valid = Boolean(range.from) && Boolean(range.to) && range.from <= range.to
  const { data: d, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard', locationId, range.from, range.to],
    queryFn: () => dashboardApi.get({ ...(locationId ? { locationId } : {}), from: range.from, to: range.to }),
    placeholderData: keepPreviousData,
    enabled: valid,
    // Keeps the figures current without reloading the page.
    refetchInterval: 20_000,
  })

  const live = useLiveStatus() === 'live'
  const today = todayInput()
  const filters = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {locations.length > 1 && (
          <Select label="Location" name="dashboard-location" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l._id} value={l._id}>{l.name}</option>
            ))}
          </Select>
        )}
        <Field
          label="From"
          type="date"
          name="dashboard-from"
          max={today}
          value={range.from}
          onChange={(event) => setRange((r) => ({ from: event.target.value, to: event.target.value > r.to ? event.target.value : r.to }))}
        />
        <Field
          label="To"
          type="date"
          name="dashboard-to"
          min={range.from}
          max={today}
          value={range.to}
          onChange={(event) => setRange((r) => ({ ...r, to: event.target.value }))}
        />
        {(range.from !== today || range.to !== today) && (
          <Button variant="secondary" onClick={() => setRange({ from: todayInput(), to: todayInput() })}>Today</Button>
        )}
      </div>
      {d && <p className="text-xs text-slate-500">Updated {timeOnly(dataUpdatedAt)} · {live ? 'live' : 'refreshes every 20 seconds'}</p>}
    </div>
  )

  if (!valid) {
    return (
      <div className="space-y-6">
        {filters}
        <Alert type="info">Choose a start date that is not after the end date.</Alert>
      </div>
    )
  }
  if (isLoading) return <CardSkeleton count={4} />
  if (error) return <div className="space-y-6">{filters}<Alert>{errorMessage(error)}</Alert></div>

  const isToday = d.period.isToday
  const when = isToday ? 'today' : 'in this period'
  const periodText = d.period.from === d.period.to ? dateOnly(d.period.from) : `${dateOnly(d.period.from)} to ${dateOnly(d.period.to)}`
  const hourLabel = (hour) => `${String(hour).padStart(2, '0')}-${String((hour + 1) % 24).padStart(2, '0')}`
  const hourly = d.traffic.hourly.map((h) => ({ ...h, label: hourLabel(h.hour) }))
  const byHour = d.revenue.byHour.map((h) => ({ ...h, label: hourLabel(h.hour) }))
  const week = d.revenue.last7Days.map((day) => ({ ...day, label: day.date.slice(5) }))
  const nearExpiry = d.locationPlans.filter((p) => p.status === 'EXPIRING' || p.status === 'EXPIRED').length
  const canRenew = can('COMPANY_MANAGE')
  const canExit = can('SESSION_OVERRIDE') || can('LOCATION_MANAGE')
  const total = d.month.total

  return (
    <div className="space-y-6">
      {filters}

      <RenewBanner subscription={d.subscription} />

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          icon="car" value={<><CountUp value={d.occupancy.totalOccupied} /> / {d.occupancy.totalCapacity}</>} label="Total Parked (Current)"
          hint={`${d.occupancy.utilization}% full · ${d.occupancy.available} free`}
        />
        <KpiCard
          icon="chart"
          value={<CountUp value={isToday ? d.revenue.today : d.revenue.inPeriod} format={money} />}
          label={isToday ? "Today's Total Revenue" : 'Total Revenue'}
          hint={isToday ? 'Today' : periodText}
        />
        <KpiCard
          icon="calendar"
          value={nearExpiry}
          label="Locations Near Expiry"
          tag={nearExpiry > 0 ? 'Expiring Soon' : undefined}
          hint={d.subscription?.validUpto ? `Plan valid upto ${dateOnly(d.subscription.validUpto)}` : undefined}
          to={canRenew ? '/dashboard/subscriptions' : undefined}
        />
        <KpiCard icon="card" value={d.passes.total} label="Total Passes" hint={`${d.passes.active} active · ${d.passes.endingSoon} end within a week`} to="/dashboard/passes" />
        <KpiCard icon="wallet" value={money(d.passes.activeRevenue)} label="Current Active Passes Revenue" hint="Paid for passes valid now" to="/dashboard/passes" />
        {d.reprints ? (
          <KpiCard
            to={`/dashboard/reports?${new URLSearchParams({ report: 'reprints', from: d.period.from, to: d.period.to, ...(locationId ? { locationId } : {}) })}`}
            icon="clipboard"
            value={d.reprints.total}
            label="Reprint Tickets Count"
            hint={
              d.reprints.operators.length > 0
                ? `${isToday ? 'Today' : periodText} · most: ${d.reprints.operators[0].name} (${d.reprints.operators[0].count})`
                : isToday ? 'Today' : periodText
            }
          />
        ) : (
          <KpiCard icon="clipboard" value={d.reprintsToday} label="Reprint Tickets Count" hint={isToday ? 'Today' : periodText} />
        )}
        {d.reEntries && (
          <KpiCard
            to={`/dashboard/reports?${new URLSearchParams({ report: 're-entries', from: d.period.from, to: d.period.to, ...(locationId ? { locationId } : {}) })}`}
            icon="clipboard"
            value={d.reEntries.total}
            label="Re-entry Count"
            hint={
              d.reEntries.operators.length > 0
                ? `${isToday ? 'Today' : periodText} · most: ${d.reEntries.operators[0].name} (${d.reEntries.operators[0].count})`
                : isToday ? 'Today' : periodText
            }
          />
        )}
      </div>

      <TypeTable summary={d.byVehicleType} title="Vehicle Type Summary (Active Types)" period={d.period} locationId={locationId} />

      <Reveal>
        <Card title={`Over All (One Month, from ${dateOnly(d.month.from)})`}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <PastelTile tone="pastel-green" value={total.entries} label="Total Entries" />
            <PastelTile tone="pastel-red" value={total.exits} label="Total Exits" />
            <PastelTile tone="pastel-blue" value={total.parked} label="Currently Parked" />
            <PastelTile tone="pastel-orange" value={money(total.cash)} label="Cash Collection" />
            <PastelTile tone="pastel-purple" value={money(total.online)} label="Online Collection" />
            <PastelTile tone="pastel-lavender" value={money(total.upi)} label="UPI QR Collection" />
            {total.card > 0 && <PastelTile tone="pastel-blue" value={money(total.card)} label="Card Collection" />}
            <PastelTile tone="pastel-mint" value={money(total.fastag)} label="FASTag Collection" />
            <PastelTile tone="pastel-peach" value={money(total.total)} label="Total Revenue" />
            {canExit && (
              <div>
                <button
                  type="button"
                  onClick={() => setExitOpen(true)}
                  className="pastel-tile sp-press flex h-full w-full flex-col items-center justify-center bg-[#dc3545] text-white shadow-sm hover:bg-[#bb2d3b]"
                >
                  <span className="pastel-value text-base">Exit Parked Vehicle</span>
                  <span className="pastel-label">Let a vehicle out without payment</span>
                </button>
              </div>
            )}
          </dl>
        </Card>
      </Reveal>
      {exitOpen && <ExitParkedModal locationId={locationId} onClose={() => setExitOpen(false)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal><Card title="Vehicle Momentum (Full Day Traffic Flow)">
          <BarChartCard
            data={hourly}
            xKey="label"
            xLabel="Time Slots (Hours)"
            series={[{ key: 'entries', label: 'Entries' }, { key: 'exits', label: 'Exits' }]}
            summary={`Entries and exits per hour ${isToday ? 'today' : `from ${periodText}`}: ${d.traffic.entriesToday} entries and ${d.traffic.exitsToday} exits in total.`}
          />
        </Card></Reveal>
        <Reveal delay={100}><Card title="Revenue Overview – Full Day">
          <BarChartCard
            data={byHour}
            xKey="label"
            xLabel="Time Slots (Hours)"
            series={[{ key: 'amount', label: 'Revenue (₹)' }]}
            formatValue={(value) => money(value)}
            summary={`Revenue per hour ${isToday ? 'today' : `from ${periodText}`}: ${money(d.revenue.inPeriod)} in total.`}
          />
        </Card></Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal><Card title="Revenue, last 7 days">
          <BarChartCard
            data={week}
            xKey="label"
            xLabel="Date"
            series={[{ key: 'amount', label: 'Revenue' }]}
            formatValue={(value) => money(value)}
            summary={`Revenue per day for the last 7 days: ${money(d.revenue.week)} in total.`}
          />
        </Card></Reveal>
        <Reveal delay={100}><Card title="Vehicles inside through the day">
          {!isToday ? (
            <p className="text-sm text-slate-500">This chart is for today. Choose today to see it.</p>
          ) : d.momentum.length < 2 ? (
            <p className="text-sm text-slate-500">The chart fills in as the day goes on.</p>
          ) : (
            <BarChartCard
              data={d.momentum.map((m) => ({ ...m, label: hourLabel(m.hour) }))}
              xKey="label"
              xLabel="Hour"
              series={[{ key: 'inside', label: 'Vehicles inside' }]}
              summary={`Vehicles inside at the end of each hour today. ${d.traffic.currentVehicles} inside now.`}
            />
          )}
        </Card></Reveal>
      </div>

      <LocationPlans plans={d.locationPlans} canRenew={canRenew} />

      <TrendsPanel locationId={locationId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Payments ${when}`}>
          {d.revenue.byMethod.length === 0 ? (
            <p className="text-sm text-slate-500">No payments {isToday ? 'yet today' : 'in this period'}.</p>
          ) : (
            <table className="table-navy w-full text-left text-sm">
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

        <Card title={`Exceptions ${when}`}>
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

      <Card title={`Operator activity ${when}`}>
        {d.operators.length === 0 ? (
          <p className="text-sm text-slate-500">No activity {isToday ? 'yet today' : 'in this period'}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-navy w-full min-w-[520px] text-left text-sm">
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
        <Card title={`Location occupancy and collection (${isToday ? 'today' : 'this period'})`}>
          <div className="overflow-x-auto">
            <table className="table-navy w-full min-w-[560px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Location</th>
                  <th className="pb-2 pr-4 text-right font-medium">Occupied</th>
                  <th className="pb-2 pr-4 text-right font-medium">Full</th>
                  <th className="pb-2 pr-4 text-right font-medium">Entries</th>
                  <th className="pb-2 text-right font-medium">Collected</th>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="sr-only">Dashboard</h1>
          <p className="text-base font-semibold text-slate-900">{company ? company.name : `Welcome, ${user.name}`}</p>
          {company && (
            <p className="text-xs text-slate-600">
              Company code: <strong className="font-mono tracking-widest text-slate-900">{company.code}</strong>
              {' '}· Plan: {company.plan.name} · <Badge>{company.subscriptionStatus}</Badge>
              {can('USER_MANAGE') && ' · everyone in your company needs the code to log in'}
            </p>
          )}
        </div>
        <p className="text-xs text-slate-500">Welcome, {user.name}</p>
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
