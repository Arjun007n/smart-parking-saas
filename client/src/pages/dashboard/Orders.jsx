import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { shopApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { dateTime, money } from '../../utils/format'
import { Alert, Badge, Card, PageLoader } from '../../components/ui'
import { PAY_TEXT, PAY_TONE, SHIP_TEXT, SHIP_TONE } from './shopStatus'

// The hardware orders of this company.
export default function Orders() {
  const orders = useQuery({ queryKey: ['shop', 'orders'], queryFn: shopApi.orders })

  if (orders.isLoading) return <PageLoader />
  if (orders.error) return <Alert>{errorMessage(orders.error)}</Alert>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">My orders</h1>
        <Link to="/product" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Order hardware</Link>
      </div>
      <Card>
        {orders.data.length === 0 ? (
          <p className="text-sm text-slate-500">No hardware orders yet. <Link to="/product" className="font-semibold text-blue-700 underline">Browse the hardware shop</Link>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2 pr-4">Order</th><th className="pr-4">Date</th><th className="pr-4">Items</th><th className="pr-4 text-right">Total</th><th className="pl-4">Payment</th><th className="pl-4">Delivery</th><th /></tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o._id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-semibold text-slate-900">{o.number}</td>
                    <td className="pr-4">{dateTime(o.createdAt)}</td>
                    <td className="pr-4">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</td>
                    <td className="pr-4 text-right">{money(o.total)}</td>
                    <td className="pl-4"><Badge tone={PAY_TONE[o.status]}>{PAY_TEXT[o.status]}</Badge></td>
                    <td className="pl-4">{o.status === 'PAID' ? <Badge tone={SHIP_TONE[o.fulfilment]}>{SHIP_TEXT[o.fulfilment]}</Badge> : <span className="text-slate-400">—</span>}</td>
                    <td className="text-right"><Link to={`/dashboard/orders/${o._id}`} className="font-semibold text-blue-700 hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
