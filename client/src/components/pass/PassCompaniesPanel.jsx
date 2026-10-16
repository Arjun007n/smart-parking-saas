import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Textarea } from '../ui'

const EMPTY = { name: '', contactName: '', phone: '', email: '', gstNumber: '', address: '' }

// The company master: the firms, societies and schools that buy passes for their people.
export default function PassCompaniesPanel() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // null = closed, 'new', or a company
  const [form, setForm] = useState(EMPTY)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const list = useQuery({ queryKey: ['pass-companies', q], queryFn: () => passCompanyApi.list(q ? { q } : {}) })
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]))
      return editing === 'new' ? passCompanyApi.create(body) : passCompanyApi.update(editing._id, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pass-companies'] })
      queryClient.invalidateQueries({ queryKey: ['pass-summary'] })
      setEditing(null)
    },
  })
  const toggle = useMutation({
    mutationFn: (company) => passCompanyApi.update(company._id, { isActive: !company.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pass-companies'] }),
  })

  const open = (company) => {
    save.reset()
    setEditing(company)
    setForm(company === 'new' ? EMPTY : Object.fromEntries(Object.keys(EMPTY).map((k) => [k, company[k] || ''])))
  }

  const totals = list.data?.totals

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Search by name" name="pass-company-search" value={q} onChange={(event) => setQ(event.target.value)} className="min-w-56" />
        <Button onClick={() => open('new')}>Add company</Button>
      </div>

      {editing && (
        <Card title={editing === 'new' ? 'New company' : `Edit ${editing.name}`}>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate()
            }}
          >
            <Alert>{save.error && errorMessage(save.error)}</Alert>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Company name" name="pc-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
              <Field label="Contact person" name="pc-contact" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
              <Field label="Phone" name="pc-phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              <Field label="Email (optional)" name="pc-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              <Field label="GST number (optional)" name="pc-gst" autoCapitalize="characters" value={form.gstNumber} onChange={(e) => set({ gstNumber: e.target.value })} />
              <Textarea label="Address (optional)" name="pc-address" rows={2} value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={save.isPending} disabled={form.name.trim().length < 2}>Save</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      {list.isLoading ? (
        <PageLoader />
      ) : (
        <Card title="Companies">
          {totals && (
            <p className="mb-3 text-sm text-slate-600">
              {totals.companies} compan{totals.companies === 1 ? 'y' : 'ies'} · {totals.passes} passes · {totals.vehicles} vehicles · {totals.active} valid now · {money(totals.revenue)} paid
            </p>
          )}
          {list.data.companies.length === 0 ? (
            <p className="text-sm text-slate-500">No companies yet. Add one, then choose it when you sell a pass.</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Company</th>
                    <th className="pb-2 pr-4 font-medium">Contact</th>
                    <th className="pb-2 pr-4 font-medium">GST</th>
                    <th className="pb-2 pr-4 text-right font-medium">Passes</th>
                    <th className="pb-2 pr-4 text-right font-medium">Vehicles</th>
                    <th className="pb-2 pr-4 text-right font-medium">Valid now</th>
                    <th className="pb-2 pr-4 text-right font-medium">Paid</th>
                    <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.companies.map((c) => (
                    <tr key={c._id} className="border-t border-slate-200">
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {c.name} {!c.isActive && <Badge tone="red">Off</Badge>}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {c.contactName || '—'}
                        {c.phone && <span className="block text-slate-500">{c.phone}</span>}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{c.gstNumber || '—'}</td>
                      <td className="py-3 pr-4 text-right">{c.stats.passes}</td>
                      <td className="py-3 pr-4 text-right">{c.stats.vehicles}</td>
                      <td className="py-3 pr-4 text-right">{c.stats.active}</td>
                      <td className="py-3 pr-4 text-right">{money(c.stats.revenue)}</td>
                      <td className="space-x-3 whitespace-nowrap py-3 text-right">
                        <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => open(c)}>Edit</button>
                        <button type="button" className="font-medium text-slate-600 hover:underline" disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>
                          {c.isActive ? 'Switch off' : 'Switch on'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
