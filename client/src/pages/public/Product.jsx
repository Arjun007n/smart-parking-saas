import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PRODUCTS } from '../../data/site'
import { shopApi } from '../../services/api'
import { useCart } from '../../hooks/useCart'
import { usePageTitle } from '../../hooks/usePageTitle'
import { money } from '../../utils/format'
import { PageHeader } from '../../layouts/PublicLayout'
import LeadForm from '../../components/public/LeadForm'

// The hardware shop. The list comes from the catalog the platform keeps (Dashboard > Shop). If the catalog
// is empty or cannot be loaded, the page falls back to the fixed list from the website, as enquiry-only cards.
const fixedList = PRODUCTS.map((p) => ({ _id: p.name, name: p.name, description: p.text, category: p.category, worksWithSoftware: p.available, canBuy: false, price: null }))

function Card({ product, onEnquire }) {
  const { add, items } = useCart()
  const inCart = items.find((item) => item.productId === product._id)?.qty || 0
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const max = product.maxPerOrder || 20

  const addToCart = () => {
    const ok = add(product._id, qty)
    setNote(ok ? `Added ${qty} to your cart` : 'Your cart is full: finish this order first')
    setQty(1)
  }

  return (
    <li className="sp-lift sp-row-in flex flex-col rounded-xl border border-slate-200 bg-white p-5">
      {product.imageUrl && (
        <img
          src={product.imageUrl}
          alt={product.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mb-4 h-40 w-full rounded-lg bg-slate-50 object-contain"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.category}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${product.worksWithSoftware ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>
          {product.worksWithSoftware ? 'Works today' : 'Planned'}
        </span>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">{product.name}</h2>
      {(product.brand || product.modelNumber) && <p className="text-xs text-slate-500">{[product.brand, product.modelNumber].filter(Boolean).join(' · ')}</p>}
      <p className="mt-2 text-sm text-slate-600">{product.description}</p>
      {product.highlights?.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          {product.highlights.map((h) => <li key={h}>{h}</li>)}
        </ul>
      )}

      <div className="mt-auto pt-4">
        {product.price ? (
          <p className="mb-3">
            <span className="text-xl font-extrabold text-[#0b4ea2]">{money(product.price)}</span>
            <span className="ml-1 text-xs text-slate-500">+ {product.gstPercent}% GST</span>
            <span className="block text-xs text-slate-500">{money(product.priceWithGst)} with GST</span>
          </p>
        ) : (
          <p className="mb-3 text-sm font-medium text-slate-600">{product.worksWithSoftware === false ? 'Not available yet' : 'Ask us for a price'}</p>
        )}

        {product.canBuy ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`qty-${product._id}`}>Quantity of {product.name}</label>
            <input
              id={`qty-${product._id}`}
              type="number"
              min="1"
              max={max}
              value={qty}
              onChange={(e) => setQty(Math.min(max, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button type="button" onClick={addToCart} className="sp-press rounded-lg bg-gradient-to-r from-[#ff7a18] to-[#ff9a3c] px-4 py-2 text-sm font-bold text-white shadow hover:brightness-105">
              Add to cart
            </button>
            {inCart > 0 && <span className="text-xs text-slate-500">{inCart} in cart</span>}
          </div>
        ) : (
          <a href="#enquiry" onClick={() => onEnquire(product.name)} className="font-semibold text-blue-700 hover:underline">
            {product.worksWithSoftware === false ? 'I am interested in' : 'Ask about'}
            <span className="sr-only"> {product.name}</span> →
          </a>
        )}
        {product.inStock === false && <p className="mt-2 text-xs font-medium text-red-700">Out of stock. Ask us when it is back.</p>}
        {note && <p role="status" className="mt-2 text-xs font-medium text-green-700">{note}</p>}
      </div>
    </li>
  )
}

export default function Product() {
  usePageTitle('Hardware shop')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState('')
  const { count } = useCart()
  const catalog = useQuery({ queryKey: ['shop', 'products'], queryFn: shopApi.products, staleTime: 60_000 })
  const info = useQuery({ queryKey: ['shop', 'info'], queryFn: shopApi.info, staleTime: 60_000 })

  const fromServer = catalog.data && catalog.data.length > 0
  const list = fromServer ? catalog.data : fixedList
  const categories = [...new Set(list.map((p) => p.category))].sort()
  const shown = list.filter((p) => !category || p.category === category)
  const anyBuyable = fromServer && list.some((p) => p.canBuy)
  const shipping = info.data?.shipping

  const chip = (active) =>
    `rounded-full border px-4 py-1.5 text-sm font-medium ${
      active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`

  return (
    <>
      <PageHeader
        title="Hardware shop"
        intro={
          anyBuyable
            ? 'Order the gate hardware online and pay securely. We ship it to your site, and we can install it and connect it to the software. Items marked Works today work with the software now.'
            : 'We supply and install the hardware and connect it to the software. Items marked Works today work with the software now. Planned items are not available yet: register your interest and we will contact you when one is ready.'
        }
      />
      <div className="mx-auto max-w-6xl px-4 py-12">
        {anyBuyable && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-slate-700">
            <p>
              Prices are before GST. GST is added at checkout (CGST + SGST within the seller&apos;s state, IGST for other states) and you get a GST invoice.
              {shipping && shipping.flat > 0
                ? ` Delivery: ${money(shipping.flat)} + GST per order${shipping.freeAbove > 0 ? `, free for orders of ${money(shipping.freeAbove)} or more before GST` : ''}.`
                : ' Delivery is included.'}
            </p>
            <Link to="/cart" className="sp-press rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
              View cart{count > 0 ? ` (${count})` : ''}
            </Link>
          </div>
        )}

        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={category === ''} className={chip(category === '')} onClick={() => setCategory('')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} className={chip(category === c)} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        {catalog.isLoading && <p className="mt-8 text-slate-500">Loading the hardware list…</p>}
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((product) => <Card key={product._id} product={product} onEnquire={setSelected} />)}
        </ul>

        <section id="enquiry" className="mt-14 scroll-mt-4 rounded-xl bg-slate-50 p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-slate-900">
            {selected ? `Ask about: ${selected}` : 'Ask about hardware'}
          </h2>
          <p className="mb-6 mt-2 text-slate-600">Need a price, a quantity we do not list, or installation? Tell us about your site and which hardware you need.</p>
          <LeadForm key={selected} type="PRODUCT" subject={selected || 'Hardware'} submitLabel="Send enquiry" messageLabel="About your site and what you need" />
        </section>
      </div>
    </>
  )
}
