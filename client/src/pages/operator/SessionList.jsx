import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { operatorApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, dateTime, duration, money, todayInput } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import { CarIcon } from '../../components/operator/icons'

const PAGE_SIZES = [10, 25, 50, 100, 200]

// The Entry List and the Exit List: one table per day with search, page size,
// Excel download and print.
function SessionList({ kind }) {
  const entry = kind === 'entries'
  const { locations, defaultId } = useMyLocations()
  const [filters, setFilters] = useState({ date: todayInput(), locationId: '', method: '', type: '', pageSize: 25, page: 1 })
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  // Phone: the filters are folded away; only the search box stays in view.
  const [showFilters, setShowFilters] = useState(false)

  // Wait a moment after typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const locationId = filters.locationId || (locations.length === 1 ? defaultId : '')
  const params = {
    date: filters.date,
    pageSize: filters.pageSize,
    page: filters.page,
    ...(locationId ? { locationId } : {}),
    ...(filters.method ? { method: filters.method } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(q ? { q } : {}),
  }
  const list = useQuery({
    queryKey: ['operator-list', kind, params],
    queryFn: () => (entry ? operatorApi.entries(params) : operatorApi.exits(params)),
    refetchInterval: 30_000,
  })
  const download = useMutation({ mutationFn: (format) => operatorApi.download(kind, { ...params, page: undefined, pageSize: undefined }, format) })

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }))
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{entry ? 'Vehicle Entry List' : 'Vehicle Exit List'}</h1>

      <div className="no-print grid grid-cols-2 gap-1 rounded-2xl bg-[#1d8cf8] p-1 text-center text-sm font-bold md:hidden" role="tablist" aria-label="History">
        <Link to="/operator/entry-list" role="tab" aria-selected={entry} className={`rounded-xl px-3 py-2.5 ${entry ? 'bg-white text-[#1d4ed8] shadow' : 'text-white/90'}`}>
          Entry{entry && data ? ` (${data.total})` : ''}
        </Link>
        <Link to="/operator/exit-list" role="tab" aria-selected={!entry} className={`rounded-xl px-3 py-2.5 ${!entry ? 'bg-white text-[#1d4ed8] shadow' : 'text-white/90'}`}>
          Exit{!entry && data ? ` (${data.total})` : ''}
        </Link>
      </div>

      <div className="no-print flex items-center gap-2 md:hidden">
        <input
          aria-label="Search token or vehicle number"
          placeholder="Search token or vehicle number"
          autoComplete="off"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setFilters((f) => ({ ...f, page: 1 })) }}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)} className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">
          Filters
        </button>
      </div>

      <div className={`no-print ${showFilters ? 'flex' : 'hidden'} flex-wrap items-end gap-4 md:flex`}>
        <Field label="Date" type="date" name="list-date" max={todayInput()} value={filters.date} onChange={(event) => set({ date: event.target.value || todayInput() })} />
        {locations.length > 1 && (
          <Select label="Location" name="list-location" value={filters.locationId} onChange={(event) => set({ locationId: event.target.value })}>
            <option value="">All my locations</option>
            {locations.map((l) => (
              <option key={l._id} value={l._id}>{l.name}</option>
            ))}
          </Select>
        )}
        <Select label="Payment mode" name="list-method" value={filters.method} onChange={(event) => set({ method: event.target.value })}>
          <option value="">All payment modes</option>
          {!entry && <option value="NA">NA (no payment)</option>}
          <option value="PASS">Pass</option>
          {Object.entries(PAYMENT_LABELS).filter(([value]) => value !== 'COMPLIMENTARY').map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select label="Vehicle type" name="list-type" value={filters.type} onChange={(event) => set({ type: event.target.value })}>
          <option value="">All vehicles</option>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select label="Show" name="list-size" value={filters.pageSize} onChange={(event) => set({ pageSize: Number(event.target.value) })}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size} entries</option>
          ))}
        </Select>
        <Field label="Search" name="list-search" className="max-md:hidden" placeholder="Vehicle or ticket number" autoComplete="off" value={search} onChange={(event) => { setSearch(event.target.value); setFilters((f) => ({ ...f, page: 1 })) }} />
        <div className="flex gap-2">
          <Button variant="secondary" loading={download.isPending} disabled={!data || data.total === 0} onClick={() => download.mutate('xlsx')}>
            Download Excel
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      {download.error && <Alert>{errorMessage(download.error)}</Alert>}
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}

      <Card className="print-area" title={`${entry ? 'Entries' : 'Exits'} on ${filters.date}${data ? ` (${data.total})` : ''}`}>
        {list.isLoading ? (
          <PageLoader />
        ) : data && data.sessions.length > 0 ? (
          <>
          <ul className="space-y-3 md:hidden">
            {data.sessions.map((row) => (
              <li key={row.id} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0f1e4a] text-white"><CarIcon width={22} height={22} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-base font-extrabold text-slate-900">{row.vehicle}</p>
                    <p className="font-mono text-xs text-slate-500">{row.ticket} · {VEHICLE_LABELS[row.type] || row.type}</p>
                  </div>
                  {!entry && <span className="shrink-0 text-base font-extrabold text-emerald-600">{money(row.paid)}</span>}
                  {entry && row.advance > 0 && <span className="shrink-0 text-base font-extrabold text-emerald-600">{money(row.advance)}</span>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">In</dt><dd className="font-semibold text-slate-900">{dateTime(row.inTime)}</dd></div>
                  {!entry ? (
                    <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Out</dt><dd className="font-semibold text-slate-900">{dateTime(row.outTime)}</dd></div>
                  ) : (
                    <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Payment</dt><dd className="font-semibold text-slate-900">{PAYMENT_LABELS[row.method] || '—'}</dd></div>
                  )}
                  {!entry && <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Total time</dt><dd className="font-semibold text-slate-900">{row.totalMinutes === '' ? '—' : duration(row.totalMinutes)}</dd></div>}
                  {!entry && <div className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">Payment</dt><dd className="font-semibold text-slate-900">{PAYMENT_LABELS[row.method] || '—'}</dd></div>}
                </dl>
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto max-md:hidden">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">SNo</th>
                  <th className="pb-2 pr-3 font-medium">Vehicle no</th>
                  <th className="pb-2 pr-3 font-medium">Payment mode</th>
                  <th className="pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 pr-3 font-medium">Token</th>
                  <th className="pb-2 pr-3 font-medium">In time</th>
                  {!entry && <th className="pb-2 pr-3 font-medium">Out time</th>}
                  {!entry && <th className="pb-2 pr-3 font-medium">Total time</th>}
                  <th className="pb-2 pr-3 text-right font-medium">Advance</th>
                  {!entry && <th className="pb-2 pr-3 text-right font-medium">Paid</th>}
                  {!entry && <th className="pb-2 text-right font-medium">Payable</th>}
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((row) => (
                  <tr key={row.id} className="sp-row-in border-t border-slate-200">
                    <td className="py-2 pr-3">{row.sno}</td>
                    <td className="py-2 pr-3 font-semibold text-slate-900">{row.vehicle}</td>
                    <td className="py-2 pr-3">{PAYMENT_LABELS[row.method] || '—'}</td>
                    <td className="py-2 pr-3">{VEHICLE_LABELS[row.type] || row.type}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.ticket}</td>
                    <td className="py-2 pr-3">{dateTime(row.inTime)}</td>
                    {!entry && <td className="py-2 pr-3">{dateTime(row.outTime)}</td>}
                    {!entry && <td className="py-2 pr-3">{row.totalMinutes === '' ? '—' : duration(row.totalMinutes)}</td>}
                    <td className="py-2 pr-3 text-right">{row.advance > 0 ? money(row.advance) : '—'}</td>
                    {!entry && <td className="py-2 pr-3 text-right">{money(row.paid)}</td>}
                    {!entry && <td className="py-2 text-right font-medium">{money(row.payable)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">{q ? 'No vehicle matches this search.' : `No ${entry ? 'entries' : 'exits'} on this day.`}</p>
        )}

        {data && data.total > data.pageSize && (
          <div className="no-print mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">Page {data.page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
              <Button variant="secondary" disabled={filters.page >= pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export const EntryList = () => <SessionList kind="entries" />
export const ExitList = () => <SessionList kind="exits" />
