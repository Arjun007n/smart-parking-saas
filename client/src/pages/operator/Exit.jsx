import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi, passApi, paymentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { playCue } from '../../utils/sound'
import { markLocalAction } from '../../utils/localAction'
import { rememberLocation, useMyLocations } from '../../hooks/useMyLocations'
import { initialLane, useRememberLane } from '../../hooks/useLane'
import { useGateCamera } from '../../hooks/useGateCamera'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, amountDue, dateTime, duration, money, timeOnly } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader } from '../../components/ui'
import LocationPicker from '../../components/operator/LocationPicker'
import LaneBar from '../../components/operator/LaneBar'
import LivePreview from '../../components/operator/LivePreview'
import GateCameraNote from '../../components/operator/GateCameraNote'
import AutoSwitch from '../../components/operator/AutoSwitch'
import DeviceStatus, { OpenBarrierButton } from '../../components/operator/DeviceStatus'
import PlateSuggestions from '../../components/operator/PlateSuggestions'
import ExitCamera from '../../components/operator/ExitCamera'
import TodaysExit from '../../components/operator/TodaysExit'
import QrScanner from '../../components/operator/QrScanner'
import OnlinePayment from '../../components/operator/OnlinePayment'
import WalletPayment from '../../components/operator/WalletPayment'
import PhotoPanel from '../../components/operator/PhotoPanel'
import PassBanner from '../../components/pass/PassBanner'

const looksLikeTicket = (text) => /^t-?\d{6}/i.test(text.trim())
const looksLikePass = (text) => /^p-\d{6}-[a-z0-9]{6}$/i.test(text.trim())
const MANUAL_METHODS = ['CASH', 'UPI', 'CARD', 'FASTAG']
const plateKey = (text) => text.toUpperCase().replace(/[\s-]/g, '')
// The car just looked up (or refused) is ignored by the camera for a minute.
const RECENT_MS = 60_000
const MIN_SEARCH = 3

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
    fee.advanceApplied > 0 && ['Total fee', money(fee.total)],
    fee.advanceApplied > 0 && ['Advance paid at entry', `− ${money(fee.advanceApplied)}`],
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
        <dd>{money(amountDue(session))}</dd>
      </div>
    </dl>
  )
}

function PaymentStep({ session, onPaid, onPaidOnline, onRecalculate, recalculating, startMethod = 'CASH', wallet, detectedTag = '', pendingCharge = null }) {
  const { can } = useAuth()
  const due = amountDue(session)
  // A wallet linked to the vehicle that can cover the fee is the likely way it is paying.
  const [method, setMethod] = useState(wallet?.enough ? 'WALLET' : startMethod)
  const [reference, setReference] = useState('')
  // FASTag charging: the tag number (the reader's, when it gave one) and whether the partner has confirmed yet.
  // (null = not typed yet: the reader's tag, or the tag of a charge that is still being confirmed)
  const [typedTag, setTypedTag] = useState(null)
  const tagId = typedTag ?? (pendingCharge?.tagId || detectedTag)
  const [waiting, setWaiting] = useState(
    pendingCharge && pendingCharge.status !== 'SUCCESS'
      ? { status: 'UNKNOWN', tagId: pendingCharge.tagId, message: 'The FASTag partner has not confirmed the charge yet. Check again in a moment. Nothing is charged twice.' }
      : null
  )
  // What the customer handed over (cash): the screen shows the change to give back.
  const [given, setGiven] = useState(String(due))
  // Online payment is offered only once a gateway is set up on the server.
  const options = useQuery({ queryKey: ['payment-options'], queryFn: paymentApi.options, staleTime: 5 * 60 * 1000 })
  const methods = [...MANUAL_METHODS, 'WALLET', ...(options.data?.online ? ['GATEWAY'] : [])]

  const handed = Number(given)
  const cash = method === 'CASH'
  const chargeTag = method === 'FASTAG' && Boolean(options.data?.fastag)
  const short = cash && (!Number.isFinite(handed) || handed + 0.005 < due)
  const change = cash && Number.isFinite(handed) ? Math.round((handed - due) * 100) / 100 : 0

  const pay = useMutation({
    mutationFn: () =>
      paymentApi.create({
        sessionId: session._id,
        method,
        amount: due,
        ...(chargeTag
          ? { tagId: tagId.trim() }
          : method !== 'CASH' && reference.trim().length >= 4 ? { transactionId: reference.trim() } : {}),
      }),
    onSuccess: (data) => {
      // The FASTag partner has not confirmed yet: nothing is charged twice, the operator checks again.
      if (data.completed === false && data.fastag) {
        setWaiting(data.fastag)
        return
      }
      setWaiting(null)
      onPaid({ ...data, change: cash && change > 0 ? change : 0 })
    },
  })

  if (!can('PAYMENT_COLLECT')) {
    return <Alert type="info">Payment is pending. Ask a staff member who collects payments to complete it.</Alert>
  }

  return (
    <div className="space-y-4">
      <Alert>{pay.error && errorMessage(pay.error)}</Alert>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Payment mode</legend>
        <div className="flex flex-wrap gap-3">
          {methods.map((value) => (
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
      {method === 'WALLET' ? (
        <WalletPayment session={session} linked={wallet} onPaid={onPaid} />
      ) : method === 'GATEWAY' ? (
        <OnlinePayment
          session={session}
          simulated={Boolean(options.data?.simulated)}
          onPaid={onPaidOnline}
          onBack={() => setMethod('CASH')}
        />
      ) : (
        <>
          {cash ? (
            <div className="space-y-2">
              <Field
                label="Amount received (₹)"
                name="given-amount"
                inputMode="decimal"
                autoComplete="off"
                value={given}
                onChange={(event) => setGiven(event.target.value)}
              />
              {short ? (
                <p className="text-sm font-semibold text-red-700" role="status">
                  {Number.isFinite(handed) && handed > 0 ? `Take ${money(due - handed)} more` : `Take ${money(due)}`}. The amount received must be at least {money(due)}.
                </p>
              ) : change > 0 ? (
                <p className="text-lg font-bold text-green-700" role="status">Return {money(change)}</p>
              ) : (
                <p className="text-sm font-semibold text-green-700" role="status">Exact amount. Nothing to return.</p>
              )}
            </div>
          ) : chargeTag ? (
            <div className="space-y-2">
              <Field
                label="FASTag number"
                name="fastag-number"
                autoComplete="off"
                autoCapitalize="characters"
                hint={detectedTag
                  ? 'Read by the FASTag reader. Check it matches the windscreen tag.'
                  : 'Printed on the tag, or shown by the reader. The fee is charged to this tag.'}
                value={tagId}
                onChange={(event) => { setTypedTag(event.target.value); setWaiting(null) }}
              />
              {waiting && (
                <p className="text-sm font-semibold text-amber-700" role="status">
                  {waiting.message} Tag {waiting.tagId}.
                </p>
              )}
            </div>
          ) : (
            <Field
              label={`${PAYMENT_LABELS[method]} reference (optional)`}
              name="reference"
              hint={method === 'FASTAG'
                ? 'Only a record: nothing is charged to the FASTag from here. Collect the money as usual.'
                : 'Transaction or approval number, if you have it'}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
          <Button
            className="w-full py-3 text-base"
            loading={pay.isPending}
            disabled={short || (chargeTag && tagId.trim().length < 4)}
            onClick={() => pay.mutate()}
          >
            {chargeTag
              ? (waiting ? 'Check FASTag charge again' : `Charge FASTag ${money(due)} and exit`)
              : `Exit — ${money(due)} received`}
          </Button>
          <Button variant="secondary" className="w-full" loading={recalculating} disabled={Boolean(waiting || pendingCharge)} onClick={onRecalculate}>
            Recalculate fee
          </Button>
        </>
      )}
    </div>
  )
}

function Done({ session, paid, advance, change, hardware, onNext }) {
  const covered = !paid && session.fee.total > 0 && session.fee.advanceApplied > 0
  const giveBack = session.fee.advanceRefunded || advance?.refund || 0
  const print = useMutation({ mutationFn: () => parkingApi.print(session._id) })
  return (
    <div className="space-y-4" role="status">
      <Alert type="success">
        {paid
          ? `Exit successful. Payment of ${money(amountDue(session))} recorded. ${session.vehicleNumber} may leave.`
          : covered
            ? `Exit successful. The advance covered the fee. ${session.vehicleNumber} may leave.`
            : `Exit successful. Nothing to pay. ${session.vehicleNumber} may leave.`}
      </Alert>
      {change > 0 && <Alert type="info">Return {money(change)} to the customer.</Alert>}
      {giveBack > 0 && (
        <Alert type="info">
          Give {money(giveBack)} back to the customer
          {advance?.method ? ` (the advance was paid by ${PAYMENT_LABELS[advance.method] || advance.method})` : ''}.
        </Alert>
      )}
      <DeviceStatus hardware={hardware} sessionId={session._id} direction="EXIT" />
      <Alert>{print.error && errorMessage(print.error)}</Alert>
      <Alert type="success">{print.isSuccess && 'Bill sent to the printer.'}</Alert>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" loading={print.isPending} onClick={() => print.mutate()}>Print bill</Button>
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

// The big search box: type 3 or more characters of a plate (or ticket) and the
// vehicles inside that match are listed; pick one to work out its fee.
function VehicleSearch({ locationId, text, onText, onPick, onSubmitText, disabled }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(timer)
  }, [text])
  const enough = q.length >= MIN_SEARCH
  const found = useQuery({
    queryKey: ['exit-search', locationId, q],
    queryFn: () => parkingApi.entries({ locationId, q, match: 'contains' }),
    enabled: enough && Boolean(locationId) && open,
  })
  const results = found.data?.sessions || []

  return (
    <div className="relative">
      <label htmlFor="exit-search" className="sr-only">Vehicle number or ticket</label>
      <input
        id="exit-search"
        data-plate-box
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        disabled={disabled}
        value={text}
        placeholder="Type min 3 characters to search…"
        className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-4 text-2xl font-bold uppercase tracking-wider text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-300 disabled:bg-slate-100"
        onChange={(event) => {
          onText(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter') {
            event.preventDefault()
            setOpen(false)
            if (!text.trim()) return
            if (results.length === 1 && !looksLikeTicket(text) && !looksLikePass(text)) onPick(results[0])
            else onSubmitText(text)
          }
        }}
      />
      {open && !disabled && text.trim() && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg" role="listbox" aria-label="Vehicles inside">
          {!enough ? (
            <p className="px-3 py-2 text-sm text-slate-500">Type at least {MIN_SEARCH} characters, or press Enter to look up exactly what you typed.</p>
          ) : found.isLoading ? (
            <p className="px-3 py-2 text-sm text-red-600">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-red-600">
              No vehicle inside matches. Press Enter to look it up anyway (for a lost ticket or a pass).
            </p>
          ) : (
            results.map((row) => (
              <button
                key={row._id}
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full flex-wrap items-baseline gap-x-4 rounded-lg px-3 py-2 text-left hover:bg-blue-50"
                onClick={() => {
                  setOpen(false)
                  onPick(row)
                }}
              >
                <span className="font-bold text-blue-700">{row.vehicleNumber}</span>
                <span className="text-sm text-slate-500">{timeOnly(row.entryTime)} · {row.ticketNumber}</span>
                <span className="text-sm font-medium text-red-600">[{VEHICLE_LABELS[row.vehicleType]}]</span>
                {row.advance?.amount > 0 && <span className="text-xs text-green-700">advance {money(row.advance.amount)}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ExitForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  const { company, can } = useAuth()
  // { session, paymentRequired } after a lookup; `paid` once payment is recorded.
  const [result, setResult] = useState(null)
  const [lastLookup, setLastLookup] = useState(null)
  const [text, setText] = useState('')
  const [lostTicket, setLostTicket] = useState(false)
  const [scanning, setScanning] = useState(false)
  // The camera suggestion the operator chose to use, if any.
  const [detection, setDetection] = useState(null)
  // Auto exit: with a gate camera it starts ON and the operator can pause it with the switch. Without one it is off.
  const [autoExitChoice, setAutoExit] = useState(null)
  const recent = useRef({ plate: '', until: 0 })
  const { register, control, formState: { errors } } = useForm({ defaultValues: initialLane(locations, defaultId, 'EXIT') })
  const locationId = useWatch({ control, name: 'locationId' })
  const gate = useWatch({ control, name: 'gate' })
  const location = locations.find((l) => l._id === locationId)
  // This computer keeps its lane (location and gate) between visits.
  useRememberLane('EXIT', locationId, gate)
  // With a camera registered for this gate, that one camera reads the plates (and fills the search box).
  // This computer's own camera is only shown when the operator asks for it.
  const gateCamera = useGateCamera(locationId, 'EXIT', gate)
  const [ownCamera, setOwnCamera] = useState(false)
  const showOwnCamera = ownCamera
  // Until the operator uses the switch, automatic follows the camera: ON when this gate has one.
  const autoExit = autoExitChoice ?? gateCamera.hasCamera

  const refreshLists = () => {
    for (const key of ['locations', 'entries', 'collection', 'exits', 'operator-list', 'operator-summary', 'operator-collection', 'exit-search']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }

  const toast = useToast()
  const lookup = useMutation({
    mutationFn: async ({ passNumber, ...body }) => {
      // A scanned pass card names the pass, not the vehicle: find the vehicle first.
      if (passNumber) {
        const found = await passApi.lookup({ passNumber, locationId: body.locationId })
        if (!found.pass) throw new Error('That pass was not found.')
        // A pass can cover several vehicles: exit the one that is inside.
        const inside = found.pass.inside || []
        if (inside.length === 0) throw new Error('No vehicle of this pass is inside right now.')
        if (inside.length > 1) throw new Error(`Several vehicles of this pass are inside (${inside.join(', ')}). Enter the vehicle number instead.`)
        return parkingApi.exit({ ...body, vehicleNumber: inside[0] })
      }
      return parkingApi.exit(body)
    },
    onSuccess: (data, body) => {
      rememberLocation(body.locationId)
      setLastLookup(body)
      setResult({ ...data, paid: false })
      recent.current = { plate: data.session.vehicleNumber, until: Date.now() + RECENT_MS }
      if (!data.paymentRequired) {
        refreshLists()
        markLocalAction()
        toast({ title: 'Exit successful', message: `${data.session.vehicleNumber} may leave`, tone: 'success' })
        playCue('exit')
      }
    },
    onError: (error, body) => {
      // A plate the camera keeps seeing must not be tried again every few seconds.
      if (body.vehicleNumber) recent.current = { plate: plateKey(body.vehicleNumber), until: Date.now() + RECENT_MS }
      // Say what went wrong at once, unless a camera is the one asking (it asks again and again).
      if (!autoExit) {
        toast({ title: 'Could not find that vehicle', message: errorMessage(error), tone: 'error' })
        playCue('error')
      }
    },
  })

  // Looks a vehicle up. `query` is what was typed, picked or scanned.
  const run = (query, extra = {}) => {
    setResult(null)
    const ticket = !lostTicket && looksLikeTicket(query)
    const pass = !ticket && looksLikePass(query)
    lookup.mutate({
      locationId,
      ...(ticket ? { ticketNumber: query.trim() } : pass ? { passNumber: query.trim().toUpperCase() } : { vehicleNumber: query.trim() }),
      ...(lostTicket ? { lostTicket: true } : {}),
      ...(gate ? { gate } : {}),
      // Only when the operator is still looking up the plate the camera read.
      ...(detection && plateKey(query) === detection.plate ? { detectionId: detection._id } : {}),
      ...extra,
    })
  }

  const pick = (row) => {
    setText(row.vehicleNumber)
    run(row.vehicleNumber)
  }

  // A scanned code fills the box and looks the vehicle up at once.
  const onScan = (scanned) => {
    setText(scanned)
    setScanning(false)
    run(scanned)
  }

  const applySuggestion = (suggestion) => {
    setDetection(suggestion)
    if (suggestion.plate) setText(suggestion.plate)
  }

  // Auto exit: the camera read a plate clearly. Nothing happens while a vehicle is being handled.
  // A vehicle that has just left (nothing more to collect) makes way for the next plate by itself; a vehicle
  // still waiting to pay is never pushed aside. Answers false when the plate cannot be taken now.
  const autoLookup = (suggestion) => {
    if (lookup.isPending || !suggestion.plate || !locationId) return false
    if (result && result.paymentRequired && !result.paid) return false
    setDetection(suggestion)
    setText(suggestion.plate)
    run(suggestion.plate, { detectionId: suggestion._id })
    return true
  }

  const next = () => {
    setResult(null)
    setLastLookup(null)
    setDetection(null)
    setText('')
    setLostTicket(false)
    lookup.reset()
  }

  const session = result?.session
  const finished = result && (!result.paymentRequired || result.paid)
  const done = (data) => {
    setResult({ session: data.session, paymentRequired: true, paid: true, hardware: data.hardware, pass: result.pass, advance: result.advance, change: data.change })
    refreshLists()
    markLocalAction()
    toast({ title: 'Payment recorded', message: `${data.session.vehicleNumber} may leave`, tone: 'success' })
    playCue('exit')
  }

  return (
    <div className="space-y-4">
      <LaneBar location={location} gate={gate} company={company}>
        {can('EXIT_CREATE') && <OpenBarrierButton locationId={locationId} direction="EXIT" gate={gate} />}
        <AutoSwitch label="AUTO EXIT" on={autoExit} onChange={setAutoExit} />
      </LaneBar>
      {autoExit && (
        <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          Automatic exit is ON. When the gate camera reads a number plate clearly, the vehicle is found and the fee is shown by itself. The barrier opens
          the moment the payment is recorded (or at once when nothing is due). Switch it off to pause.
        </p>
      )}

      <LivePreview locationId={locationId} direction="EXIT" gate={gate} />


      <PlateSuggestions
        locationId={locationId}
        direction="EXIT"
        onUse={applySuggestion}
        usedId={detection?._id}
        canFill={!text.trim() && !detection && !result && !lookup.isPending}
        auto={autoExit}
        onAuto={autoLookup}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="no-print">
            <LocationPicker locations={locations} selectedId={locationId} register={register} errors={errors} gateTypes={['EXIT', 'BOTH']} />
          </Card>

          <div className="no-print space-y-3">
            <Alert>{lookup.error && errorMessage(lookup.error)}</Alert>
            <VehicleSearch
              locationId={locationId}
              text={text}
              onText={(value) => {
                setText(value)
                setDetection((d) => (d && plateKey(value) === d.plate ? d : null))
              }}
              onPick={pick}
              onSubmitText={run}
              disabled={Boolean(result) || lookup.isPending || !locationId}
            />
            {!locationId && <p className="text-sm text-slate-500">Choose a parking location first.</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={lostTicket} onChange={(event) => setLostTicket(event.target.checked)} />
                Ticket is lost (type the vehicle number, then press Enter)
              </label>
              <Button type="button" variant="secondary" onClick={() => setScanning((on) => !on)}>
                {scanning ? 'Close camera' : 'Scan QR code'}
              </Button>
            </div>
            {scanning && <QrScanner onScan={onScan} onClose={() => setScanning(false)} />}
          </div>

          {session && (
            <Card title={finished ? 'Exit complete' : 'Fee to collect'}>
              <div className="space-y-5">
                <PassBanner pass={result.pass} at="exit" />
                <SessionSummary session={session} />
                <PhotoPanel key={session._id} sessionId={session._id} kind="EXIT" />
                {finished ? (
                  <Done session={session} paid={result.paid} advance={result.advance} change={result.change} hardware={result.hardware} onNext={next} />
                ) : (
                  <>
                    <PaymentStep
                      key={session._id}
                      session={session}
                      recalculating={lookup.isPending}
                      // A FASTag reader gave us this vehicle: the likely way it is paying.
                      startMethod={result.fastagCharge || detection?.source === 'FASTAG' ? 'FASTAG' : 'CASH'}
                      wallet={result.wallet}
                      detectedTag={detection?.tagId || ''}
                      pendingCharge={result.fastagCharge || null}
                      onRecalculate={() => lookup.mutate(lastLookup)}
                      onPaid={done}
                      // Online: the server already released the vehicle; show the finished view.
                      onPaidOnline={done}
                    />
                    <Button variant="secondary" className="w-full" onClick={next}>Cancel</Button>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {showOwnCamera ? (
            <ExitCamera
              locationId={locationId}
              busy={Boolean(result) || lookup.isPending}
              onDetection={applySuggestion}
              autoExit={autoExit}
              onAutoExitChange={setAutoExit}
              onAutoExit={autoLookup}
              isRecentPlate={(plate) => recent.current.plate === plate && Date.now() < recent.current.until}
            />
          ) : (
            <GateCameraNote camera={gateCamera} direction="EXIT" gate={gate} fills="the search box" onUseOwn={() => setOwnCamera(true)} />
          )}
          <TodaysExit locationId={locationId} />
        </div>
      </div>
    </div>
  )
}

export default function Exit() {
  const { locations, defaultId, isLoading, error } = useMyLocations()

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Vehicle Exit</h1>
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
