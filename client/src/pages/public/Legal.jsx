import { Link } from 'react-router-dom'
import { SITE } from '../../config/site'
import { LEGAL_UPDATED, privacySections, termsSections } from '../../data/legal'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'

function LegalPage({ title, intro, sections }) {
  usePageTitle(title)
  return (
    <>
      <PageHeader title={title} intro={`Last updated ${LEGAL_UPDATED}.`} />
      <article className="mx-auto max-w-3xl px-4 py-12">
        {intro && <p className="mb-8 text-slate-700">{intro}</p>}
        {sections.map((section, index) => (
          <section key={section.title} className="mb-8">
            <h2 className="text-xl font-bold text-[#0b4ea2]">{index + 1}. {section.title}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph} className="mt-3 text-slate-700">{paragraph}</p>
            ))}
            {section.list && (
              <ul className="mt-3 list-disc space-y-2 pl-6 text-slate-700">
                {section.list.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        ))}
        <section className="rounded-xl bg-slate-50 p-5 text-sm text-slate-700">
          <h2 className="font-bold text-slate-900">Contact us</h2>
          <p className="mt-2">
            Questions about this page? {SITE.email ? <>Write to <a className="font-semibold text-blue-700 hover:underline" href={`mailto:${SITE.email}`}>{SITE.email}</a> or use </> : 'Use '}
            the <Link to="/contact" className="font-semibold text-blue-700 hover:underline">contact form</Link>.
          </p>
          {SITE.address && <p className="mt-1">{SITE.legalName || SITE.name}, {SITE.address}</p>}
        </section>
      </article>
    </>
  )
}

export function PrivacyPolicy() {
  return <LegalPage title="Privacy Policy" sections={privacySections(SITE)} />
}

export function Terms() {
  return <LegalPage title="Terms & Conditions" sections={termsSections(SITE)} />
}

// A page that lists every public page, for people (the XML sitemap is for search engines).
const SITE_PAGES = [
  ['Home', '/'],
  ['Book a parking space', '/book'],
  ['Hardware', '/product'],
  ['About us', '/aboutus'],
  ['Frequently asked questions', '/faq'],
  ['Blog', '/blog'],
  ['Contact us', '/contact'],
  ['Partner login', '/ResellerLogin'],
  ['Start free trial', '/register'],
  ['Log in', '/login'],
  ['Privacy Policy', '/privacy-policy'],
  ['Terms & Conditions', '/terms-conditions'],
]

export function SitemapPage() {
  usePageTitle('Sitemap')
  return (
    <>
      <PageHeader title="Sitemap" intro="Every public page of this website." />
      <ul className="mx-auto grid max-w-3xl gap-3 px-4 py-12 sm:grid-cols-2">
        {SITE_PAGES.map(([label, to]) => (
          <li key={to}>
            <Link to={to} className="sp-lift block rounded-xl border border-slate-200 px-4 py-3 font-semibold text-[#1e3d73] hover:text-[#007bff]">{label}</Link>
          </li>
        ))}
      </ul>
    </>
  )
}
