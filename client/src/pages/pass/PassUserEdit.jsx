import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi, passUserApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field, PageLoader, Select } from '../../components/ui'
import { PageTitle } from '../../components/pass/ListKit'
import { PM } from '../../components/pass/listState'

function Form({ holder }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const companies = useQuery({ queryKey: ['pass-companies', 'active'], queryFn: () => passCompanyApi.list({ active: 'true' }) })
  const [form, setForm] = useState({
    name: holder.name || '', passCompanyId: holder.passCompanyId || '', gstNumber: holder.gstNumber || '',
    email: holder.email || '', mobile: holder.mobile || '', address: holder.address || '',
  })
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))
  const save = useMutation({
    mutationFn: () => passUserApi.update(holder._id, {
      name: form.name.trim(), mobile: form.mobile.trim(), address: form.address.trim(), email: form.email.trim(),
      gstNumber: form.gstNumber.trim(), passCompanyId: form.passCompanyId,
    }),
    onSuccess: () => {
      for (const key of ['pass-user', 'pass-users', 'passes', 'pass-vehicle-list']) queryClient.invalidateQueries({ queryKey: [key] })
      navigate(`${PM}/users`)
    },
  })
  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="text-lg font-semibold text-slate-900">Pass User Information</h2>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="User Name *" name="pe-name" maxLength={100} value={form.name} onChange={set('name')} />
        <Select label="Company Name" name="pe-company" value={form.passCompanyId} onChange={set('passCompanyId')}>
          <option value="">Select One/No Company</option>
          {(companies.data?.companies || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </Select>
        <Field label="GSTIN No." name="pe-gst" maxLength={15} autoCapitalize="characters" value={form.gstNumber} onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value.toUpperCase() }))} />
        <Field label="Email" name="pe-email" type="email" maxLength={254} value={form.email} onChange={set('email')} />
        <Field label="Mobile *" name="pe-mobile" inputMode="numeric" maxLength={10} value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))} />
        <Field label="Address *" name="pe-address" maxLength={255} value={form.address} onChange={set('address')} />
      </div>
      <p className="text-xs text-slate-500">The name, mobile, email and company are copied onto this user&apos;s passes.</p>
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} disabled={!form.name.trim() || !form.address.trim() || form.mobile.length !== 10}>Update Profile</Button>
        <Button type="button" variant="secondary" onClick={() => navigate(`${PM}/users`)}>Cancel</Button>
      </div>
    </form>
  )
}

// Pass Management > Pass Users > Edit: "Pass User Edit".
export default function PassUserEdit() {
  const { id } = useParams()
  const user = useQuery({ queryKey: ['pass-user', id], queryFn: () => passUserApi.get(id) })
  if (user.isLoading) return <PageLoader />
  if (user.error) return <Alert>{errorMessage(user.error)}</Alert>
  return (
    <div className="space-y-5">
      <PageTitle title={`Pass User Edit: ${user.data.user.name.toUpperCase()}`} back={PM + '/users'} />
      <Form key={user.data.user.updatedAt} holder={user.data.user} />
    </div>
  )
}
