import { useDeferredValue, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi, passUserApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, Button, PageLoader } from '../../components/ui'
import CreatePassForm from '../../components/pass/CreatePassForm'
import { ExportButtons, IconButton, IconLink, Pager, SearchBox, ShowEntries, StatTile, TileGrid, Toolbar } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'

// Pass Management > Pass Users, laid out like ismartparking.com: number tiles, the Create Pass form,
// filters and the user list with its Vehicles / Passes / Edit / Delete buttons.
export default function PassUsers() {
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(params.get('create') === '1')
  const [state, patch, setPage] = useListState({ passCompanyId: params.get('company') || '', userId: '', q: '' })
  const q = useDeferredValue(state.q.trim())
  const tableRef = useRef(null)

  const stats = useQuery({ queryKey: ['pass-user-stats'], queryFn: passUserApi.stats })
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const options = useQuery({ queryKey: ['pass-user-options'], queryFn: passUserApi.options })
  const query = {
    ...(state.passCompanyId ? { passCompanyId: state.passCompanyId } : {}), ...(state.userId ? { userId: state.userId } : {}),
    ...(q ? { q } : {}), limit: state.limit, page: state.page,
  }
  const list = useQuery({ queryKey: ['pass-users', query], queryFn: () => passUserApi.list(query), placeholderData: keepPreviousData })
  const download = useMutation({ mutationFn: (format) => passUserApi.download({ ...query, page: undefined, limit: undefined }, format) })
  const remove = useMutation({
    mutationFn: (user) => passUserApi.remove(user._id),
    onSuccess: () => {
      for (const key of ['pass-users', 'pass-user-stats', 'pass-user-options', 'pass-vehicle-list']) queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
  const confirmDelete = (user) => {
    if (window.confirm(`Delete pass user ${user.name}? Their vehicles are removed with them.`)) remove.mutate(user)
  }

  const s = stats.data
  const data = list.data
  return (
    <div className="space-y-5">
      <TileGrid>
        <StatTile tone="cyan" value={s ? s.companies : '…'} label="Total Company" />
        <StatTile tone="green" value={s ? s.users : '…'} label="Total Pass Users" />
        <StatTile tone="orange" value={s ? s.vehicles : '…'} label="Total Vehicles" />
        <StatTile tone="purple" value={s ? s.passes : '…'} label="Total Passes">
          {s && (
            <p className="mt-1 flex gap-1 text-xs font-semibold">
              <span className="rounded bg-emerald-600 px-1.5 py-0.5">Active: {s.active}</span>
              <span className="rounded bg-rose-500 px-1.5 py-0.5">Expired: {s.expired}</span>
            </p>
          )}
        </StatTile>
        <StatTile tone="dark" value={s ? money(s.activeRevenue) : '…'} label="Current Active Passes Revenue" />
      </TileGrid>

      {creating && <CreatePassForm onClose={() => setCreating(false)} />}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="mb-3 text-lg font-semibold text-slate-900">Pass Users List</h1>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Company
            <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2" value={state.passCompanyId} onChange={(e) => patch({ passCompanyId: e.target.value })}>
              <option value="">All Company</option>
              <option value="none">No Company OR N/A</option>
              {(companies.data?.companies || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Pass User
            <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2" value={state.userId} onChange={(e) => patch({ userId: e.target.value })}>
              <option value="">All Pass User</option>
              {(options.data?.users || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.mobile || '—'})</option>)}
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} />
          <SearchBox value={state.q} onChange={(value) => patch({ q: value })} />
        </div>
        <Toolbar>
          <Button type="button" variant="success" onClick={() => setCreating((open) => !open)}>Create Pass</Button>
          <Link to={`${PM}/bulk-upload`} className="rounded-lg bg-[#28a745] px-4 py-2 text-sm font-semibold text-white hover:bg-[#218838]">Bulk Pass Upload</Link>
          <ExportButtons onDownload={(format) => download.mutate(format)} pending={download.isPending} disabled={!data || data.users.length === 0} onPrint={() => printTable(tableRef.current, 'Pass Users List')} />
        </Toolbar>

        <Alert>{download.error ? errorMessage(download.error) : remove.error ? errorMessage(remove.error) : list.error ? errorMessage(list.error) : ''}</Alert>
        {list.isLoading ? (
          <PageLoader />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table ref={tableRef} className="w-full min-w-[900px] border border-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    {['SN', 'Pass User Name', 'Company Name', 'Mobile No.', 'Email ID', 'Address', 'GST No.', 'Vehicles', 'Passes', 'Action'].map((h) => (
                      <th key={h} className="whitespace-nowrap p-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.users.length === 0 && (
                    <tr><td colSpan={10} className="p-4 text-center text-slate-500">No pass users found.</td></tr>
                  )}
                  {data.users.map((u, i) => (
                    <tr key={u._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                      <td className="p-2">{(data.page - 1) * data.pageSize + i + 1}</td>
                      <td className="p-2 font-medium text-slate-900">{u.name}</td>
                      <td className="p-2">{u.company || 'N/A'}</td>
                      <td className="p-2">{u.mobile}</td>
                      <td className="p-2">{u.email}</td>
                      <td className="p-2">{u.address}</td>
                      <td className="p-2 font-mono text-xs">{u.gstNumber}</td>
                      <td className="p-2">{u.vehicles || '-'}</td>
                      <td className="p-2">{u.passes ? `${u.passes} (${u.active} active)` : '-'}</td>
                      <td className="no-print whitespace-nowrap p-2">
                        <span className="flex gap-1">
                          <IconLink to={`${PM}/users/${u._id}/vehicles`} title="View / Add New Vehicle">Vehicles</IconLink>
                          <IconLink to={`${PM}/users/${u._id}/passes`} title="View / Add New Pass">Passes</IconLink>
                          <IconLink to={`${PM}/users/${u._id}/edit`} title="Edit pass user" tone="outline">Edit</IconLink>
                          <IconButton title={`Delete ${u.name}`} tone="danger" disabled={remove.isPending} onClick={() => confirmDelete(u)}>Delete</IconButton>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  )
}
