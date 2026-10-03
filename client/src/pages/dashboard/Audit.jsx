import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { auditApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { dateTime, todayInput } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader, Select } from '../../components/ui'

// "PAYMENT_REFUNDED" -> "Payment refunded"
const readable = (action) => action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, ' ')

// The extra details of an entry as short "name: value" text.
function details(meta) {
  if (!meta) return ''
  return Object.entries(meta)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : value}`)
    .join(' · ')
}

export default function Audit() {
  const [filters, setFilters] = useState({ from: todayInput(), to: todayInput(), action: '', actor: '', page: 1 })
  const [actorInput, setActorInput] = useState('')
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }))
  const params = {
    from: filters.from,
    to: filters.to,
    page: filters.page,
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actor ? { actor: filters.actor } : {}),
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', params],
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(filters.from && filters.to),
  })
  const download = useMutation({ mutationFn: () => auditApi.download(params) })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">A permanent record of important actions. Entries cannot be edited or deleted.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          set({ actor: actorInput.trim() })
        }}
      >
        <Field
          label="From"
          type="date"
          name="audit-from"
          max={todayInput()}
          value={filters.from}
          onChange={(event) => set({ from: event.target.value, ...(event.target.value > filters.to ? { to: event.target.value } : {}) })}
        />
        <Field label="To" type="date" name="audit-to" min={filters.from} max={todayInput()} value={filters.to} onChange={(event) => set({ to: event.target.value })} />
        <Select label="Action" name="audit-action" value={filters.action} onChange={(event) => set({ action: event.target.value })}>
          <option value="">All actions</option>
          {(data?.actions || []).map((action) => (
            <option key={action} value={action}>{readable(action)}</option>
          ))}
        </Select>
        <Field label="User email" type="email" name="audit-actor" value={actorInput} onChange={(event) => setActorInput(event.target.value)} />
        <Button type="submit">Filter</Button>
        <Button type="button" variant="secondary" loading={download.isPending} disabled={!data || data.total === 0} onClick={() => download.mutate()}>
          Download CSV
        </Button>
      </form>

      {download.error && <Alert>{errorMessage(download.error)}</Alert>}
      {error && <Alert>{errorMessage(error)}</Alert>}

      <Card>
        {isLoading ? (
          <PageLoader />
        ) : data && data.logs.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">When</th>
                    <th className="pb-2 pr-4 font-medium">Who</th>
                    <th className="pb-2 pr-4 font-medium">Action</th>
                    <th className="pb-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((log) => (
                    <tr key={log._id} className="border-t border-slate-200 align-top">
                      <td className="whitespace-nowrap py-2 pr-4 text-slate-600">{dateTime(log.createdAt)}</td>
                      <td className="py-2 pr-4">{log.actorEmail || '—'}</td>
                      <td className="whitespace-nowrap py-2 pr-4 font-medium text-slate-900">{readable(log.action)}</td>
                      <td className="break-words py-2 text-slate-600">{details(log.meta) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>{data.total} entries · page {data.page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          !error && <p className="text-sm text-slate-500">No entries for these filters.</p>
        )}
      </Card>
    </div>
  )
}
