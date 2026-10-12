import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { shiftApi } from '../../services/api'
import { shiftCloseSchema, shiftOpenSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, dateTime, money } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader, Select } from '../ui'

const number = { valueAsNumber: true }

function OpenShiftForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(shiftOpenSchema), defaultValues: { locationId: defaultId, openingCash: 0 } })

  const open = useMutation({
    mutationFn: shiftApi.open,
    onSuccess: (shift) => {
      queryClient.setQueryData(['shift'], shift)
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => open.mutate(values))} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600">
        Start a shift to keep track of the cash you collect. Count the cash in your drawer first.
      </p>
      <Alert>{open.error && errorMessage(open.error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Parking location" error={errors.locationId?.message} {...register('locationId')}>
          <option value="">Choose a location</option>
          {locations.map((l) => (
            <option key={l._id} value={l._id}>{l.name}</option>
          ))}
        </Select>
        <Field label="Cash in drawer now (₹)" type="number" min="0" step="0.01" error={errors.openingCash?.message} {...register('openingCash', number)} />
      </div>
      <Button type="submit" loading={open.isPending}>Start shift</Button>
    </form>
  )
}

function OpenShift({ shift, locationName }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(shiftCloseSchema), defaultValues: { closingCash: undefined, notes: '' } })

  const close = useMutation({
    mutationFn: ({ closingCash, notes }) => shiftApi.close(shift._id, { closingCash, ...(notes ? { notes } : {}) }),
    onSuccess: (closed) => {
      queryClient.setQueryData(['shift'], null)
      queryClient.setQueryData(['shift-closed'], closed)
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
  })
  const t = shift.totals

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Shift at {locationName || 'your location'} started {dateTime(shift.openedAt)}.
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-slate-500">Opening cash</dt>
          <dd className="text-lg font-bold text-slate-900">{money(shift.openingCash)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-slate-500">Collected ({t.payments})</dt>
          <dd className="text-lg font-bold text-slate-900">{money(t.collected)}</dd>
        </div>
        <div className="rounded-lg bg-blue-50 p-3">
          <dt className="text-slate-600">Cash expected in drawer</dt>
          <dd className="text-lg font-bold text-slate-900">{money(t.expectedCash)}</dd>
        </div>
      </dl>
      {t.byMethod.length > 0 && (
        <p className="text-sm text-slate-600">
          {t.byMethod.map((m) => `${PAYMENT_LABELS[m.method] || m.method}: ${money(m.amount)}`).join(' · ')}
          {t.adjustments !== 0 ? ` · Adjustments: ${money(t.adjustments)}` : ''}
        </p>
      )}
      {(t.walletTopups?.count > 0 || t.walletSpent?.count > 0) && (
        <p className="text-sm text-slate-600">
          Wallets: {money(t.walletTopups?.amount)} put in ({t.walletTopups?.count || 0}), {money(t.walletSpent?.amount)} paid from wallets ({t.walletSpent?.count || 0}).
          Money put in is counted above; fees paid from wallets are not new money.
        </p>
      )}

      <form onSubmit={handleSubmit((values) => close.mutate(values))} className="space-y-4 border-t border-slate-200 pt-4" noValidate>
        <h3 className="font-semibold text-slate-900">End shift</h3>
        <Alert>{close.error && errorMessage(close.error)}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cash counted in drawer (₹)"
            type="number"
            min="0"
            step="0.01"
            hint="Count the cash before you look at the expected amount"
            error={errors.closingCash?.message}
            {...register('closingCash', number)}
          />
          <Field label="Notes (optional)" error={errors.notes?.message} {...register('notes')} />
        </div>
        <Button type="submit" variant="secondary" loading={close.isPending}>End shift</Button>
      </form>
    </div>
  )
}

function ClosedSummary({ shift }) {
  const tone = shift.difference === 0 ? 'success' : 'error'
  const text =
    shift.difference === 0
      ? 'Cash matches.'
      : shift.difference < 0
        ? `Cash is short by ${money(Math.abs(shift.difference))}.`
        : `Cash is over by ${money(shift.difference)}.`
  return (
    <Alert type={tone}>
      Shift ended. Expected {money(shift.expectedCash)}, counted {money(shift.closingCash)}. {text}
    </Alert>
  )
}

// The signed-in operator's shift: start it, watch the running totals, end it.
export default function ShiftPanel({ locations, defaultId }) {
  const { data: shift, isLoading, error } = useQuery({ queryKey: ['shift'], queryFn: shiftApi.current, refetchInterval: 30_000 })
  // Set by OpenShift when a shift is ended, to show the result once.
  const { data: justClosed } = useQuery({ queryKey: ['shift-closed'], queryFn: () => null, enabled: false })
  const locationNames = Object.fromEntries(locations.map((l) => [l._id, l.name]))

  return (
    <Card title="My shift">
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : shift ? (
        <OpenShift key={shift._id} shift={shift} locationName={locationNames[shift.locationId]} />
      ) : (
        <div className="space-y-4">
          {justClosed && <ClosedSummary shift={justClosed} />}
          <OpenShiftForm locations={locations} defaultId={defaultId} />
        </div>
      )}
    </Card>
  )
}
