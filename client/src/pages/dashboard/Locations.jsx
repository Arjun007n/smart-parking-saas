import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { locationSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { isCompanyWide } from '../../utils/roles'
import { Alert, Badge, Button, Card, Field, PageLoader } from '../../components/ui'

const DEFAULTS = { name: '', line1: '', city: '', state: '', pincode: '', car: 0, bike: 0, heavy: 0 }

function CreateLocationForm({ onDone }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(locationSchema), defaultValues: DEFAULTS })

  const create = useMutation({
    mutationFn: ({ name, line1, city, state, pincode, car, bike, heavy }) =>
      locationApi.create({
        name,
        address: { line1, city, state, pincode },
        capacity: { car, bike, heavy },
      }),
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      reset(DEFAULTS)
      onDone(location)
    },
  })

  const number = { valueAsNumber: true }

  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-4" noValidate>
      <Alert>{create.error && errorMessage(create.error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parking name" placeholder="City Mall Parking" error={errors.name?.message} {...register('name')} />
        <Field label="Address" placeholder="MG Road" error={errors.line1?.message} {...register('line1')} />
        <Field label="City" error={errors.city?.message} {...register('city')} />
        <Field label="State" error={errors.state?.message} {...register('state')} />
        <Field label="Pincode" inputMode="numeric" error={errors.pincode?.message} {...register('pincode')} />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-900">Capacity (number of spaces)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cars" type="number" min="0" error={errors.car?.message} {...register('car', number)} />
          <Field label="Bikes" type="number" min="0" error={errors.bike?.message} {...register('bike', number)} />
          <Field label="Heavy vehicles" type="number" min="0" error={errors.heavy?.message} {...register('heavy', number)} />
        </div>
      </fieldset>
      <Button type="submit" loading={create.isPending}>
        Create parking
      </Button>
    </form>
  )
}

function LocationCard({ location, canClose }) {
  const queryClient = useQueryClient()
  const close = useMutation({
    mutationFn: () => locationApi.deactivate(location._id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
    },
  })

  const address = [location.address.line1, location.address.city, location.address.state, location.address.pincode]
    .filter(Boolean)
    .join(', ')

  const rows = [
    ['Cars', 'car'],
    ['Bikes', 'bike'],
    ['Heavy', 'heavy'],
  ].filter(([, key]) => location.capacity[key] > 0)

  return (
    <li className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">
            <Link to={`/dashboard/locations/${location._id}`} className="text-blue-700 hover:underline">
              {location.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">{address}</p>
        </div>
        <Badge tone={location.isActive ? 'green' : 'red'}>{location.isActive ? 'Active' : 'Closed'}</Badge>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No capacity set yet.</p>
      ) : (
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          {rows.map(([label, key]) => (
            <div key={key} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-semibold text-slate-900">
                {location.capacity[key] - location.occupied[key]} free of {location.capacity[key]}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {close.error && <p className="mt-3 text-sm text-red-600">{errorMessage(close.error)}</p>}
      <Link
        to={`/dashboard/locations/${location._id}`}
        className="mt-4 mr-2 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Details, slots and tariffs
      </Link>
      {canClose && location.isActive && (
        <Button
          variant="danger"
          className="mt-4"
          loading={close.isPending}
          onClick={() => {
            if (window.confirm(`Close "${location.name}"? Operators will no longer be able to use it.`)) {
              close.mutate()
            }
          }}
        >
          Close location
        </Button>
      )}
    </li>
  )
}

export default function Locations() {
  const { user, company, can } = useAuth()
  const [created, setCreated] = useState(null)
  const { data = [], isLoading, error } = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })

  // Creating and closing locations is for company admins.
  const canCreate = can('LOCATION_MANAGE') && isCompanyWide(user.role) && Boolean(company)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Parking Locations</h1>

      {canCreate && (
        <Card title={data.length === 0 ? 'Create your first parking' : 'Add a parking location'}>
          {created && <div className="mb-4"><Alert type="success">“{created.name}” was created.</Alert></div>}
          <CreateLocationForm onDone={setCreated} />
        </Card>
      )}

      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <p className="text-slate-500">No parking locations to show yet.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((location) => (
            <LocationCard key={location._id} location={location} canClose={canCreate} />
          ))}
        </ul>
      )}
    </div>
  )
}
