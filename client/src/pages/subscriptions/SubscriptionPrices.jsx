import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subscriptionApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { Alert, Button, Card, PageLoader } from '../../components/ui'

// Platform > Subscription prices: what the Super Admin charges per month for each add-on (before GST).
export default function SubscriptionPrices() {
  const queryClient = useQueryClient()
  const catalog = useQuery({ queryKey: ['subscriptions', 'catalog'], queryFn: subscriptionApi.catalog })
  const [edits, setEdits] = useState({})
  const save = useMutation({
    mutationFn: () => subscriptionApi.setPrices(Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, Number(v)]))),
    onSuccess: (data) => {
      queryClient.setQueryData(['subscriptions', 'catalog'], data)
      setEdits({})
    },
  })

  if (catalog.isLoading) return <PageLoader />
  if (catalog.error) return <Alert>{errorMessage(catalog.error)}</Alert>
  const c = catalog.data
  const dirty = Object.keys(edits).length > 0
  const bad = Object.values(edits).some((v) => v === '' || !Number.isFinite(Number(v)) || Number(v) < 0)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Subscription prices</h1>
      <Card title="Add-on prices (rupees per month, before GST)">
        <Alert>{save.error && errorMessage(save.error)}</Alert>
        {save.isSuccess && !dirty && <Alert type="success">Prices saved. New quotes use them at once.</Alert>}
        <p className="mb-3 text-sm text-slate-600">The price of a user is {money(c.userPrice)} a month and is the same as on the public website. Changing a price here does not change subscriptions already bought.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700"><tr><th className="p-2">Add-on</th><th className="p-2">Charged</th><th className="p-2">Standard</th><th className="p-2">Price</th></tr></thead>
            <tbody>
              {c.addons.map((a) => (
                <tr key={a.key} className="border-t border-slate-100">
                  <td className="p-2 font-medium">{a.label}</td>
                  <td className="p-2 text-slate-500">{a.unit}</td>
                  <td className="p-2 text-slate-500">{money(a.standardPrice)}</td>
                  <td className="p-2">
                    <input type="number" min="0" max="1000000" className="w-28 rounded-md border border-slate-300 px-2 py-1" aria-label={`${a.label} price`}
                      value={edits[a.key] ?? a.price} onChange={(e) => setEdits((s) => ({ ...s, [a.key]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" loading={save.isPending} disabled={!dirty || bad} onClick={() => save.mutate()}>Save prices</Button>
          <Button type="button" variant="secondary" disabled={!dirty} onClick={() => setEdits({})}>Reset</Button>
        </div>
      </Card>
    </div>
  )
}
