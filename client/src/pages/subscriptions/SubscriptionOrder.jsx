import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { billingApi, subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { printInvoice } from '../../utils/printInvoice'
import { ORDER_KIND_TEXT, PAY_TEXT, PAY_TONE, dmy, lastDayOf, monthsText } from '../../utils/subscriptions'
import { Alert, Badge, Button, Card, PageLoader } from '../../components/ui'
import { Modal } from '../../components/pass/ListKit'

const SHEET = 'subscription-invoice-sheet'

// "CGST 9 % SGST 9 %" inside the seller's state, "IGST 18 %" outside it (known once the invoice is made).
const taxText = (order, percent) => {
  const type = order.invoice && order.invoice.taxType
  if (type === 'INTER') return `IGST ${percent} %`
  if (type === 'INTRA') return `CGST ${percent / 2} % SGST ${percent / 2} %`
  return `GST ${percent} %`
}

// The GST invoice of a paid order, laid out like the Receipt / Invoice window of ismartparking.com.
function InvoiceSheet({ order }) {
  const inv = order.invoice
  const { seller, buyer } = order
  return (
    <article id={SHEET} className="space-y-3 text-sm text-slate-900">
      <header className="text-center">
        <p className="text-lg font-bold">TAX INVOICE</p>
        <p className="font-semibold">{seller.name}</p>
        <p className="text-xs text-slate-600">{seller.address}{seller.gstin ? ` · GST : ${seller.gstin}` : ''}{seller.email ? ` · ${seller.email}` : ''}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-slate-500">Invoice to</p>
          <p className="font-semibold">{buyer.name}</p>
          <p className="text-xs text-slate-600">{buyer.address}{buyer.gstin ? ` · GSTIN : ${buyer.gstin}` : ''}</p>
          <p className="text-xs text-slate-600">{[buyer.phone, buyer.email].filter(Boolean).join(' , ')}</p>
        </div>
        <dl className="text-xs sm:text-right">
          <div>Invoice no : <b>{inv.number}</b></div>
          <div>Invoice date : {dmy(inv.issuedAt)}</div>
          <div>Order no : {order.orderNumber}</div>
          <div>Location : {order.locationName}</div>
        </dl>
      </div>
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="bg-slate-100">
            {['Item', 'Qty', 'Month', 'Rate', 'Amount', 'Discount', 'Taxable'].map((h) => <th key={h} className="border border-slate-300 p-1.5">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.key}>
              <td className="border border-slate-300 p-1.5">{l.label}</td>
              <td className="border border-slate-300 p-1.5">{l.qty}</td>
              <td className="border border-slate-300 p-1.5">{l.months}</td>
              <td className="border border-slate-300 p-1.5">{money(l.rate)}</td>
              <td className="border border-slate-300 p-1.5">{money(l.amount)}</td>
              <td className="border border-slate-300 p-1.5">{money(l.discount)}</td>
              <td className="border border-slate-300 p-1.5">{money(l.taxable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto w-64 space-y-0.5 text-xs">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
        <div className="flex justify-between"><dt>Discount</dt><dd>{money(order.discount)}</dd></div>
        <div className="flex justify-between"><dt>Gross Total</dt><dd>{money(order.gross)}</dd></div>
        {inv.taxType === 'INTER' ? (
          <div className="flex justify-between"><dt>IGST</dt><dd>{money(inv.igst)}</dd></div>
        ) : (
          <>
            <div className="flex justify-between"><dt>CGST</dt><dd>{money(inv.cgst)}</dd></div>
            <div className="flex justify-between"><dt>SGST</dt><dd>{money(inv.sgst)}</dd></div>
          </>
        )}
        <div className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold"><dt>Total Amount</dt><dd>{money(inv.total)}</dd></div>
      </dl>
      <p className="text-xs text-slate-500">This is a computer generated invoice and needs no signature. Thank you for your business!</p>
    </article>
  )
}

// One order: its status (it checks again while the payment is pending), what was bought, the invoice.
export default function SubscriptionOrder() {
  const { id } = useParams()
  const cameFrom = useLocation().state
  const queryClient = useQueryClient()
  const [showInvoice, setShowInvoice] = useState(false)
  const query = useQuery({
    queryKey: ['subscriptions', 'order', id],
    queryFn: () => subscriptionApi.order(id),
    refetchInterval: (q) => (q.state.data && q.state.data.status === 'PENDING' ? 3000 : false),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['my-orders'] })
  }
  const simulate = useMutation({ mutationFn: (outcome) => billingApi.simulate(id, outcome), onSuccess: refresh })
  const download = useMutation({ mutationFn: () => billingApi.downloadInvoice(query.data.invoice._id, query.data.invoice.number) })

  if (query.isLoading) return <PageLoader />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  const o = query.data
  const back = cameFrom && cameFrom.from === 'orders' ? '/dashboard/orders' : `/dashboard/subscriptions/location/${o.locationId}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Order Number : {o.orderNumber}</h1>
        <Link to={back} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</Link>
      </div>

      {o.status === 'PAID' && <Alert type="success">Payment received. {o.kind === 'UPDATE' ? 'Your subscription has been updated.' : `Your subscription is active until ${dmy(lastDayOf(o.periodEnd))}.`} The invoice has been emailed.</Alert>}
      {o.status === 'PENDING' && <Alert type="info">Waiting for the payment result. This can take a minute. You can keep this page open.</Alert>}
      {(o.status === 'FAILED' || o.status === 'CANCELLED') && <Alert>The payment did not go through{o.failureReason ? `: ${o.failureReason}` : '.'} You can start again from the location page.</Alert>}

      <Card title="Order" action={o.status === 'PAID' && o.invoice ? <Button type="button" variant="info" onClick={() => setShowInvoice(true)}>Receipt / Invoice</Button> : null}>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Status</dt><dd className="mt-1"><Badge tone={o.status === 'PAID' ? 'green' : 'slate'}>{o.status === 'PAID' ? 'PLACED' : 'WAITING'}</Badge></dd></div>
          <div><dt className="text-slate-500">Payment</dt><dd className="mt-1"><Badge tone={PAY_TONE[o.status]}>{PAY_TEXT[o.status]}</Badge></dd></div>
          <div><dt className="text-slate-500">Date</dt><dd className="mt-1 font-semibold">{dmy(o.createdAt)}</dd></div>
          <div><dt className="text-slate-500">Payment Source</dt><dd className="mt-1 font-semibold capitalize">{o.provider || '-'}</dd></div>
          <div><dt className="text-slate-500">Location</dt><dd className="mt-1 font-semibold">{o.locationName}</dd></div>
          <div><dt className="text-slate-500">Subscription</dt><dd className="mt-1 font-semibold">{o.subscriptionCode || '-'} ({ORDER_KIND_TEXT[o.kind]}{o.kind === 'UPDATE' ? '' : `, ${monthsText(o.months)}`})</dd></div>
          {o.invoice && <div><dt className="text-slate-500">Invoice No</dt><dd className="mt-1 font-semibold">{o.invoice.number}</dd></div>}
          {o.invoice && <div><dt className="text-slate-500">Invoice Date</dt><dd className="mt-1 font-semibold">{dmy(o.invoice.issuedAt)}</dd></div>}
        </dl>
        {o.status === 'PAID' && (o.paymentId || o.gatewayOrderId) && (
          <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
            {o.paymentId && <div><dt className="text-slate-500">Payment transaction id</dt><dd className="break-all font-mono text-xs">{o.paymentId}</dd></div>}
            {o.gatewayOrderId && <div><dt className="text-slate-500">Payment order id</dt><dd className="break-all font-mono text-xs">{o.gatewayOrderId}</dd></div>}
          </dl>
        )}
      </Card>

      <Card title="Subscription Detail">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>{['Order ID', 'Subscription', 'Item (User/Addons)', 'Qty.', 'Month.', 'Price', 'Discount', 'Taxable Amount', 'Taxes', 'Tax Amount', 'Total Amount'].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {o.taxLines.map((l, i) => (
                <tr key={l.key} className="border-t border-slate-100 align-top">
                  {i === 0 && (
                    <>
                      <td className="p-2 whitespace-nowrap" rowSpan={o.taxLines.length}>
                        ORI1
                        <div><Badge tone={o.status === 'PAID' ? 'green' : 'slate'}>{o.status === 'PAID' ? 'Confirmed' : 'Not confirmed'}</Badge></div>
                      </td>
                      <td className="p-2" rowSpan={o.taxLines.length}>
                        {o.planName}
                        {o.subscriptionCode && <div className="text-xs text-slate-500">({o.subscriptionCode})</div>}
                      </td>
                    </>
                  )}
                  <td className="p-2">{l.label}</td><td className="p-2">{l.qty}</td><td className="p-2">{l.months}</td>
                  <td className="p-2">{money(l.amount)}</td><td className="p-2">{money(l.discount)}</td><td className="p-2">{money(l.taxable)}</td>
                  <td className="p-2 text-xs">{taxText(o, l.taxPercent)}</td><td className="p-2">{money(l.tax)}</td><td className="p-2">{money(l.totalWithTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-3 w-64 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Discount</dt><dd>{money(o.discount)}</dd></div>
          <div className="flex justify-between"><dt>Gross Total</dt><dd>{money(o.gross)}</dd></div>
          {o.invoice && o.invoice.taxType !== 'INTER' ? (
            <>
              <div className="flex justify-between"><dt>CGST</dt><dd>{money(o.invoice.cgst)}</dd></div>
              <div className="flex justify-between"><dt>SGST</dt><dd>{money(o.invoice.sgst)}</dd></div>
            </>
          ) : (
            <div className="flex justify-between"><dt>{o.invoice ? 'IGST' : 'GST'}</dt><dd>{money(o.gst)}</dd></div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><dt>Total Amount</dt><dd>{money(o.total)}</dd></div>
        </dl>
      </Card>

      <Card title="Customer">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-slate-500">Customer</p>
            <p className="font-semibold text-slate-900">{o.buyer.name || 'NA'}</p>
            <p className="text-slate-600">GSTIN : {o.buyer.gstin || '-'}</p>
            <p className="text-slate-600">{[o.buyer.email, o.buyer.phone].filter(Boolean).join(' · ') || '-'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Billing address</p>
            <p className="text-slate-700">Company : {o.buyer.name}</p>
            <p className="text-slate-600">{o.buyer.address || '-'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Shipping address</p>
            <p className="text-slate-700">{o.buyer.name}</p>
            <p className="text-slate-600">{o.buyer.address || '-'}</p>
            <p className="text-slate-600">{[o.buyer.phone, o.buyer.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </Card>

      {o.status === 'PENDING' && (
        <Card title="Pay">
          <Alert>{simulate.error && errorMessage(simulate.error)}</Alert>
          <div className="flex flex-wrap items-center gap-3">
            {o.payUrl && <a href={o.payUrl} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Pay {money(o.total)}</a>}
            {o.simulated && (
              <>
                <Button type="button" variant="success" loading={simulate.isPending} onClick={() => simulate.mutate('SUCCESS')}>Practice payment: succeed</Button>
                <Button type="button" variant="danger" disabled={simulate.isPending} onClick={() => simulate.mutate('FAILED')}>Practice payment: fail</Button>
              </>
            )}
          </div>
        </Card>
      )}

      {showInvoice && o.invoice && (
        <Modal title="Receipt / Invoice" wide onClose={() => setShowInvoice(false)}>
          <div className="mb-3 flex justify-end gap-2">
            <Button type="button" variant="info" loading={download.isPending} onClick={() => download.mutate()}>Download PDF</Button>
            <Button type="button" variant="dark" onClick={() => printInvoice(SHEET)}>Print</Button>
          </div>
          <Alert>{download.error && errorMessage(download.error)}</Alert>
          <InvoiceSheet order={o} />
        </Modal>
      )}
    </div>
  )
}
