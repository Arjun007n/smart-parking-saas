import { useDeferredValue, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, Badge, Button, PageLoader } from '../../components/ui'
import CompanyModal from '../../components/pass/CompanyModal'
import { ExportButtons, IconButton, PageTitle, Pager, SearchBox, ShowEntries, Toolbar } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'
import { csvDownload } from '../../utils/csvDownload'

// Pass Management > Company Master ("Company List (Pass Users)"): the firms and societies that buy passes for
// their people, with how many users, passes, vehicles and how much revenue each has.
export default function CompanyMaster() {
  const queryClient = useQueryClient()
  const tableRef = useRef(null)
  const [state, patch, setPage] = useListState({ q: '' })
  const [editing, setEditing] = useState(null) // null = closed, 'new', or a company
  const q = useDeferredValue(state.q.trim())
  const list = useQuery({ queryKey: ['pass-companies', q], queryFn: () => passCompanyApi.list(q ? { q } : {}) })
  const remove = useMutation({
    mutationFn: (company) => passCompanyApi.remove(company._id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pass-companies'] }),
  })
  const toggle = useMutation({
    mutationFn: (company) => passCompanyApi.update(company._id, { isActive: !company.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pass-companies'] }),
  })

  const all = list.data ? list.data.companies : []
  const rows = all.slice((state.page - 1) * state.limit, state.page * state.limit)
  const exportRows = () => csvDownload('company-master.csv', [
    ['Company Name', 'Contact Person Name', 'Mobile No.', 'Email ID', 'Address', 'GST No.', 'Total Pass Users', 'Total Passes', 'Active', 'Expired', 'Total Vehicles', 'Total Revenue'],
    ...all.map((c) => [c.name, c.contactName || '', c.phone || '', c.email || 'N/A', c.address || '', c.gstNumber || 'N/A', c.stats.users, c.stats.passes, c.stats.active, c.stats.expired, c.stats.vehicles, c.stats.revenue]),
  ])

  return (
    <div className="space-y-5">
      <PageTitle title="Company List (Pass Users)" />
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} />
          <SearchBox label="Search by Company" value={state.q} onChange={(value) => patch({ q: value })} />
        </div>
        <Toolbar>
          <Button type="button" variant="success" onClick={() => setEditing('new')}>Create New Company</Button>
          <Button type="button" variant="info" disabled={all.length === 0} onClick={exportRows}>Download Excel</Button>
          <ExportButtons disabled={all.length === 0} onPrint={() => printTable(tableRef.current, 'Company List (Pass Users)')} />
        </Toolbar>
        <Alert>{list.error ? errorMessage(list.error) : remove.error ? errorMessage(remove.error) : toggle.error ? errorMessage(toggle.error) : ''}</Alert>
        {list.isLoading ? (
          <PageLoader />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table ref={tableRef} className="w-full min-w-[1100px] border border-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    {['SN', 'Company Name', 'Contact Person Name', 'Mobile No.', 'Email ID', 'Address', 'GST No.', 'Total Pass Users', 'Total Passes', 'Total Vehicles', 'Total Revenue(₹) (Current)', 'Action'].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={12} className="p-4 text-center text-slate-500">No companies yet. Create one, then choose it when you create a pass.</td></tr>}
                  {rows.map((c, i) => (
                    <tr key={c._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                      <td className="p-2">{(state.page - 1) * state.limit + i + 1}</td>
                      <td className="p-2 font-medium text-slate-900">{c.name} {!c.isActive && <Badge tone="red">Off</Badge>}</td>
                      <td className="p-2">{c.contactName}</td>
                      <td className="p-2">{c.phone}</td>
                      <td className="p-2">{c.email || 'N/A'}</td>
                      <td className="p-2">{c.address}</td>
                      <td className="p-2 font-mono text-xs">{c.gstNumber || 'N/A'}</td>
                      <td className="p-2">{c.stats.users}</td>
                      <td className="p-2">
                        Total: {c.stats.passes}
                        <span className="mt-1 flex gap-1 text-xs font-semibold text-white">
                          <span className="rounded bg-emerald-600 px-1.5 py-0.5">Active: {c.stats.active}</span>
                          <span className="rounded bg-rose-500 px-1.5 py-0.5">Expired: {c.stats.expired}</span>
                        </span>
                      </td>
                      <td className="p-2">{c.stats.vehicles}</td>
                      <td className="whitespace-nowrap p-2">{money(c.stats.revenue)}</td>
                      <td className="no-print p-2">
                        <span className="flex flex-wrap gap-1">
                          <Link className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white" to={`${PM}/users?company=${c._id}`}>View Pass Users</Link>
                          <Link className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white" to={`${PM}/passes?company=${c._id}`}>View Passes</Link>
                          <Link className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white" to={`${PM}/vehicles?company=${c._id}`}>View Vehicles</Link>
                          <IconButton title={`Edit ${c.name}`} onClick={() => setEditing(c)}>Edit</IconButton>
                          <IconButton title={c.isActive ? 'Switch off' : 'Switch on'} disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>{c.isActive ? 'Switch off' : 'Switch on'}</IconButton>
                          <IconButton title={`Delete ${c.name}`} tone="danger" disabled={remove.isPending} onClick={() => window.confirm(`Delete company ${c.name}?`) && remove.mutate(c)}>Delete</IconButton>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={state.page} pageSize={state.limit} total={all.length} onPage={setPage} />
          </>
        )}
      </section>
      {editing && <CompanyModal company={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
