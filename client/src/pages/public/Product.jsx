import { useState } from 'react'
import { PRODUCTS } from '../../data/site'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import LeadForm from '../../components/public/LeadForm'

const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category))].sort()

export default function Product() {
  usePageTitle('Hardware')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState('')
  const shown = PRODUCTS.filter((p) => !category || p.category === category)

  const chip = (active) =>
    `rounded-full border px-4 py-1.5 text-sm font-medium ${
      active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`

  return (
    <>
      <PageHeader
        title="Hardware"
        intro="The software runs without any hardware. The integrations below are planned and are not available to buy yet. Register your interest and we will contact you when one is ready."
      />
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={category === ''} className={chip(category === '')} onClick={() => setCategory('')}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} className={chip(category === c)} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((product) => (
            <li key={product.name} className="flex flex-col rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.category}</p>
                <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">Planned</span>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">{product.name}</h2>
              <p className="mt-2 flex-1 text-sm text-slate-600">{product.text}</p>
              <a
                href="#enquiry"
                onClick={() => setSelected(product.name)}
                className="mt-4 font-semibold text-blue-700 hover:underline"
              >
                I am interested<span className="sr-only"> in {product.name}</span> →
              </a>
            </li>
          ))}
        </ul>

        <section id="enquiry" className="mt-14 scroll-mt-4 rounded-xl bg-slate-50 p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-slate-900">
            {selected ? `Register interest: ${selected}` : 'Register your interest'}
          </h2>
          <p className="mb-6 mt-2 text-slate-600">Tell us about your site and which hardware you need.</p>
          <LeadForm key={selected} type="PRODUCT" subject={selected || 'Hardware'} submitLabel="Register interest" messageLabel="About your site and what you need" />
        </section>
      </div>
    </>
  )
}
