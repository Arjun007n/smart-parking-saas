import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { vehicleApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { vehicleSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'

const DEFAULTS = { plateNumber: '', type: 'CAR', ownerName: '', phone: '' }

function AddVehicleForm() {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(vehicleSchema), defaultValues: DEFAULTS })

  const create = useMutation({
    mutationFn: ({ ownerName, phone, ...values }) =>
      vehicleApi.create({ ...values, ...(ownerName ? { ownerName } : {}), ...(phone ? { phone } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      reset(DEFAULTS)
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-4" noValidate>
      <Alert>{create.error && errorMessage(create.error)}</Alert>
      <Alert type="success">{create.isSuccess && `${create.data.plateNumber} was added.`}</Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Vehicle number"
          placeholder="RJ14 AB 1234"
          autoCapitalize="characters"
          error={errors.plateNumber?.message}
          {...register('plateNumber')}
        />
        <Select label="Type" error={errors.type?.message} {...register('type')}>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Field label="Owner name (optional)" error={errors.ownerName?.message} {...register('ownerName')} />
        <Field label="Phone (optional)" type="tel" error={errors.phone?.message} {...register('phone')} />
      </div>
      <Button type="submit" loading={create.isPending}>
        Add vehicle
      </Button>
    </form>
  )
}

function VehicleRow({ vehicle, canManage }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (body) => vehicleApi.update(vehicle._id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  const toggleBlock = () => {
    if (vehicle.isBlocked) {
      change.mutate({ isBlocked: false })
      return
    }
    const reason = window.prompt(`Why is ${vehicle.plateNumber} being blocked? It will be refused at entry.`)
    if (reason && reason.trim()) change.mutate({ isBlocked: true, blockedReason: reason.trim().slice(0, 200) })
  }

  return (
    <tr className="border-t border-slate-200">
      <td className="py-3 pr-4 font-medium text-slate-900">{vehicle.plateNumber}</td>
      <td className="py-3 pr-4">{VEHICLE_LABELS[vehicle.type]}</td>
      <td className="py-3 pr-4 text-slate-600">
        {vehicle.ownerName || '—'}
        {vehicle.phone && <span className="block text-slate-500">{vehicle.phone}</span>}
      </td>
      <td className="py-3 pr-4">
        {vehicle.isBlocked ? (
          <>
            <Badge tone="red">Blocked</Badge>
            <span className="mt-1 block text-xs text-slate-500">{vehicle.blockedReason}</span>
          </>
        ) : (
          <Badge tone="green">Allowed</Badge>
        )}
      </td>
      {canManage && (
        <td className="py-3 text-right">
          <Button variant={vehicle.isBlocked ? 'secondary' : 'danger'} loading={change.isPending} onClick={toggleBlock}>
            {vehicle.isBlocked ? 'Unblock' : 'Block'}
          </Button>
          {change.error && <p className="mt-1 text-sm text-red-600">{errorMessage(change.error)}</p>}
        </td>
      )}
    </tr>
  )
}

export default function Vehicles() {
  const { company, can } = useAuth()
  const canManage = can('VEHICLE_MANAGE')
  const [input, setInput] = useState('')
  const [search, setSearch] = useState({ q: '', blocked: false, page: 1 })

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['vehicles', search],
    queryFn: () =>
      vehicleApi.list({
        ...(search.q ? { q: search.q } : {}),
        ...(search.blocked ? { blocked: 'true' } : {}),
        page: search.page,
      }),
    placeholderData: keepPreviousData,
  })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Vehicles</h1>

      {canManage && company && (
        <Card title="Add a vehicle">
          <AddVehicleForm />
        </Card>
      )}

      <Card title="Find a vehicle">
        <form
          role="search"
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch((s) => ({ ...s, q: input.trim(), page: 1 }))
          }}
        >
          <Field
            className="min-w-56 flex-1"
            label="Vehicle number or phone"
            name="vehicle-search"
            placeholder="RJ14…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" loading={isFetching}>Search</Button>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={search.blocked}
              onChange={(event) => setSearch((s) => ({ ...s, blocked: event.target.checked, page: 1 }))}
            />
            Blocked only
          </label>
        </form>

        {error && <Alert>{errorMessage(error)}</Alert>}
        {isLoading ? (
          <PageLoader />
        ) : data && data.vehicles.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Vehicle number</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Owner</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    {canManage && <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.vehicles.map((vehicle) => (
                    <VehicleRow key={vehicle._id} vehicle={vehicle} canManage={canManage} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>{data.total} vehicles · page {data.page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={search.page <= 1} onClick={() => setSearch((s) => ({ ...s, page: s.page - 1 }))}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={search.page >= pages} onClick={() => setSearch((s) => ({ ...s, page: s.page + 1 }))}>
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          !error && <p className="text-sm text-slate-500">No vehicles found.</p>
        )}
      </Card>
    </div>
  )
}
