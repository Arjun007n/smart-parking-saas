import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { passApi, passCompanyApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { lastDay } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader, Select } from '../ui'

// The people who hold passes. Passes with the same mobile number (or, with none, the same name) are one user.
export default function PassUsersPanel() {
  const [input, setInput] = useState('')
  const [filters, setFilters] = useState({ q: '', passCompanyId: '', page: 1 })
  const params = {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.passCompanyId ? { passCompanyId: filters.passCompanyId } : {}),
    page: filters.page,
  }
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const list = useQuery({ queryKey: ['pass-users', params], queryFn: () => passApi.users(params), placeholderData: keepPreviousData })
  const download = useMutation({ mutationFn: (format) => passApi.downloadUsers({ ...params, page: undefined }, format) })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <Card title="Pass users">
      <form
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setFilters((f) => ({ ...f, q: input.trim(), page: 1 }))
        }}
      >
        <Field className="min-w-56 flex-1" label="Name, mobile, email or vehicle" name="pu-search" value={input} onChange={(event) => setInput(event.target.value)} />
        {(companies.data?.companies || []).length > 0 && (
          <Select className="w-52" label="Company" name="pu-company" value={filters.passCompanyId} onChange={(e) => setFilters((f) => ({ ...f, passCompanyId: e.target.value, page: 1 }))}>
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
                  <th className="pb-2 pr-4 font-medium">Pass user</th>
                  <th className="pb-2 pr-4 font-medium">Company</th>
                  <th className="pb-2 pr-4 font-medium">Mobile / email</th>
                  <th className="pb-2 pr-4 text-right font-medium">Vehicles</th>
                  <th className="pb-2 pr-4 text-right font-medium">Passes</th>
                  <th className="pb-2 pr-4 text-right font-medium">Active now</th>
                  <th className="pb-2 font-medium">Latest last day</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.holderName}-${r.phone}`} className="border-t border-slate-200">
                    <td className="py-2 pr-4 font-medium text-slate-900">{r.holderName}</td>
                    <td className="py-2 pr-4 text-slate-600">
                      {r.company || '—'}
                      {r.gstNumber && <span className="block text-xs text-slate-500">GST {r.gstNumber}</span>}
                    </td>
                    <td className="py-2 pr-4 text-slate-600">
                      {r.phone || '—'}
                      {r.email && <span className="block text-xs text-slate-500">{r.email}</span>}
                    </td>
                    <td className="py-2 pr-4 text-right">{r.vehicles}</td>
                    <td className="py-2 pr-4 text-right">{r.passes}</td>
                    <td className="py-2 pr-4 text-right">{r.active}</td>
                    <td className="py-2">{lastDay(r.lastEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{data.total} pass users · page {data.page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
              <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
            </div>
          </div>
        </>
      ) : (
        !list.error && <p className="text-sm text-slate-500">No pass users found.</p>
      )}
    </Card>
  )
}
