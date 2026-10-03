import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { locationDetailsSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Checkbox, Field, Select } from '../ui'

const toForm = (l) => ({
  name: l.name,
  line1: l.address.line1 || '',
  city: l.address.city || '',
  state: l.address.state || '',
  pincode: l.address.pincode || '',
  contactName: l.contact?.name || '',
  contactPhone: l.contact?.phone || '',
  is24x7: l.operatingHours.is24x7,
  open: l.operatingHours.open,
  close: l.operatingHours.close,
  car: l.capacity.car,
  bike: l.capacity.bike,
  heavy: l.capacity.heavy,
  zones: l.zones.join(', '),
  gates: l.gates.map((g) => ({ name: g.name, type: g.type })),
})

const toBody = (v) => {
  const capacity = { car: v.car, bike: v.bike, heavy: v.heavy }
  return {
    name: v.name,
    address: { line1: v.line1, city: v.city, state: v.state, pincode: v.pincode },
    contact: { name: v.contactName, phone: v.contactPhone },
    operatingHours: { is24x7: v.is24x7, open: v.open, close: v.close },
    capacity,
    // A vehicle type is accepted when it has capacity.
    vehicleTypes: ['car', 'bike', 'heavy'].filter((k) => capacity[k] > 0).map((k) => k.toUpperCase()),
    zones: (v.zones || '').split(',').map((z) => z.trim()).filter(Boolean),
    gates: v.gates,
  }
}

export default function DetailsForm({ location }) {
  const queryClient = useQueryClient()
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(locationDetailsSchema), defaultValues: toForm(location) })
  const gates = useFieldArray({ control, name: 'gates' })
  const is24x7 = useWatch({ control, name: 'is24x7' })

  const save = useMutation({
    mutationFn: (values) => locationApi.update(location._id, toBody(values)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['location', location._id], updated)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
    },
  })

  const number = { valueAsNumber: true }

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-6" noValidate>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Alert type="success">{save.isSuccess && 'Location saved.'}</Alert>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900">Address and contact</legend>
        <Field label="Parking name" error={errors.name?.message} {...register('name')} />
        <Field label="Address" error={errors.line1?.message} {...register('line1')} />
        <Field label="City" error={errors.city?.message} {...register('city')} />
        <Field label="State" error={errors.state?.message} {...register('state')} />
        <Field label="Pincode" inputMode="numeric" error={errors.pincode?.message} {...register('pincode')} />
        <Field label="Site contact name" error={errors.contactName?.message} {...register('contactName')} />
        <Field label="Site contact phone" type="tel" error={errors.contactPhone?.message} {...register('contactPhone')} />
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-slate-900">Operating hours</legend>
        <Checkbox label="Open 24 hours" {...register('is24x7')} />
        {!is24x7 && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Opens at" type="time" error={errors.open?.message} {...register('open')} />
            <Field label="Closes at" type="time" error={errors.close?.message} {...register('close')} />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-slate-900">Capacity (number of spaces)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cars" type="number" min="0" error={errors.car?.message} {...register('car', number)} />
          <Field label="Bikes" type="number" min="0" error={errors.bike?.message} {...register('bike', number)} />
          <Field label="Heavy vehicles" type="number" min="0" error={errors.heavy?.message} {...register('heavy', number)} />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-slate-900">Zones and gates</legend>
        <Field
          label="Zones / floors"
          placeholder="Basement 1, Basement 2, Open area"
          hint="Separate names with commas"
          error={errors.zones?.message}
          {...register('zones')}
        />
        <div className="mt-4 space-y-3">
          {gates.fields.map((gate, i) => (
            <div key={gate.id} className="flex flex-wrap items-end gap-3">
              <Field
                className="min-w-40 flex-1"
                label={`Gate ${i + 1} name`}
                error={errors.gates?.[i]?.name?.message}
                {...register(`gates.${i}.name`)}
              />
              <Select label="Used for" {...register(`gates.${i}.type`)}>
                <option value="BOTH">Entry and exit</option>
                <option value="ENTRY">Entry only</option>
                <option value="EXIT">Exit only</option>
              </Select>
              <Button type="button" variant="danger" onClick={() => gates.remove(i)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => gates.append({ name: '', type: 'BOTH' })}>
            Add gate
          </Button>
        </div>
      </fieldset>

      <Button type="submit" loading={save.isPending}>
        Save location
      </Button>
    </form>
  )
}
