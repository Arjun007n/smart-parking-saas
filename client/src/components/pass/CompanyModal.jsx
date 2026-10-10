import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field, Textarea } from '../ui'
import { Modal } from './ListKit'

const EMPTY = { name: '', address: '', gstNumber: '', contactName: '', phone: '', email: '' }

// "Add Company" / "Edit Company" of the Company Master. `company` is the one being edited (none = add).
// `onSaved(company)` gets the saved record, so the Create Pass form can pick the new company straight away.
export default function CompanyModal({ company, onClose, onSaved }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(company ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, company[k] || ''])) : EMPTY)
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]))
      return company ? passCompanyApi.update(company._id, body) : passCompanyApi.create(body)
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['pass-companies'] })
      queryClient.invalidateQueries({ queryKey: ['pass-user-stats'] })
      if (onSaved) onSaved(saved)
      onClose()
    },
  })
  return (
    <Modal title={company ? 'Edit Company' : 'Add Company'} onClose={onClose}>
      <form
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <Alert>{save.error && errorMessage(save.error)}</Alert>
        <Field label="Company Name *" name="co-name" value={form.name} onChange={set('name')} maxLength={150} />
        <Textarea label={company ? 'Address' : 'Address (Optional)'} name="co-address" rows={2} value={form.address} onChange={set('address')} maxLength={300} />
        <Field label={company ? 'GSTIN No.' : 'GSTIN No (Optional)'} name="co-gst" value={form.gstNumber} onChange={set('gstNumber')} maxLength={15} autoCapitalize="characters" />
        <Field label={company ? 'Contact Person' : 'Contact Person (Optional)'} name="co-contact" value={form.contactName} onChange={set('contactName')} maxLength={100} />
        <Field label={company ? 'Mobile' : 'Mobile (Optional)'} name="co-phone" type="tel" value={form.phone} onChange={set('phone')} maxLength={20} />
        <Field label={company ? 'Email' : 'Company Email (Optional)'} name="co-email" type="email" value={form.email} onChange={set('email')} maxLength={254} />
        <div className="flex justify-end gap-2">
          <Button type="submit" loading={save.isPending} disabled={form.name.trim().length < 2}>{company ? 'Update' : 'Save'}</Button>
          <Button type="button" variant="danger" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}
