import { useForm, useWatch } from 'react-hook-form'
import LocationPicker from '../maps/LocationPicker'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { locationDetailsSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Checkbox, Field, Select } from '../ui'
import { CAPACITY_FIELDS, VEHICLE_KEYS } from '../../utils/format'

const toForm = (l) => ({
  name: l.name,
  parkingType: l.parkingType || 'NORMAL',
  line1: l.address.line1 || '',
  city: l.address.city || '',
  state: l.address.state || '',
  pincode: l.address.pincode || '',
  lat: Number.isFinite(l.coordinates?.lat) ? String(l.coordinates.lat) : '',
  lng: Number.isFinite(l.coordinates?.lng) ? String(l.coordinates.lng) : '',
  contactName: l.contact?.name || '',
  contactPhone: l.contact?.phone || '',
  is24x7: l.operatingHours.is24x7,
  open: l.operatingHours.open,
  close: l.operatingHours.close,
  car: l.capacity.car,
  bike: l.capacity.bike,
  heavy: l.capacity.heavy,
  taxi: l.capacity.taxi || 0,
  tempo: l.capacity.tempo || 0,
  zones: l.zones.join(', '),
  onlineEnabled: Boolean(l.onlineBooking?.enabled),
  onlineNote: l.onlineBooking?.note || '',
  waitingMinutes: l.onlineBooking?.waitingMinutes || 0,
  cancelBeforeMinutes: l.onlineBooking?.cancelBeforeMinutes || 0,
  fee: Object.fromEntries(VEHICLE_KEYS.map((key) => [key, l.onlineBooking?.fees?.[key] || 0])),
})

const toBody = (v) => {
  const capacity = { car: v.car, bike: v.bike, heavy: v.heavy, taxi: v.taxi, tempo: v.tempo }
  return {
    name: v.name,
    parkingType: v.parkingType,
    address: { line1: v.line1, city: v.city, state: v.state, pincode: v.pincode },
    // Both numbers, or neither: an empty pair removes the saved position.
    coordinates: v.lat !== '' && v.lng !== '' && v.lat !== undefined && v.lng !== undefined
      ? { lat: Number(v.lat), lng: Number(v.lng) }
      : { clear: true },
    contact: { name: v.contactName, phone: v.contactPhone },
    operatingHours: { is24x7: v.is24x7, open: v.open, close: v.close },
    capacity,
    // A vehicle type is accepted when it has capacity.
    vehicleTypes: VEHICLE_KEYS.filter((k) => capacity[k] > 0).map((k) => k.toUpperCase()),
    zones: (v.zones || '').split(',').map((z) => z.trim()).filter(Boolean),
    onlineBooking: {
      enabled: v.onlineEnabled, note: v.onlineNote || '', fees: v.fee,
      waitingMinutes: v.waitingMinutes, cancelBeforeMinutes: v.cancelBeforeMinutes,
    },
  }
}

export default function DetailsForm({ location }) {
  const queryClient = useQueryClient()
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(locationDetailsSchema), defaultValues: toForm(location) })
  const is24x7 = useWatch({ control, name: 'is24x7' })
  const onlineEnabled = useWatch({ control, name: 'onlineEnabled' })
  const [lat, lng, line1, city, state, pincode] = useWatch({ control, name: ['lat', 'lng', 'line1', 'city', 'state', 'pincode'] })

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
        <Select label="Parking type" {...register('parkingType')}>
          <option value="NORMAL">Normal</option>
          <option value="AIRPORT">Airport (long stay)</option>
        </Select>
        <Field label="Address" error={errors.line1?.message} {...register('line1')} />
        <Field label="City" error={errors.city?.message} {...register('city')} />
        <Field label="State" error={errors.state?.message} {...register('state')} />
        <Field label="Pincode" inputMode="numeric" error={errors.pincode?.message} {...register('pincode')} />
        <Field label="Site contact name" error={errors.contactName?.message} {...register('contactName')} />
        <Field label="Site contact phone" type="tel" error={errors.contactPhone?.message} {...register('contactPhone')} />
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-slate-900">Position on the map</legend>
        <LocationPicker
          lat={lat || ''}
          lng={lng || ''}
          addressText={[line1, city, state, pincode].filter(Boolean).join(', ')}
          errors={{ lat: errors.lat?.message, lng: errors.lng?.message }}
          onChange={(p) => {
            setValue('lat', p.lat, { shouldDirty: true, shouldValidate: true })
            setValue('lng', p.lng, { shouldDirty: true, shouldValidate: true })
          }}
        />
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
          <Field label="Coach / Bus / Truck" type="number" min="0" error={errors.heavy?.message} {...register('heavy', number)} />
          <Field label="Taxis" type="number" min="0" error={errors.taxi?.message} {...register('taxi', number)} />
          <Field label="Tempo / SUV / Mini bus" type="number" min="0" error={errors.tempo?.message} {...register('tempo', number)} />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-slate-900">Zones</legend>
        <Field
          label="Zones / floors"
          placeholder="Basement 1, Basement 2, Open area"
          hint="Separate names with commas"
          error={errors.zones?.message}
          {...register('zones')}
        />
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-slate-900">Online booking</legend>
        <p className="mb-3 text-sm text-slate-600">
          Customers can book a space on the public page (<span className="font-mono">/book</span>) and pay a booking fee. The fee is set against the parking charge when the vehicle arrives. A fee of 0 means that class books free. Paid fees need an online payment gateway to be set up.
        </p>
        <Checkbox label="Take online bookings at this location" {...register('onlineEnabled')} />
        {onlineEnabled && (
          <div className="mt-3 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {CAPACITY_FIELDS.map(([label, key]) => (
                <Field key={key} label={`${label}: booking fee (₹)`} type="number" min="0" step="1" error={errors.fee?.[key]?.message} {...register(`fee.${key}`, number)} />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Waiting time (minutes)"
                type="number" min="0" step="1"
                hint="How long a booking waits after the arrival time. 0 = the standard 12 hours."
                error={errors.waitingMinutes?.message}
                {...register('waitingMinutes', number)}
              />
              <Field
                label="Customer can cancel until (minutes before arrival)"
                type="number" min="0" step="1"
                hint="0 = customers cannot cancel online. A booking that has been paid for cannot be cancelled by the customer."
                error={errors.cancelBeforeMinutes?.message}
                {...register('cancelBeforeMinutes', number)}
              />
            </div>
            <Field label="Note shown to customers (optional)" hint="For example: which gate to use" error={errors.onlineNote?.message} {...register('onlineNote')} />
          </div>
        )}
      </fieldset>

      <Button type="submit" loading={save.isPending}>
        Save location
      </Button>
    </form>
  )
}
