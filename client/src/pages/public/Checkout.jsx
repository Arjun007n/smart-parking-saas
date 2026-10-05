import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { shopApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useCart } from '../../hooks/useCart'
import { usePageTitle } from '../../hooks/usePageTitle'
import { errorMessage } from '../../utils/errors'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert, Button, Checkbox, Field, PageLoader, Select, Textarea } from '../../components/ui'
import { Totals } from './Cart'

// The delivery address and the payment. Needs a signed-in company admin (the order belongs to the company).
function CheckoutForm() {
  const navigate = useNavigate()
  const { company } = useAuth()
  const { items, clear } = useCart()
  const info = useQuery({ queryKey: ['shop', 'info'], queryFn: shopApi.info, staleTime: 60_000 })
  const key = JSON.stringify(items)
  const priced = useQuery({ queryKey: ['shop', 'cart', key], queryFn: () => shopApi.priceCart(items), enabled: items.length > 0 })

  const a = company?.address || {}
  const [form, setForm] = useState(() => ({
    name: company?.billingContact?.name || '',
    phone: company?.billingContact?.phone || '',
    line1: a.line1 || '',
    line2: '',
    city: a.city || '',
    state: a.state || '',
    pincode: a.pincode || '',
    gstin: company?.gstNumber || '',
    installationRequested: false,
    notes: '',
  }))
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))

  const place = useMutation({
    mutationFn: () => shopApi.checkout({
      items,
      shipTo: { name: form.name, phone: form.phone, line1: form.line1, ...(form.line2 ? { line2: form.line2 } : {}), city: form.city, state: form.state, pincode: form.pincode },
      installationRequested: form.installationRequested,
      ...(form.notes ? { notes: form.notes } : {}),
      ...(form.gstin ? { gstin: form.gstin.trim().toUpperCase() } : {}),
    }),
    onSuccess: ({ order }) => {
      clear()
      // A real gateway sends the customer to its payment page; the practice gateway shows its buttons on the order page.
      if (order.payUrl) window.location.assign(order.payUrl)
      else navigate(`/dashboard/orders/${order._id}`)
    },
  })

  if (items.length === 0 && !place.isSuccess) {
    return (
      <div className="rounded-xl bg-slate-50 p-8 text-center">
        <p className="text-slate-700">Your cart is empty.</p>
        <Link to="/product" className="mt-4 inline-block rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700">Browse the hardware</Link>
      </div>
    )
  }
  const data = priced.data
  const blocked = !data || data.problems.length > 0 || data.lines.length === 0
  const closed = info.data && !info.data.orderingOpen

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); place.mutate() }}
      className="grid gap-8 lg:grid-cols-[1fr_22rem]"
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Delivery address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name of the person receiving it" name="name" value={form.name} onChange={set('name')} required autoComplete="name" />
            <Field label="Phone number" name="phone" value={form.phone} onChange={set('phone')} required inputMode="tel" autoComplete="tel" hint="The courier may call this number" />
            <Field className="sm:col-span-2" label="Address" name="line1" value={form.line1} onChange={set('line1')} required autoComplete="address-line1" />
            <Field className="sm:col-span-2" label="Landmark or more address (optional)" name="line2" value={form.line2} onChange={set('line2')} autoComplete="address-line2" />
            <Field label="City" name="city" value={form.city} onChange={set('city')} required autoComplete="address-level2" />
            <Select label="State" name="state" value={form.state} onChange={set('state')} required>
              <option value="">Choose the state…</option>
              {(info.data?.states || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Field label="PIN code" name="pincode" value={form.pincode} onChange={set('pincode')} required inputMode="numeric" maxLength={6} autoComplete="postal-code" />
            <Field label="GSTIN for the invoice (optional)" name="gstin" value={form.gstin} onChange={set('gstin')} maxLength={15} hint="Leave empty if you have none" />
          </div>
          <p className="mt-3 text-xs text-slate-500">GST is charged by the state the goods are delivered to: CGST + SGST within the seller&apos;s state, IGST otherwise.</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Anything else?</h2>
          <Checkbox label="I would also like you to install it and connect it to the software (we will contact you about the charge)" checked={form.installationRequested} onChange={set('installationRequested')} />
          <Textarea className="mt-4" label="Notes for us (optional)" name="notes" rows={3} maxLength={500} value={form.notes} onChange={set('notes')} />
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-xl bg-slate-50 p-5">
        <h2 className="text-lg font-bold text-slate-900">Your order</h2>
        {data && (
          <ul className="space-y-1 text-sm text-slate-700">
            {data.lines.map((l) => <li key={l.productId} className="flex justify-between gap-3"><span>{l.qty} × {l.name}</span><span>{l.total.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span></li>)}
          </ul>
        )}
        {data ? <Totals priced={data} shipping={info.data?.shipping} /> : <p className="text-sm text-slate-500">Working out the price…</p>}
        {data && data.problems.length > 0 && <Alert>Something in your cart cannot be ordered. <Link to="/cart" className="font-semibold underline">Go back to the cart</Link>.</Alert>}
        {closed && <Alert type="info">Online ordering is not open yet. <Link to="/contact" className="font-semibold underline">Contact us</Link> to order.</Alert>}
        <Alert>{place.error && errorMessage(place.error)}</Alert>
        <Button type="submit" loading={place.isPending} disabled={blocked || closed} className="w-full py-3">Place order and pay</Button>
        <p className="text-xs text-slate-500">You pay on the secure page of our payment partner (UPI, cards, net banking). Your GST invoice is emailed when the payment arrives.</p>
        <Link to="/cart" className="block text-center text-sm font-semibold text-blue-700 hover:underline">Back to the cart</Link>
      </aside>
    </form>
  )
}

export default function Checkout() {
  usePageTitle('Checkout')
  const { isAuthenticated, loading, can, company } = useAuth()

  let body
  if (loading) body = <PageLoader />
  else if (!isAuthenticated) {
    body = (
      <div className="mx-auto max-w-xl rounded-xl bg-slate-50 p-8 text-center">
        <h2 className="text-xl font-bold text-slate-900">Sign in to place your order</h2>
        <p className="mt-2 text-slate-600">Orders are made for your parking company, so we can send the GST invoice and keep track of the delivery. Your cart will still be here.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/login" state={{ from: '/checkout' }} className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700">Sign in</Link>
          <Link to="/register" className="rounded-lg border border-slate-300 bg-white px-5 py-2 font-semibold text-slate-700 hover:bg-slate-50">Create an account</Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">After registering, sign in and come back to this page.</p>
      </div>
    )
  } else if (!company || !can('COMPANY_MANAGE')) {
    body = <Alert type="info">Only a company admin can place hardware orders. Ask your company admin, or <Link to="/contact" className="font-semibold underline">contact us</Link>.</Alert>
  } else body = <CheckoutForm />

  return (
    <>
      <PageHeader title="Checkout" intro="Enter where the hardware should be delivered, then pay online." />
      <div className="mx-auto max-w-6xl px-4 py-10">{body}</div>
    </>
  )
}
