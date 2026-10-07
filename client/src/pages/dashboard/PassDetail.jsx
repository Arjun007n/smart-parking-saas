import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passApi, passCompanyApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useMyLocations } from '../../hooks/useMyLocations'
import { passContactSchema, passRenewSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { PASS_STATE, PAYMENT_LABELS, VEHICLE_LABELS, dateOnly, dateTime, lastDay, money } from '../../utils/format'
import { Alert, Badge, Button, Card, Field, PageLoader, Select } from '../../components/ui'
import QrCode from '../../components/QrCode'
import PassMoneyFields from '../../components/pass/PassMoneyFields'
import { MAX_PASS_VEHICLES, PASS_TYPE_LABELS, passMoneyPayload, termText } from '../../utils/pass'

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function RenewForm({ pass, locations, defaultLocationId }) {
  const queryClient = useQueryClient()
  const defaults = { locationId: defaultLocationId, unit: 'MONTH', count: 1, amount: 0, method: 'CASH', transactionId: '' }
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm({ resolver: zodResolver(passRenewSchema), defaultValues: defaults })

  const renew = useMutation({
    mutationFn: (values) => passApi.renew(pass._id, passMoneyPayload(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pass', pass._id] })
      queryClient.invalidateQueries({ queryKey: ['passes'] })
      queryClient.invalidateQueries({ queryKey: ['collection'] })
      queryClient.invalidateQueries({ queryKey: ['shift'] })
      reset({ ...defaults, locationId: defaultLocationId })
    },
  })

  const expired = pass.state === 'EXPIRED'
  return (
    <form onSubmit={handleSubmit((values) => renew.mutate(values))} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600">
        {expired
          ? 'This pass has ended. Renewing starts a new period from today.'
          : `Renewing adds the time after ${lastDay(pass.endDate)}, so no days are lost.`}
      </p>
      <Alert>{renew.error && errorMessage(renew.error)}</Alert>
      <Alert type="success">
        {renew.isSuccess && `Renewed. The pass now works until ${lastDay(renew.data.pass.endDate)}.`}
      </Alert>
      <PassMoneyFields register={register} errors={errors} locations={locations} />
      <Button type="submit" loading={renew.isPending}>Renew pass</Button>
    </form>
  )
}

// The holder's name, phone and email (the email receives the pass details and an ending-soon reminder).
function ContactCard({ pass, onChanged }) {
  const [done, setDone] = useState('')
  const [passCompanyId, setPassCompanyId] = useState(pass.passCompanyId || '')
  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const {
    register, handleSubmit, formState: { errors },
  } = useForm({
    resolver: zodResolver(passContactSchema),
    defaultValues: { holderName: pass.holderName || '', phone: pass.phone || '', email: pass.email || '' },
  })
  const save = useMutation({
    mutationFn: (values) => passApi.update(pass._id, { holderName: values.holderName, phone: values.phone || '', email: values.email || '', passCompanyId }),
    onSuccess: () => {
      setDone('Saved.')
      onChanged()
    },
  })
  return (
    <Card title="Holder contact">
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Alert type="success">{done}</Alert>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((values) => { setDone(''); save.mutate(values) })} noValidate>
        <Field label="Holder name" error={errors.holderName?.message} {...register('holderName')} />
        <Field label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        {(companies.data?.companies || []).length > 0 && (
          <div className="sm:col-span-2">
            <Select label="Company" name="pass-company" value={passCompanyId} onChange={(event) => setPassCompanyId(event.target.value)}>
              <option value="">No company</option>
              {companies.data.companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field
            label="Email"
            type="email"
            hint="Pass details and an ending-soon reminder are emailed here. Leave empty for none."
            error={errors.email?.message}
            {...register('email')}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" loading={save.isPending}>Save contact</Button>
        </div>
      </form>
    </Card>
  )
}

const CHANGE_LABELS = { ADDED: 'Added', REMOVED: 'Removed', REPLACED: 'Replaced' }

// Which vehicles may use the pass: add, replace, remove, plus the pass type and the vehicle limit.
function VehiclesCard({ pass, onChanged }) {
  const [plate, setPlate] = useState('')
  const [type, setType] = useState('CAR')
  const [replacing, setReplacing] = useState(null) // the plate being replaced
  const [newPlate, setNewPlate] = useState('')
  const [newType, setNewType] = useState('CAR')
  const [reason, setReason] = useState('')
  const [passType, setPassType] = useState(pass.passType || 'REGULAR')
  const [maxVehicles, setMaxVehicles] = useState(pass.maxVehicles || 1)
  const [done, setDone] = useState('')

  const finish = (message) => {
    setDone(message)
    setPlate('')
    setReplacing(null)
    setNewPlate('')
    setReason('')
    onChanged()
  }
  const add = useMutation({
    mutationFn: () => passApi.addVehicle(pass._id, { vehicleNumber: plate.trim(), vehicleType: type }),
    onSuccess: () => finish('Vehicle added.'),
  })
  const replace = useMutation({
    mutationFn: () =>
      passApi.replaceVehicle(pass._id, { from: replacing, to: newPlate.trim(), vehicleType: newType, reason: reason.trim() }),
    onSuccess: () => finish('Vehicle replaced.'),
  })
  const remove = useMutation({
    mutationFn: (body) => passApi.removeVehicle(pass._id, body),
    onSuccess: () => finish('Vehicle removed.'),
  })
  const [tagging, setTagging] = useState(null) // the vehicle whose tag is being edited
  const [tagText, setTagText] = useState('')
  const setTag = useMutation({
    mutationFn: () => passApi.setVehicleTag(pass._id, { vehicleNumber: tagging, tag: tagText.trim() }),
    onSuccess: () => {
      const cleared = !tagText.trim()
      setTagging(null)
      finish(cleared ? 'Tag removed.' : 'Tag saved.')
    },
  })
  const save = useMutation({
    mutationFn: () => passApi.update(pass._id, { passType, maxVehicles: Number(maxVehicles) }),
    onSuccess: () => finish('Saved.'),
  })
  const error = add.error || replace.error || remove.error || save.error || setTag.error

  const askRemove = (vehicleNumber) => {
    const why = window.prompt(`Why is ${vehicleNumber} being taken off this pass?`)
    if (why && why.trim().length >= 5) remove.mutate({ vehicleNumber, reason: why.trim().slice(0, 300) })
    else if (why !== null) window.alert('Please write at least 5 characters.')
  }

  const vehicles = pass.vehicles?.length ? pass.vehicles : [{ number: pass.vehicleNumber, type: pass.vehicleType }]
  const full = vehicles.length >= (pass.maxVehicles || 1)
  const busy = add.isPending || replace.isPending || remove.isPending || save.isPending || setTag.isPending

  return (
    <Card title="Vehicles">
      <Alert>{error && errorMessage(error)}</Alert>
      <Alert type="success">{done}</Alert>
      <ul className="mt-2 divide-y divide-slate-200 text-sm">
        {vehicles.map((v, index) => (
          <li key={v.number} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium text-slate-900">{v.number}</span>
                <span className="ml-2 text-slate-500">{VEHICLE_LABELS[v.type]}{index === 0 && vehicles.length > 1 ? ' · main' : ''}</span>
              </span>
              <span className="flex gap-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => { setTagging(v.number); setTagText(v.tag || '') }}>
                  {v.tag ? 'Change tag' : 'Add tag'}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => { setReplacing(v.number); setNewType(v.type) }}>Replace</Button>
                {vehicles.length > 1 && (
                  <Button type="button" variant="danger" disabled={busy} onClick={() => askRemove(v.number)}>Remove</Button>
                )}
              </span>
            </div>
            {v.tag && tagging !== v.number && (
              <p className="mt-1 text-xs text-slate-500">UHF tag <span className="font-mono">{v.tag}</span></p>
            )}
            {tagging === v.number && (
              <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field
                  label="UHF / RFID tag number"
                  name="tag-number"
                  autoCapitalize="characters"
                  hint="As printed on the tag or shown by the reader. Leave empty to remove the tag."
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" loading={setTag.isPending} onClick={() => setTag.mutate()}>Save tag</Button>
                  <Button type="button" variant="secondary" onClick={() => setTagging(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {replacing === v.number && (
              <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                <Field label="New vehicle number" name="replace-number" autoCapitalize="characters" value={newPlate} onChange={(e) => setNewPlate(e.target.value)} />
                <Select label="Type" name="replace-type" value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
                <Field className="sm:col-span-2" label="Reason (at least 5 characters)" name="replace-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2 sm:col-span-2">
                  <Button
                    type="button"
                    loading={replace.isPending}
                    disabled={newPlate.trim().length < 4 || reason.trim().length < 5}
                    onClick={() => replace.mutate()}
                  >
                    Replace {v.number}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setReplacing(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
        <Field className="min-w-44 flex-1" label="Add a vehicle" name="add-number" autoCapitalize="characters" value={plate} onChange={(e) => setPlate(e.target.value)} />
        <Select className="w-40" label="Type" name="add-type" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Button type="button" loading={add.isPending} disabled={full || plate.trim().length < 4} onClick={() => add.mutate()}>Add</Button>
      </div>
      {full && <p className="mt-2 text-xs text-slate-500">The pass allows {pass.maxVehicles || 1} vehicle(s). Raise the limit below to add more.</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
        <Select className="w-44" label="Pass type" name="detail-type" value={passType} onChange={(e) => setPassType(e.target.value)}>
          {Object.entries(PASS_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Field
          className="w-40"
          label="Vehicles allowed"
          name="detail-max"
          type="number"
          min={vehicles.length}
          max={MAX_PASS_VEHICLES}
          value={maxVehicles}
          onChange={(e) => setMaxVehicles(e.target.value)}
        />
        <Button type="button" variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>

      {pass.vehicleChanges?.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Vehicle history</h3>
          <ul className="space-y-1 text-xs text-slate-600">
            {[...pass.vehicleChanges].reverse().map((c, i) => (
              <li key={i}>
                {dateTime(c.at)} · {CHANGE_LABELS[c.action]}{' '}
                {c.action === 'REPLACED' ? `${c.from} with ${c.to}` : c.to || c.from}
                {c.reason ? ` (${c.reason})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export default function PassDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { locations, defaultId } = useMyLocations()
  const { data, isLoading, error } = useQuery({ queryKey: ['pass', id], queryFn: () => passApi.get(id) })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['pass', id] })
    queryClient.invalidateQueries({ queryKey: ['passes'] })
  }
  const change = useMutation({
    mutationFn: ({ action, reason }) => (action === 'resume' ? passApi.resume(id) : passApi[action](id, reason)),
    onSuccess: refresh,
  })

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>

  const { pass, payments } = data
  const state = PASS_STATE[pass.state] || PASS_STATE.ACTIVE
  const canManage = can('PASS_MANAGE')
  const allVehicles = pass.vehicles?.length ? pass.vehicles : [{ number: pass.vehicleNumber }]
  const names = pass.locationIds.length
    ? pass.locationIds.map((locationId) => locations.find((l) => l._id === locationId)?.name || 'Another location').join(', ')
    : 'Every location'

  const ask = (action, question) => {
    const reason = window.prompt(question)
    if (reason && reason.trim().length >= 5) change.mutate({ action, reason: reason.trim().slice(0, 300) })
    else if (reason !== null) window.alert('Please write at least 5 characters.')
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center justify-between">
        <Link to="/dashboard/passes" className="text-sm text-blue-700 hover:underline">← All passes</Link>
        <Button variant="secondary" onClick={() => window.print()}>Print pass card</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <article className="print-area rounded-xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Parking pass · {PASS_TYPE_LABELS[pass.passType] || 'Regular'}
              </p>
              <h1 className="text-2xl font-bold text-slate-900">{pass.vehicleNumber}</h1>
              <p className="text-slate-600">{VEHICLE_LABELS[pass.vehicleType]} · {pass.holderName}</p>
            </div>
            <Badge tone={state.tone}>{state.label}</Badge>
          </header>
          <div className="flex items-center justify-between gap-4 py-4">
            <dl className="flex-1 space-y-2">
              <Row label="Pass number"><span className="font-mono">{pass.passNumber}</span></Row>
              <Row label="Valid from">{dateOnly(pass.startDate)}</Row>
              <Row label="Last day">{lastDay(pass.endDate)}</Row>
              {allVehicles.length > 1 && <Row label="Vehicles">{allVehicles.map((v) => v.number).join(', ')}</Row>}
              <Row label="Works at">{names}</Row>
              {pass.phone && <Row label="Phone">{pass.phone}</Row>}
              {pass.email && <Row label="Email"><span className="no-print">{pass.email}</span></Row>}
              {pass.statusReason && <Row label="Reason">{pass.statusReason}</Row>}
            </dl>
            <QrCode value={pass.passNumber} size={112} label={`QR code for pass ${pass.passNumber}`} />
          </div>
          <p className="text-center text-xs text-slate-500">Show this pass or number plate at the gate. Free entry and exit while valid.</p>
        </article>

        {canManage && (
          <div className="no-print space-y-6">
            <Card title="Actions">
              <Alert>{change.error && errorMessage(change.error)}</Alert>
              <div className="mt-2 flex flex-wrap gap-2">
                {pass.status === 'ACTIVE' && (
                  <Button variant="secondary" loading={change.isPending} onClick={() => ask('suspend', 'Why is this pass being suspended? A suspended pass pays the normal tariff.')}>
                    Suspend
                  </Button>
                )}
                {pass.status === 'SUSPENDED' && (
                  <Button variant="secondary" loading={change.isPending} onClick={() => change.mutate({ action: 'resume' })}>
                    Resume
                  </Button>
                )}
                {pass.status !== 'CANCELLED' && (
                  <Button variant="danger" loading={change.isPending} onClick={() => ask('cancel', 'Why is this pass being cancelled? This cannot be undone.')}>
                    Cancel pass
                  </Button>
                )}
                {pass.status === 'CANCELLED' && <p className="text-sm text-slate-500">This pass is cancelled. Sell a new pass to restart.</p>}
              </div>
            </Card>

            {pass.status !== 'CANCELLED' && <ContactCard key={`${pass._id}-${pass.updatedAt}`} pass={pass} onChanged={refresh} />}
            {pass.status !== 'CANCELLED' && <VehiclesCard key={pass._id} pass={pass} onChanged={refresh} />}

            {pass.status !== 'CANCELLED' && (
              <Card title="Renew">
                {locations.length > 0 && <RenewForm pass={pass} locations={locations} defaultLocationId={defaultId} />}
              </Card>
            )}
          </div>
        )}
      </div>

      <Card title="Payments" className="no-print">
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Paid</th>
                  <th className="pb-2 pr-4 font-medium">For</th>
                  <th className="pb-2 pr-4 font-medium">Period</th>
                  <th className="pb-2 pr-4 font-medium">Method</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p._id} className="border-t border-slate-200">
                    <td className="py-2 pr-4">{dateTime(p.paidAt)}</td>
                    <td className="py-2 pr-4">{p.kind === 'NEW' ? 'New pass' : 'Renewal'}</td>
                    <td className="py-2 pr-4">
                      {dateOnly(p.periodStart)} – {lastDay(p.periodEnd)}
                      {p.periodCount && <span className="block text-xs text-slate-500">{termText(p.periodUnit, p.periodCount)}</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {PAYMENT_LABELS[p.method] || p.method}
                      {p.transactionId && <span className="block text-xs text-slate-500">{p.transactionId}</span>}
                    </td>
                    <td className="py-2 text-right">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
