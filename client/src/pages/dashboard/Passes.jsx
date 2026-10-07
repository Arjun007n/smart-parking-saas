import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passApi, passCompanyApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useMyLocations } from '../../hooks/useMyLocations'
import { passSaleSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { isCompanyWide } from '../../utils/roles'
import { PASS_STATE, VEHICLE_LABELS, lastDay, money, todayInput } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select, Textarea } from '../../components/ui'
import PassMoneyFields from '../../components/pass/PassMoneyFields'
import PassCompaniesPanel from '../../components/pass/PassCompaniesPanel'
import PassVehiclesPanel from '../../components/pass/PassVehiclesPanel'
import PassReceiptsPanel from '../../components/pass/PassReceiptsPanel'
import PassBulkBar from '../../components/pass/PassBulkBar'
import PassUsersPanel from '../../components/pass/PassUsersPanel'
import PassUploadPanel from '../../components/pass/PassUploadPanel'
import { PASS_TYPE_LABELS, MAX_PASS_VEHICLES, passMoneyPayload, vehicleList } from '../../utils/pass'

const FILTERS = [
  ['', 'All current'],
  ['ACTIVE', 'Active'],
  ['EXPIRING', 'Ending within 7 days'],
  ['UPCOMING', 'Starts later'],
  ['EXPIRED', 'Expired'],
  ['SUSPENDED', 'Suspended'],
  ['CANCELLED', 'Cancelled'],
]

function SellPassForm({ locations, defaultLocationId }) {
  const { user } = useAuth()
  const wide = isCompanyWide(user.role)
  const queryClient = useQueryClient()
  const defaults = {
    vehicleNumber: '', vehicleType: 'CAR', holderName: '', phone: '', email: '', notes: '', startDate: '',
    locationId: defaultLocationId, unit: 'MONTH', count: 1, passType: 'REGULAR', maxVehicles: 1, amount: 0, method: 'CASH', transactionId: '',
  }
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm({ resolver: zodResolver(passSaleSchema), defaultValues: defaults })
  const [everywhere, setEverywhere] = useState(wide)
  const [chosen, setChosen] = useState(() => locations.map((l) => l._id))
  const noCoverage = !everywhere && chosen.length === 0
  // Other vehicles that share the pass: [{ vehicleNumber, vehicleType }]
  const [extras, setExtras] = useState([])
  const [extrasError, setExtrasError] = useState('')
  // The firm or society the pass is for (optional; see the Companies tab).
  const [passCompanyId, setPassCompanyId] = useState('')
  const companies = useQuery({ queryKey: ['pass-companies', 'active'], queryFn: () => passCompanyApi.list({ active: 'true' }) })

  const sell = useMutation({
    mutationFn: (values) =>
      passApi.create({
        ...passMoneyPayload(values),
        vehicleNumber: values.vehicleNumber,
        vehicleType: values.vehicleType,
        passType: values.passType,
        maxVehicles: values.maxVehicles,
        ...(extras.length ? { extraVehicles: extras.map((v) => ({ vehicleNumber: v.vehicleNumber.trim(), vehicleType: v.vehicleType })) } : {}),
        holderName: values.holderName,
        ...(passCompanyId ? { passCompanyId } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
        ...(values.startDate ? { startDate: values.startDate } : {}),
        locationIds: everywhere ? [] : chosen,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passes'] })
      queryClient.invalidateQueries({ queryKey: ['pass-summary'] })
      queryClient.invalidateQueries({ queryKey: ['pass-companies'] })
      queryClient.invalidateQueries({ queryKey: ['collection'] })
      queryClient.invalidateQueries({ queryKey: ['shift'] })
      reset({ ...defaults, locationId: defaultLocationId })
      setExtras([])
      setPassCompanyId('')
    },
  })

  const submit = (values) => {
    if (noCoverage) return
    const plates = [values.vehicleNumber, ...extras.map((v) => v.vehicleNumber)].map((v) => v.replace(/[\s-]/g, '').toUpperCase())
    if (extras.some((v) => !/^[A-Za-z0-9]{4,12}$/.test(v.vehicleNumber.replace(/[\s-]/g, '')))) {
      setExtrasError('Each extra vehicle needs 4 to 12 letters and digits.')
    } else if (new Set(plates).size !== plates.length) {
      setExtrasError('The same vehicle number is listed twice.')
    } else if (plates.length > values.maxVehicles) {
      setExtrasError(`The pass allows ${values.maxVehicles} vehicle(s). Raise "Vehicles allowed" or remove one.`)
    } else {
      setExtrasError('')
      sell.mutate(values)
    }
  }
  const updateExtra = (index, patch) => setExtras((list) => list.map((v, i) => (i === index ? { ...v, ...patch } : v)))

  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <Alert>{sell.error && errorMessage(sell.error)}</Alert>
      <Alert type="success">
        {sell.isSuccess && (
          <>
            Pass {sell.data.pass.passNumber} sold for {vehicleList(sell.data.pass)}, valid until {lastDay(sell.data.pass.endDate)}.{' '}
            <Link className="font-semibold underline" to={`/dashboard/passes/${sell.data.pass._id}`}>Open pass</Link>
          </>
        )}
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Vehicle number" placeholder="RJ14 AB 1234" autoCapitalize="characters" error={errors.vehicleNumber?.message} {...register('vehicleNumber')} />
        <Select label="Vehicle type" error={errors.vehicleType?.message} {...register('vehicleType')}>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Field label="Holder name" error={errors.holderName?.message} {...register('holderName')} />
        <Field label="Phone (optional)" type="tel" error={errors.phone?.message} {...register('phone')} />
        {(companies.data?.companies || []).length > 0 && (
          <Select label="Company (optional)" name="sell-company" value={passCompanyId} onChange={(event) => setPassCompanyId(event.target.value)}>
            <option value="">No company</option>
            {companies.data.companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        )}
        <Field
          label="Email (optional)"
          type="email"
          hint="The holder gets the pass details and a reminder before it ends"
          error={errors.email?.message}
          {...register('email')}
        />
        <Field
          label="Starts on (optional)"
          type="date"
          min={todayInput()}
          hint="Leave empty to start today."
          error={errors.startDate?.message}
          {...register('startDate')}
        />
        <Select label="Pass type" error={errors.passType?.message} {...register('passType')}>
          {Object.entries(PASS_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Field
          label="Vehicles allowed"
          type="number"
          min="1"
          max={MAX_PASS_VEHICLES}
          hint="1 for a single vehicle; more lets a family or firm share one pass."
          error={errors.maxVehicles?.message}
          {...register('maxVehicles', { valueAsNumber: true })}
        />
        <Textarea className="sm:col-span-2" label="Notes (optional)" rows={2} error={errors.notes?.message} {...register('notes')} />
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-700">Other vehicles on this pass (optional)</legend>
        {extras.map((extra, index) => (
          <div key={index} className="mb-3 flex flex-wrap items-end gap-3">
            <Field
              className="min-w-48 flex-1"
              label={`Vehicle ${index + 2} number`}
              name={`extra-number-${index}`}
              value={extra.vehicleNumber}
              autoCapitalize="characters"
              onChange={(e) => updateExtra(index, { vehicleNumber: e.target.value })}
            />
            <Select
              className="w-44"
              label="Type"
              name={`extra-type-${index}`}
              value={extra.vehicleType}
              onChange={(e) => updateExtra(index, { vehicleType: e.target.value })}
            >
              {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={() => setExtras((list) => list.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        ))}
        {extrasError && <p className="mb-2 text-sm text-red-600">{extrasError}</p>}
        <Button
          type="button"
          variant="secondary"
          disabled={extras.length + 1 >= MAX_PASS_VEHICLES}
          onClick={() => setExtras((list) => [...list, { vehicleNumber: '', vehicleType: 'CAR' }])}
        >
          Add another vehicle
        </Button>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-700">Works at</legend>
        {wide && (
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
            Every location of the company
          </label>
        )}
        {!everywhere && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {locations.map((l) => (
              <label key={l._id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={chosen.includes(l._id)} onChange={() => toggle(l._id)} />
                {l.name}
              </label>
            ))}
          </div>
        )}
        {noCoverage && <p className="mt-2 text-sm text-red-600">Choose at least one location.</p>}
      </fieldset>

      <PassMoneyFields register={register} errors={errors} locations={locations} />
      <Button type="submit" loading={sell.isPending}>Sell pass</Button>
    </form>
  )
}

const TABS = [['passes', 'Passes'], ['users', 'Pass users'], ['companies', 'Companies'], ['vehicles', 'Vehicles'], ['receipts', 'Receipts'], ['upload', 'Bulk upload']]

function SummaryTiles() {
  const { data } = useQuery({ queryKey: ['pass-summary'], queryFn: passApi.summary })
  if (!data) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {[
        ['Companies', data.companies],
        ['Pass users', data.users],
        ['Passes', data.passes],
        ['Vehicles', data.vehicles],
        ['Valid now', data.active],
        ['Ending in 7 days', data.expiring],
        ['Ended', data.expired],
        ['Paid by valid passes', money(data.activeRevenue)],
      ].map(([label, value]) => (
        <div key={label} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-lg font-bold text-slate-900">{value}</p>
        </div>
      ))}
    </div>
  )
}

export default function Passes() {
  const [tab, setTab] = useState('passes')
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Parking passes</h1>
      <SummaryTiles />
      <div role="tablist" aria-label="Pass sections" className="flex gap-1 border-b border-slate-300">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'passes' && <PassList />}
      {tab === 'users' && <PassUsersPanel />}
      {tab === 'companies' && <PassCompaniesPanel />}
      {tab === 'vehicles' && <PassVehiclesPanel />}
      {tab === 'receipts' && <PassReceiptsPanel />}
      {tab === 'upload' && <PassUploadPanel />}
    </div>
  )
}

function PassList() {
  const { company } = useAuth()
  const { locations, defaultId, isLoading: locationsLoading } = useMyLocations()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState({ q: '', state: '', type: '', passCompanyId: '', locationId: '', page: 1 })
  // Passes ticked for a change that applies to all of them.
  const [chosen, setChosen] = useState([])
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['passes', search],
    queryFn: () =>
      passApi.list({
        ...(search.q ? { q: search.q } : {}),
        ...(search.state ? { state: search.state } : {}),
        ...(search.type ? { type: search.type } : {}),
        ...(search.passCompanyId ? { passCompanyId: search.passCompanyId } : {}),
        ...(search.locationId ? { locationId: search.locationId } : {}),
        page: search.page,
      }),
    placeholderData: keepPreviousData,
  })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const rows = data ? data.passes : []
  const allChosen = rows.length > 0 && rows.every((p) => chosen.includes(p._id))
  const toggleOne = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const toggleAll = () => setChosen((list) => (allChosen ? list.filter((id) => !rows.some((p) => p._id === id)) : [...new Set([...list, ...rows.map((p) => p._id)])]))

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-slate-600">
        A vehicle with a valid pass (daily, weekly or monthly) drives in and out without paying the tariff. A lost ticket costs a pass holder nothing.
        When the pass ends, the normal tariff applies again.
      </p>

      {company && (
        <Card title="Sell a pass">
          {locationsLoading ? (
            <PageLoader />
          ) : locations.length === 0 ? (
            <p className="text-sm text-slate-500">Add a parking location first.</p>
          ) : (
            <SellPassForm locations={locations} defaultLocationId={defaultId} />
          )}
        </Card>
      )}

      <Card title="Passes">
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
            label="Vehicle, pass number, holder or phone"
            name="pass-search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Select
            className="w-56"
            label="Show"
            name="pass-state"
            value={search.state}
            onChange={(event) => setSearch((s) => ({ ...s, state: event.target.value, page: 1 }))}
          >
            {FILTERS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
          <Select
            className="w-44"
            label="Type"
            name="pass-type"
            value={search.type}
            onChange={(event) => setSearch((s) => ({ ...s, type: event.target.value, page: 1 }))}
          >
            <option value="">All types</option>
            {Object.entries(PASS_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
          {(companies.data?.companies || []).length > 0 && (
            <Select
              className="w-48"
              label="Company"
              name="pass-company"
              value={search.passCompanyId}
              onChange={(event) => setSearch((s) => ({ ...s, passCompanyId: event.target.value, page: 1 }))}
            >
              <option value="">All companies</option>
              {companies.data.companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          )}
          {locations.length > 1 && (
            <Select
              className="w-48"
              label="Location"
              name="pass-location"
              value={search.locationId}
              onChange={(event) => setSearch((s) => ({ ...s, locationId: event.target.value, page: 1 }))}
            >
              <option value="">All locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </Select>
          )}
          <Button type="submit" loading={isFetching}>Search</Button>
        </form>

        {chosen.length > 0 && <PassBulkBar ids={chosen} onDone={() => setChosen([])} />}

        {error && <Alert>{errorMessage(error)}</Alert>}
        {isLoading ? (
          <PageLoader />
        ) : data && data.passes.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">
                      <input type="checkbox" className="h-4 w-4" aria-label="Choose all passes on this page" checked={allChosen} onChange={toggleAll} />
                    </th>
                    <th className="pb-2 pr-4 font-medium">Vehicle</th>
                    <th className="pb-2 pr-4 font-medium">Holder</th>
                    <th className="pb-2 pr-4 font-medium">Pass number</th>
                    <th className="pb-2 pr-4 font-medium">Last day</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.passes.map((pass) => {
                    const state = PASS_STATE[pass.state] || PASS_STATE.ACTIVE
                    return (
                      <tr key={pass._id} className="border-t border-slate-200">
                        <td className="py-3 pr-3">
                          <input type="checkbox" className="h-4 w-4" aria-label={`Choose pass ${pass.passNumber}`} checked={chosen.includes(pass._id)} onChange={() => toggleOne(pass._id)} />
                        </td>
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          {vehicleList(pass)}
                          <span className="block text-xs font-normal text-slate-500">
                            {VEHICLE_LABELS[pass.vehicleType]} · {PASS_TYPE_LABELS[pass.passType] || 'Regular'}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {pass.holderName}
                          {pass.phone && <span className="block text-slate-500">{pass.phone}</span>}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">{pass.passNumber}</td>
                        <td className="py-3 pr-4">{lastDay(pass.endDate)}</td>
                        <td className="py-3 pr-4"><Badge tone={state.tone}>{state.label}</Badge></td>
                        <td className="py-3 text-right">
                          <Link className="font-medium text-blue-700 hover:underline" to={`/dashboard/passes/${pass._id}`}>Open</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>{data.total} passes · page {data.page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={search.page <= 1} onClick={() => setSearch((s) => ({ ...s, page: s.page - 1 }))}>Previous</Button>
                <Button variant="secondary" disabled={search.page >= pages} onClick={() => setSearch((s) => ({ ...s, page: s.page + 1 }))}>Next</Button>
              </div>
            </div>
          </>
        ) : (
          !error && <p className="text-sm text-slate-500">No passes found.</p>
        )}
      </Card>
    </div>
  )
}
