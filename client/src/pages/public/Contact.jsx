import { useSearchParams } from 'react-router-dom'
import { SITE } from '../../config/site'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import LeadForm from '../../components/public/LeadForm'

export default function Contact() {
  usePageTitle('Contact us')
  const [params] = useSearchParams()
  const isDemo = params.get('type') === 'demo'
  // Only short, plain plan names from our own links are used.
  const plan = /^[A-Za-z ]{1,30}$/.test(params.get('plan') || '') ? params.get('plan') : ''

  // The plan calculator adds the number of users and months it priced.
  const users = Number.parseInt(params.get('users'), 10)
  const months = Number.parseInt(params.get('months'), 10)
  const subject = plan
    ? `${plan} plan${users > 0 && users <= 500 ? ` · ${users} user${users === 1 ? '' : 's'}` : ''}${months > 0 && months <= 60 ? ` · ${months} month${months === 1 ? '' : 's'}` : ''}`
    : undefined

  const details = [
    SITE.email && { label: 'Email', value: SITE.email, href: `mailto:${SITE.email}` },
    SITE.phone && { label: 'Phone', value: SITE.phone, href: `tel:${SITE.phone.replace(/\s/g, '')}` },
    SITE.address && { label: 'Address', value: SITE.address },
    SITE.hours && { label: 'Hours', value: SITE.hours },
  ].filter(Boolean)

  return (
    <>
      <PageHeader
        title={isDemo ? 'Ask for a demo' : 'Contact us'}
        intro={isDemo ? 'Tell us about your parking and we will show you how it would run on the platform.' : 'Questions about the product, pricing or your account? Send us a message.'}
      />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="text-xl font-bold text-slate-900">
            {plan ? `Enquiry about the ${plan} plan` : 'Send us a message'}
          </h2>
          <div className="mt-5">
            <LeadForm
              type={isDemo ? 'DEMO' : 'CONTACT'}
              subject={subject}
              messageLabel={isDemo ? 'About your parking (locations, capacity, current system)' : 'How can we help?'}
            />
          </div>
        </section>

        <aside>
          <h2 className="text-xl font-bold text-slate-900">Other ways to reach us</h2>
          {details.length === 0 ? (
            <p className="mt-4 text-slate-600">Use the form and we will reply by email.</p>
          ) : (
            <dl className="mt-4 space-y-4">
              {details.map((item) => (
                <div key={item.label}>
                  <dt className="text-sm font-medium text-slate-500">{item.label}</dt>
                  <dd className="text-slate-900">
                    {item.href ? <a href={item.href} className="text-blue-700 hover:underline">{item.value}</a> : item.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </aside>
      </div>
    </>
  )
}
