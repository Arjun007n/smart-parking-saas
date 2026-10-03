import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parkingApi, paymentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { rememberLocation, useMyLocations } from '../../hooks/useMyLocations'
import { exitLookupSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, dateTime, duration, money } from '../../utils/format'
import { Alert, Button, Card, Checkbox, Field, PageLoader } from '../../components/ui'
import LocationPicker from '../../components/operator/LocationPicker'

const looksLikeTicket = (text) => /^t-?\d{6}/i.test(text.trim())
const METHODS = ['CASH', 'UPI', 'CARD']

function SessionSummary({ session }) {
  const fee = session.fee
  const rows = [
    ['Vehicle', `${session.vehicleNumber} (${VEHICLE_LABELS[session.vehicleType]})`],
    ['Ticket', session.ticketNumber],
    ['Entered', dateTime(session.entryTime)],
    ['Duration', duration(session.durationMinutes)],
    ['Parking fee', money(fee.breakdown.base)],
    fee.breakdown.overnight > 0 && ['Overnight charge', money(fee.breakdown.overnight)],
    fee.breakdown.lostTicket > 0 && ['Lost ticket penalty', money(fee.breakdown.lostTicket)],
    fee.taxPercent > 0 && [`Tax (${fee.taxPercent}%${fee.taxInclusive ? ', included' : ''})`, money(fee.tax)],
  ].filter(Boolean)

  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-right font-medium text-slate-900">{value}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-lg font-bold text-slate-900">
        <dt>To pay</dt>
        <dd>{money(fee.total)}</dd>
      </div>
    </dl>
  )
}

function PaymentStep({ session, onPaid, onRecalculate, recalculating }) {
  const { can } = useAuth()
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')

  const pay = useMutation({
    mutationFn: () =>
      paymentApi.create({
        sessionId: session._id,
        method,
        amount: session.fee.total,
        ...(method !== 'CASH' && reference.trim().length >= 4 ? { transactionId: reference.trim() } : {}),
      }),
    onSuccess: onPaid,
  })

  if (!can('PAYMENT_COLLECT')) {
    return <Alert type="info">Payment is pending. Ask a staff member who collects payments to complete it.</Alert>
  }

  return (
    <div className="space-y-4">
      <Alert>{pay.error && errorMessage(pay.error)}</Alert>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Paid by</legend>
        <div className="flex flex-wrap gap-3">
          {METHODS.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
            >
              <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} />
              {PAYMENT_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      {method !== 'CASH' && (
        <Field
          label={`${PAYMENT_LABELS[method]} reference (optional)`}
          name="reference"
          hint="Transaction or approval number, if you have it"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      )}
      <Button className="w-full py-3 text-base" loading={pay.isPending} onClick={() => pay.mutate()}>
        {money(session.fee.total)} received — complete exit
      </Button>
      <Button variant="secondary" className="w-full" loading={recalculating} onClick={onRecalculate}>
        Recalculate fee
      </Button>
    </div>
  )
}

function Done({ session, paid, onNext }) {
  return (
    <div className="space-y-4" role="status">
      <Alert type="success">
        {paid
          ? `Payment of ${money(session.fee.total)} recorded. ${session.vehicleNumber} may leave.`
          : `Nothing to pay. ${session.vehicleNumber} may leave.`}
      </Alert>
      <div className="flex flex-wrap gap-3">
        <Link
          to={`/operator/receipt/${session._id}`}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          View receipt
        </Link>
        <Button onClick={onNext}>Next vehicle</Button>
      </div>
    </div>
  )
}

function ExitForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  // { session, paymentRequired } after a lookup; `paid` once payment is recorded.
  const [result, setResult] = useState(null)
  const [lastLookup, setLastLookup] = useState(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    setFocus,
    getValues,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(exitLookupSchema),
    defaultValues: { locationId: defaultId, query: '', lostTicket: false, gate: '' },
  })
  const locationId = useWatch({ control, name: 'locationId' })

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['locations'] })
    queryClient.invalidateQueries({ queryKey: ['entries'] })
    queryClient.invalidateQueries({ queryKey: ['collection'] })
    queryClient.invalidateQueries({ queryKey: ['exits'] })
  }

  const lookup = useMutation({
    mutationFn: (body) => parkingApi.exit(body),
    onSuccess: (data, body) => {
      rememberLocation(body.locationId)
      setLastLookup(body)
      setResult({ ...data, paid: false })
      if (!data.paymentRequired) refreshLists()
    },
  })

  const onSubmit = ({ locationId: location, query, lostTicket, gate }) => {
    setResult(null)
    const ticket = !lostTicket && looksLikeTicket(query)
    lookup.mutate({
      locationId: location,
      ...(ticket ? { ticketNumber: query } : { vehicleNumber: query }),
      ...(lostTicket ? { lostTicket: true } : {}),
      ...(gate ? { gate } : {}),
    })
  }

  const next = () => {
    setResult(null)
    setLastLookup(null)
    lookup.reset()
    reset({ ...getValues(), query: '', lostTicket: false })
    setFocus('query')
  }

  const session = result?.session
  const finished = result && (!result.paymentRequired || result.paid)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Find the vehicle">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <Alert>{lookup.error && errorMessage(lookup.error)}</Alert>
          <LocationPicker
            locations={locations}
            selectedId={locationId}
            register={register}
            errors={errors}
            gateTypes={['EXIT', 'BOTH']}
          />
          <Field
            label="Ticket number or vehicle number"
            placeholder="T-260302-K7QXMP or RJ14 AB 1234"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            className="[&_input]:text-lg [&_input]:font-semibold [&_input]:uppercase"
            error={errors.query?.message}
            {...register('query')}
          />
          <Checkbox label="Ticket is lost (enter the vehicle number)" {...register('lostTicket')} />
          <Button type="submit" loading={lookup.isPending} className="w-full py-3 text-base">
            Calculate fee
          </Button>
        </form>
      </Card>

      {session && (
        <Card title={finished ? 'Exit complete' : 'Fee to collect'}>
          <div className="space-y-5">
            <SessionSummary session={session} />
            {finished ? (
              <Done session={session} paid={result.paid} onNext={next} />
            ) : (
              <PaymentStep
                key={session._id}
                session={session}
                recalculating={lookup.isPending}
                onRecalculate={() => lookup.mutate(lastLookup)}
                onPaid={(data) => {
                  setResult({ session: data.session, paymentRequired: true, paid: true })
                  refreshLists()
                }}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

export default function Exit() {
  const { locations, defaultId, isLoading, error } = useMyLocations()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Vehicle Exit</h1>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : locations.length === 0 ? (
        <Alert type="info">No open parking location is assigned to you. Ask your admin.</Alert>
      ) : (
        <ExitForm locations={locations} defaultId={defaultId} />
      )}
    </div>
  )
}
