import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { csvDownload } from '../../utils/csvDownload'
import { ORDER_NOTE, PAY_TEXT, PAY_TONE, STATE_TEXT, STATE_TONE, dmy, monthsText, validity } from '../../utils/subscriptions'
import { Alert, Badge, Button, Card, PageLoader } from '../../components/ui'
import { ExportButtons, Modal, Pager, SearchBox, ShowEntries, Toolbar } from '../../components/pass/ListKit'

// "31d 10h 9m 34s" until the subscription ends.
function Countdown({ end }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = new Date(end).getTime() - now
  if (left <= 0) return <span className="text-sm font-semibold text-red-600">Ended</span>
  const s = Math.floor(left / 1000)
  return (
    <span className="rounded-md bg-slate-900 px-2 py-1 font-mono text-xs text-white">
      {Math.floor(s / 86400)}d {Math.floor((s % 86400) / 3600)}h {Math.floor((s % 3600) / 60)}m {s % 60}s
    </span>
  )
}

function CancelModal({ sub, onClose }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => subscriptionApi.cancel(sub._id, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      onClose()
    },
  })
  return (
    <Modal title={`Cancel subscription ${sub.code}`} onClose={onClose}>
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); cancel.mutate() }}>
        <Alert>{cancel.error && errorMessage(cancel.error)}</Alert>
        <label className="block text-sm font-medium text-slate-700">Enter the reason for subscription cancellation. *
          <textarea className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p className="text-xs text-slate-500">The add-ons of this subscription stop working at once. Money already paid is not returned here.</p>
        <div className="flex justify-end gap-2">
          <Button type="submit" variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 5}>Submit</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </form>
    </Modal>
  )
}

function OrderHistory({ orders }) {
  const tableRef = useRef(null)
  const [limit, setLimit] = useState(25)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const rows = orders.filter((o) => !term || o.orderNumber.toLowerCase().includes(term) || (o.subscriptionCode || '').toLowerCase().includes(term))
  const start = (page - 1) * limit
  const itemsOf = (o) => (o.kind === 'UPDATE' || o.kind === 'PURCHASE' || o.kind === 'RENEWAL' ? o.lines.map((l) => (l.key === 'users' ? `Users : ${l.qty}` : l.label)) : [])
  const download = () => csvDownload('subscription-orders.csv', [
    ['SN', 'Date', 'Subscription', 'Items', 'Order Number', 'Order status', 'Sub Total', 'Gross Total', 'Total paid', 'Payment', 'Order Note'],
    ...rows.map((o, i) => [i + 1, dmy(o.createdAt), o.subscriptionCode, itemsOf(o).join('; '), o.orderNumber, o.status === 'PAID' ? 'Confirmed' : 'Placed', o.subtotal, o.gross, o.status === 'PAID' ? o.total : 0, PAY_TEXT[o.status], ORDER_NOTE[o.kind]]),
  ])
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ShowEntries value={limit} onChange={(n) => { setLimit(n); setPage(1) }} sizes={[10, 25, 50, 100]} />
        <SearchBox label="Search by Order ID/Subscription" value={q} onChange={(v) => { setQ(v); setPage(1) }} />
      </div>
      <Toolbar><ExportButtons onDownload={download} onPrint={() => printTable(tableRef.current, 'Subscription Orders History')} disabled={rows.length === 0} /></Toolbar>
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>{['SN', 'Date', 'Subscription', 'Items', 'Order Number', 'Order status', 'Payment Status', 'Order Note'].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(start, start + limit).map((o, i) => (
              <tr key={o._id} className="border-t border-slate-100 align-top">
                <td className="p-2">{start + i + 1}</td>
                <td className="p-2 whitespace-nowrap">{dmy(o.createdAt)}</td>
                <td className="p-2">{o.subscriptionCode || '—'}<div className="text-xs text-slate-500">({monthsText(o.months)}){' '}({o.kind === 'PURCHASE' ? 'Purchase' : o.kind === 'RENEWAL' ? 'Renewal' : 'Update'})</div></td>
                <td className="p-2"><ol className="list-inside list-decimal text-xs">{itemsOf(o).map((item) => <li key={item}>{item}</li>)}</ol></td>
                <td className="p-2"><Link to={`/dashboard/subscriptions/orders/${o._id}`} className="font-semibold text-blue-700 hover:underline">{o.orderNumber}</Link></td>
                <td className="p-2"><Badge tone={o.status === 'PAID' ? 'green' : 'slate'}>{o.status === 'PAID' ? 'Confirmed' : 'Placed'}</Badge></td>
                <td className="p-2 text-xs">
                  <div>Sub Total : {money(o.subtotal)}</div>
                  <div>Gross Total : {money(o.gross)}</div>
                  <div>Total paid : {money(o.status === 'PAID' ? o.total : 0)}</div>
                  <Badge tone={PAY_TONE[o.status]}>{PAY_TEXT[o.status]}</Badge>
                </td>
                <td className="p-2">{ORDER_NOTE[o.kind]}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">No orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={limit} total={rows.length} onPage={setPage} />
    </div>
  )
}

// Manage Subscriptions > View: one location's subscription, its running subscriptions and its order history.
export default function SubscriptionLocation() {
  const { locationId } = useParams()
  const [tab, setTab] = useState('running')
  const [cancelling, setCancelling] = useState(null)
  const query = useQuery({ queryKey: ['subscriptions', 'location', locationId], queryFn: () => subscriptionApi.location(locationId) })

  if (query.isLoading) return <PageLoader />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  const d = query.data
  const cur = d.current
  const base = '/dashboard/subscriptions'
  const canRenew = cur && !cur.legacy && cur.status !== 'CANCELLED'
  const tabClass = (name) => `rounded-md border px-3 py-1.5 text-sm font-medium ${tab === name ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Location : {d.location.name} <span className="text-sm font-normal text-slate-500">{d.company.code}</span></h1>
        <Link to={base} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</Link>
      </div>
      {!d.ready && <Alert type="info">Buying online is not available yet: {d.notReady.join('; ')}. Please contact support.</Alert>}

      {cur ? (
        <Card title={`Subscription : ${cur.code}`} action={canRenew && cur.state !== 'UPCOMING' ? <div className="flex items-center gap-3"><Link to={`${base}/renew/${cur._id}`} className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600">Renew Now</Link><Countdown end={cur.periodEnd} /></div> : null}>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Subscription/Plan</dt><dd className="mt-1 font-semibold text-slate-900">{cur.planName} <span className="font-normal text-slate-500">{cur.code}</span></dd></div>
            <div><dt className="text-slate-500">Total Users</dt><dd className="mt-1 font-semibold text-slate-900">{cur.users}</dd></div>
            <div><dt className="text-slate-500">Validity</dt><dd className="mt-1 font-semibold text-slate-900">{validity(cur)}</dd></div>
            <div><dt className="text-slate-500">Status</dt><dd className="mt-1"><Badge tone={STATE_TONE[cur.state]}>{STATE_TEXT[cur.state]}</Badge></dd></div>
          </dl>
          <div className="mt-4 text-sm">
            <p className="text-slate-500">Parking Addons :</p>
            <ul className="mt-1 list-inside list-disc">{cur.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          {cur.legacy && <p className="mt-3 text-xs text-slate-500">This is your free trial or earlier plan: everything is included until it ends. Buy a subscription to keep the features you use.</p>}
        </Card>
      ) : (
        <Card title="No subscription yet"><p className="text-sm text-slate-600">This location has no subscription. Buy one to use passes, photos, cameras and online payments here.</p></Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" className={tabClass('running')} onClick={() => setTab('running')}>Running / Upcoming Subscription</button>
          <button type="button" className={tabClass('orders')} onClick={() => setTab('orders')}>Subscription Orders History</button>
        </div>
        <Link to={`${base}/new/${d.location._id}`} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Add new subscription</Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {tab === 'running' ? (
          <div className="overflow-x-auto">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Running / Upcoming subscription</h2>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>{['SNo', 'Subscription code', 'Validity', 'Package/Plan', 'Tenure', 'Items', 'Status', 'Action'].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {d.running.map((s, i) => (
                  <tr key={s._id} className="border-t border-slate-100 align-top">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 font-semibold">{s.code}</td>
                    <td className="p-2 whitespace-nowrap">{validity(s)}</td>
                    <td className="p-2">{s.planName}</td>
                    <td className="p-2">{s.legacy ? '—' : monthsText(s.months)}</td>
                    <td className="p-2"><ol className="list-inside list-decimal text-xs">{!s.legacy && <li>Users : {s.users}</li>}{s.items.map((item) => <li key={item}>{item}</li>)}</ol></td>
                    <td className="p-2"><Badge tone={s.state === 'ACTIVE' ? 'green' : 'blue'}>{s.state === 'ACTIVE' ? 'Running' : 'Upcoming'}</Badge></td>
                    <td className="space-y-1 p-2">
                      {!s.legacy && <Link to={`${base}/update/${s._id}`} className="block rounded-md border border-blue-600 px-2.5 py-1 text-center text-xs font-medium text-blue-700 hover:bg-blue-50">View &amp; Add More Addons</Link>}
                      {!s.legacy && <button type="button" className="block w-full rounded-md border border-red-600 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50" onClick={() => setCancelling(s)}>Cancel</button>}
                    </td>
                  </tr>
                ))}
                {d.running.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">Nothing is running. Press Add new subscription.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <OrderHistory orders={d.orders} />
        )}
      </section>
      {cancelling && <CancelModal sub={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  )
}
