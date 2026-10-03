import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { rememberLocation, useMyLocations } from '../../hooks/useMyLocations'
import { entrySchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime, newRequestKey } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader } from '../../components/ui'
import LocationPicker from '../../components/operator/LocationPicker'
import Availability from '../../components/operator/Availability'

function Ticket({ session, locationName, repeated }) {
  return (
    <div className="print-area rounded-xl border-2 border-dashed border-slate-400 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-slate-600">{locationName}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Parking ticket</p>
      <p className="mt-3 font-mono text-3xl font-bold tracking-wider text-slate-900">{session.ticketNumber}</p>
      <p className="mt-3 text-xl font-semibold text-slate-900">{session.vehicleNumber}</p>
      <p className="text-sm text-slate-600">
        {VEHICLE_LABELS[session.vehicleType]} · In at {dateTime(session.entryTime)}
        {session.entryGate ? ` · ${session.entryGate}` : ''}
      </p>
      <p className="mt-3 text-xs text-slate-500">Keep this ticket. A lost ticket may be charged extra.</p>
      {repeated && <p className="mt-2 text-xs text-slate-500">(This ticket was already created.)</p>}
      <Button variant="secondary" className="no-print mt-4" onClick={() => window.print()}>
        Print ticket
      </Button>
    </div>
  )
}

function EntryForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  // One key per entry attempt; kept across retries, renewed after success.
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [ticket, setTicket] = useState(null)
  const {
    register,
    control,
    handleSubmit,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(entrySchema),
    defaultValues: { locationId: defaultId, vehicleNumber: '', vehicleType: 'CAR', gate: '' },
  })
  const locationId = useWatch({ control, name: 'locationId' })
  const location = locations.find((l) => l._id === locationId)

  const create = useMutation({
    mutationFn: ({ gate, ...values }) =>
      parkingApi.entry({ ...values, ...(gate ? { gate } : {}), idempotencyKey: requestKey }),
    onSuccess: (data, values) => {
      setRequestKey(newRequestKey())
      rememberLocation(values.locationId)
      setTicket({ ...data, locationName: locations.find((l) => l._id === values.locationId)?.name })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      queryClient.invalidateQueries({ queryKey: ['entries'] })
      resetField('vehicleNumber')
      setFocus('vehicleNumber')
    },
  })

  const types = location ? location.vehicleTypes : Object.keys(VEHICLE_LABELS)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="New entry" className="no-print">
        <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-5" noValidate>
          <Alert>{create.error && errorMessage(create.error)}</Alert>
          <LocationPicker
            locations={locations}
            selectedId={locationId}
            register={register}
            errors={errors}
            gateTypes={['ENTRY', 'BOTH']}
          />
          <Field
            label="Vehicle number"
            placeholder="RJ14 AB 1234"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            className="[&_input]:text-xl [&_input]:font-semibold [&_input]:uppercase [&_input]:tracking-wider"
            error={errors.vehicleNumber?.message}
            {...register('vehicleNumber')}
          />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Vehicle type</legend>
            <div className="flex flex-wrap gap-3">
              {types.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
                >
                  <input type="radio" value={type} {...register('vehicleType')} />
                  {VEHICLE_LABELS[type]}
                </label>
              ))}
            </div>
            {errors.vehicleType && <p className="mt-1 text-sm text-red-600">{errors.vehicleType.message}</p>}
          </fieldset>
          <Button type="submit" loading={create.isPending} className="w-full py-3 text-base">
            Create ticket
          </Button>
        </form>
      </Card>

      <div className="space-y-6">
        {location && (
          <Card title="Availability" className="no-print">
            <Availability capacity={location.capacity} occupied={location.occupied} />
          </Card>
        )}
        {ticket && (
          <div role="status">
            <Ticket session={ticket.session} locationName={ticket.locationName} repeated={ticket.repeated} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function Entry() {
  const { locations, defaultId, isLoading, error } = useMyLocations()

  return (
    <div className="space-y-6">
      <h1 className="no-print text-2xl font-bold text-slate-900">Vehicle Entry</h1>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : locations.length === 0 ? (
        <Alert type="info">No open parking location is assigned to you. Ask your admin.</Alert>
      ) : (
        <EntryForm locations={locations} defaultId={defaultId} />
      )}
    </div>
  )
}
