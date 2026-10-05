import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { walletApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { dateTime, WALLET_TXN, money } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader } from '../../components/ui'
import TopUpForm from '../../components/wallet/TopUpForm'

function WalletPanel({ id, locations, defaultLocationId }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['wallet', id], queryFn: () => walletApi.get(id) })
  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>
  const { wallet, transactions } = data

  return (
    <Card title={`${wallet.holderName} (${wallet.number})`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {wallet.vehicles.length ? `Vehicles: ${wallet.vehicles.join(', ')}` : 'No vehicles linked'}
            {wallet.phone ? ` · ${wallet.phone}` : ''}
          </p>
          <div className="text-right">
            <p className="text-3xl font-extrabold text-slate-900">{money(wallet.balance)}</p>
            <div className="mt-1 flex justify-end gap-1">
              <Badge tone={wallet.status === 'ACTIVE' ? 'green' : 'red'}>{wallet.status === 'ACTIVE' ? 'Active' : 'Blocked'}</Badge>
              {wallet.low && <Badge tone="amber">Low balance</Badge>}
            </div>
          </div>
        </div>

        {wallet.status === 'ACTIVE' ? (
          <TopUpForm key={defaultLocationId} wallet={wallet} locations={locations} defaultLocationId={defaultLocationId} />
        ) : (
          <Alert type="info">This wallet is blocked{wallet.statusReason ? `: ${wallet.statusReason}` : ''}. Ask an admin.</Alert>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Latest activity</h3>
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody>
                {transactions.slice(0, 8).map((t) => (
                  <tr key={t._id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{dateTime(t.createdAt)}</td>
                    <td className="py-1.5 pr-3"><Badge tone={WALLET_TXN[t.type]?.tone}>{WALLET_TXN[t.type]?.label || t.type}</Badge></td>
                    <td className={`py-1.5 text-right font-medium ${t.deltaPaise < 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {t.deltaPaise < 0 ? '−' : '+'}{money(Math.abs(t.deltaPaise) / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Card>
  )
}

// For the counter: find a customer's wallet (number, vehicle, holder or phone) and add money to it.
export default function OperatorWallets() {
  const { locations, defaultId } = useMyLocations()
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState('')

  const found = useQuery({
    queryKey: ['wallets', { q }],
    queryFn: () => walletApi.list({ q }),
    enabled: q.length >= 3,
  })
  const results = found.data?.wallets || []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Wallet top-up</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Find the customer&apos;s prepaid wallet and add the money they hand over. Cash is counted in your open shift at the location you choose, so open your shift first.
      </p>

      <Card title="Find a wallet">
        <form
          role="search"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setPicked('')
            setQ(input.trim())
          }}
        >
          <Field
            className="min-w-56 flex-1"
            label="Wallet number, vehicle, holder or phone"
            name="wallet-find"
            autoComplete="off"
            autoCapitalize="characters"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            hint="Type at least 3 characters"
          />
          <Button type="submit" variant="secondary" disabled={input.trim().length < 3}>Search</Button>
        </form>
        {found.error && <div className="mt-3"><Alert>{errorMessage(found.error)}</Alert></div>}
        {found.isLoading && q.length >= 3 && <p className="mt-3 text-sm text-slate-500">Searching…</p>}
        {found.data && results.length === 0 && <p className="mt-3 text-sm font-semibold text-red-700">No wallet found.</p>}
        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {results.map((w) => (
              <li key={w._id}>
                <button
                  type="button"
                  onClick={() => setPicked(w._id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-slate-50 ${picked === w._id ? 'bg-blue-50' : ''}`}
                >
                  <span>
                    <span className="font-semibold text-slate-900">{w.holderName}</span>{' '}
                    <span className="text-slate-500">{w.number}{w.vehicles.length ? ` · ${w.vehicles.join(', ')}` : ''}</span>
                  </span>
                  <span className="font-semibold">{money(w.balance)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {picked && <WalletPanel key={picked} id={picked} locations={locations} defaultLocationId={defaultId} />}
    </div>
  )
}
