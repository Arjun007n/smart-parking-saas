import { Link } from 'react-router-dom'
import { SITE } from '../config/site'
import { FEATURES, PLANS, PRODUCTS, WORKFLOW } from '../data/site'
import { usePageTitle } from '../hooks/usePageTitle'

const primary = 'inline-block rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700'
const secondary = 'inline-block rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-800 hover:bg-slate-50'

function Section({ id, title, intro, children, tinted }) {
  return (
    <section id={id} className={`scroll-mt-4 ${tinted ? 'bg-slate-50' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h2>
        {intro && <p className="mt-3 max-w-2xl text-slate-600">{intro}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  )
}

export default function Home() {
  usePageTitle('')
  const available = FEATURES.filter((f) => f.available)
  const planned = FEATURES.filter((f) => !f.available)

  return (
    <>
      <section className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">Parking management software</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{SITE.tagline}</h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-300">{SITE.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className={primary}>Start free trial</Link>
            <Link to="/contact?type=demo" className="inline-block rounded-lg border border-slate-500 px-6 py-3 font-semibold text-white hover:bg-slate-800">
              Ask for a demo
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-400">14 days free. No card needed. Works in any web browser.</p>
        </div>
      </section>

      <Section title="Everything between the entry gate and the bank" intro="One system for the people at the gate and the people who own the business.">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['For operators', 'A ticket in seconds, the fee worked out for them, and a clear screen for taking payment.'],
            ['For managers', 'Who is inside, how full each site is, and what every shift collected, as it happens.'],
            ['For owners', 'Revenue you can trust: every payment tied to a ticket, a person and a shift.'],
          ].map(([title, text]) => (
            <div key={title} className="rounded-xl border border-slate-200 p-6">
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="features" title="Features" intro="What you get today, and what we are building next." tinted>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {available.map((feature) => (
            <li key={feature.title} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h3 className="font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{feature.text}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-12 text-lg font-semibold text-slate-900">On the roadmap</h3>
        <p className="mt-1 text-sm text-slate-600">Not available yet. Tell us which matters to you and we will keep you posted.</p>
        <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {planned.map((feature) => (
            <li key={feature.title} className="rounded-xl border border-dashed border-slate-300 p-5">
              <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">Coming later</span>
              <h4 className="mt-3 font-semibold text-slate-900">{feature.title}</h4>
              <p className="mt-2 text-sm text-slate-600">{feature.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="How a visit works" intro="Four steps, the same at every location.">
        <ol className="grid gap-6 md:grid-cols-4">
          {WORKFLOW.map((step, i) => (
            <li key={step.title}>
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="subscription" title="Pricing" intro="Start with the free trial. Move to a paid plan when you are ready." tinted>
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-xl bg-white p-6 shadow-sm ring-1 ${plan.highlighted ? 'ring-2 ring-blue-600' : 'ring-slate-200'}`}
            >
              <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
              <p className="mt-2 text-2xl font-bold text-slate-900">{plan.price || 'Contact us for pricing'}</p>
              <p className="mt-2 text-sm text-slate-600">{plan.summary}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                {plan.limits.map((limit) => (
                  <li key={limit} className="flex gap-2">
                    <span aria-hidden="true" className="font-bold text-green-700">✓</span>
                    {limit}
                  </li>
                ))}
              </ul>
              <Link to={plan.cta.to} className={`mt-6 text-center ${plan.highlighted ? primary : secondary}`}>
                {plan.cta.label}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-600">Prices are before applicable taxes.</p>
      </Section>

      <Section title="Hardware" intro="The software works without any hardware. These integrations are planned for sites that want automation.">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.slice(0, 4).map((product) => (
            <li key={product.name} className="rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.category}</p>
              <h3 className="mt-1 font-semibold text-slate-900">{product.name}</h3>
              <p className="mt-2 text-sm text-slate-600">{product.text}</p>
            </li>
          ))}
        </ul>
        <Link to="/product" className="mt-6 inline-block font-semibold text-blue-700 hover:underline">
          See all planned hardware →
        </Link>
      </Section>

      <section className="bg-blue-700 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14">
          <div>
            <h2 className="text-2xl font-bold">Ready to see it with your own parking?</h2>
            <p className="mt-2 text-blue-100">Set up your first location in a few minutes, or talk to us first.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/register" className="inline-block rounded-lg bg-white px-6 py-3 font-semibold text-blue-800 hover:bg-blue-50">
              Start free trial
            </Link>
            <Link to="/contact" className="inline-block rounded-lg border border-white px-6 py-3 font-semibold text-white hover:bg-blue-800">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
