import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { locationApi, passApi, passCompanyApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, dateOnly, dateTime, lastDay, money } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader, Select } from '../ui'

// One receipt, laid out to print. Only this block prints (the print-area class).
function Receipt({ row, onClose }) {
  const lines = [
    ['Receipt', row.receiptNumber],
    ['Date', dateTime(row.paidAt)],
    ['Pass', row.passNumber],
    ['For', row.kind === 'RENEWAL' ? 'Renewal' : 'New pass'],
    ['Holder', `${row.holder}${row.phone ? ` (${row.phone})` : ''}`],
    ['Vehicle', row.vehicle],
    row.company && ['Company', `${row.company}${row.companyGst ? ` · GST ${row.companyGst}` : ''}`],
    ['Location', row.location],
    ['Valid', `${dateOnly(row.periodStart)} to ${lastDay(row.periodEnd)}`],
    ['Paid by', `${PAYMENT_LABELS[row.method] || row.method}${row.reference ? ` · ${row.reference}` : ''}`],
  ].filter(Boolean)
  return (
    <div className="print-area rounded-xl border-2 border-dashed border-slate-400 bg-white p-6">
      <p className="text-center text-sm font-semibold uppercase tracking-wide text-slate-600">Pass receipt</p>
      <dl className="mt-4 space-y-1 text-sm">
        {lines.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right font-medium text-slate-900">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
          <dt className="text-slate-500">Taxable value</dt>
          <dd>{money(row.taxable)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Tax (included)</dt>
          <dd>{money(row.tax)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-lg font-bold text-slate-900">
          <dt>Total</dt>
          <dd>{money(row.total)}</dd>
        </div>
      </dl>
      <div className="no-print mt-4 flex gap-2">
        <Button onClick={() => window.print()}>Print</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}

// Every pass sale and renewal, with the amount split into taxable value and tax.
export default function PassReceiptsPanel() {
  const [input, setInput] = useState('')
  const [filters, setFilters] = useState({ from: '', to: '', locationId: '', passCompanyId: '', q: '', page: 1 })
  const [open, setOpen] = useState(null)
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== null))
  const locations = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const list = useQuery({ queryKey: ['pass-invoices', params], queryFn: () => passApi.invoices(params), placeholderData: keepPreviousData })
  const download = useMutation({ mutationFn: (format) => passApi.downloadInvoices({ ...params, page: undefined }, format) })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }))

  return (
    <div className="space-y-4">
      {open && <Receipt row={open} onClose={() => setOpen(null)} />}
      <Card title="Pass receipts" className="no-print">
        <form
          role="search"
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            set({ q: input.trim() })
          }}
        >
          <Field label="From" type="date" name="pr-from" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          <Field label="To" type="date" name="pr-to" min={filters.from} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          {(locations.data || []).length > 1 && (
            <Select className="w-48" label="Location" name="pr-location" value={filters.locationId} onChange={(e) => set({ locationId: e.target.value })}>
              <option value="">All locations</option>
              {locations.data.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </Select>
          )}
          {(companies.data?.companies || []).length > 0 && (
            <Select className="w-48" label="Company" name="pr-company" value={filters.passCompanyId} onChange={(e) => set({ passCompanyId: e.target.value })}>
              <option value="">All companies</option>
              {companies.data.companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          )}
          <Field className="min-w-48" label="Holder, vehicle or pass" name="pr-search" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" loading={list.isFetching}>Search</Button>
          {['csv', 'xlsx', 'pdf'].map((format) => (
            <Button key={format} type="button" variant="secondary" disabled={!data || data.rows.length === 0 || download.isPending} onClick={() => download.mutate(format)}>
              {format === 'xlsx' ? 'Excel' : format.toUpperCase()}
            </Button>
          ))}
        </form>
        {download.error && <Alert>{errorMessage(download.error)}</Alert>}
        {list.error && <Alert>{errorMessage(list.error)}</Alert>}
        {list.isLoading ? (
          <PageLoader />
        ) : data && data.rows.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-slate-600">
              {data.total} receipts · taxable {money(data.totals.taxable)} · tax {money(data.totals.tax)} · <strong>total {money(data.totals.total)}</strong>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Receipt</th>
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Holder</th>
                    <th className="pb-2 pr-4 font-medium">Company</th>
                    <th className="pb-2 pr-4 text-right font-medium">Taxable</th>
                    <th className="pb-2 pr-4 text-right font-medium">Tax</th>
                    <th className="pb-2 pr-4 text-right font-medium">Total</th>
                    <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.receiptNumber} className="border-t border-slate-200">
                      <td className="py-2 pr-4 font-mono text-xs">{r.receiptNumber}</td>
                      <td className="py-2 pr-4">{dateTime(r.paidAt)}</td>
                      <td className="py-2 pr-4 text-slate-600">{r.holder}<span className="block text-xs text-slate-500">{r.vehicle}</span></td>
                      <td className="py-2 pr-4 text-slate-600">{r.company || '—'}</td>
                      <td className="py-2 pr-4 text-right">{money(r.taxable)}</td>
                      <td className="py-2 pr-4 text-right">{money(r.tax)}</td>
                      <td className="py-2 pr-4 text-right font-medium">{money(r.total)}</td>
                      <td className="py-2 text-right">
                        <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => setOpen(r)}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>page {data.page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
                <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
              </div>
            </div>
          </>
        ) : (
          !list.error && <p className="text-sm text-slate-500">No receipts for these filters.</p>
        )}
      </Card>
    </div>
  )
}
