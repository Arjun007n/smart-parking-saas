import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { walletApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useMyLocations } from '../../hooks/useMyLocations'
import { walletAdjustSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { isCompanyWide } from '../../utils/roles'
import { WALLET_TXN, dateTime, money } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader } from '../../components/ui'
import TopUpForm from '../../components/wallet/TopUpForm'
import { WalletForm } from './Wallets'

function AdjustForm({ wallet }) {
  const queryClient = useQueryClient()
  const requestId = useRef(null)
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm({ resolver: zodResolver(walletAdjustSchema), defaultValues: { amount: undefined, reason: '' } })
  const adjust = useMutation({
    mutationFn: (values) => {
      requestId.current ??= `adj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      return walletApi.adjust(wallet._id, { ...values, requestId: requestId.current })
    },
    onSuccess: () => {
      requestId.current = null
      queryClient.invalidateQueries({ queryKey: ['wallet', wallet._id] })
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
      reset({ amount: undefined, reason: '' })
    },
    onError: (error) => {
      if (error?.response?.status && error.response.status < 500) requestId.current = null
    },
  })
  return (
    <form onSubmit={handleSubmit((values) => adjust.mutate(values))} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600">
        Use this only to correct a mistake. Enter a plus amount to add money or a minus amount to take it away. The reason is kept in the history.
      </p>
      <Alert>{adjust.error && errorMessage(adjust.error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Amount (₹, plus or minus)"
          name="adjust-amount"
          type="number"
          step="0.01"
          error={errors.amount?.message}
          {...register('amount', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })}
        />
        <Field className="sm:col-span-2" label="Reason" error={errors.reason?.message} {...register('reason')} />
      </div>
      <Button type="submit" variant="secondary" loading={adjust.isPending}>Correct balance</Button>
    </form>
  )
}

function BlockPanel({ wallet }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const blocked = wallet.status === 'BLOCKED'
  const change = useMutation({
    mutationFn: () => walletApi.update(wallet._id, blocked ? { status: 'ACTIVE' } : { status: 'BLOCKED', statusReason: reason.trim() }),
    onSuccess: () => {
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['wallet', wallet._id] })
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
    },
  })
  return (
    <div className="space-y-3">
      <Alert>{change.error && errorMessage(change.error)}</Alert>
      {blocked ? (
        <>
          <p className="text-sm text-slate-600">This wallet is blocked{wallet.statusReason ? `: ${wallet.statusReason}` : ''}. It cannot pay or be topped up.</p>
          <Button loading={change.isPending} onClick={() => change.mutate()}>Unblock wallet</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">Block a lost or misused card. The balance is kept and can be unblocked later.</p>
          <Field label="Reason" name="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" disabled={reason.trim().length < 3} loading={change.isPending} onClick={() => change.mutate()}>Block wallet</Button>
        </>
      )}
    </div>
  )
}

export default function WalletDetail() {
  const { id } = useParams()
  const { can, user } = useAuth()
  const wide = isCompanyWide(user.role)
  const { locations, defaultId } = useMyLocations()
  const { data, isLoading, error } = useQuery({ queryKey: ['wallet', id], queryFn: () => walletApi.get(id) })
  const [check, setCheck] = useState(null)
  const verify = useMutation({ mutationFn: () => walletApi.verify(id), onSuccess: setCheck })

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>
  const { wallet, transactions } = data

  return (
    <div className="space-y-6">
      <Link to="/dashboard/wallets" className="text-sm font-medium text-blue-700 hover:underline">← All wallets</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{wallet.number}</h1>
          <p className="text-sm text-slate-600">{wallet.holderName}{wallet.phone ? ` · ${wallet.phone}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-extrabold text-slate-900">{money(wallet.balance)}</p>
          <div className="mt-1 flex justify-end gap-1">
            <Badge tone={wallet.status === 'ACTIVE' ? 'green' : 'red'}>{wallet.status === 'ACTIVE' ? 'Active' : 'Blocked'}</Badge>
            {wallet.low && <Badge tone="amber">Low balance</Badge>}
          </div>
        </div>
      </div>

      {wallet.status === 'ACTIVE' && can('PAYMENT_COLLECT') && (
        <Card title="Add money">
          <TopUpForm key={defaultId} wallet={wallet} locations={locations} defaultLocationId={defaultId} />
        </Card>
      )}

      <Card title="Details">
        <WalletForm key={wallet._id} wallet={wallet} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Block or unblock"><BlockPanel wallet={wallet} /></Card>
        {wide && <Card title="Correct the balance"><AdjustForm wallet={wallet} /></Card>}
      </div>

      <Card
        title="History"
        action={<Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>Check balance</Button>}
      >
        {check && (
          <div className="mb-3">
            <Alert type={check.ok ? 'success' : 'error'}>
              {check.ok ? 'The balance matches the history.' : `The balance (${money(check.balancePaise / 100)}) does not match the history (${money(check.ledgerPaise / 100)}). Tell support.`}
            </Alert>
          </div>
        )}
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-500">No money has moved yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">What</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                  <th className="py-2 pr-4 text-right font-medium">Balance</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t._id} className="border-b border-slate-100">
                    <td className="py-2 pr-4 whitespace-nowrap">{dateTime(t.createdAt)}</td>
                    <td className="py-2 pr-4"><Badge tone={WALLET_TXN[t.type]?.tone}>{WALLET_TXN[t.type]?.label || t.type}</Badge></td>
                    <td className={`py-2 pr-4 text-right font-medium ${t.deltaPaise < 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {t.deltaPaise < 0 ? '−' : '+'}{money(Math.abs(t.deltaPaise) / 100)}
                    </td>
                    <td className="py-2 pr-4 text-right">{money(t.balanceAfterPaise / 100)}</td>
                    <td className="py-2 text-slate-600">
                      {[t.method, t.reference, t.reason, t.by?.name && `by ${t.by.name}`].filter(Boolean).join(' · ')}
                    </td>
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
