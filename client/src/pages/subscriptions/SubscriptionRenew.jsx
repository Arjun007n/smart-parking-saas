import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { dmy, lastDayOf, tenureLabel } from '../../utils/subscriptions'
import { Alert, Button, Card, PageLoader } from '../../components/ui'
import QuoteSummary from '../../components/subscription/QuoteSummary'

// Manage Subscriptions > Renew Now: the same users and add-ons for more months.
export default function SubscriptionRenew() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sub = useQuery({ queryKey: ['subscriptions', 'one', id], queryFn: () => subscriptionApi.get(id) })
  const catalog = useQuery({ queryKey: ['subscriptions', 'catalog'], queryFn: subscriptionApi.catalog })
  const [months, setMonths] = useState(1)
  const body = { kind: 'RENEWAL', subscriptionId: id, months }
  const quote = useQuery({ queryKey: ['subscriptions', 'quote', body], queryFn: () => subscriptionApi.quote(body), placeholderData: keepPreviousData, retry: false })
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
  const s = sub.data.subscription
  const c = catalog.data
  const leftText = s.daysLeft > 0 ? `Your subscription will expire in ${Math.floor(s.daysLeft / 30)} months & ${s.daysLeft % 30} days.` : 'Your subscription has ended. A renewal starts today.'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Location : {sub.data.location?.name}</h1>
        <Link to={`/dashboard/subscriptions/location/${s.locationId}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</Link>
      </div>
      {!sub.data.ready && <Alert type="info">Buying online is not available yet: {sub.data.notReady.join('; ')}. Please contact support.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card title={`Existing Subscription : ${s.code}`}>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Parking Plan</dt><dd className="mt-1 font-semibold">{s.planName}</dd></div>
            <div><dt className="text-slate-500">Total Users</dt><dd className="mt-1 font-semibold">{s.users}</dd></div>
            <div><dt className="text-slate-500">Valid until</dt><dd className="mt-1 font-semibold">{dmy(lastDayOf(s.periodEnd))}</dd></div>
          </dl>
          <p className="mt-4 text-sm text-slate-500">Parking Addons :</p>
          <ol className="mt-1 list-inside list-decimal text-sm">{s.items.map((item) => <li key={item}>{item}</li>)}</ol>
          <p className="mt-4 text-sm font-medium text-amber-700">{leftText}</p>
          <label className="mt-4 block max-w-xs text-sm font-medium text-slate-700">Tenure
            <select className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {c.tenures.map((t) => <option key={t.months} value={t.months}>{tenureLabel(t)}</option>)}
            </select>
          </label>
        </Card>
        <aside className="h-fit space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <QuoteSummary quote={quote.data} error={quote.error} loading={quote.isFetching} />
          <Alert>{pay.error && errorMessage(pay.error)}</Alert>
          <Button type="button" className="w-full" loading={pay.isPending} disabled={!sub.data.ready || !quote.data || Boolean(quote.error)} onClick={() => pay.mutate()}>Proceed To Pay</Button>
          <p className="text-center text-xs text-slate-500">Your payment is encrypted and secure.</p>
        </aside>
      </div>
    </div>
  )
}
