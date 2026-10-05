import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { walletApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { parseVehicles, walletSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select, Textarea } from '../../components/ui'

export function WalletForm({ wallet, onSaved, submitLabel }) {
  const queryClient = useQueryClient()
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm({
    resolver: zodResolver(walletSchema),
    defaultValues: {
      holderName: wallet?.holderName || '',
      phone: wallet?.phone || '',
      vehicles: (wallet?.vehicles || []).join(', '),
      lowBalanceAlert: wallet?.lowBalanceAlert ?? 100,
      notes: wallet?.notes || '',
    },
  })

  const save = useMutation({
    mutationFn: (values) => {
      const body = {
        holderName: values.holderName,
        // On a change an empty phone or note is sent as empty text so that it is cleared.
        phone: wallet ? values.phone ?? '' : values.phone || undefined,
        vehicles: parseVehicles(values.vehicles),
        lowBalanceAlert: values.lowBalanceAlert,
        notes: wallet ? values.notes ?? '' : values.notes || undefined,
      }
      return wallet ? walletApi.update(wallet._id, body) : walletApi.create(body)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
      queryClient.invalidateQueries({ queryKey: ['wallet'] })
      if (!wallet) reset({ holderName: '', phone: '', vehicles: '', lowBalanceAlert: 100, notes: '' })
      onSaved?.(data)
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4" noValidate>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Alert type="success">
        {save.isSuccess && !wallet && (
          <>
            Wallet {save.data.number} created for {save.data.holderName}.{' '}
            <Link className="font-semibold underline" to={`/dashboard/wallets/${save.data._id}`}>Open wallet</Link>
          </>
        )}
        {save.isSuccess && wallet && 'Saved.'}
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Holder name" error={errors.holderName?.message} {...register('holderName')} />
        <Field label="Phone (optional)" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Field
          label="Vehicles (optional)"
          placeholder="RJ14 AB 1234, RJ14 CD 5678"
          hint="Their fee is paid from this wallet at exit. Separate with commas."
          autoCapitalize="characters"
          error={errors.vehicles?.message}
          {...register('vehicles')}
        />
        <Field
          label="Low balance below (₹)"
          type="number"
          min="0"
          step="1"
          hint="The list marks the wallet as low. 0 = never"
          error={errors.lowBalanceAlert?.message}
          {...register('lowBalanceAlert', { valueAsNumber: true })}
        />
        <Textarea className="sm:col-span-2" label="Notes (optional)" rows={2} error={errors.notes?.message} {...register('notes')} />
      </div>
      <Button type="submit" loading={save.isPending}>{submitLabel || (wallet ? 'Save changes' : 'Create wallet')}</Button>
    </form>
  )
}

export default function Wallets() {
  const { company } = useAuth()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState({ q: '', status: '', page: 1 })
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['wallets', search],
    queryFn: () => walletApi.list({ ...(search.q ? { q: search.q } : {}), ...(search.status ? { status: search.status } : {}), page: search.page }),
    placeholderData: keepPreviousData,
  })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Prepaid wallets</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        A wallet is a prepaid parking card for a regular customer. The customer pays money in at the counter, and the parking fee is taken from the wallet when the vehicle leaves.
        A wallet can only pay this company&apos;s parking fees. Money put in is not income until a fee is paid from it.
      </p>

      {company && (
        <Card title="New wallet">
          <WalletForm />
        </Card>
      )}

      <Card title="Wallets">
        <form
          role="search"
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch((s) => ({ ...s, q: input.trim(), page: 1 }))
          }}
        >
          <Field className="min-w-56 flex-1" label="Wallet number, holder, phone or vehicle" name="wallet-search" value={input} onChange={(e) => setInput(e.target.value)} />
          <Select className="w-44" label="Status" name="wallet-status" value={search.status} onChange={(e) => setSearch((s) => ({ ...s, status: e.target.value, page: 1 }))}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="BLOCKED">Blocked</option>
          </Select>
          <Button type="submit" variant="secondary">Search</Button>
        </form>

        {error && <Alert>{errorMessage(error)}</Alert>}
        {isLoading ? (
          <PageLoader />
        ) : !data ? null : data.wallets.length === 0 ? (
          <p className="text-sm text-slate-500">No wallets found.</p>
        ) : (
          <div className={isFetching ? 'overflow-x-auto opacity-70' : 'overflow-x-auto'}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">Wallet</th>
                  <th className="py-2 pr-4 font-medium">Holder</th>
                  <th className="py-2 pr-4 font-medium">Vehicles</th>
                  <th className="py-2 pr-4 text-right font-medium">Balance</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.map((w) => (
                  <tr key={w._id} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-medium">
                      <Link className="text-blue-700 hover:underline" to={`/dashboard/wallets/${w._id}`}>{w.number}</Link>
                    </td>
                    <td className="py-2 pr-4">{w.holderName}{w.phone ? <span className="block text-xs text-slate-500">{w.phone}</span> : null}</td>
                    <td className="py-2 pr-4">{w.vehicles.join(', ') || '—'}</td>
                    <td className="py-2 pr-4 text-right font-semibold">{money(w.balance)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={w.status === 'ACTIVE' ? 'green' : 'red'}>{w.status === 'ACTIVE' ? 'Active' : 'Blocked'}</Badge>
                        {w.low && <Badge tone="amber">Low balance</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <Button variant="secondary" disabled={search.page <= 1} onClick={() => setSearch((s) => ({ ...s, page: s.page - 1 }))}>Previous</Button>
            <span className="text-slate-500">Page {search.page} of {pages}</span>
            <Button variant="secondary" disabled={search.page >= pages} onClick={() => setSearch((s) => ({ ...s, page: s.page + 1 }))}>Next</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
