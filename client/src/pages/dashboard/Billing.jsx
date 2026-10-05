import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { billingApi, companyApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { PRICING } from '../../data/site'
import { planLabel, planPrice } from '../../utils/planPrice'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { Alert, Badge, Button, Card, PageLoader } from '../../components/ui'

const STATUS_TONE = { TRIAL: 'blue', ACTIVE: 'green', PAST_DUE: 'red', SUSPENDED: 'red', CANCELLED: 'red' }
const ORDER_TONE = { PAID: 'green', PENDING: 'blue', FAILED: 'red', CANCELLED: 'slate' }
const ORDER_TEXT = { PAID: 'Paid', PENDING: 'Waiting for payment', FAILED: 'Not paid', CANCELLED: 'Replaced' }
const day = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const daysLeft = (value) => (value ? Math.ceil((new Date(value) - Date.now()) / 86400000) : null)

const toInt = (text, fallback, min, max) => {
  const n = Number.parseInt(text, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// After the customer comes back from the payment page, ask the server until it knows the result.
function ReturnBanner({ orderId, onDone }) {
  const query = useQuery({
    queryKey: ['billing', 'order', orderId],
    queryFn: () => billingApi.order(orderId),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'PENDING' ? false : 3000),
  })
  const status = query.data?.status
  const done = useRef(false)
  useEffect(() => {
    if (status && status !== 'PENDING' && !done.current) {
      done.current = true
      onDone(status)
    }
  }, [status, onDone])

  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  if (!query.data) return null
  if (status === 'PAID') return <Alert type="success">Payment received. Your plan is active until {day(query.data.periodEnd && new Date(new Date(query.data.periodEnd).getTime() - 1))}. Your invoice is below and has been emailed.</Alert>
  if (status === 'PENDING') return <Alert type="info">Waiting for the payment result. This can take a minute. You can keep this page open.</Alert>
  return <Alert>The payment did not go through{query.data.failureReason ? `: ${query.data.failureReason}` : '.'} You can try again below.</Alert>
}

export default function Billing() {
  const { setCompany, company } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const returnedOrder = params.get('order')

  const summary = useQuery({ queryKey: ['billing'], queryFn: billingApi.summary })
  const [users, setUsers] = useState(null)
  const [months, setMonths] = useState(() => {
    const m = toInt(params.get('months'), 12, 1, 60)
    return PRICING.tenures.some((t) => t.months === m) ? m : 12
  })
  const data = summary.data
  // Start at the number of people already using the account (a plan cannot have fewer users than that).
  const chosenUsers = users ?? Math.max(toInt(params.get('users'), 0, 0, 500), data?.activeUsers || 1, 1)
  const price = planPrice({ users: chosenUsers, months })

  const checkout = useMutation({
    mutationFn: () => billingApi.checkout({ users: chosenUsers, months }),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      // A real gateway sends the customer to its payment page. (The practice gateway shows buttons below.)
      if (order.payUrl) window.location.assign(order.payUrl)
    },
  })
  const simulate = useMutation({
    mutationFn: ({ id, outcome }) => billingApi.simulate(id, outcome),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      setParams({ order: order._id })
    },
  })
  const download = useMutation({ mutationFn: ({ id, number }) => billingApi.downloadInvoice(id, number) })

  const refreshCompany = async () => {
    await queryClient.invalidateQueries({ queryKey: ['billing'] })
    try {
      const fresh = await companyApi.get(company._id)
      setCompany(fresh)
      queryClient.setQueryData(['company', company._id], fresh)
    } catch {
      // The page is still right; the next refresh fixes the header.
    }
  }

  if (summary.isLoading) return <PageLoader />
  if (summary.error) return <Alert>{errorMessage(summary.error)}</Alert>

  const sub = data.subscription
  const end = sub.status === 'ACTIVE' ? sub.currentPeriodEnd : sub.trialEndsAt
  const left = daysLeft(end)
  const missingState = !data.billTo.state
  const lowUsers = chosenUsers < data.activeUsers
  const pending = (data.orders || []).find((o) => o.status === 'PENDING' && o.simulated)
  const canBuy = data.ready && !missingState && !lowUsers

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Billing</h1>

      {returnedOrder && <ReturnBanner orderId={returnedOrder} onDone={refreshCompany} />}
      {!data.ready && (
        <Alert type="info">
          Buying a plan online is not available yet: {data.notReady.join('; ')}. Please contact support, or{' '}
          <Link to="/contact?plan=Parking Management" className="font-semibold underline">send us a request</Link>.
        </Alert>
      )}

      <Card title="Your plan" action={<Link to="/dashboard/company" className="text-sm font-semibold text-blue-700 hover:underline">Company details</Link>}>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Status</dt><dd className="mt-1"><Badge tone={STATUS_TONE[sub.status] || 'slate'}>{sub.status.replace('_', ' ')}</Badge></dd></div>
          <div><dt className="text-slate-500">Plan</dt><dd className="mt-1 font-semibold text-slate-900">{sub.planName}</dd></div>
          <div><dt className="text-slate-500">Users allowed</dt><dd className="mt-1 font-semibold text-slate-900">{sub.maxUsers} <span className="font-normal text-slate-500">({data.activeUsers} in use)</span></dd></div>
          <div>
            <dt className="text-slate-500">{sub.status === 'ACTIVE' ? 'Paid until' : sub.status === 'TRIAL' ? 'Trial ends' : 'Ended'}</dt>
            <dd className="mt-1 font-semibold text-slate-900">
              {day(end)}
              {left !== null && <span className={`ml-2 text-xs font-medium ${left <= 7 ? 'text-red-600' : 'text-slate-500'}`}>{left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'ended'}</span>}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title={sub.status === 'ACTIVE' ? 'Renew or change your plan' : 'Buy the Parking Management plan'}>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-slate-700">
              Number of users
              <input
                type="number" min="1" max="500" inputMode="numeric" value={chosenUsers}
                onChange={(e) => setUsers(toInt(e.target.value, 1, 1, 500))}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Plan length
              <select
                value={months} onChange={(e) => setMonths(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PRICING.tenures.map((t) => <option key={t.months} value={t.months}>{planLabel(t.months)}{t.discount ? ` (${t.discount}% off)` : ''}</option>)}
              </select>
            </label>
            {lowUsers && <Alert>You have {data.activeUsers} active users. Choose at least that many, or deactivate some users first.</Alert>}
            {sub.status === 'ACTIVE' && <p className="text-xs text-slate-500">A renewal starts when your paid period ends. The number of users applies straight away.</p>}
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">Invoice will be made out to</p>
              <p>{data.billTo.name}</p>
              <p>{data.billTo.address || 'No address yet'}</p>
              <p>GSTIN: {data.billTo.gstin || 'not given'}{data.billTo.state ? ` · Place of supply: ${data.billTo.state}` : ''}</p>
              {missingState && <p className="mt-1 font-semibold text-red-700">Add your state (or a GSTIN) on the <Link to="/dashboard/company" className="underline">Company page</Link> first, so the GST can be worked out.</p>}
            </div>
          </div>

          <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">{chosenUsers} user{chosenUsers === 1 ? '' : 's'} × {planLabel(months)}</dt><dd className="font-semibold">{money(price.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Discount ({price.discountPercent}%)</dt><dd className="font-semibold text-green-700">− {money(price.discount)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2"><dt className="text-slate-600">Total before GST</dt><dd className="font-semibold">{money(price.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">GST ({PRICING.gstPercent}%)</dt><dd>{money(price.gst)}</dd></div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-3"><dt className="font-bold text-slate-900">Total to pay</dt><dd className="text-2xl font-extrabold text-[#0b4ea2]">{money(price.total)}</dd></div>
            <p className="text-xs text-slate-500">CGST + SGST for a buyer in the seller&apos;s state, IGST for another state. The total is the same.</p>
          </dl>
        </div>
        <Alert>{checkout.error && errorMessage(checkout.error)}</Alert>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => checkout.mutate()} loading={checkout.isPending} disabled={!canBuy}>Pay {money(price.total)} online</Button>
          <span className="text-xs text-slate-500">You pay on the secure payment page of our payment partner (UPI, cards, net banking). The invoice is emailed when the payment arrives.</span>
        </div>

        {pending && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Practice payment (development only)</p>
            <p>This server uses the pretend gateway. Order of {money(pending.total)}: </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => simulate.mutate({ id: pending._id, outcome: 'SUCCESS' })} loading={simulate.isPending}>Mark as paid</Button>
              <Button variant="secondary" onClick={() => simulate.mutate({ id: pending._id, outcome: 'FAILED' })} disabled={simulate.isPending}>Mark as failed</Button>
            </div>
            <Alert>{simulate.error && errorMessage(simulate.error)}</Alert>
          </div>
        )}
      </Card>

      <Card title="Invoices">
        {data.invoices.length === 0 ? (
          <p className="text-sm text-slate-500">No invoices yet. One is made when a plan payment arrives.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th className="py-2 pr-4">Invoice</th><th className="pr-4">Date</th><th className="pr-4">For</th><th className="pr-4 text-right">Total</th><th /></tr></thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv._id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-semibold text-slate-900">{inv.number}</td>
                    <td className="pr-4">{day(inv.issuedAt)}</td>
                    <td className="pr-4">{inv.description}</td>
                    <td className="pr-4 text-right">{money(inv.total)}</td>
                    <td className="text-right"><Button variant="secondary" onClick={() => download.mutate({ id: inv._id, number: inv.number })} disabled={download.isPending}>Download PDF</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Alert>{download.error && errorMessage(download.error)}</Alert>
      </Card>

      {data.orders.length > 0 && (
        <Card title="Recent orders">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">Plan</th><th className="pr-4 text-right">Amount</th><th className="pl-4">Status</th><th /></tr></thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o._id} className="border-t border-slate-100">
                    <td className="py-2 pr-4">{day(o.createdAt)}</td>
                    <td className="pr-4">{o.users} users × {planLabel(o.months)}</td>
                    <td className="pr-4 text-right">{money(o.total)}</td>
                    <td className="pl-4"><Badge tone={ORDER_TONE[o.status]}>{ORDER_TEXT[o.status]}</Badge></td>
                    <td className="text-right">{o.status === 'PENDING' && o.payUrl && <a href={o.payUrl} className="font-semibold text-blue-700 hover:underline">Pay now</a>}</td>
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
