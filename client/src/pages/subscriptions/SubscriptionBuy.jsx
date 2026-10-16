import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { tenureLabel } from '../../utils/subscriptions'
import { Alert, Button, Card, PageLoader } from '../../components/ui'
import QuoteSummary from '../../components/subscription/QuoteSummary'

const START = { pass: true, photo: true, anpr: 0, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 }
const INPUT = 'mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm'

// One add-on card: a tick (and a number for cameras and lanes, a length for backups), its price and what it does.
function AddonCard({ addon, value, onChange }) {
  const on = addon.kind === 'FLAG' ? Boolean(value) : addon.kind === 'COUNT' ? value > 0 : value > (addon.freeMonths || 0)
  return (
    <div className={`rounded-lg border p-4 ${on ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-start gap-2 text-sm font-semibold text-slate-900">
          {addon.kind !== 'RETENTION' && (
            <input
              type="checkbox" className="mt-1" checked={on}
              onChange={(e) => onChange(addon.kind === 'FLAG' ? e.target.checked : e.target.checked ? 1 : 0)}
            />
          )}
          {addon.label}
        </label>
        <span className="whitespace-nowrap text-sm font-semibold text-slate-800">{addon.price > 0 ? money(addon.price) : 'Free'}<span className="block text-right text-xs font-normal text-slate-500">/ {addon.unit}</span></span>
      </div>
      {addon.kind === 'COUNT' && on && (
        <label className="mt-2 block text-xs font-medium text-slate-600">No. of {addon.noun}
          <input type="number" min="1" max="100" className={`${INPUT} ml-2 w-20`} value={value} onChange={(e) => onChange(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </label>
      )}
      {addon.kind === 'RETENTION' && (
        <label className="mt-2 block text-xs font-medium text-slate-600">Duration
          <select className={`${INPUT} ml-2`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
            {addon.options.map((m) => <option key={m} value={m}>{m === 0 ? 'None' : `${m} Month${m === 1 ? '' : 's'}`}</option>)}
          </select>
        </label>
      )}
      <p className="mt-2 text-xs text-slate-600">{addon.description}</p>
    </div>
  )
}

// Manage Subscriptions > Add new subscription: choose users, length and add-ons, see the price, pay.
export default function SubscriptionBuy() {
  const { locationId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useQuery({ queryKey: ['subscriptions', 'catalog'], queryFn: subscriptionApi.catalog })
  const location = useQuery({ queryKey: ['subscriptions', 'location', locationId], queryFn: () => subscriptionApi.location(locationId) })
  const [months, setMonths] = useState(1)
  const [users, setUsers] = useState(5)
  const [addons, setAddons] = useState(START)
  const body = { kind: 'PURCHASE', locationId, users, months, addons }
  const quote = useQuery({ queryKey: ['subscriptions', 'quote', body], queryFn: () => subscriptionApi.quote(body), placeholderData: keepPreviousData, retry: false })
  const pay = useMutation({
    mutationFn: () => subscriptionApi.createOrder(body),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      // A real gateway sends the customer to its payment page; the practice gateway shows its buttons on the order page.
      if (order.payUrl) window.location.assign(order.payUrl)
      else navigate(`/dashboard/subscriptions/orders/${order._id}`)
    },
  })

  if (catalog.isLoading || location.isLoading) return <PageLoader />
  if (catalog.error || location.error) return <Alert>{errorMessage(catalog.error || location.error)}</Alert>
  const c = catalog.data
  const set = (key) => (value) => setAddons((a) => ({ ...a, [key]: value }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Subscriptions : Purchase</h1>
        <Link to={`/dashboard/subscriptions/location/${locationId}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</Link>
      </div>
      <p className="text-sm font-semibold text-slate-700">{location.data.location.name}</p>
      {!c.ready && <Alert type="info">Buying online is not available yet: {c.notReady.join('; ')}. Please contact support.</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="Build Your Parking Subscription">
            <p className="mb-4 text-sm text-slate-600">Personalize your plan by selecting duration, users, and additional features.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-blue-400 bg-blue-50/40 p-3 sm:col-span-3">
                <p className="font-semibold text-slate-900">{c.planName}</p>
                <p className="text-sm text-slate-600">{money(c.userPrice)} / user / month</p>
              </div>
              <label className="text-sm font-medium text-slate-700">Package Tenure
                <select className={`${INPUT} block w-full`} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                  {c.tenures.map((t) => <option key={t.months} value={t.months}>{tenureLabel(t)}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">Total Users
                <input type="number" min={c.minUsers} max={c.maxUsers} className={`${INPUT} block w-full`} value={users}
                  onChange={(e) => setUsers(Math.max(c.minUsers, Math.min(c.maxUsers, Number(e.target.value) || c.minUsers)))} />
              </label>
            </div>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.addons.map((a) => <AddonCard key={a.key} addon={a} value={addons[a.key]} onChange={set(a.key)} />)}
          </div>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
          <h2 className="font-semibold text-slate-900">{c.planName} ({months} month{months === 1 ? '' : 's'} plan)</h2>
          <QuoteSummary quote={quote.data} error={quote.error} loading={quote.isFetching} />
          <Alert>{pay.error && errorMessage(pay.error)}</Alert>
          <Button type="button" className="w-full" loading={pay.isPending} disabled={!c.ready || !quote.data || Boolean(quote.error)} onClick={() => pay.mutate()}>Proceed To Pay</Button>
          <p className="text-center text-xs text-slate-500">Your payment is encrypted and secure.</p>
        </aside>
      </div>
    </div>
  )
}
