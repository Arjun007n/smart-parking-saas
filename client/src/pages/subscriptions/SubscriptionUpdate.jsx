import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { dmy, lastDayOf, monthsText } from '../../utils/subscriptions'
import { Alert, Button, Card, PageLoader } from '../../components/ui'
import QuoteSummary from '../../components/subscription/QuoteSummary'

const INPUT = 'mt-1 w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm'
const num = (text) => Math.max(0, Math.min(500, Number.parseInt(text, 10) || 0))

// Manage Subscriptions > View & Add More Addons: more users, cameras or lanes, or a new add-on, for the rest of the period.
export default function SubscriptionUpdate() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sub = useQuery({ queryKey: ['subscriptions', 'one', id], queryFn: () => subscriptionApi.get(id) })
  const catalog = useQuery({ queryKey: ['subscriptions', 'catalog'], queryFn: subscriptionApi.catalog })
  const [change, setChange] = useState({ addUsers: 0, pass: false, photo: false, gateway: false, addAnpr: 0, addFastag: 0, dataBackup: null, photoBackup: null })
  const set = (key, value) => setChange((c) => ({ ...c, [key]: value }))

  const s = sub.data?.subscription
  const body = s && {
    kind: 'UPDATE', subscriptionId: id,
    change: {
      ...(change.addUsers > 0 ? { addUsers: change.addUsers } : {}), ...(change.pass ? { pass: true } : {}), ...(change.photo ? { photo: true } : {}),
      ...(change.gateway ? { gateway: true } : {}), ...(change.addAnpr > 0 ? { addAnpr: change.addAnpr } : {}), ...(change.addFastag > 0 ? { addFastag: change.addFastag } : {}),
      ...(change.dataBackup !== null && change.dataBackup > s.addons.dataBackup ? { dataBackup: change.dataBackup } : {}),
      ...(change.photoBackup !== null && change.photoBackup > s.addons.photoBackup ? { photoBackup: change.photoBackup } : {}),
    },
  }
  const chosen = body && Object.keys(body.change).length > 0
  const quote = useQuery({
    queryKey: ['subscriptions', 'quote', body], queryFn: () => subscriptionApi.quote(body), enabled: Boolean(chosen), placeholderData: keepPreviousData, retry: false,
  })
  const pay = useMutation({
    mutationFn: () => subscriptionApi.createOrder(body),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      if (order.payUrl) window.location.assign(order.payUrl)
      else navigate(`/dashboard/subscriptions/orders/${order._id}`)
    },
  })

  if (sub.isLoading || catalog.isLoading) return <PageLoader />
  if (sub.error || catalog.error) return <Alert>{errorMessage(sub.error || catalog.error)}</Alert>
  const c = catalog.data
  const addon = (key) => c.addons.find((a) => a.key === key)
  const ended = s.state !== 'ACTIVE'
  const left = `Your subscription will expire in ${Math.floor(s.daysLeft / 30)} month & ${s.daysLeft % 30} days`

  const flag = (key) => {
    const a = addon(key)
    return (
      <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
        <span className="font-medium text-slate-800">{a.label} <span className="font-normal text-slate-500">({money(a.price)} / month)</span></span>
        {s.addons[key] ? <span className="text-xs font-semibold text-emerald-700">Included</span> : <input type="checkbox" checked={change[key]} disabled={ended} onChange={(e) => set(key, e.target.checked)} />}
      </label>
    )
  }
  const count = (key, field) => {
    const a = addon(key)
    return (
      <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
        <span className="font-medium text-slate-800">{a.label} <span className="font-normal text-slate-500">({money(a.price)} / {a.unit})</span><span className="block text-xs text-slate-500">Now: {s.addons[key]} {a.noun}. Add:</span></span>
        <input type="number" min="0" max="100" className={INPUT} value={change[field]} disabled={ended} onChange={(e) => set(field, num(e.target.value))} />
      </label>
    )
  }
  const keep = (key) => {
    const a = addon(key)
    const now = s.addons[key]
    return (
      <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
        <span className="font-medium text-slate-800">{a.label} <span className="font-normal text-slate-500">({money(a.price)} / month)</span><span className="block text-xs text-slate-500">Now: {now === 0 ? 'none' : monthsText(now)}</span></span>
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5" value={change[key] ?? now} disabled={ended} onChange={(e) => set(key, Number(e.target.value))}>
          {a.options.filter((m) => m >= now).map((m) => <option key={m} value={m}>{m === 0 ? 'None' : monthsText(m)}</option>)}
        </select>
      </label>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Location : {sub.data.location?.name}</h1>
        <Link to={`/dashboard/subscriptions/location/${s.locationId}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</Link>
      </div>
      {!sub.data.ready && <Alert type="info">Buying online is not available yet: {sub.data.notReady.join('; ')}. Please contact support.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title={`Update Subscription : ${s.code}`}>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-slate-500">Parking Plan</dt><dd className="mt-1 font-semibold">{s.planName}</dd></div>
              <div><dt className="text-slate-500">Tenure</dt><dd className="mt-1 font-semibold">{monthsText(s.months)}</dd></div>
              <div><dt className="text-slate-500">Total Users</dt><dd className="mt-1 font-semibold">{s.users}</dd></div>
              <div><dt className="text-slate-500">Expiry Date</dt><dd className="mt-1 font-semibold">{dmy(lastDayOf(s.periodEnd))}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-slate-500">Parking Addons :</p>
            <ol className="mt-1 list-inside list-decimal text-sm">{s.items.map((item) => <li key={item}>{item}</li>)}</ol>
            <p className="mt-3 text-sm font-medium text-amber-700">{ended ? (s.state === 'UPCOMING' ? 'This subscription has not started yet. You can add to it once it starts.' : 'This subscription has ended. Renew it first.') : left}</p>
          </Card>
          {!ended && (
            <Card title="Add more">
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
                  <span className="font-medium text-slate-800">Users <span className="font-normal text-slate-500">({money(c.userPrice)} / user / month)</span><span className="block text-xs text-slate-500">Now: {s.users}. Add:</span></span>
                  <input type="number" min="0" max="500" className={INPUT} value={change.addUsers} onChange={(e) => set('addUsers', num(e.target.value))} />
                </label>
                {flag('pass')}{flag('photo')}{count('anpr', 'addAnpr')}{count('fastag', 'addFastag')}{flag('gateway')}{keep('dataBackup')}{keep('photoBackup')}
              </div>
              <p className="mt-3 text-xs text-slate-500">You pay only for the days left in this period. Nothing can be taken away in the middle of a period.</p>
            </Card>
          )}
        </div>
        <aside className="h-fit space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <QuoteSummary quote={chosen ? quote.data : null} error={chosen ? quote.error : null} loading={chosen && quote.isFetching} />
          <Alert>{pay.error && errorMessage(pay.error)}</Alert>
          <Button type="button" className="w-full" loading={pay.isPending} disabled={!sub.data.ready || !chosen || !quote.data || Boolean(quote.error)} onClick={() => pay.mutate()}>Proceed To Pay</Button>
        </aside>
      </div>
    </div>
  )
}
