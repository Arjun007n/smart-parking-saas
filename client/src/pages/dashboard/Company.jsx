import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { companyApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { companySchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, Button, Card, Field, PageLoader } from '../../components/ui'

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

      <Card title="Plan and subscription">
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

      <Card title="Company details">
        <CompanyForm key={company.updatedAt} company={company} />
      </Card>
    </div>
  )
}
