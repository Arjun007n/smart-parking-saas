import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { slotApi } from '../../services/api'
import { slotBulkSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS } from '../../utils/format'
import { Alert, Badge, Button, Field, PageLoader, Select } from '../ui'

const SLOT_TYPES = { NORMAL: 'Normal', RESERVED: 'Reserved', EV: 'EV charging', ACCESSIBLE: 'Accessible', VIP: 'VIP' }
const STATUS = {
  FREE: { label: 'Free', tone: 'green' },
  OCCUPIED: { label: 'Occupied', tone: 'red' },
  MAINTENANCE: { label: 'Maintenance', tone: 'slate' },
}
const DEFAULTS = { prefix: 'A', start: 1, count: 10, zone: '', floor: '', vehicleType: 'CAR', type: 'NORMAL' }

function AddSlots({ locationId, zones }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(slotBulkSchema), defaultValues: DEFAULTS })

  const create = useMutation({
    mutationFn: ({ zone, floor, ...values }) =>
      slotApi.createBulk({ locationId, ...values, ...(zone ? { zone } : {}), ...(floor ? { floor } : {}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['slots', locationId] }),
  })

  const number = { valueAsNumber: true }

  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-4" noValidate>
      <Alert>{create.error && errorMessage(create.error)}</Alert>
      <Alert type="success">
        {create.isSuccess &&
          `${create.data.created} slots added.` +
            (create.data.skipped.length ? ` ${create.data.skipped.length} already existed and were skipped.` : '')}
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code prefix" hint="A gives A01, A02…" error={errors.prefix?.message} {...register('prefix')} />
        <Field label="Start number" type="number" min="0" error={errors.start?.message} {...register('start', number)} />
        <Field label="How many" type="number" min="1" max="500" error={errors.count?.message} {...register('count', number)} />
        <Field label="Zone / floor" list="zone-options" error={errors.zone?.message} {...register('zone')} />
        <datalist id="zone-options">
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <Select label="Vehicle type" error={errors.vehicleType?.message} {...register('vehicleType')}>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select label="Slot type" error={errors.type?.message} {...register('type')}>
          {Object.entries(SLOT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </div>
      <Button type="submit" loading={create.isPending}>
        Add slots
      </Button>
    </form>
  )
}

function SlotRow({ slot, locationId, canManage }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['slots', locationId] })
  const toggle = useMutation({
    mutationFn: () => slotApi.update(slot._id, { status: slot.status === 'FREE' ? 'MAINTENANCE' : 'FREE' }),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: () => slotApi.remove(slot._id), onSuccess: refresh })
  const error = toggle.error || remove.error

  return (
    <tr className="border-t border-slate-200">
      <td className="py-2 pr-4 font-medium text-slate-900">{slot.code}</td>
      <td className="py-2 pr-4 text-slate-600">{slot.zone || '—'}</td>
      <td className="py-2 pr-4">{VEHICLE_LABELS[slot.vehicleType]}</td>
      <td className="py-2 pr-4">{SLOT_TYPES[slot.type]}</td>
      <td className="py-2 pr-4">
        <Badge tone={STATUS[slot.status].tone}>{STATUS[slot.status].label}</Badge>
      </td>
      {canManage && (
        <td className="py-2 text-right">
          {slot.status !== 'OCCUPIED' && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>
                {slot.status === 'FREE' ? 'Set maintenance' : 'Set free'}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => window.confirm(`Remove slot ${slot.code}?`) && remove.mutate()}
              >
                Remove
              </Button>
            </div>
          )}
          {error && <p className="mt-1 text-sm text-red-600">{errorMessage(error)}</p>}
        </td>
      )}
    </tr>
  )
}

export default function SlotsPanel({ location, canManage }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['slots', location._id],
    queryFn: () => slotApi.list(location._id),
  })

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Slots are optional. Entry and exit work from the capacity numbers on the Details tab; add named
        slots only if you want to track individual bays.
      </p>

      {canManage && location.isActive && <AddSlots locationId={location._id} zones={location.zones} />}

      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data && data.slots.length > 0 ? (
        <>
          <p className="text-sm text-slate-700">
            {data.summary.total} slots · {data.summary.FREE} free · {data.summary.OCCUPIED} occupied ·{' '}
            {data.summary.MAINTENANCE} in maintenance
          </p>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Code</th>
                  <th className="pb-2 pr-4 font-medium">Zone</th>
                  <th className="pb-2 pr-4 font-medium">Vehicle</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  {canManage && <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.slots.map((slot) => (
                  <SlotRow key={slot._id} slot={slot} locationId={location._id} canManage={canManage} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        !error && <p className="text-sm text-slate-500">No slots added yet.</p>
      )}
    </div>
  )
}
