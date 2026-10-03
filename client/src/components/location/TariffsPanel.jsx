import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tariffApi } from '../../services/api'
import { feePreviewSchema, tariffSchema, toOptionalNumber } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { DAY_LABELS, VEHICLE_LABELS, duration, money } from '../../utils/format'
import { Alert, Badge, Button, Checkbox, Field, PageLoader, Select } from '../ui'

const NEW_TARIFF = {
  name: '',
  vehicleType: 'CAR',
  gracePeriodMinutes: 10,
  slabs: [{ uptoMinutes: 60, rate: 20 }],
  additionalPerHour: 20,
  minimumFee: 0,
  maxDailyFee: undefined,
  overnightFee: undefined,
  lostTicketFee: undefined,
  taxPercent: 18,
  taxInclusive: true,
  daysOfWeek: [],
}

const toForm = (t) => ({
  name: t.name,
  vehicleType: t.vehicleType,
  gracePeriodMinutes: t.gracePeriodMinutes,
  slabs: t.slabs.map((s) => ({ uptoMinutes: s.uptoMinutes, rate: s.rate })),
  additionalPerHour: t.additionalPerHour,
  minimumFee: t.minimumFee,
  maxDailyFee: t.maxDailyFee,
  overnightFee: t.overnightFee,
  lostTicketFee: t.lostTicketFee,
  taxPercent: t.taxPercent,
  taxInclusive: t.taxInclusive,
  daysOfWeek: t.daysOfWeek.map(String),
})

// Optional amounts are sent as null when empty so the server clears them.
const toBody = ({ vehicleType, daysOfWeek, maxDailyFee, overnightFee, lostTicketFee, ...rest }, isEdit) => ({
  ...rest,
  ...(isEdit ? {} : { vehicleType }),
  daysOfWeek: daysOfWeek.map(Number).sort(),
  ...Object.fromEntries(
    Object.entries({ maxDailyFee, overnightFee, lostTicketFee })
      .filter(([, value]) => value !== undefined || isEdit)
      .map(([key, value]) => [key, value ?? null]),
  ),
})

function TariffForm({ locationId, tariff, onClose }) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(tariff)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(tariffSchema), defaultValues: tariff ? toForm(tariff) : NEW_TARIFF })
  const slabs = useFieldArray({ control, name: 'slabs' })

  const save = useMutation({
    mutationFn: (values) =>
      isEdit
        ? tariffApi.update(tariff._id, toBody(values, true))
        : tariffApi.create({ locationId, ...toBody(values, false) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tariffs', locationId] })
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      onClose()
    },
  })

  const number = { valueAsNumber: true }
  const optional = { setValueAs: toOptionalNumber }

  return (
    <form
      onSubmit={handleSubmit((values) => save.mutate(values))}
      className="space-y-5 rounded-lg bg-slate-50 p-4"
      noValidate
    >
      <h3 className="font-semibold text-slate-900">{isEdit ? `Edit “${tariff.name}”` : 'New tariff'}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tariff name" placeholder="Car standard" error={errors.name?.message} {...register('name')} />
        <Select label="Vehicle type" disabled={isEdit} error={errors.vehicleType?.message} {...register('vehicleType')}>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Field
          label="Grace period (minutes)"
          type="number"
          min="0"
          hint="Free if the vehicle leaves within this time"
          error={errors.gracePeriodMinutes?.message}
          {...register('gracePeriodMinutes', number)}
        />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-slate-900">Duration slabs</legend>
        <p className="mb-3 text-xs text-slate-500">
          Each row is the total fee for a stay up to that many minutes. Example: up to 60 = ₹20, up to 180 = ₹50.
        </p>
        <div className="space-y-3">
          {slabs.fields.map((slab, i) => (
            <div key={slab.id} className="flex flex-wrap items-start gap-3">
              <Field
                className="w-40"
                label="Up to (minutes)"
                type="number"
                min="1"
                error={errors.slabs?.[i]?.uptoMinutes?.message}
                {...register(`slabs.${i}.uptoMinutes`, number)}
              />
              <Field
                className="w-40"
                label="Fee (₹)"
                type="number"
                min="0"
                step="0.01"
                error={errors.slabs?.[i]?.rate?.message}
                {...register(`slabs.${i}.rate`, number)}
              />
              <Button type="button" variant="danger" className="mt-6" onClick={() => slabs.remove(i)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => slabs.append({ uptoMinutes: 0, rate: 0 })}>
            Add slab
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="After last slab, per hour (₹)"
          type="number"
          min="0"
          step="0.01"
          hint="Charged for each started hour"
          error={errors.additionalPerHour?.message}
          {...register('additionalPerHour', number)}
        />
        <Field label="Minimum fee (₹)" type="number" min="0" step="0.01" error={errors.minimumFee?.message} {...register('minimumFee', number)} />
        <Field
          label="Maximum per 24 hours (₹)"
          type="number"
          min="0"
          step="0.01"
          hint="Leave empty for no limit"
          error={errors.maxDailyFee?.message}
          {...register('maxDailyFee', optional)}
        />
        <Field
          label="Overnight charge (₹)"
          type="number"
          min="0"
          step="0.01"
          hint="Added for each midnight crossed"
          error={errors.overnightFee?.message}
          {...register('overnightFee', optional)}
        />
        <Field
          label="Lost ticket penalty (₹)"
          type="number"
          min="0"
          step="0.01"
          hint="Added to the parking fee"
          error={errors.lostTicketFee?.message}
          {...register('lostTicketFee', optional)}
        />
        <Field label="Tax (%)" type="number" min="0" max="100" step="0.01" error={errors.taxPercent?.message} {...register('taxPercent', number)} />
      </div>

      <Checkbox label="Prices above already include tax" {...register('taxInclusive')} />

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-900">Applies on</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {DAY_LABELS.map((label, day) => (
            <Checkbox key={label} label={label} value={String(day)} {...register('daysOfWeek')} />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Leave all unticked for every day. A tariff limited to certain days is used instead of an every-day tariff.
        </p>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>
          {isEdit ? 'Save tariff' : 'Create tariff'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function TariffCard({ tariff, onEdit }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: () =>
      tariff.isActive ? tariffApi.deactivate(tariff._id) : tariffApi.update(tariff._id, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tariffs', tariff.locationId] })
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
    },
  })

  const rules = [
    tariff.gracePeriodMinutes > 0 && `${tariff.gracePeriodMinutes} min free`,
    ...tariff.slabs.map((s) => `up to ${duration(s.uptoMinutes)}: ${money(s.rate)}`),
    tariff.additionalPerHour > 0 && `then ${money(tariff.additionalPerHour)} per hour`,
    tariff.maxDailyFee != null && `max ${money(tariff.maxDailyFee)} per 24 h`,
    tariff.overnightFee > 0 && `overnight +${money(tariff.overnightFee)}`,
    tariff.lostTicketFee > 0 && `lost ticket +${money(tariff.lostTicketFee)}`,
    tariff.taxPercent > 0 && `${tariff.taxPercent}% tax ${tariff.taxInclusive ? 'included' : 'extra'}`,
  ].filter(Boolean)

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{tariff.name}</h3>
          <Badge tone="blue">{VEHICLE_LABELS[tariff.vehicleType]}</Badge>
          <Badge tone={tariff.isActive ? 'green' : 'slate'}>{tariff.isActive ? 'Active' : 'Off'}</Badge>
          {tariff.daysOfWeek.length > 0 && (
            <Badge>{tariff.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')} only</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}>Edit</Button>
          <Button variant={tariff.isActive ? 'danger' : 'secondary'} loading={change.isPending} onClick={() => change.mutate()}>
            {tariff.isActive ? 'Switch off' : 'Switch on'}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">{rules.join(' · ')}</p>
      {change.error && <p className="mt-2 text-sm text-red-600">{errorMessage(change.error)}</p>}
    </li>
  )
}

function FeePreview({ locationId }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(feePreviewSchema),
    defaultValues: { vehicleType: 'CAR', entryTime: '', exitTime: '', lostTicket: false },
  })

  const preview = useMutation({
    mutationFn: ({ entryTime, exitTime, ...rest }) =>
      tariffApi.preview({
        locationId,
        ...rest,
        entryTime: new Date(entryTime).toISOString(),
        exitTime: new Date(exitTime).toISOString(),
      }),
  })
  const fee = preview.data?.fee

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-900">Try a fee calculation</h3>
      <p className="mt-1 text-sm text-slate-600">Check what a visit would cost with the tariffs above.</p>
      <form onSubmit={handleSubmit((values) => preview.mutate(values))} className="mt-4 space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Vehicle type" error={errors.vehicleType?.message} {...register('vehicleType')}>
            {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
          <Field label="Entry" type="datetime-local" error={errors.entryTime?.message} {...register('entryTime')} />
          <Field label="Exit" type="datetime-local" error={errors.exitTime?.message} {...register('exitTime')} />
        </div>
        <Checkbox label="Ticket was lost" {...register('lostTicket')} />
        <Button type="submit" variant="secondary" loading={preview.isPending}>
          Calculate
        </Button>
      </form>

      {preview.error && <div className="mt-4"><Alert>{errorMessage(preview.error)}</Alert></div>}
      {fee && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between"><dt className="text-slate-500">Tariff used</dt><dd>{preview.data.tariff.name}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Duration</dt><dd>{duration(fee.durationMinutes)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Parking fee</dt><dd>{money(fee.breakdown.base)}</dd></div>
          {fee.breakdown.overnight > 0 && (
            <div className="flex justify-between"><dt className="text-slate-500">Overnight</dt><dd>{money(fee.breakdown.overnight)}</dd></div>
          )}
          {fee.breakdown.lostTicket > 0 && (
            <div className="flex justify-between"><dt className="text-slate-500">Lost ticket</dt><dd>{money(fee.breakdown.lostTicket)}</dd></div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate-500">Tax ({fee.taxPercent}%{fee.taxInclusive ? ', included' : ''})</dt>
            <dd>{money(fee.tax)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-slate-900 sm:col-span-2">
            <dt>Total to pay{fee.reason === 'GRACE_PERIOD' ? ' (within grace period)' : ''}</dt>
            <dd>{money(fee.total)}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}

export default function TariffsPanel({ location }) {
  // null = closed, 'new' = create form, or the tariff being edited.
  const [editing, setEditing] = useState(null)
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['tariffs', location._id],
    queryFn: () => tariffApi.list(location._id),
  })

  return (
    <div className="space-y-6">
      {error && <Alert>{errorMessage(error)}</Alert>}

      {editing ? (
        <TariffForm
          key={editing === 'new' ? 'new' : editing._id}
          locationId={location._id}
          tariff={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : (
        <Button onClick={() => setEditing('new')}>Add tariff</Button>
      )}

      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">
          No tariffs yet. Vehicles cannot be charged at exit until each vehicle type has a tariff.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.map((tariff) => (
            <TariffCard key={tariff._id} tariff={tariff} onEdit={() => setEditing(tariff)} />
          ))}
        </ul>
      )}

      {data.some((t) => t.isActive) && <FeePreview locationId={location._id} />}
    </div>
  )
}
