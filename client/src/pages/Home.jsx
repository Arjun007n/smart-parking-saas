import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SITE } from '../config/site'
import { FEATURES, GATE_FLOW, PLANS, PRODUCTS, WORKFLOW } from '../data/site'
import PlanCalculator from '../components/public/PlanCalculator'
import { DashboardMock, HardwareArt, HeroScene, Icon, IconBadge, OldTicket, PhoneMock, Seal } from '../components/public/Art'
import { usePageTitle } from '../hooks/usePageTitle'
import { Reveal, CountUp } from '../components/motion'
import { statsApi, testimonialApi } from '../services/api'

const FEATURE_ICON = {
  'Entry and exit': 'car',
  'Automatic fee calculation': 'rupee',
  'Payments and receipts': 'printer',
  'Live dashboard': 'chart',
  'Shifts and cash reconciliation': 'clock',
  'Reports and export': 'chart',
  'Multi-location': 'pin',
  'Roles and audit log': 'shield',
  'Number plate recognition (ANPR)': 'camera',
  'Passes and bookings': 'pass',
  'Online payment': 'qr',
  'Gate hardware': 'gate',
  'FASTag payments': 'bolt',
  'Valet management': 'users',
}

const HARDWARE_KIND = {
  'Boom barrier': 'barrier',
  'ANPR camera': 'camera',
  'Thermal ticket printer': 'printer',
  'UHF / RFID reader': 'reader',
}

function Heading({ eyebrow, title, intro, center, light }) {
  return (
    <Reveal className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      {eyebrow && <span className={`pub-eyebrow ${light ? '!text-[#ffb866]' : ''}`}>{eyebrow}</span>}
      <h2 className={`pub-title mt-2 ${light ? '!text-white' : ''}`}>{title}</h2>
      {intro && <p className={`mt-3 ${light ? 'text-blue-100' : 'pub-lead'}`}>{intro}</p>}
    </Reveal>
  )
}

function Section({ id, children, className = '' }) {
  return (
    <section id={id} className={`scroll-mt-16 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20">{children}</div>
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
        <section className="pub-night">
          <dl className="mx-auto grid max-w-5xl gap-8 px-4 py-12 text-center sm:grid-cols-2">
            {numbers.map(([label, value]) => (
              <div key={label}>
                <dd className="pub-display text-5xl font-extrabold"><CountUp value={value} format={(n) => Math.round(n).toLocaleString('en-IN')} /></dd>
                <dt className="mt-2 text-sm text-blue-200">{label}</dt>
              </div>
            ))}
          </dl>
        </section>
      )}
      {SITE.clients.length > 0 && (
        <Section className="pub-soft-bg">
          <Heading center eyebrow="Our customers" title="Trusted by parking businesses" />
          <ul className="mt-8 flex flex-wrap justify-center gap-3">
            {SITE.clients.map((name) => (
              <li key={name} className="pub-card pub-card-lift px-6 py-3 text-sm font-semibold text-[#0047ab]">{name}</li>
            ))}
          </ul>
        </Section>
      )}
      {items.length > 0 && (
        <Section>
          <Heading center eyebrow="Testimonials" title="What our customers say" />
          <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item._id} className="pub-card pub-card-lift relative flex flex-col p-7">
                <span aria-hidden="true" className="pub-display absolute right-5 top-2 text-7xl leading-none text-[#d8e6fb]">”</span>
                <p className="relative flex-1 text-[#2c3e5c]">{item.quote}</p>
                <div className="mt-5 flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#1867e1] to-[#0047ab] font-bold text-white">{(item.name || '?').slice(0, 1).toUpperCase()}</span>
                  <div>
                    <p className="text-sm font-semibold text-[#10233f]">{item.name}</p>
                    {(item.role || item.company) && <p className="text-xs text-slate-500">{[item.role, item.company].filter(Boolean).join(' · ')}</p>}
                  </div>
                </div>
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
      {/* Hero */}
      <section className="pub-hero-bg relative overflow-hidden">
        <div aria-hidden="true" className="pub-grid-bg absolute inset-0 opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-10 pt-12 lg:grid-cols-[1fr_1.1fr] lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[#1867e1] shadow-sm ring-1 ring-[#d3e0f5]">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#19b63d]" /> Parking management software
            </span>
            <h1 className="sp-row-in mt-5 text-4xl font-extrabold leading-[1.1] text-[#0047ab] sm:text-5xl lg:text-[3.4rem]">{SITE.tagline}</h1>
            <p className="mt-5 max-w-xl text-lg text-[#4b5d78]">{SITE.description}</p>
            <ul className="mt-6 grid max-w-xl gap-x-6 gap-y-2.5 text-sm font-medium text-[#10233f] sm:grid-cols-2">
              {['Entry, exit and fees in seconds', 'Cash, UPI, card and online payments', 'Passes, bookings and receipts', 'Live dashboard and reports'].map((text) => (
                <li key={text} className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1867e1] text-white"><Icon name="check" className="h-3.5 w-3.5" /></span>
                  {text}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/register" className="pub-btn pub-btn-orange px-7 py-3.5 text-base">
                Get started free <Icon name="arrow" className="h-4 w-4" />
              </Link>
              <Link to="/contact?type=demo" className="pub-btn pub-btn-ghost px-6 py-3.5 text-base">Ask for a demo</Link>
              {SITE.demoVideoUrl && (
                <a href={SITE.demoVideoUrl} target="_blank" rel="noreferrer" className="pub-btn pub-btn-ghost px-6 py-3.5 text-base">
                  <Icon name="video" className="h-5 w-5" /> Watch demo video
                </a>
              )}
            </div>
            {SITE.phone && (
              <p className="mt-4 text-sm text-[#4b5d78]">
                Talk to an expert:{' '}
                <a href={`tel:${SITE.phone.replace(/\s/g, '')}`} className="font-semibold text-[#0047ab] hover:underline">{SITE.phone}</a>
              </p>
            )}
            <p className="mt-3 text-sm text-slate-500">14 days free. No card needed. Works in any web browser.</p>
          </div>
          <div className="relative">
            <div aria-hidden="true" className="pub-dots absolute -right-4 -top-4 h-40 w-40 rounded-full opacity-70" />
            <HeroScene className="relative w-full drop-shadow-[0_30px_40px_rgba(0,71,171,0.28)]" />
            <Seal top="FREE TRIAL" big="14" bottom="DAYS" className="pub-float absolute -top-3 right-2 hidden h-24 w-24 sm:block lg:right-6" />
          </div>
        </div>

        {/* Trust strip */}
        <div className="relative mx-auto max-w-7xl px-4 pb-10">
          <ul className="pub-night grid grid-cols-2 gap-4 rounded-2xl px-5 py-5 shadow-xl shadow-blue-900/20 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['clock', 'Fast entry and exit', 'A ticket in seconds'],
              ['card', 'Cashless payments', 'UPI, card, online link'],
              ['chart', 'Real-time tracking', 'Live occupancy'],
              ['pin', 'Many locations', 'One company account'],
              ['shield', 'Roles and audit log', 'Every action recorded'],
              ['lock', 'Secure by design', 'Access by permission'],
            ].map(([icon, title, text]) => (
              <li key={title} className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#ffb866]"><Icon name={icon} className="h-5 w-5" /></span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-xs text-blue-200">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Manual to digital */}
      <Section>
        <Heading center eyebrow="Leave the paper behind" title="From manual parking ticket to app-based parking management" intro="Paper tickets get lost, smudged and miscounted. Every vehicle here is recorded, priced and paid for on screen." />
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal className="mx-auto text-center">
            <span className="inline-block rounded-md bg-[#fff1e6] px-4 py-1.5 text-xs font-extrabold tracking-wider text-[#c25a00] ring-1 ring-[#ffd2a8]">OLD MANUAL TICKETING</span>
            <OldTicket className="mx-auto mt-4 w-64 -rotate-3" />
          </Reveal>
          <div aria-hidden="true" className="hidden items-center lg:flex">
            <span className="h-1 w-24 rounded bg-gradient-to-r from-[#fc7800] to-[#1867e1]" />
            <Icon name="arrow" className="-ml-1 h-8 w-8 text-[#1867e1]" />
          </div>
          <Reveal className="mx-auto grid items-center gap-6 sm:grid-cols-[auto_1fr]" delay={120}>
            <PhoneMock className="mx-auto w-44 drop-shadow-[0_24px_30px_rgba(0,71,171,0.3)]" />
            <ul className="grid gap-3">
              {[
                ['clock', 'Faster entry and exit', 'No writing, no counting change.'],
                ['shield', 'Secure and reliable', 'Every ticket tied to a person and a shift.'],
                ['chart', 'Real-time tracking', 'See who is inside, right now.'],
                ['rupee', 'Cashless payments', 'UPI, card and an online pay link.'],
              ].map(([icon, title, text]) => (
                <li key={title} className="pub-card pub-card-lift flex items-center gap-3 p-3.5">
                  <IconBadge name={icon} className="!h-11 !w-11 shrink-0" />
                  <span className="leading-snug">
                    <span className="block text-sm font-semibold text-[#10233f]">{title}</span>
                    <span className="block text-xs text-slate-500">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* Roles */}
      <section className="pub-soft-bg">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <Heading center eyebrow="One system" title="Everything between the entry gate and the bank" intro="One system for the people at the gate and the people who own the business." />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ['users', 'For operators', 'A ticket in seconds, the fee worked out for them, and a clear screen for taking payment.'],
              ['chart', 'For managers', 'Who is inside, how full each site is, and what every shift collected, as it happens.'],
              ['rupee', 'For owners', 'Revenue you can trust: every payment tied to a ticket, a person and a shift.'],
            ].map(([icon, title, text]) => (
              <Reveal key={title}>
                <div className="pub-card pub-card-lift h-full p-7">
                  <IconBadge name={icon} />
                  <h3 className="mt-5 text-xl font-semibold text-[#10233f]">{title}</h3>
                  <p className="mt-2 text-[#4b5d78]">{text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <Section id="features" className="relative">
        <div aria-hidden="true" className="pub-dots absolute left-0 top-10 h-56 w-56 opacity-50" />
        <Heading center eyebrow="Powerful features" title="See every capability" intro="What you get today, and what we are building next." />
        <div className="relative mt-12 grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
          <ul className="grid gap-4 sm:grid-cols-2">
            {available.map((feature) => (
              <li key={feature.title} className="pub-card pub-card-lift flex gap-4 p-5">
                <IconBadge name={FEATURE_ICON[feature.title] || 'check'} className="shrink-0" />
                <div>
                  <h3 className="font-semibold text-[#10233f]">{feature.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#4b5d78]">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="lg:sticky lg:top-24">
            <div className="pub-card p-3 shadow-2xl shadow-blue-900/15">
              <DashboardMock className="w-full" />
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">The admin dashboard: occupancy, entries, revenue and hourly traffic.</p>
          </div>
        </div>

        <div className="mt-16">
          <h3 className="text-xl font-semibold text-[#10233f]">On the roadmap</h3>
          <p className="mt-1 text-sm text-[#4b5d78]">Not available yet, or only partly. Tell us which matters to you and we will keep you posted.</p>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2">
            {planned.map((feature) => (
              <li key={feature.title} className="flex gap-4 rounded-2xl border-2 border-dashed border-[#c9d9f2] bg-[#f7faff] p-5">
                <IconBadge name={FEATURE_ICON[feature.title] || 'check'} className="shrink-0 opacity-70" />
                <div>
                  <span className="rounded-full bg-[#e4edfb] px-2.5 py-0.5 text-xs font-semibold text-[#0047ab]">Coming later</span>
                  <h4 className="mt-2 font-semibold text-[#10233f]">{feature.title}</h4>
                  <p className="mt-1 text-sm text-[#4b5d78]">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* How a visit works */}
      <section className="pub-soft-bg">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <Heading center eyebrow="How it works" title="How a visit works" intro="Four steps, the same at every location." />
          <ol className="relative mt-12 grid gap-8 md:grid-cols-4">
            <span aria-hidden="true" className="absolute left-[12%] right-[12%] top-7 hidden h-0.5 bg-gradient-to-r from-[#1867e1] via-[#7a3fd2] to-[#fc7800] opacity-40 md:block" />
            {WORKFLOW.map((step, i) => (
              <li key={step.title} className="relative text-center">
                <span aria-hidden="true" className="pub-display relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1867e1] to-[#0047ab] text-2xl font-bold text-white shadow-lg shadow-blue-600/30">{i + 1}</span>
                <h3 className="mt-5 text-lg font-semibold text-[#10233f]">{step.title}</h3>
                <p className="mt-2 text-sm text-[#4b5d78]">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Software and hardware */}
      <section className="pub-night relative overflow-hidden">
        <div aria-hidden="true" className="pub-grid-bg absolute inset-0 opacity-20" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <Heading light center eyebrow="Gate automation" title="Software and hardware, working together" intro="From the vehicle arriving to the exit barrier opening, every step is connected." />
          <ol className="mt-12 grid gap-5 md:grid-cols-4">
            {GATE_FLOW.map((step, i) => (
              <li key={step.title} className="relative rounded-2xl bg-white/10 p-6 ring-1 ring-white/15 backdrop-blur">
                <span aria-hidden="true" className="pub-display flex h-10 w-10 items-center justify-center rounded-full bg-[#fc7800] text-lg font-bold text-white">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-blue-100">{step.text}</p>
                {i < GATE_FLOW.length - 1 && <Icon name="arrow" className="absolute -right-4 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-[#ffb866] md:block" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Proof />

      {/* Pricing */}
      <Section id="subscription" className="pub-soft-bg">
        <Heading center eyebrow="Plans" title="Choose your subscription plan" intro="Start with the free trial. Move to a paid plan when you are ready." />
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`pub-card pub-card-lift relative flex flex-col p-6 ${plan.highlighted ? '!border-2 !border-[#1867e1] shadow-xl shadow-blue-900/10' : ''}`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-6 rounded-full bg-[#fc7800] px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow">Most chosen</span>
              )}
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-[#10233f]">
                {plan.name}
                {plan.comingLater && <span className="rounded-full bg-[#e4edfb] px-2.5 py-0.5 text-xs font-semibold text-[#0047ab]">Coming later</span>}
              </h3>
              <p className="pub-display mt-3 text-2xl font-bold text-[#0047ab]">{plan.price || 'Contact us for pricing'}</p>
              {plan.note && <p className="mt-1 text-xs text-slate-500">{plan.note}</p>}
              <p className="mt-3 text-sm text-[#4b5d78]">{plan.summary}</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-[#2c3e5c]">
                {plan.limits.map((limit) => (
                  <li key={limit} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#e1f8e8] text-[#19b63d]"><Icon name="check" className="h-3.5 w-3.5" /></span>
                    {limit}
                  </li>
                ))}
              </ul>
              <Link to={plan.cta.to} className={`pub-btn mt-7 w-full ${plan.highlighted ? 'pub-btn-orange' : 'pub-btn-ghost'}`}>
                {plan.cta.label}
              </Link>
            </div>
          ))}
        </div>
        <div className="mt-10"><PlanCalculator /></div>
        <p className="mt-6 text-center text-sm text-slate-500">Prices are before applicable taxes.</p>
      </Section>

      {/* App in action */}
      <Section>
        <Heading center eyebrow="On every screen" title="Experience the power in action" intro="The admin sees the whole business. The operator sees one clear screen for the gate." />
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1.5fr_1fr]">
          <Reveal>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#1867e1]">Admin view</p>
            <div className="pub-card p-3 shadow-xl shadow-blue-900/10"><DashboardMock className="w-full" /></div>
          </Reveal>
          <Reveal delay={120}>
            <p className="mb-3 text-center text-sm font-semibold uppercase tracking-wider text-[#fc7800]">Operator view</p>
            <PhoneMock className="mx-auto w-56 drop-shadow-[0_28px_34px_rgba(0,71,171,0.3)]" />
          </Reveal>
        </div>
      </Section>

      {/* Hardware */}
      <section className="pub-soft-bg">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <Heading center eyebrow="Hardware" title="Gate hardware, supplied and installed" intro="We supply and install the gate hardware for you: boom barrier, ANPR camera, ticket printer and readers. We connect it all to the software, so the gate can run by itself." />
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCTS.filter((p) => p.available).slice(0, 4).map((product) => (
              <li key={product.name} className="pub-card pub-card-lift overflow-hidden">
                <div className="pub-hero-bg flex h-40 items-center justify-center">
                  <HardwareArt kind={HARDWARE_KIND[product.name] || 'reader'} className="h-32 w-auto" />
                </div>
                <div className="p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#1867e1]">{product.category}</p>
                  <h3 className="mt-1 font-semibold text-[#10233f]">{product.name}</h3>
                  <p className="mt-2 text-sm text-[#4b5d78]">{product.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 text-center">
            <Link to="/product" className="pub-btn pub-btn-blue">See all hardware <Icon name="arrow" className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="pub-night relative overflow-hidden">
        <div aria-hidden="true" className="pub-dots absolute inset-y-0 right-0 w-1/3 opacity-20" />
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-16">
          <div>
            <h2 className="pub-display text-3xl font-bold">Ready to see it with your own parking?</h2>
            <p className="mt-2 text-blue-100">Set up your first location in a few minutes, or talk to us first.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/register" className="pub-btn pub-btn-orange px-7 py-3.5 text-base">Get started free</Link>
            <Link to="/contact" className="pub-btn border-2 border-white/70 px-7 py-3.5 text-base text-white hover:bg-white/10">Contact us</Link>
          </div>
        </div>
      </section>
    </>
  )
}
