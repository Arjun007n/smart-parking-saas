import { useDeferredValue, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { passCompanyApi, passInvoiceApi, passUserApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, Button, PageLoader } from '../../components/ui'
import InvoiceSheet from '../../components/pass/InvoiceSheet'
import { printInvoice } from '../../utils/printInvoice'
import { ExportButtons, Modal, PageTitle, Pager, SearchBox, ShowEntries, Toolbar } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'

const FILTER = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2'

// The saved invoice in a window, with Print.
export function InvoiceView({ id, onClose }) {
  const invoice = useQuery({ queryKey: ['pass-invoice', id], queryFn: () => passInvoiceApi.get(id) })
  return (
    <Modal title="Pass Invoice" wide onClose={onClose}>
      {invoice.isLoading ? <PageLoader /> : invoice.error ? <Alert>{errorMessage(invoice.error)}</Alert> : <InvoiceSheet invoice={invoice.data} />}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="dark" disabled={!invoice.data} onClick={printInvoice}>Print</Button>
        <Button type="button" variant="danger" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

// Pass Management > Manage Invoice ("Invoice List"): the GST invoices made from passes.
export default function PassInvoices() {
  const tableRef = useRef(null)
  const { locations } = useMyLocations()
  const [state, patch, setPage] = useListState({ locationId: '', passCompanyId: '', passUserId: '', q: '' })
  const [viewing, setViewing] = useState('')
  const q = useDeferredValue(state.q.trim())
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const users = useQuery({ queryKey: ['pass-user-options'], queryFn: passUserApi.options })
  const query = {
    ...(state.locationId ? { locationId: state.locationId } : {}), ...(state.passCompanyId ? { passCompanyId: state.passCompanyId } : {}),
    ...(state.passUserId ? { passUserId: state.passUserId } : {}), ...(q ? { q } : {}), limit: state.limit, page: state.page,
  }
  const list = useQuery({ queryKey: ['pass-invoices', query], queryFn: () => passInvoiceApi.list(query), placeholderData: keepPreviousData })
  const download = useMutation({ mutationFn: (format) => passInvoiceApi.download({ ...query, page: undefined, limit: undefined }, format) })
  const data = list.data

  return (
    <div className="space-y-5">
      <PageTitle title="Invoice List" />
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Location Name
            <select className={FILTER} value={state.locationId} onChange={(e) => patch({ locationId: e.target.value })}>
              <option value="">All Location</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Company Name
            <select className={FILTER} value={state.passCompanyId} onChange={(e) => patch({ passCompanyId: e.target.value })}>
              <option value="">All Company</option>
              <option value="none">No Company OR N/A</option>
              {(companies.data?.companies || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">User Name / Mobile
            <select className={FILTER} value={state.passUserId} onChange={(e) => patch({ passUserId: e.target.value })}>
              <option value="">All Pass User</option>
              {(users.data?.users || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.mobile || '—'})</option>)}
            </select>
          </label>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} />
          <SearchBox label="Search by Invoice No. / User Name" value={state.q} onChange={(value) => patch({ q: value })} />
        </div>
        <Toolbar>
          <Link to={`${PM}/invoices/new`} className="rounded-lg bg-[#28a745] px-4 py-2 text-sm font-semibold text-white hover:bg-[#218838]">+ Generate Pass Invoice</Link>
          <ExportButtons onDownload={(format) => download.mutate(format)} pending={download.isPending} disabled={!data || data.invoices.length === 0} onPrint={() => printTable(tableRef.current, 'Invoice List')} />
        </Toolbar>
        <Alert>{list.error ? errorMessage(list.error) : download.error ? errorMessage(download.error) : ''}</Alert>
        {list.isLoading ? (
          <PageLoader />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table ref={tableRef} className="w-full min-w-[960px] border border-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>{['SNo', 'Invoice Date', 'Invoice Number', 'User Name', 'Company Name', 'Location', 'No of Vehicle', 'Taxable Amount', 'Tax', 'Total Amount', 'Action'].map((h) => <th key={h} className="whitespace-nowrap p-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.invoices.length === 0 && <tr><td colSpan={11} className="p-4 text-center text-slate-500">No invoices yet.</td></tr>}
                  {data.invoices.map((inv, i) => (
                    <tr key={inv._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                      <td className="p-2">{(data.page - 1) * data.pageSize + i + 1}</td>
                      <td className="whitespace-nowrap p-2">{new Date(inv.invoiceDate).toLocaleDateString('en-GB').replaceAll('/', '-')}</td>
                      <td className="p-2 font-medium">{inv.invoiceNumber}</td>
                      <td className="p-2">{inv.userName || 'N/A'}</td>
                      <td className="p-2">{inv.company || 'N/A'}</td>
                      <td className="p-2">{inv.location}</td>
                      <td className="p-2">{inv.vehicles}</td>
                      <td className="p-2">{money(inv.taxable)}</td>
                      <td className="p-2">{money(inv.tax)}</td>
                      <td className="p-2 font-medium">{money(inv.total)}</td>
                      <td className="no-print p-2"><Button type="button" className="!px-2 !py-1 !text-xs" onClick={() => setViewing(inv._id)}>View Invoice</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
      {viewing && <InvoiceView id={viewing} onClose={() => setViewing('')} />}
    </div>
  )
}
