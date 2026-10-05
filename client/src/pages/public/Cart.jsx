import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { shopApi } from '../../services/api'
import { useCart } from '../../hooks/useCart'
import { usePageTitle } from '../../hooks/usePageTitle'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert } from '../../components/ui'

// What the customer pays, worked out by the server from the current catalog.
export function Totals({ priced, shipping }) {
  const free = priced.shippingFee === 0
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between"><dt className="text-slate-600">Goods (before GST)</dt><dd className="font-semibold">{money(priced.goods)}</dd></div>
      <div className="flex justify-between">
        <dt className="text-slate-600">Delivery{free ? '' : ' (before GST)'}</dt>
        <dd className="font-semibold">{free ? (shipping && shipping.flat > 0 ? 'Free' : 'Included') : money(priced.shippingFee)}</dd>
      </div>
      <div className="flex justify-between"><dt className="text-slate-600">GST</dt><dd className="font-semibold">{money(priced.gst)}</dd></div>
      <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
        <dt className="font-bold text-slate-900">Total</dt>
        <dd className="text-2xl font-extrabold text-[#0b4ea2]">{money(priced.total)}</dd>
      </div>
    </dl>
  )
}

export default function Cart() {
  usePageTitle('Your cart')
  const { items, setQty, remove, clear } = useCart()
  const key = JSON.stringify(items)
  const priced = useQuery({
    queryKey: ['shop', 'cart', key],
    queryFn: () => shopApi.priceCart(items),
    enabled: items.length > 0,
    placeholderData: (previous) => previous,
  })
  const info = useQuery({ queryKey: ['shop', 'info'], queryFn: shopApi.info, staleTime: 60_000 })
  const data = priced.data
  const lineOf = (id) => data?.lines.find((l) => l.productId === id)
  const problemOf = (id) => data?.problems.find((p) => p.productId === id)
  const blocked = !data || data.problems.length > 0 || data.lines.length === 0

  return (
    <>
      <PageHeader title="Your cart" intro="Check your items, then continue to checkout. Prices are worked out by our server." />
      <div className="mx-auto max-w-6xl px-4 py-10">
        {items.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-8 text-center">
            <p className="text-slate-700">Your cart is empty.</p>
            <Link to="/product" className="mt-4 inline-block rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700">Browse the hardware</Link>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-4">
              {priced.error && <Alert>{errorMessage(priced.error)}</Alert>}
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {items.map((item) => {
                  const line = lineOf(item.productId)
                  const problem = problemOf(item.productId)
                  return (
                    <li key={item.productId} className="flex flex-wrap items-center gap-4 p-4">
                      {line?.imageUrl && <img src={line.imageUrl} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded bg-slate-50 object-contain" />}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900">{line?.name || problem?.name || (priced.isLoading ? 'Loading…' : 'Item')}</p>
                        {line && <p className="text-xs text-slate-500">{money(line.unitPrice)} + {line.gstPercent}% GST each</p>}
                        {problem && <p role="alert" className="text-sm font-medium text-red-700">{problem.problem}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" aria-label="One less" onClick={() => setQty(item.productId, item.qty - 1)} disabled={item.qty <= 1} className="h-8 w-8 rounded border border-slate-300 text-lg leading-none disabled:opacity-40">−</button>
                        <span aria-live="polite" className="w-8 text-center font-semibold">{item.qty}</span>
                        <button type="button" aria-label="One more" onClick={() => setQty(item.productId, item.qty + 1)} className="h-8 w-8 rounded border border-slate-300 text-lg leading-none">+</button>
                      </div>
                      <p className="w-28 text-right font-semibold">{line ? money(line.taxable) : '—'}</p>
                      <button type="button" onClick={() => remove(item.productId)} className="text-sm font-semibold text-red-700 hover:underline">Remove</button>
                    </li>
                  )
                })}
              </ul>
              <button type="button" onClick={clear} className="text-sm font-semibold text-slate-600 hover:underline">Empty the cart</button>
            </div>

            <aside className="h-fit rounded-xl bg-slate-50 p-5">
              <h2 className="mb-4 text-lg font-bold text-slate-900">Order summary</h2>
              {data ? <Totals priced={data} shipping={info.data?.shipping} /> : <p className="text-sm text-slate-500">Working out the price…</p>}
              {data && data.problems.length > 0 && <p className="mt-3 text-sm text-red-700">Fix or remove the items marked above to continue.</p>}
              {info.data && !info.data.orderingOpen && (
                <div className="mt-4"><Alert type="info">Online ordering is not open yet. <Link to="/contact" className="font-semibold underline">Contact us</Link> to order.</Alert></div>
              )}
              <Link
                to="/checkout"
                aria-disabled={blocked || (info.data && !info.data.orderingOpen)}
                onClick={(e) => { if (blocked || (info.data && !info.data.orderingOpen)) e.preventDefault() }}
                className={`sp-press mt-5 block rounded-lg px-4 py-3 text-center font-bold text-white shadow ${blocked || (info.data && !info.data.orderingOpen) ? 'cursor-not-allowed bg-slate-400' : 'bg-gradient-to-r from-[#ff7a18] to-[#ff9a3c] hover:brightness-105'}`}
              >
                Continue to checkout
              </Link>
              <p className="mt-3 text-xs text-slate-500">You will sign in (or register) and enter the delivery address next. We send a GST invoice when the payment arrives.</p>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}
