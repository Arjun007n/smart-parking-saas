import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { operatorApi, parkingApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, money, timeOnly } from '../../utils/format'
import { Alert, Button, Card, Field } from '../ui'

// Vehicles that left today, newest first. "Bill" opens the receipt or sends it to the thermal printer.
export default function TodaysExit({ locationId }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const params = { pageSize: 10, page, ...(locationId ? { locationId } : {}), ...(q ? { q } : {}) }
  const { data, error } = useQuery({ queryKey: ['operator-list', 'exits', params], queryFn: () => operatorApi.exits(params), refetchInterval: 20_000 })
  const { user } = useAuth()
  const mayPrint = user?.access?.reprint !== false
  const print = useMutation({ mutationFn: (id) => parkingApi.print(id) })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <Card title={`Today's Exit${data ? ` (${data.total})` : ''}`} className="no-print">
      <Field label="Search" name="todays-exit-search" placeholder="Vehicle or ticket number" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} />
      {error && <Alert>{errorMessage(error)}</Alert>}
      {print.error && <Alert>{errorMessage(print.error)}</Alert>}
      {print.isSuccess && <Alert type="success">Bill sent to the printer.</Alert>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-2 font-medium">#</th>
              <th className="pb-2 pr-2 font-medium">Vehicle no</th>
              <th className="pb-2 pr-2 font-medium">Mode</th>
              <th className="pb-2 pr-2 font-medium">Type</th>
              <th className="pb-2 pr-2 font-medium">Out</th>
              <th className="pb-2 font-medium">Bill</th>
            </tr>
          </thead>
          <tbody>
            {data && data.sessions.length > 0 ? (
              data.sessions.map((row) => (
                <tr key={row.id} className="sp-row-in border-t border-slate-200">
                  <td className="py-2 pr-2">{row.sno}</td>
                  <td className="py-2 pr-2 font-semibold text-slate-900">{row.vehicle}</td>
                  <td className="py-2 pr-2">{PAYMENT_LABELS[row.method] || '—'}</td>
                  <td className="py-2 pr-2">{VEHICLE_LABELS[row.type] || row.type}</td>
                  <td className="py-2 pr-2">{timeOnly(row.outTime)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{money(row.payable)}</span>
                      <Link to={`/operator/receipt/${row.id}`} className="text-blue-700 underline">View</Link>
                      {mayPrint && <button type="button" className="text-blue-700 underline" onClick={() => print.mutate(row.id)}>Print</button>}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="border-t border-slate-200 py-3 text-slate-500">{data ? 'No data available in table' : 'Loading…'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-500">Page {data.page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
