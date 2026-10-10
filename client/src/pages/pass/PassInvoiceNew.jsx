import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi, passInvoiceApi, passUserApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateOnly, lastDay, money } from '../../utils/format'
import { Alert, Button, Field } from '../../components/ui'
import InvoiceSheet from '../../components/pass/InvoiceSheet'
import { printInvoice } from '../../utils/printInvoice'
import { Modal, PageTitle, Pager, SearchBox, ShowEntries } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'

const FILTER = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2'

// The preview of an invoice, with the GST rate editable, and Save to make it for real.
function PreviewModal({ body, onClose, onSaved }) {
  const [rate, setRate] = useState('')
  const preview = useQuery({
    queryKey: ['pass-invoice-preview', body, rate],
    queryFn: () => passInvoiceApi.preview({ ...body, ...(rate !== '' ? { taxPercent: Number(rate) } : {}) }),
  })
  const save = useMutation({
    mutationFn: () => passInvoiceApi.generate({ ...body, taxPercent: preview.data.taxPercent }),
    onSuccess: onSaved,
  })
  return (
    <Modal title="Pass Invoice Print" wide onClose={onClose}>
      {preview.isLoading ? <p>Loading…</p> : preview.error ? <Alert>{errorMessage(preview.error)}</Alert> : (
        <>
          <Alert>{save.error && errorMessage(save.error)}</Alert>
          <div className="mb-3 max-w-[10rem]">
            <Field label="GST %" name="inv-rate" type="number" min="0" max="100" value={rate === '' ? preview.data.taxPercent : rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <InvoiceSheet invoice={preview.data} />
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="dark" disabled={!preview.data} onClick={printInvoice}>Print</Button>
        <Button type="button" loading={save.isPending} disabled={!preview.data || save.isSuccess} onClick={() => save.mutate()}>Save Invoice</Button>
        <Button type="button" variant="danger" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

// Pass Management > Manage Invoice > Generate Pass Invoice: choose the location and company (or a user with
// no company), tick the approved passes that are not billed yet, preview and save the invoice.
export default function PassInvoiceNew() {
  const queryClient = useQueryClient()
  const { locations, defaultId } = useMyLocations()
  const [choice, setChoice] = useState({ locationId: '', passCompanyId: '', passUserId: '' })
  const [chosen, setChosen] = useState([])
  const [problem, setProblem] = useState('')
  const [previewing, setPreviewing] = useState(null)
  const [saved, setSaved] = useState(null)
  const [state, patch, setPage] = useListState({ q: '' })

  const locationId = choice.locationId || defaultId
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const users = useQuery({ queryKey: ['pass-user-options'], queryFn: passUserApi.options })
  const noCompanyUsers = (users.data?.users || []).filter((u) => !u.passCompanyId)
  const ready = Boolean(locationId && choice.passCompanyId && (choice.passCompanyId !== 'none' || choice.passUserId))
  const eligible = useQuery({
    queryKey: ['pass-invoice-eligible', locationId, choice.passCompanyId, choice.passUserId],
    queryFn: () => passInvoiceApi.eligible({ locationId, passCompanyId: choice.passCompanyId, ...(choice.passUserId ? { passUserId: choice.passUserId } : {}) }),
    enabled: ready,
  })

  const needle = state.q.trim().toLowerCase()
  const all = (eligible.data?.passes || []).filter((p) => !needle || `${p.userName} ${p.mobile} ${p.vehicles.join(' ')}`.toLowerCase().includes(needle))
  const rows = all.slice((state.page - 1) * state.limit, state.page * state.limit)
  const allChosen = rows.length > 0 && rows.every((p) => chosen.includes(p._id))
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const toggleAll = () => setChosen((c) => (allChosen ? c.filter((id) => !rows.some((p) => p._id === id)) : [...new Set([...c, ...rows.map((p) => p._id)])]))
  const change = (patchValues) => {
    setChoice((c) => ({ ...c, ...patchValues }))
    setChosen([])
    setSaved(null)
    setProblem('')
  }

  const generate = () => {
    setProblem('')
    if (!locationId) return setProblem('Please select location.')
    if (!choice.passCompanyId) return setProblem('Please select company.')
    if (choice.passCompanyId === 'none' && !choice.passUserId) return setProblem('Please select User Name from dropdown when No Company is selected.')
    if (chosen.length === 0) return setProblem('Please select at least one pass.')
    setPreviewing({ locationId, passCompanyId: choice.passCompanyId, ...(choice.passUserId ? { passUserId: choice.passUserId } : {}), passIds: chosen })
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Create Pass Invoice" back={`${PM}/invoices`} />
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 grid items-end gap-3 sm:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">Location Name
            <select className={FILTER} value={locationId} onChange={(e) => change({ locationId: e.target.value })}>
              <option value="">-Select One-</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Company Name
            <select className={FILTER} value={choice.passCompanyId} onChange={(e) => change({ passCompanyId: e.target.value, passUserId: '' })}>
              <option value="">-Select One-</option>
              <option value="none">No Company OR N/A</option>
              {(companies.data?.companies || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">User Name (with No Company)
            <select className={FILTER} value={choice.passUserId} disabled={choice.passCompanyId !== 'none'} onChange={(e) => change({ passUserId: e.target.value })}>
              <option value="">-Select One-</option>
              {noCompanyUsers.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.mobile || '—'})</option>)}
            </select>
          </label>
          <Button type="button" variant="success" onClick={generate}>Generate Pass Invoice</Button>
        </div>
        <Alert>{problem || (eligible.error && errorMessage(eligible.error))}</Alert>
        {saved && <Alert type="success">Invoice {saved.invoiceNumber} saved for {money(saved.total)}. Find it in the Invoice List.</Alert>}

        {ready && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} />
              <SearchBox value={state.q} onChange={(q) => patch({ q })} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border border-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2"><input type="checkbox" className="h-4 w-4" aria-label="Choose all passes on this page" checked={allChosen} onChange={toggleAll} /></th>
                    {['SNo', 'Company', 'User Name', 'Mobile', 'Email', 'Vehicle No.', 'Vehicle Type', 'Location', 'Start Month', 'Expiry Month', 'Amount', 'Pass Status'].map((h) => <th key={h} className="whitespace-nowrap p-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {eligible.isLoading && <tr><td colSpan={13} className="p-4 text-center text-slate-500">Loading…</td></tr>}
                  {!eligible.isLoading && rows.length === 0 && <tr><td colSpan={13} className="p-4 text-center text-slate-500">No approved passes waiting for an invoice.</td></tr>}
                  {rows.map((p, i) => (
                    <tr key={p._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                      <td className="p-2"><input type="checkbox" className="h-4 w-4" aria-label={`Choose pass ${p.passNumber}`} checked={chosen.includes(p._id)} onChange={() => toggle(p._id)} /></td>
                      <td className="p-2">{(state.page - 1) * state.limit + i + 1}</td>
                      <td className="p-2">{p.company || 'N/A'}</td>
                      <td className="p-2">{p.userName}</td>
                      <td className="p-2">{p.mobile}</td>
                      <td className="p-2">{p.email}</td>
                      <td className="p-2">{p.vehicles.join(', ')}</td>
                      <td className="p-2">{VEHICLE_LABELS[p.vehicleType]}</td>
                      <td className="p-2">{p.locations.length ? p.locations.join(', ') : 'All locations'}</td>
                      <td className="whitespace-nowrap p-2">{dateOnly(p.startDate)}</td>
                      <td className="whitespace-nowrap p-2">{lastDay(p.endDate)}</td>
                      <td className="p-2">{money(p.amount)}</td>
                      <td className="p-2 font-bold text-blue-700">Approved</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={state.page} pageSize={state.limit} total={all.length} onPage={setPage} />
          </>
        )}
      </section>

      {previewing && (
        <PreviewModal
          body={previewing}
          onClose={() => setPreviewing(null)}
          onSaved={(invoice) => {
            setSaved(invoice)
            setPreviewing(null)
            setChosen([])
            for (const key of ['pass-invoice-eligible', 'pass-invoices', 'passes']) queryClient.invalidateQueries({ queryKey: [key] })
          }}
        />
      )}
    </div>
  )
}
