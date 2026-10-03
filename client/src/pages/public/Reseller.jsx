import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import LeadForm from '../../components/public/LeadForm'

// The partner (reseller) portal is planned for a later phase. Until it is
// built, this page explains that and collects registrations of interest.
export default function Reseller() {
  usePageTitle('Partners')

  return (
    <>
      <PageHeader
        title="Partner program"
        intro="We are preparing a program for resellers and implementation partners. The partner login is not open yet."
      />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-2">
        <section>
          <h2 className="text-xl font-bold text-slate-900">What partners will be able to do</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-slate-700">
            <li>Introduce parking operators to the platform and help them get started.</li>
            <li>Manage their customers' subscriptions from a partner account.</li>
            <li>Earn commission on the customers they bring.</li>
          </ul>
          <p className="mt-6 text-slate-700">
            These are planned and may change before launch. Register your interest and we will contact you when the
            program opens.
          </p>
        </section>
        <section className="rounded-xl bg-slate-50 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Register as a partner</h2>
          <div className="mt-5">
            <LeadForm type="PARTNER" subject="Partner program" submitLabel="Register interest" messageLabel="About your business and the region you cover" />
          </div>
        </section>
      </div>
    </>
  )
}
