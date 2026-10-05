import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { companyApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { companySchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader } from '../../components/ui'

const toForm = (c) => ({
  name: c.name || '',
  legalName: c.legalName || '',
  businessType: c.businessType || '',
  gstNumber: c.gstNumber || '',
  billingName: c.billingContact?.name || '',
  billingEmail: c.billingContact?.email || '',
  billingPhone: c.billingContact?.phone || '',
  line1: c.address?.line1 || '',
  city: c.address?.city || '',
  state: c.address?.state || '',
  pincode: c.address?.pincode || '',
})

function CompanyForm({ company }) {
  const queryClient = useQueryClient()
  const { setCompany } = useAuth()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(companySchema), defaultValues: toForm(company) })

  const save = useMutation({
    mutationFn: (v) =>
      companyApi.update(company._id, {
        name: v.name,
        legalName: v.legalName,
        businessType: v.businessType,
        gstNumber: v.gstNumber,
        billingContact: {
          name: v.billingName,
          phone: v.billingPhone,
          ...(v.billingEmail ? { email: v.billingEmail } : {}),
        },
        address: { line1: v.line1, city: v.city, state: v.state, pincode: v.pincode },
      }),
    onSuccess: (updated) => {
      setCompany(updated)
      queryClient.setQueryData(['company', company._id], updated)
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-6" noValidate>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Alert type="success">{save.isSuccess && 'Company details saved.'}</Alert>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900">Business</legend>
        <Field label="Company name" error={errors.name?.message} {...register('name')} />
        <Field label="Legal name" error={errors.legalName?.message} {...register('legalName')} />
        <Field label="Business type" placeholder="Mall, hospital, operator…" error={errors.businessType?.message} {...register('businessType')} />
        <Field label="GSTIN" placeholder="15 characters" error={errors.gstNumber?.message} {...register('gstNumber')} />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900">Billing contact</legend>
        <Field label="Contact name" error={errors.billingName?.message} {...register('billingName')} />
        <Field label="Contact email" type="email" error={errors.billingEmail?.message} {...register('billingEmail')} />
        <Field label="Contact phone" type="tel" error={errors.billingPhone?.message} {...register('billingPhone')} />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900">Address</legend>
        <Field label="Address" error={errors.line1?.message} {...register('line1')} />
        <Field label="City" error={errors.city?.message} {...register('city')} />
        <Field label="State" error={errors.state?.message} {...register('state')} />
        <Field label="Pincode" inputMode="numeric" error={errors.pincode?.message} {...register('pincode')} />
      </fieldset>

      <Button type="submit" loading={save.isPending}>
        Save changes
      </Button>
    </form>
  )
}

const splitAddresses = (text) => text.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean)

// Switch the end-of-day report email on or off, choose who gets it and when.
function ReportEmail({ companyId }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['company', companyId, 'report-email'], queryFn: () => companyApi.reportEmail(companyId) })
  const [draft, setDraft] = useState(null)
  const saved = query.data
  const form = draft || (saved && { enabled: saved.enabled, recipients: saved.recipients.join(', '), sendAt: saved.sendAt })

  const save = useMutation({
    mutationFn: (v) => companyApi.updateReportEmail(companyId, { enabled: v.enabled, recipients: splitAddresses(v.recipients), sendAt: v.sendAt }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['company', companyId, 'report-email'], updated)
      setDraft(null)
    },
  })
  const test = useMutation({ mutationFn: () => companyApi.testReportEmail(companyId) })

  if (query.isLoading) return <PageLoader />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  const change = (patch) => setDraft({ ...form, ...patch })

  return (
    <div className="space-y-4">
      {!saved.emailAvailable && <Alert type="info">Email is not set up on the server yet, so nothing can be sent. You can still choose the settings.</Alert>}
      <p className="text-sm text-slate-600">
        Every day, at the time you choose, we email what happened that day at each location: vehicles in and out, money collected by method,
        passes sold and vehicles still inside.
      </p>
      <Checkbox label="Send me the end-of-day report" checked={form.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send at (local time)" type="time" value={form.sendAt} onChange={(e) => change({ sendAt: e.target.value })} />
        <Field
          label="Send to" placeholder="a@example.com, b@example.com" value={form.recipients}
          hint="Separate addresses with commas. Leave empty to send to every company admin."
          onChange={(e) => change({ recipients: e.target.value })}
        />
      </div>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Alert>{test.error && errorMessage(test.error)}</Alert>
      <Alert type="success">{save.isSuccess && !draft && 'Saved.'}</Alert>
      <Alert type="success">{test.isSuccess && `A test report was sent to ${test.data.sentTo.join(', ')}.`}</Alert>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => save.mutate(form)} loading={save.isPending} disabled={!draft}>Save</Button>
        <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={Boolean(draft)}>Email me a test report</Button>
      </div>
    </div>
  )
}

export default function Company() {
  const { company: sessionCompany } = useAuth()
  const { data: company, isLoading, error } = useQuery({
    queryKey: ['company', sessionCompany._id],
    queryFn: () => companyApi.get(sessionCompany._id),
  })

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Company</h1>

      <Card title="Plan and subscription" action={<Link to="/dashboard/billing" className="text-sm font-semibold text-blue-700 hover:underline">Buy or renew a plan</Link>}>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="mt-1"><Badge tone="blue">{company.subscriptionStatus}</Badge></dd>
          </div>
          <div>
            <dt className="text-slate-500">Plan</dt>
            <dd className="mt-1 font-semibold text-slate-900">{company.plan.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Locations allowed</dt>
            <dd className="mt-1 font-semibold text-slate-900">{company.plan.maxLocations}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Users allowed</dt>
            <dd className="mt-1 font-semibold text-slate-900">{company.plan.maxUsers}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Daily report email">
        <ReportEmail companyId={company._id} />
      </Card>

      <Card title="Company details">
        <CompanyForm key={company.updatedAt} company={company} />
      </Card>
    </div>
  )
}
