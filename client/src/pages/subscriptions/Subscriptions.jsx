import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import printTable from '../../utils/printTable'
import { csvDownload } from '../../utils/csvDownload'
import { STATE_TEXT, STATE_TONE, monthsText, validity } from '../../utils/subscriptions'
import { Alert, Badge, PageLoader } from '../../components/ui'
import { ExportButtons, Pager, SearchBox, ShowEntries, Toolbar } from '../../components/pass/ListKit'

// Manage Subscriptions > Subscription List: one row per location with the subscription that counts now.
export default function Subscriptions() {
  const tableRef = useRef(null)
  const [limit, setLimit] = useState(25)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const query = useQuery({ queryKey: ['subscriptions'], queryFn: subscriptionApi.list })

  if (query.isLoading) return <PageLoader />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>

  const all = query.data.rows
  const rows = all.filter((r) => !q.trim() || r.locationName.toLowerCase().includes(q.trim().toLowerCase()))
  const pageRows = rows.slice((page - 1) * limit, page * limit)
  const start = (page - 1) * limit

  const download = () => csvDownload('subscriptions.csv', [
    ['SN', 'Location', 'Plan', 'Code', 'Users', 'Addons', 'Tenure', 'Validity', 'Status'],
    ...rows.map((r, i) => [
      i + 1, r.locationName, r.subscription ? r.subscription.planName : '', r.subscription ? r.subscription.code : '',
      r.subscription ? r.subscription.users : '', r.subscription ? r.subscription.items.join('; ') : '',
      r.subscription ? monthsText(r.subscription.months) : '', r.subscription ? validity(r.subscription) : '', STATE_TEXT[r.state],
    ]),
  ])

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Subscription List</h1>
      {!query.data.ready && <Alert type="info">Buying online is not available yet: {query.data.notReady.join('; ')}. Please contact support.</Alert>}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={limit} onChange={(n) => { setLimit(n); setPage(1) }} sizes={[10, 25, 50, 100]} />
          <SearchBox label="Search by Location" value={q} onChange={(v) => { setQ(v); setPage(1) }} />
        </div>
        <Toolbar>
          <ExportButtons onDownload={download} onPrint={() => printTable(tableRef.current, 'Subscription List')} disabled={rows.length === 0} />
        </Toolbar>
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                {['SN', 'Location', 'Subscription/Plan', 'Users', 'Addons', 'Tenure', 'Validity', 'Status', 'Action'].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const s = r.subscription
                return (
                  <tr key={r.locationId} className="border-t border-slate-100 align-top">
                    <td className="p-2">{start + i + 1}</td>
                    <td className="p-2 font-semibold text-slate-900">{r.locationName}</td>
                    <td className="p-2">{s ? <>{s.planName}<div className="text-xs text-slate-500">{s.code}</div></> : <span className="text-slate-400">—</span>}</td>
                    <td className="p-2">{s ? s.users : '—'}</td>
                    <td className="p-2">
                      {s ? <ol className="list-inside list-decimal space-y-0.5 text-xs">{s.items.map((item) => <li key={item}>{item}</li>)}</ol> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-2">{s && !s.legacy ? monthsText(s.months) : '—'}</td>
                    <td className="p-2 whitespace-nowrap">{validity(s)}</td>
                    <td className="p-2"><Badge tone={STATE_TONE[r.state]}>{STATE_TEXT[r.state]}</Badge></td>
                    <td className="p-2 print:hidden">
                      {s ? (
                        <Link to={`/dashboard/subscriptions/location/${r.locationId}`} className="inline-flex rounded-md border border-blue-600 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">View</Link>
                      ) : (
                        <Link to={`/dashboard/subscriptions/new/${r.locationId}`} className="inline-flex rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">Buy</Link>
                      )}
                    </td>
                  </tr>
                )
              })}
              {pageRows.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-slate-500">No locations found.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageSize={limit} total={rows.length} onPage={setPage} />
      </section>
    </div>
  )
}
