import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationApi, userApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { locationSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { isCompanyWide } from '../../utils/roles'
import { Alert, Badge, Button, Card, Field, PageLoader } from '../../components/ui'
import { dateOnly } from '../../utils/format'
import printTable from '../../utils/printTable'
import { OPERATION_DEFAULTS } from '../../utils/operations'
import { defaultGates, laneCount } from '../../utils/lanes'
import { CAPACITY_FIELDS } from '../../utils/format'

const DEFAULTS = { name: '', line1: '', city: '', state: '', pincode: '', car: 0, bike: 0, heavy: 0, taxi: 0, tempo: 0 }

function CreateLocationForm({ onDone }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(locationSchema), defaultValues: DEFAULTS })

  const create = useMutation({
    mutationFn: ({ name, line1, city, state, pincode, car, bike, heavy, taxi, tempo }) =>
      locationApi.create({
        name,
        address: { line1, city, state, pincode },
        capacity: { car, bike, heavy, taxi, tempo },
        // Every location starts with an entry lane and an exit lane for 2-wheelers (Bike) and for 4-wheelers (Car).
        gates: defaultGates(),
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
          <Field label="Coach / Bus / Truck" type="number" min="0" error={errors.heavy?.message} {...register('heavy', number)} />
          <Field label="Taxis" type="number" min="0" error={errors.taxi?.message} {...register('taxi', number)} />
          <Field label="Tempo / SUV / Mini bus" type="number" min="0" error={errors.tempo?.message} {...register('tempo', number)} />
        </div>
      </fieldset>
      <Button type="submit" loading={create.isPending}>
        Create parking
      </Button>
    </form>
  )
}

const PAGE_SIZES = [10, 25, 50, 100]
const PARKING_TYPE = { NORMAL: 'Normal', AIRPORT: 'Airport' }
// The gate switches shown as columns: [heading, key in location.operations].
const SWITCHES = [
  ['Photo auto capture', 'photoAutoCapture'],
  ['Print photo', 'printPhoto'],
  ['Exit amount edit', 'exitAmountEdit'],
  ['Allow re-entry', 'allowReEntry'],
  ['Print ticket no.', 'printTicketNumber'],
  ['Print receipt pass vehicle', 'printPassReceipt'],
]
const total = (capacity) => CAPACITY_FIELDS.reduce((sum, [, key]) => sum + (capacity?.[key] || 0), 0)
const switchValue = (location, key) => {
  const value = location.operations?.[key]
  return typeof value === 'boolean' ? value : OPERATION_DEFAULTS[key]
}

// One on/off switch of a location's gate rules. Saves as soon as it is clicked.
function SwitchCell({ location, field, label, editable }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (value) => locationApi.update(location._id, { operations: { [field]: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['location', location._id], updated)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })
  return (
    <>
      <input
        type="checkbox"
        className="h-4 w-4 accent-blue-600"
        aria-label={`${label}: ${location.name}`}
        checked={switchValue(location, field)}
        disabled={!editable || save.isPending}
        onChange={(event) => save.mutate(event.target.checked)}
      />
      {save.error && <span className="block max-w-32 text-xs text-red-600">{errorMessage(save.error)}</span>}
    </>
  )
}

// A small window to change a location's capacity, like the one in the tables of other parking software.
function CapacityDialog({ location, onClose }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState(() => Object.fromEntries(CAPACITY_FIELDS.map(([, key]) => [key, location.capacity?.[key] || 0])))
  const save = useMutation({
    mutationFn: () => locationApi.update(location._id, { capacity: values, vehicleTypes: CAPACITY_FIELDS.filter(([, key]) => values[key] > 0).map(([, key]) => key.toUpperCase()) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['location', location._id], updated)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      onClose()
    },
  })
  const bad = Object.values(values).some((v) => !Number.isInteger(v) || v < 0 || v > 100000)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Update capacity of ${location.name}`}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Update capacity</h2>
        <p className="mb-3 text-sm text-slate-600">{location.name}. Spaces for each vehicle type; 0 means that type is not accepted.</p>
        <Alert>{save.error && errorMessage(save.error)}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPACITY_FIELDS.map(([label, key]) => (
            <Field key={key} label={label} type="number" min="0" value={values[key]}
              onChange={(event) => setValues((v) => ({ ...v, [key]: Number(event.target.value) }))} hint={location.occupied?.[key] ? `${location.occupied[key]} parked now` : undefined} />
          ))}
        </div>
        {bad && <p className="mt-2 text-sm text-red-600">Use whole numbers from 0 to 100000.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={save.isPending} disabled={bad} onClick={() => save.mutate()}>Update capacity</Button>
        </div>
      </div>
    </div>
  )
}

const linkClass = 'inline-block rounded-lg border border-blue-600 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50'

function LocationRow({ location, index, licence, validUpto, editable, canClose, onCapacity }) {
  const queryClient = useQueryClient()
  const close = useMutation({
    mutationFn: () => locationApi.deactivate(location._id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
    },
  })
  const detail = (tab) => `/dashboard/locations/${location._id}?tab=${tab}`
  const ops = location.operations || {}
  const autoOn = (ops.autoExitHours || 0) > 0 || (ops.autoExitRules || []).some((r) => r.active)
  const expired = validUpto && new Date(validUpto) < new Date()

  return (
    <tr className="border-b border-slate-100 align-middle">
      <td className="px-2 py-2">{index}</td>
      <td className="px-2 py-2 font-medium">
        <Link to={`/dashboard/locations/${location._id}`} className="text-blue-700 hover:underline">{location.name}</Link>
        {!location.isActive && <> <Badge tone="red">Closed</Badge></>}
      </td>
      <td className="px-2 py-2">{PARKING_TYPE[location.parkingType] || 'Normal'}</td>
      <td className="whitespace-nowrap px-2 py-2">
        {licence ? `${licence.used} / ${licence.limit === null ? '∞' : licence.limit}` : '—'}
      </td>
      <td className="whitespace-nowrap px-2 py-2">
        {validUpto ? (
          <>
            <span className={expired ? 'font-semibold text-red-600' : 'font-semibold text-green-700'}>{dateOnly(validUpto)}</span>
            <br />
            <Link to="/dashboard/subscriptions" className={linkClass}>Renew</Link>
          </>
        ) : '—'}
      </td>
      {SWITCHES.map(([label, field]) => (
        <td key={field} className="px-2 py-2 text-center">
          <SwitchCell location={location} field={field} label={label} editable={editable} />
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        <Link to={detail('autoexit')} className={`${linkClass} ${autoOn ? 'bg-green-50' : ''}`}>{autoOn ? 'ON' : 'OFF'}</Link>
      </td>
      <td className="px-2 py-2 text-center"><Link to={detail('tariffs')} className={linkClass}>View / Edit</Link></td>
      <td className="whitespace-nowrap px-2 py-2">
        {total(location.capacity)}
        {editable && <> <button type="button" className={linkClass} onClick={() => onCapacity(location)}>Update</button></>}
      </td>
      <td className="px-2 py-2 text-center"><Link to={detail('lanes')} className={linkClass}>{laneCount(location)} lane{laneCount(location) === 1 ? '' : 's'}</Link></td>
      <td className="whitespace-nowrap px-2 py-2 print:hidden">
        <Link to={`/dashboard/locations/${location._id}`} className={linkClass}>Edit</Link>
        {canClose && location.isActive && (
          <>
            {' '}
            <button
              type="button"
              disabled={close.isPending}
              className="inline-block rounded-lg border border-red-600 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
              onClick={() => {
                if (window.confirm(`Close "${location.name}"? Operators will no longer be able to use it.`)) close.mutate()
              }}
            >
              Close
            </button>
          </>
        )}
        {close.error && <span className="block max-w-40 text-xs text-red-600">{errorMessage(close.error)}</span>}
      </td>
    </tr>
  )
}

export default function Locations() {
  const { user, company, can } = useAuth()
  const [created, setCreated] = useState(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [size, setSize] = useState(25)
  const [page, setPage] = useState(0)
  const [capacityOf, setCapacityOf] = useState(null)
  const [fileError, setFileError] = useState('')
  const { data = [], isLoading, error } = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })
  // Seats and the valid-upto date come with the Users page; people who cannot open it simply do not see them.
  const licences = useQuery({ queryKey: ['licences'], queryFn: userApi.licences, retry: false, enabled: can('USER_MANAGE') })
  const licenceOf = useMemo(
    () => Object.fromEntries((licences.data?.locations || []).map((row) => [String(row.locationId), row])),
    [licences.data],
  )

  // Creating and closing locations is for company admins.
  const canCreate = can('LOCATION_MANAGE') && isCompanyWide(user.role) && Boolean(company)
  const editable = can('LOCATION_MANAGE')

  const shown = data.filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(shown.length / size))
  const current = Math.min(page, pages - 1)
  const rows = shown.slice(current * size, current * size + size)

  const download = async () => {
    setFileError('')
    try {
      await locationApi.download('xlsx')
    } catch (err) {
      setFileError(errorMessage(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Parking Location List</h1>
        {canCreate && (
          <Button type="button" variant="success" onClick={() => setAdding((open) => !open)}>
            {adding ? 'Close form' : '+ Add New Location'}
          </Button>
        )}
      </div>

      {canCreate && (adding || data.length === 0) && (
        <Card title={data.length === 0 ? 'Create your first parking' : 'Add a parking location'}>
          {created && <div className="mb-4"><Alert type="success">“{created.name}” was created.</Alert></div>}
          <CreateLocationForm onDone={(location) => { setCreated(location); setAdding(false) }} />
        </Card>
      )}
      {!adding && created && <Alert type="success">“{created.name}” was created.</Alert>}

      {error && <Alert>{errorMessage(error)}</Alert>}
      {fileError && <Alert>{fileError}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <p className="text-slate-500">No parking locations to show yet.</p>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Show
              <select className="rounded-lg border border-slate-300 px-2 py-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} records</option>)}
              </select>
              entries
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search" placeholder="Search by location" aria-label="Search by location"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              />
              <Button type="button" variant="info" onClick={download}>Download Excel</Button>
              <Button type="button" variant="dark" onClick={() => printTable(document.getElementById('location-table'), 'Parking locations')}>Print</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table id="location-table" className="w-full min-w-[78rem] text-left text-sm">
              <thead className="border-b border-slate-300 bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2">SN</th>
                  <th className="px-2 py-2">Location</th>
                  <th className="px-2 py-2">Parking type</th>
                  <th className="px-2 py-2">User licence</th>
                  <th className="px-2 py-2">Valid upto</th>
                  {SWITCHES.map(([label]) => <th key={label} className="px-2 py-2 text-center">{label}</th>)}
                  <th className="px-2 py-2 text-center">Auto exit</th>
                  <th className="px-2 py-2 text-center">Tariffs</th>
                  <th className="px-2 py-2">Capacity</th>
                  <th className="px-2 py-2 text-center">Lane</th>
                  <th className="px-2 py-2 print:hidden">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((location, i) => (
                  <LocationRow
                    key={location._id} location={location} index={current * size + i + 1}
                    licence={licenceOf[String(location._id)]} validUpto={licences.data?.validUpto}
                    editable={editable} canClose={canCreate} onCapacity={setCapacityOf}
                  />
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={16} className="px-2 py-6 text-center text-slate-500">No location matches “{search}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>
              {shown.length === 0 ? 'Showing 0 entries' : `Showing ${current * size + 1} to ${Math.min(shown.length, current * size + size)} of ${shown.length} entries`}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
              <span>Page {current + 1} of {pages}</span>
              <Button type="button" variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}
      {capacityOf && <CapacityDialog location={capacityOf} onClose={() => setCapacityOf(null)} />}
    </div>
  )
}
