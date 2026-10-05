import { useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { walletApi } from '../../services/api'
import { walletTopUpSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { money } from '../../utils/format'
import { Alert, Button, Field, Select } from '../ui'

const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `r${Date.now()}${Math.random().toString(36).slice(2)}`)

// Money handed over at the counter. The request id stays the same while a submission is being retried,
// so a double tap or a lost connection can never top the wallet up twice.
export default function TopUpForm({ wallet, locations, defaultLocationId, onDone }) {
  const queryClient = useQueryClient()
  const requestId = useRef(null)
  const {
    register, handleSubmit, reset, control, formState: { errors },
  } = useForm({
    resolver: zodResolver(walletTopUpSchema),
    defaultValues: { amount: undefined, method: 'CASH', reference: '', locationId: defaultLocationId || '' },
  })
  const method = useWatch({ control, name: 'method' })

  const topUp = useMutation({
    mutationFn: (values) => {
      requestId.current ??= newRequestId()
      return walletApi.topUp(wallet._id, {
        amount: values.amount,
        method: values.method,
        locationId: values.locationId,
        requestId: requestId.current,
        ...(values.method !== 'CASH' && values.reference ? { reference: values.reference } : {}),
      })
    },
    onSuccess: (data) => {
      requestId.current = null
      queryClient.invalidateQueries({ queryKey: ['wallets'] })
      queryClient.invalidateQueries({ queryKey: ['wallet', wallet._id] })
      queryClient.invalidateQueries({ queryKey: ['shift'] })
      queryClient.invalidateQueries({ queryKey: ['collection'] })
      reset({ amount: undefined, method: 'CASH', reference: '', locationId: defaultLocationId || '' })
      onDone?.(data)
    },
    // A refused request is a new decision: the next try gets a fresh id.
    onError: (error) => {
      if (error?.response?.status && error.response.status < 500) requestId.current = null
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => topUp.mutate(values))} className="space-y-4" noValidate>
      <Alert>{topUp.error && errorMessage(topUp.error)}</Alert>
      <Alert type="success">
        {topUp.isSuccess && `${money(topUp.data.transaction.deltaPaise / 100)} added. New balance ${money(topUp.data.wallet.balance)}.`}
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Amount (₹)"
          name="topup-amount"
          type="number"
          min="1"
          step="0.01"
          inputMode="decimal"
          error={errors.amount?.message}
          {...register('amount', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })}
        />
        <Select label="Paid by" error={errors.method?.message} {...register('method')}>
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card</option>
        </Select>
        {method !== 'CASH' && (
          <Field label="Reference (optional)" hint="UPI or card approval number" error={errors.reference?.message} {...register('reference')} />
        )}
        <Select label="Taken at" error={errors.locationId?.message} {...register('locationId')}>
          <option value="">Choose…</option>
          {locations.map((l) => (
            <option key={l._id} value={l._id}>{l.name}</option>
          ))}
        </Select>
      </div>
      <Button type="submit" loading={topUp.isPending}>Add money</Button>
    </form>
  )
}
