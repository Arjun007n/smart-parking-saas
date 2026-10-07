import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { passApi, passCompanyApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { PASS_STATE, VEHICLE_LABELS, lastDay } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../ui'

const STATES = [['', 'All current'], ['ACTIVE', 'Active'], ['EXPIRING', 'Ending within 7 days'], ['EXPIRED', 'Expired'], ['SUSPENDED', 'Suspended']]

// Every vehicle on a current pass, one row each (a shared pass lists all of its vehicles).
export default function PassVehiclesPanel() {
  const [input, setInput] = useState('')
  const [filters, setFilters] = useState({ q: '', state: '', passCompanyId: '', page: 1 })
  const params = {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.passCompanyId ? { passCompanyId: filters.passCompanyId } : {}),
    page: filters.page,
  }
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const list = useQuery({ queryKey: ['pass-vehicles', params], queryFn: () => passApi.vehicles(params), placeholderData: keepPreviousData })
  const download = useMutation({ mutationFn: (format) => passApi.downloadVehicles({ ...params, page: undefined }, format) })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <Card title="Vehicles on passes">
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setFilters((f) => ({ ...f, q: input.trim(), page: 1 }))
        }}
      >
        <Field className="min-w-56 flex-1" label="Vehicle, holder or tag" name="pv-search" value={input} onChange={(event) => setInput(event.target.value)} />
        <Select className="w-52" label="Show" name="pv-state" value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value, page: 1 }))}>
          {STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {(companies.data?.companies || []).length > 0 && (
          <Select className="w-52" label="Company" name="pv-company" value={filters.passCompanyId} onChange={(e) => setFilters((f) => ({ ...f, passCompanyId: e.target.value, page: 1 }))}>
            <option value="">All companies</option>
            {companies.data.companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        )}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Vehicle</th>
                  <th className="pb-2 pr-4 font-medium">Holder</th>
                  <th className="pb-2 pr-4 font-medium">Company</th>
                  <th className="pb-2 pr-4 font-medium">Pass</th>
                  <th className="pb-2 pr-4 font-medium">Last day</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const state = PASS_STATE[r.state] || PASS_STATE.ACTIVE
                  return (
                    <tr key={`${r.passId}-${r.vehicleNumber}`} className="border-t border-slate-200">
                      <td className="py-2 pr-4 font-medium text-slate-900">
                        {r.vehicleNumber}
                        <span className="block text-xs font-normal text-slate-500">{VEHICLE_LABELS[r.vehicleType]}{r.tag ? ` · tag ${r.tag}` : ''}</span>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{r.holderName}{r.phone && <span className="block text-slate-500">{r.phone}</span>}</td>
                      <td className="py-2 pr-4 text-slate-600">{r.company || '—'}</td>
                      <td className="py-2 pr-4">
                        <Link className="font-mono text-xs text-blue-700 hover:underline" to={`/dashboard/passes/${r.passId}`}>{r.passNumber}</Link>
                      </td>
                      <td className="py-2 pr-4">{lastDay(r.endDate)}</td>
                      <td className="py-2"><Badge tone={state.tone}>{state.label}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{data.total} vehicles · page {data.page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
              <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
            </div>
          </div>
        </>
      ) : (
        !list.error && <p className="text-sm text-slate-500">No vehicles found.</p>
      )}
    </Card>
  )
}
