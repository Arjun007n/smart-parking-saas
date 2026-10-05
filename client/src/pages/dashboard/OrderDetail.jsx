import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { shopApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { dateTime, money } from '../../utils/format'
import { Alert, Badge, Button, Card, PageLoader } from '../../components/ui'
import { HISTORY_TEXT, PAY_TEXT, PAY_TONE, SHIP_TEXT, SHIP_TONE } from './shopStatus'

// One hardware order: payment, delivery, what was bought, where it goes, and the invoice.
export default function OrderDetail() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['shop', 'order', id],
    queryFn: () => shopApi.order(id),
    // While the payment is not confirmed, ask again every few seconds (the customer may just have come back from paying).
    refetchInterval: (q) => (q.state.data && q.state.data.status === 'PENDING' ? 4000 : false),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shop', 'order', id] })
    queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] })
  }
  const simulate = useMutation({ mutationFn: (outcome) => shopApi.simulate(id, outcome), onSuccess: refresh })
  const cancel = useMutation({ mutationFn: () => shopApi.cancelOrder(id), onSuccess: refresh })
  const download = useMutation({ mutationFn: () => shopApi.downloadInvoice(query.data.invoiceId, query.data.number) })

  if (query.isLoading) return <PageLoader />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  const o = query.data
  const ship = o.shipTo

  return (
    <div className="space-y-6">
      <div>
        <Link to="/dashboard/orders" className="text-sm font-semibold text-blue-700 hover:underline">← My orders</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Order {o.number}</h1>
        <p className="text-sm text-slate-500">Placed {dateTime(o.createdAt)}</p>
      </div>

      {o.status === 'PAID' && <Alert type="success">Payment received. {o.fulfilment === 'DELIVERED' ? 'Your order was delivered.' : o.fulfilment === 'SHIPPED' ? 'Your order is on its way.' : o.fulfilment === 'CANCELLED' ? 'This order was cancelled.' : 'We are preparing your order. Your GST invoice has been emailed and is below.'}</Alert>}
      {o.status === 'PENDING' && <Alert type="info">Waiting for the payment. If you have just paid, this page updates by itself within a minute.</Alert>}
      {(o.status === 'FAILED' || o.status === 'CANCELLED') && <Alert>This order was not paid{o.failureReason ? `: ${o.failureReason}` : ''}. If money left your account, contact us with the order number. Otherwise, you can order again from the shop.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Status" className="lg:col-span-1">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><dt className="text-slate-500">Payment</dt><dd><Badge tone={PAY_TONE[o.status]}>{PAY_TEXT[o.status]}</Badge></dd></div>
            <div className="flex items-center justify-between"><dt className="text-slate-500">Delivery</dt><dd>{o.status === 'PAID' ? <Badge tone={SHIP_TONE[o.fulfilment]}>{SHIP_TEXT[o.fulfilment]}</Badge> : <span className="text-slate-400">—</span>}</dd></div>
            {o.courier && <div className="flex justify-between"><dt className="text-slate-500">Courier</dt><dd className="font-semibold">{o.courier}</dd></div>}
            {o.trackingNumber && <div className="flex justify-between"><dt className="text-slate-500">Tracking no.</dt><dd className="font-semibold">{o.trackingNumber}</dd></div>}
          </dl>
          <ol className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
            {o.history.map((h, i) => (
              <li key={`${h.status}-${i}`} className="flex justify-between gap-3">
                <span>{HISTORY_TEXT[h.status] || h.status}{h.note ? <span className="block text-xs text-slate-500">{h.note}</span> : null}</span>
                <span className="shrink-0 text-xs text-slate-500">{dateTime(h.at)}</span>
              </li>
            ))}
          </ol>
          {o.status === 'PENDING' && (
            <div className="mt-4 flex flex-wrap gap-2">
              {o.payUrl && <a href={o.payUrl} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Pay now</a>}
              <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel this order</Button>
            </div>
          )}
          <div className="mt-3"><Alert>{cancel.error && errorMessage(cancel.error)}</Alert></div>
          {o.invoiceId && (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => download.mutate()} loading={download.isPending}>Download GST invoice (PDF)</Button>
              <div className="mt-2"><Alert>{download.error && errorMessage(download.error)}</Alert></div>
            </div>
          )}
        </Card>

        <Card title="Delivery address" className="lg:col-span-1">
          <address className="text-sm not-italic leading-relaxed text-slate-700">
            <strong className="text-slate-900">{ship.name}</strong><br />
            {ship.line1}<br />
            {ship.line2 && <>{ship.line2}<br /></>}
            {ship.city}, {ship.state} {ship.pincode}<br />
            Phone: {ship.phone}
          </address>
          {o.installationRequested && <p className="mt-3 text-sm font-medium text-slate-800">Installation requested. We will contact you about it.</p>}
          {o.notes && <p className="mt-3 text-sm text-slate-600">Your note: {o.notes}</p>}
        </Card>

        <Card title="Amount" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Goods (before GST)</dt><dd>{money(o.goods)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Delivery (before GST)</dt><dd>{o.shippingFee ? money(o.shippingFee) : 'Included'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">GST</dt><dd>{money(o.gst)}</dd></div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2"><dt className="font-bold text-slate-900">Total</dt><dd className="text-xl font-extrabold text-[#0b4ea2]">{money(o.total)}</dd></div>
          </dl>
        </Card>
      </div>

      <Card title="Items">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2 pr-4">Item</th><th className="pr-4 text-right">Qty</th><th className="pr-4 text-right">Price</th><th className="pr-4 text-right">GST</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.productId} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-semibold text-slate-900">{l.name}</td>
                  <td className="pr-4 text-right">{l.qty}</td>
                  <td className="pr-4 text-right">{money(l.unitPrice)}</td>
                  <td className="pr-4 text-right">{money(l.gst)} <span className="text-xs text-slate-500">({l.gstPercent}%)</span></td>
                  <td className="text-right font-semibold">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {o.simulated && o.status === 'PENDING' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Practice payment (development only)</p>
          <p>This server uses the pretend gateway. Order of {money(o.total)}:</p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => simulate.mutate('SUCCESS')} loading={simulate.isPending}>Mark as paid</Button>
            <Button variant="secondary" onClick={() => simulate.mutate('FAILED')} disabled={simulate.isPending}>Mark as failed</Button>
          </div>
          <Alert>{simulate.error && errorMessage(simulate.error)}</Alert>
        </div>
      )}
    </div>
  )
}
