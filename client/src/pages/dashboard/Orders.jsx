import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { myOrdersApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { csvDownload } from '../../utils/csvDownload'
import { dmyTime } from '../../utils/subscriptions'
import { Alert, Badge, PageLoader } from '../../components/ui'
import { ExportButtons, Pager, ShowEntries, Toolbar } from '../../components/pass/ListKit'

const PAY = { PAID: ['Paid', 'green'], PENDING: ['Pending', 'amber'], FAILED: ['Failed', 'red'], CANCELLED: ['Cancelled', 'slate'] }
const TYPE_TEXT = { SUBSCRIPTION: 'Subscription', PLAN: 'Plan (earlier)', HARDWARE: 'Hardware' }
const SELECT = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm'

// Dashboard > My Orders ("Orders History List"): every order of the company in one table: subscription orders
// (all locations), earlier company-wide plan orders and hardware shop orders.
export default function Orders() {
  const tableRef = useRef(null)
  const [limit, setLimit] = useState(25)
  const [page, setPage] = useState(1)
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')

  // The order number is searched a moment after the typing stops.
  useEffect(() => {
    const timer = setTimeout(() => { setQ(typed.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [typed])

  const filters = { q: q || undefined, status: status || undefined, type: type || undefined }
  const query = useQuery({
    queryKey: ['my-orders', limit, page, q, status, type],
    queryFn: () => myOrdersApi.list({ ...filters, limit, page }),
    placeholderData: keepPreviousData,
  })
  const everything = useMutation({
    mutationFn: () => myOrdersApi.all(filters),
    onSuccess: ({ rows }) => csvDownload(`Order_History_List_${new Date().toISOString().slice(0, 10)}.csv`, [
      ['SN', 'Date', 'Order Number', 'Type', 'Invoice', 'Details', 'Subscription', 'Items', 'Quantity', 'Amount', 'Payment Status'],
      ...rows.map((r, i) => [
        i + 1, dmyTime(r.createdAt), r.number, TYPE_TEXT[r.type], r.invoiceNumber || (r.status === 'PENDING' ? 'Pending' : ''), r.title,
        r.subscription, r.itemCount, r.quantity, r.amount, PAY[r.status][0],
      ]),
    ]),
  })

  if (query.isLoading) return <PageLoader />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  const { rows, total } = query.data
  const start = (page - 1) * limit

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Orders History List</h1>
        <div className="flex gap-2">
          <Link to="/dashboard/subscriptions" className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">Manage Subscriptions</Link>
          <Link to="/product" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Order hardware</Link>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={limit} onChange={(n) => { setLimit(n); setPage(1) }} sizes={[10, 25, 50, 100, 200]} />
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              Order No.
              <input type="search" className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Enter order number" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              Payment Status
              <select className={SELECT} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
                <option value="">All Payment Status</option>
                <option value="PAID">Paid</option>
                <option value="PENDING">Pending</option>
                <option value="FAILED">Failed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Type
              <select className={SELECT} value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
                <option value="">All orders</option>
                <option value="SUBSCRIPTION">Subscription</option>
                <option value="HARDWARE">Hardware</option>
                <option value="PLAN">Plan (earlier)</option>
              </select>
            </label>
          </div>
        </div>
        <Toolbar>
          <ExportButtons onDownload={() => everything.mutate()} pending={everything.isPending} onPrint={() => printTable(tableRef.current, 'Orders History List')} disabled={total === 0} />
        </Toolbar>
        <Alert>{everything.error && errorMessage(everything.error)}</Alert>
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                {['SN', 'Date', 'Order Number', 'Type', 'Invoice', 'Details', 'Items', 'Quantity', 'Amount', 'Payment Status'].map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.type}-${r.id}`} className="border-t border-slate-100 align-top">
                  <td className="p-2">{start + i + 1}</td>
                  <td className="p-2 whitespace-nowrap">{dmyTime(r.createdAt)}</td>
                  <td className="p-2">
                    {r.number ? <Link to={r.link} state={{ from: 'orders' }} className="font-medium text-blue-700 hover:underline">{r.number}</Link> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="p-2">{TYPE_TEXT[r.type]}</td>
                  <td className="p-2 whitespace-nowrap">
                    {r.invoiceNumber ? (
                      <Link to={r.link} state={{ from: 'orders' }} className="rounded-md border border-blue-600 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 print:hidden">View</Link>
                    ) : r.status === 'PENDING' ? (
                      <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Pending</span>
                    ) : <span className="text-slate-400">—</span>}
                    {r.invoiceNumber && <span className="hidden print:inline">{r.invoiceNumber}</span>}
                  </td>
                  <td className="p-2">
                    <div>{r.title}</div>
                    {r.subscription && <div className="text-xs text-slate-500">{r.subscription}</div>}
                    {r.type === 'HARDWARE' && r.status === 'PAID' && <div className="text-xs text-slate-500">Delivery: {r.fulfilment.charAt(0) + r.fulfilment.slice(1).toLowerCase()}</div>}
                  </td>
                  <td className="p-2">{r.itemCount}</td>
                  <td className="p-2">{r.quantity}</td>
                  <td className="p-2 text-right whitespace-nowrap">{money(r.amount)}</td>
                  <td className="p-2"><Badge tone={PAY[r.status][1]}>{PAY[r.status][0]}</Badge></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="p-4 text-center text-slate-500">
                  {total === 0 && !q && !status && !type ? <>No orders yet. <Link to="/dashboard/subscriptions" className="font-semibold text-blue-700 underline">Buy a subscription</Link> or <Link to="/product" className="font-semibold text-blue-700 underline">browse the hardware shop</Link>.</> : 'No matching records found'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageSize={limit} total={total} onPage={setPage} />
      </section>
    </div>
  )
}
