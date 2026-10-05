import { Link } from 'react-router-dom'
import { SITE } from '../config/site'
import { FEATURES, GATE_FLOW, PLANS, PRODUCTS, WORKFLOW } from '../data/site'
import PlanCalculator from '../components/public/PlanCalculator'
import { usePageTitle } from '../hooks/usePageTitle'
import { useQuery } from '@tanstack/react-query'
import { Reveal, CountUp } from '../components/motion'
import { statsApi, testimonialApi } from '../services/api'

const primary = 'sp-press inline-block rounded-lg bg-gradient-to-r from-[#007bff] to-[#0056b3] px-6 py-3 font-semibold text-white shadow hover:brightness-110'
const secondary = 'inline-block rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-800 hover:bg-slate-50'

function Section({ id, title, intro, children, tinted }) {
  return (
    <section id={id} className={`scroll-mt-4 ${tinted ? 'bg-slate-50' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Reveal>
          <h2 className="text-2xl font-extrabold text-[#0b4ea2] sm:text-3xl">{title}</h2>
          {intro && <p className="mt-3 max-w-2xl text-slate-600">{intro}</p>}
        </Reveal>
        <Reveal className="mt-8" delay={100}>{children}</Reveal>
      </div>
    </section>
  )
}

// Real numbers and real quotes only. Each block stays hidden until there is something true to show.
function Proof() {
  const stats = useQuery({ queryKey: ['public-stats'], queryFn: statsApi.get, staleTime: 10 * 60_000, retry: false })
  const quotes = useQuery({ queryKey: ['testimonials'], queryFn: testimonialApi.list, staleTime: 5 * 60_000, retry: false })
  const numbers = [
    ['Parking locations using the platform', stats.data?.locations],
    ['Vehicles handled in the last 30 days', stats.data?.vehicles30d],
  ].filter(([, value]) => value > 0)
  const items = quotes.data || []

  return (
    <>
      {numbers.length > 0 && (
        <section className="bg-[#0b2a55] text-white">
          <dl className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-center sm:grid-cols-2">
            {numbers.map(([label, value]) => (
              <div key={label}>
                <dd className="text-4xl font-extrabold"><CountUp value={value} format={(n) => Math.round(n).toLocaleString('en-IN')} /></dd>
                <dt className="mt-1 text-sm text-blue-200">{label}</dt>
              </div>
            ))}
          </dl>
        </section>
      )}
      {SITE.clients.length > 0 && (
        <Section title="Trusted by parking businesses" tinted>
          <ul className="flex flex-wrap gap-3">
            {SITE.clients.map((name) => (
              <li key={name} className="sp-lift rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#1e3d73] shadow-sm ring-1 ring-slate-200">{name}</li>
            ))}
          </ul>
        </Section>
      )}
      {items.length > 0 && (
        <Section title="What our customers say">
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item._id} className="sp-lift flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="flex-1 text-slate-700">“{item.quote}”</p>
                <p className="mt-4 text-sm font-semibold text-slate-900">{item.name}</p>
                {(item.role || item.company) && <p className="text-xs text-slate-500">{[item.role, item.company].filter(Boolean).join(' · ')}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

export default function Home() {
  usePageTitle('')
  const available = FEATURES.filter((f) => f.available)
  const planned = FEATURES.filter((f) => !f.available)

  return (
    <>
      <section className="bg-gradient-to-br from-[#eaf3ff] via-white to-[#dcebff] text-slate-900">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <p className="text-sm font-bold uppercase tracking-wide text-[#007bff]">Parking management software</p>
          <h1 className="sp-row-in mt-3 max-w-3xl text-4xl font-extrabold leading-tight text-[#0b4ea2] sm:text-5xl">{SITE.tagline}</h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600">{SITE.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className={primary}>Start free trial</Link>
            <Link to="/contact?type=demo" className="inline-block rounded-lg border-2 border-[#007bff] px-6 py-3 font-semibold text-[#007bff] hover:bg-blue-50">
              Ask for a demo
            </Link>
            {SITE.demoVideoUrl && (
              <a href={SITE.demoVideoUrl} target="_blank" rel="noreferrer" className="inline-block rounded-lg px-4 py-3 font-semibold text-[#0b4ea2] hover:underline">
                ▶ Watch demo video
              </a>
            )}
            {SITE.phone && (
              <a href={`tel:${SITE.phone.replace(/\s/g, '')}`} className="inline-block rounded-lg px-4 py-3 font-semibold text-[#0b4ea2] hover:underline">
                Talk to an expert: {SITE.phone}
              </a>
            )}
          </div>
          <p className="mt-4 text-sm text-slate-500">14 days free. No card needed. Works in any web browser.</p>
        </div>
      </section>

      <Section title="Everything between the entry gate and the bank" intro="One system for the people at the gate and the people who own the business.">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['For operators', 'A ticket in seconds, the fee worked out for them, and a clear screen for taking payment.'],
            ['For managers', 'Who is inside, how full each site is, and what every shift collected, as it happens.'],
            ['For owners', 'Revenue you can trust: every payment tied to a ticket, a person and a shift.'],
          ].map(([title, text]) => (
            <div key={title} className="sp-lift rounded-xl border border-slate-200 p-6">
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="features" title="Features" intro="What you get today, and what we are building next." tinted>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {available.map((feature) => (
            <li key={feature.title} className="sp-lift rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h3 className="font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{feature.text}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-12 text-lg font-semibold text-slate-900">On the roadmap</h3>
        <p className="mt-1 text-sm text-slate-600">Not available yet, or only partly. Tell us which matters to you and we will keep you posted.</p>
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

      <Section title="Software and hardware, working together" intro="From the vehicle arriving to the exit barrier opening, every step is connected.">
        <ol className="grid gap-4 md:grid-cols-4">
          {GATE_FLOW.map((step, i) => (
            <li key={step.title} className="sp-lift relative rounded-xl border border-slate-200 bg-white p-5">
              <span aria-hidden="true" className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#007bff] to-[#0056b3] text-sm font-bold text-white">{i + 1}</span>
              <h3 className="font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.text}</p>
              {i < GATE_FLOW.length - 1 && <span aria-hidden="true" className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-xl text-[#007bff] md:block">→</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Proof />

      <Section id="subscription" title="Pricing" intro="Start with the free trial. Move to a paid plan when you are ready." tinted>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`sp-lift flex flex-col rounded-xl bg-white p-6 shadow-sm ring-1 ${plan.highlighted ? 'ring-2 ring-blue-600' : 'ring-slate-200'}`}
            >
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
                {plan.name}
                {plan.comingLater && <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">Coming later</span>}
              </h3>
              <p className="mt-2 text-2xl font-bold text-slate-900">{plan.price || 'Contact us for pricing'}</p>
              {plan.note && <p className="mt-1 text-xs text-slate-500">{plan.note}</p>}
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
        <div className="mt-10"><PlanCalculator /></div>
        <p className="mt-6 text-sm text-slate-600">Prices are before applicable taxes.</p>
      </Section>

      <Section title="Hardware" intro="We supply and install the gate hardware for you: boom barrier, ANPR camera, ticket printer and readers. We connect it all to the software, so the gate can run by itself.">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.filter((p) => p.available).slice(0, 4).map((product) => (
            <li key={product.name} className="sp-lift rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.category}</p>
              <h3 className="mt-1 font-semibold text-slate-900">{product.name}</h3>
              <p className="mt-2 text-sm text-slate-600">{product.text}</p>
            </li>
          ))}
        </ul>
        <Link to="/product" className="mt-6 inline-block font-semibold text-blue-700 hover:underline">
          See all hardware →
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
