import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { paymentApi, walletApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { amountDue, money } from '../../utils/format'
import { Alert, Button, Field } from '../ui'

// Pays the exit fee from a prepaid wallet: the wallet linked to the vehicle, or another one found by its number.
export default function WalletPayment({ session, linked, onPaid }) {
  const due = amountDue(session)
  const [number, setNumber] = useState('')
  const [found, setFound] = useState(null) // a wallet found by number, or { none: true }
  const wallet = found && !found.none ? found : linked

  const find = useMutation({
    mutationFn: () => walletApi.lookup({ number: number.trim() }),
    onSuccess: (data) => setFound(data.wallet || { none: true }),
  })
  const pay = useMutation({
    mutationFn: () => paymentApi.create({ sessionId: session._id, method: 'WALLET', amount: due, walletId: wallet._id }),
    onSuccess: (data) => onPaid({ ...data, change: 0 }),
  })

  const balance = wallet?.balance ?? 0
  const enough = wallet && wallet.status === 'ACTIVE' && balance + 0.005 >= due

  return (
    <div className="space-y-4">
      <Alert>{pay.error && errorMessage(pay.error)}</Alert>
      {wallet ? (
        <div className="rounded-lg bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">{wallet.holderName} <span className="font-normal text-slate-500">({wallet.number})</span></p>
          <p className="mt-1 text-slate-700">Balance: <strong>{money(balance)}</strong> · Fee: <strong>{money(due)}</strong></p>
          {wallet.status !== 'ACTIVE' ? (
            <p className="mt-2 font-semibold text-red-700" role="status">This wallet is blocked. Take another payment mode.</p>
          ) : enough ? (
            <p className="mt-2 font-semibold text-green-700" role="status">Balance after payment: {money(balance - due)}</p>
          ) : (
            <p className="mt-2 font-semibold text-red-700" role="status">
              Not enough balance: {money(due - balance)} short. Top the wallet up (Wallets page) or take another payment mode.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No wallet is linked to this vehicle. Enter the wallet number from the customer&apos;s card.</p>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (number.trim()) find.mutate()
        }}
      >
        <Field
          className="min-w-48 flex-1"
          label={wallet ? 'Use another wallet' : 'Wallet number'}
          name="wallet-number"
          placeholder="W-XXXXXXXX"
          autoCapitalize="characters"
          autoComplete="off"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
        <Button type="submit" variant="secondary" loading={find.isPending}>Find</Button>
      </form>
      <Alert>{find.error && errorMessage(find.error)}</Alert>
      {found?.none && <p className="text-sm font-semibold text-red-700" role="status">No wallet with that number.</p>}

      <Button className="w-full py-3 text-base" disabled={!enough} loading={pay.isPending} onClick={() => pay.mutate()}>
        Exit — pay {money(due)} from wallet
      </Button>
    </div>
  )
}
