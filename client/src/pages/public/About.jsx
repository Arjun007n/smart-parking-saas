import { Link } from 'react-router-dom'
import { SITE } from '../../config/site'
import { FEATURES } from '../../data/site'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'

export default function About() {
  usePageTitle('About us')

  return (
    <>
      <PageHeader title="About us" intro={SITE.description} />
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-12">
        <section>
          <h2 className="text-2xl font-bold text-slate-900">Our mission</h2>
          <p className="mt-3 text-lg text-slate-700">{SITE.about.mission}</p>
        </section>

        {SITE.about.story && (
          <section>
            <h2 className="text-2xl font-bold text-slate-900">Our story</h2>
            <p className="mt-3 whitespace-pre-line text-slate-700">{SITE.about.story}</p>
          </section>
        )}

        <section>
          <h2 className="text-2xl font-bold text-slate-900">What the product does</h2>
          <p className="mt-3 text-slate-700">
            {SITE.name} is a complete operating system for paid parking. It covers the whole visit, from the
            ticket at entry to the receipt at exit, and gives owners the figures to run the business.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {FEATURES.filter((f) => f.available).map((feature) => (
              <li key={feature.title} className="flex gap-2 text-slate-700">
                <span aria-hidden="true" className="font-bold text-green-700">✓</span>
                {feature.title}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-900">How we build it</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-700">
            <li>Manual operations first. Everything works with a phone or a computer, before any hardware.</li>
            <li>The fee is always calculated by the system, so the amount never depends on who is at the gate.</li>
            <li>Each company's data is kept separate, and every important action is recorded.</li>
          </ul>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link to="/register" className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700">Start free trial</Link>
          <Link to="/contact" className="rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-800 hover:bg-slate-50">Contact us</Link>
        </div>
      </div>
    </>
  )
}
