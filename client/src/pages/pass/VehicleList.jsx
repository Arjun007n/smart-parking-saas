import { useDeferredValue, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { passCompanyApi, passUserApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, PageLoader } from '../../components/ui'
import { ExportButtons, PageTitle, Pager, SearchBox, ShowEntries, Toolbar } from '../../components/pass/ListKit'
import { useListState } from '../../components/pass/listState'

const FILTER = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2'

// Pass Management > Vehicle List: every vehicle that belongs to a pass user, with its user, company and mobile.
export default function VehicleList() {
  const tableRef = useRef(null)
  const [params] = useSearchParams()
  const [state, patch, setPage] = useListState({ vehicleNumber: '', passCompanyId: params.get('company') || '', passUserId: '', vehicleType: '', q: '' })
  const q = useDeferredValue(state.q.trim())
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const users = useQuery({ queryKey: ['pass-user-options'], queryFn: passUserApi.options })
  const query = {
    ...(state.vehicleNumber.trim() ? { vehicleNumber: state.vehicleNumber.trim() } : {}), ...(state.passCompanyId ? { passCompanyId: state.passCompanyId } : {}),
    ...(state.passUserId ? { passUserId: state.passUserId } : {}), ...(state.vehicleType ? { vehicleType: state.vehicleType } : {}), ...(q ? { q } : {}),
    limit: state.limit, page: state.page,
  }
  const list = useQuery({ queryKey: ['pass-vehicle-list', query], queryFn: () => passUserApi.vehicles(query), placeholderData: keepPreviousData })
  const download = useMutation({ mutationFn: (format) => passUserApi.downloadVehicles({ ...query, page: undefined, limit: undefined }, format) })
  const data = list.data

  return (
    <div className="space-y-5">
      <PageTitle title="Vehicle List" />
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">Vehicle No.
            <input className={FILTER} value={state.vehicleNumber} maxLength={15} autoCapitalize="characters" placeholder="All Vehicle No." onChange={(e) => patch({ vehicleNumber: e.target.value })} />
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
          <label className="text-sm font-medium text-slate-700">Vehicle Type
            <select className={FILTER} value={state.vehicleType} onChange={(e) => patch({ vehicleType: e.target.value })}>
              <option value="">Select</option>
              {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} />
          <SearchBox label="Search by Company / User Name / Vehicle No." value={state.q} onChange={(value) => patch({ q: value })} />
        </div>
        <Toolbar>
          <ExportButtons onDownload={(format) => download.mutate(format)} pending={download.isPending} disabled={!data || data.vehicles.length === 0} onPrint={() => printTable(tableRef.current, 'Vehicle List')} />
        </Toolbar>
        <Alert>{list.error ? errorMessage(list.error) : download.error ? errorMessage(download.error) : ''}</Alert>
        {list.isLoading ? (
          <PageLoader />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table ref={tableRef} className="w-full min-w-[760px] border border-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>{['SN', 'Vehicle No.', 'Vehicle Type', 'User Name', 'Company Name', 'Role', 'Mobile'].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.vehicles.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No vehicles found.</td></tr>}
                  {data.vehicles.map((v, i) => (
                    <tr key={v._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                      <td className="p-2">{(data.page - 1) * data.pageSize + i + 1}</td>
                      <td className="p-2 font-medium">{v.vehicleNumber}</td>
                      <td className="p-2">{VEHICLE_LABELS[v.vehicleType]}</td>
                      <td className="p-2">{v.userName}</td>
                      <td className="p-2">{v.company || 'N/A'}</td>
                      <td className="p-2">USERS</td>
                      <td className="p-2">{v.mobile}</td>
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
