import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi, passApi, paymentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { playCue } from '../../utils/sound'
import { markLocalAction } from '../../utils/localAction'
import { rememberLocation, useMyLocations } from '../../hooks/useMyLocations'
import { assignedLane } from '../../hooks/useLane'
import { useGateCamera } from '../../hooks/useGateCamera'
import { errorMessage } from '../../utils/errors'
import { operationSettings } from '../../utils/operations'
import { PAYMENT_LABELS, VEHICLE_LABELS, amountDue, dateTime, duration, money } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader } from '../../components/ui'
import LaneBar from '../../components/operator/LaneBar'
import LivePreview from '../../components/operator/LivePreview'
import GateCameraNote from '../../components/operator/GateCameraNote'
import AutoSwitch from '../../components/operator/AutoSwitch'
import DeviceStatus, { OpenBarrierButton } from '../../components/operator/DeviceStatus'
import PlateSuggestions from '../../components/operator/PlateSuggestions'
import TodaysExit from '../../components/operator/TodaysExit'
import QrScanner from '../../components/operator/QrScanner'
import OnlinePayment from '../../components/operator/OnlinePayment'
import WalletPayment from '../../components/operator/WalletPayment'
import PhotoPanel from '../../components/operator/PhotoPanel'
import PassBanner from '../../components/pass/PassBanner'
import QrCode from '../../components/QrCode'

// The last lookup without any amount change (what "Recalculate" and "Use the tariff amount" send).
const withoutEdit = (body) => {
  const rest = { ...body }
  delete rest.editedAmount
  delete rest.editReason
  return rest
}
const looksLikeTicket = (text) => /^t-?\d{6}/i.test(text.trim())
const looksLikePass = (text) => /^p-\d{6}-[a-z0-9]{6}$/i.test(text.trim())
const MANUAL_METHODS = ['CASH', 'UPI', 'CARD', 'FASTAG']
const plateKey = (text) => text.toUpperCase().replace(/[\s-]/g, '')
// The car just looked up (or refused) is ignored by the camera for a minute.
const RECENT_MS = 60_000
const MIN_SEARCH = 3
// Barcode-scanner commands: a QR code printed next to the Exit button reads {OK} and one on the bill reads {PRINT},
// so a scanner at the gate can confirm the exit or print the bill without touching the screen.
const CMD_OK = '{OK}'
const CMD_PRINT = '{PRINT}'
const isCommand = (text) => [CMD_OK, CMD_PRINT].includes(text.trim().toUpperCase())
const fire = (name) => window.dispatchEvent(new CustomEvent(name))

function SessionSummary({ session }) {
  const fee = session.fee
  const rows = [
    ['Vehicle', `${session.vehicleNumber} (${VEHICLE_LABELS[session.vehicleType]})`],
    ['Ticket', session.ticketNumber],
    ['In time', dateTime(session.entryTime)],
    session.exitTime && ['Out time', dateTime(session.exitTime)],
    ['Total time', duration(session.durationMinutes)],
    ['Parking fee', money(fee.breakdown.base)],
    fee.breakdown.overnight > 0 && ['Overnight charge', money(fee.breakdown.overnight)],
    fee.breakdown.lostTicket > 0 && ['Lost ticket penalty', money(fee.breakdown.lostTicket)],
    fee.taxPercent > 0 && [`Tax (${fee.taxPercent}%${fee.taxInclusive ? ', included' : ''})`, money(fee.tax)],
    fee.advanceApplied > 0 && ['Total fee', money(fee.total)],
    fee.advanceApplied > 0 && ['Advance paid at entry', `− ${money(fee.advanceApplied)}`],
    session.feeEdit?.reason && ['Amount changed', `from ${money(session.feeEdit.calculated)}: ${session.feeEdit.reason}`],
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

// Where the location allows it, the person at the exit can collect a different amount than the
// tariff's. A reason is always asked for and is recorded with who made the change.
function AmountEdit({ session, onApply, onReset, pending, error }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const edited = Boolean(session.feeEdit?.reason)
  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value >= 0 && reason.trim().length >= 5

  if (!open && !edited) {
    return (
      <button type="button" className="text-sm font-medium text-blue-700 hover:underline" onClick={() => setOpen(true)}>
        Change the amount
      </button>
    )
  }
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">
        {edited ? `Amount changed from ${money(session.feeEdit.calculated)}.` : 'Collect a different amount'}
      </p>
      <Alert>{error && errorMessage(error)}</Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount to collect (₹)" name="edit-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Field label="Reason" name="edit-reason" autoComplete="off" hint="At least 5 letters. It is kept with your name." value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending} disabled={!valid} onClick={() => onApply(value, reason.trim())}>Apply</Button>
        {edited && <Button type="button" variant="secondary" onClick={onReset}>Use the tariff amount</Button>}
        {!edited && <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>}
      </div>
    </div>
  )
}

function PaymentStep({ session, onPaid, onPaidOnline, onRecalculate, recalculating, startMethod = 'CASH', wallet, detectedTag = '', pendingCharge = null, onLock }) {
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
  // What the customer paid (cash): this amount is recorded as it is. There is no change to give back.
  const [given, setGiven] = useState(String(due))
  // Online payment is offered only once a gateway is set up on the server.
  const options = useQuery({ queryKey: ['payment-options'], queryFn: paymentApi.options, staleTime: 5 * 60 * 1000 })
  const methods = [...MANUAL_METHODS, 'WALLET', ...(options.data?.online ? ['GATEWAY'] : [])]

  const handed = Number(given)
  const cash = method === 'CASH'
  const chargeTag = method === 'FASTAG' && Boolean(options.data?.fastag)
  const short = cash && (!Number.isFinite(handed) || handed + 0.005 < due)
  // Cash: what was received is what is recorded (never less than the fee).
  const payable = cash && Number.isFinite(handed) && handed > due ? Math.round(handed * 100) / 100 : due

  const pay = useMutation({
    mutationFn: () =>
      paymentApi.create({
        sessionId: session._id,
        method,
        amount: payable,
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
      onPaid(data)
    },
  })

  const ready = !short && !(chargeTag && tagId.trim().length < 4)
  const canSubmit = ready && ['CASH', 'UPI', 'CARD', 'FASTAG'].includes(method)
  // A scanned {OK} code confirms the exit, like pressing the button.
  const confirmRef = useRef(null)
  useEffect(() => {
    confirmRef.current = () => { if (canSubmit && !pay.isPending && can('PAYMENT_COLLECT')) pay.mutate() }
  })
  useEffect(() => {
    const handler = () => confirmRef.current?.()
    window.addEventListener('sp:exit-confirm', handler)
    return () => window.removeEventListener('sp:exit-confirm', handler)
  }, [])
  const markOnline = useCallback((active) => onLock?.('online', active), [onLock])
  // While the FASTag partner has not confirmed a charge, the vehicle cannot be cleared away.
  const lockedByCharge = Boolean(waiting || pendingCharge)
  useEffect(() => {
    onLock?.('charge', lockedByCharge)
    return () => onLock?.('charge', false)
  }, [lockedByCharge, onLock])

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
          onActive={markOnline}
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
                autoFocus
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    confirmRef.current?.()
                  }
                }}
                value={given}
                onChange={(event) => setGiven(event.target.value)}
              />
              {short ? (
                <p className="text-sm font-semibold text-red-700" role="status">
                  {Number.isFinite(handed) && handed > 0 ? `Take ${money(due - handed)} more` : `Take ${money(due)}`}. The amount received must be at least {money(due)}.
                </p>
              ) : payable > due ? (
                <p className="text-sm font-semibold text-green-700" role="status">{money(payable)} will be recorded for this exit.</p>
              ) : (
                <p className="text-sm font-semibold text-green-700" role="status">{money(due)} will be recorded for this exit.</p>
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
          <div className="flex items-center gap-3">
            <Button
              className="w-full py-3 text-base"
              loading={pay.isPending}
              disabled={!ready}
              onClick={() => pay.mutate()}
            >
              {chargeTag
                ? (waiting ? 'Check FASTag charge again' : `Charge FASTag ${money(due)} and exit`)
                : `Exit — ${money(payable)} received`}
            </Button>
            <span className="hidden shrink-0 text-center sm:block" title="Scan this code with the gate scanner to confirm the exit">
              <QrCode value={CMD_OK} size={64} label="Scan to confirm the exit" />
              <span className="block text-[10px] text-slate-500">scan to exit</span>
            </span>
          </div>
          <Button variant="secondary" className="w-full" loading={recalculating} disabled={Boolean(waiting || pendingCharge)} onClick={onRecalculate}>
            Recalculate fee
          </Button>
        </>
      )}
    </div>
  )
}

function Done({ session, paid, method, advance, hardware, onNext, skipReceipt = false }) {
  const { user } = useAuth()
  const mayPrint = user?.access?.reprint !== false
  const covered = !paid && session.fee.total > 0 && session.fee.advanceApplied > 0
  const giveBack = session.fee.advanceRefunded || advance?.refund || 0
  const print = useMutation({ mutationFn: () => parkingApi.print(session._id) })
  // A scanned {PRINT} code prints the bill, like pressing the button.
  const printRef = useRef(null)
  const canPrint = !skipReceipt && mayPrint
  useEffect(() => {
    printRef.current = () => { if (canPrint && !print.isPending) print.mutate() }
  })
  useEffect(() => {
    const handler = () => printRef.current?.()
    window.addEventListener('sp:exit-print', handler)
    return () => window.removeEventListener('sp:exit-print', handler)
  }, [])
  return (
    <div className="space-y-4" role="status">
      <Alert type="success">
        {paid
          ? `${method ? `${PAYMENT_LABELS[method] || method} exit successful.` : 'Exit successful.'} Payment of ${money(amountDue(session))} recorded. ${session.vehicleNumber} may leave.`
          : covered
            ? `Exit successful. The advance covered the fee. ${session.vehicleNumber} may leave.`
            : `Exit successful. Nothing to pay. ${session.vehicleNumber} may leave.`}
      </Alert>
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
        {canPrint && <Button variant="secondary" loading={print.isPending} onClick={() => print.mutate()}>Print bill</Button>}
        {canPrint && (
          <span className="hidden text-center sm:block" title="Scan this code with the gate scanner to print the bill">
            <QrCode value={CMD_PRINT} size={48} label="Scan to print the bill" />
          </span>
        )}
        {!skipReceipt && (
          <Link
            to={`/operator/receipt/${session._id}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            View receipt
          </Link>
        )}
        <Button autoFocus onClick={onNext}>Next vehicle</Button>
      </div>
    </div>
  )
}

// The big search box: click it to see the vehicles that are inside, newest first. Type to narrow
// the list (3 or more characters search every vehicle inside); pick one to work out its fee.
function VehicleSearch({ locationId, text, onText, onPick, onSubmitText, disabled }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(timer)
  }, [text])
  const enough = q.length >= MIN_SEARCH
  // With fewer than 3 characters the vehicles inside are listed as they are (the newest ones) and the
  // typed characters only narrow that list; with 3 or more the server looks through all of them.
  const found = useQuery({
    queryKey: ['exit-search', locationId, enough ? q : ''],
    queryFn: () => parkingApi.entries(enough ? { locationId, q, match: 'contains' } : { locationId }),
    enabled: Boolean(locationId) && open,
  })
  const typed = text.trim().toUpperCase().replace(/[\s-]/g, '')
  const all = found.data?.sessions || []
  const results = enough || !typed
    ? all
    : all.filter((row) => row.vehicleNumber.includes(typed) || row.ticketNumber.toUpperCase().replace(/-/g, '').includes(typed))
  const total = found.data?.total ?? 0

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
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg" role="listbox" aria-label="Vehicles inside">
          {found.isLoading ? (
            <p className="px-3 py-2 text-sm font-semibold text-red-600">Searching…</p>
          ) : found.error ? (
            <p className="px-3 py-2 text-sm text-red-600">{errorMessage(found.error)}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-red-600">
              {typed ? 'No vehicle inside matches. Press Enter to look it up anyway (for a lost ticket or a pass).' : 'No vehicle is inside right now.'}
            </p>
          ) : (
            <>
              <p className="px-3 pb-1 text-xs text-slate-500">
                {typed
                  ? `${results.length} matching`
                  : total > all.length
                    ? `Newest ${all.length} of ${total} vehicles inside. Type to find another.`
                    : `${total} vehicle${total === 1 ? '' : 's'} inside`}
              </p>
              {results.map((row) => (
                <button
                  key={row._id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="flex w-full flex-wrap items-baseline gap-x-4 rounded-lg px-3 py-2 text-left hover:bg-blue-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpen(false)
                    onPick(row)
                  }}
                >
                  <span className="font-bold text-blue-700">{row.vehicleNumber}</span>
                  <span className="text-sm text-slate-500">{dateTime(row.entryTime)} · {row.ticketNumber}</span>
                  <span className="text-sm font-medium text-red-600">[{VEHICLE_LABELS[row.vehicleType]}]</span>
                  {row.advance?.amount > 0 && <span className="text-xs text-green-700">advance {money(row.advance.amount)}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ExitForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  const { company, can, user } = useAuth()
  // { session, paymentRequired } after a lookup; `paid` once payment is recorded.
  const [result, setResult] = useState(null)
  const [lastLookup, setLastLookup] = useState(null)
  const [text, setText] = useState('')
  const [lostTicket, setLostTicket] = useState(false)
  const [scanning, setScanning] = useState(false)
  // A payment that has started online or at the FASTag partner must be finished or released first:
  // the vehicle cannot be cleared away or swapped for another one meanwhile.
  const [locks, setLocks] = useState({})
  const setLock = useCallback((key, on) => setLocks((current) => (Boolean(current[key]) === on ? current : { ...current, [key]: on })), [])
  const paymentLocked = Boolean(locks.online || locks.charge)
  // The camera suggestion the operator chose to use, if any.
  const [detection, setDetection] = useState(null)
  // Auto exit always starts OFF when the page opens (also after a refresh): the operator switches it on.
  const [autoExit, setAutoExit] = useState(false)
  const recent = useRef({ plate: '', until: 0 })
  // The location and gate are the lane the admin assigned: the operator does not choose them.
  const { control } = useForm({ defaultValues: assignedLane(locations, user?.lanes, 'EXIT', defaultId) })
  const locationId = useWatch({ control, name: 'locationId' })
  const gate = useWatch({ control, name: 'gate' })
  const location = locations.find((l) => l._id === locationId)
  const ops = operationSettings(location?.operations)
  // With an ANPR camera registered for this gate, its readings appear as suggestions and fill the search box.
  // Without one, the operator types the number.
  const gateCamera = useGateCamera(locationId, 'EXIT', gate)

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
    // A scanner command typed into the search box is not a vehicle.
    if (isCommand(query)) {
      setText('')
      return
    }
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

  // Coming from the entry screen's "Vehicle Already Entered" window (Exit button) with ?ticket=: look that ticket up at once.
  const [params] = useSearchParams()
  const fromEntry = useRef(false)
  useEffect(() => {
    const ticket = params.get('ticket')
    if (!ticket || fromEntry.current || !locationId) return
    const timer = setTimeout(() => {
      fromEntry.current = true
      setText(ticket)
      run(ticket)
    }, 0)
    return () => clearTimeout(timer)
  })

  // The gate scanner types like a keyboard: {OK} confirms the exit, {PRINT} prints the bill.
  useEffect(() => {
    let buffer = ''
    let last = 0
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      const now = Date.now()
      if (now - last > 120) buffer = ''
      last = now
      buffer = (buffer + event.key).slice(-8).toUpperCase()
      if (buffer.endsWith(CMD_OK)) {
        buffer = ''
        fire('sp:exit-confirm')
      } else if (buffer.endsWith(CMD_PRINT)) {
        buffer = ''
        fire('sp:exit-print')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    setResult({ session: data.session, paymentRequired: true, paid: true, method: data.payment?.method, hardware: data.hardware, pass: result.pass, advance: result.advance })
    refreshLists()
    markLocalAction()
    toast({ title: 'Payment recorded', message: `${data.session.vehicleNumber} may leave`, tone: 'success' })
    playCue('exit')
  }

  return (
    <div className="space-y-4">
      <LaneBar location={location} gate={gate} company={company} parkingType={location?.parkingType}>
        {can('EXIT_CREATE') && <OpenBarrierButton locationId={locationId} direction="EXIT" gate={gate} />}
        <AutoSwitch
          label="AUTO EXIT"
          on={autoExit}
          onChange={setAutoExit}
          hint="When the gate camera reads a number plate clearly, the vehicle is found and the fee is shown by itself. The barrier opens the moment the payment is recorded (or at once when nothing is due)."
        />
      </LaneBar>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
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

          <PlateSuggestions
            locationId={locationId}
            direction="EXIT"
            onUse={applySuggestion}
            usedId={detection?._id}
            canFill={!text.trim() && !detection && !result && !lookup.isPending}
            auto={autoExit}
            onAuto={autoLookup}
          />

          {session && (
            <Card title={finished ? 'Exit complete' : 'Fee to collect'}>
              <div className="space-y-5">
                <PassBanner pass={result.pass} at="exit" />
                <SessionSummary session={session} />
                <PhotoPanel key={session._id} sessionId={session._id} kind="EXIT" />
                {finished ? (
                  <Done
                    session={session}
                    paid={result.paid}
                    method={result.method}
                    advance={result.advance}
                    hardware={result.hardware}
                    onNext={next}
                    // A location can switch the receipt off for pass holders, who pay nothing.
                    skipReceipt={session.status === 'PASS_EXIT' && !ops.printPassReceipt}
                  />
                ) : (
                  <>
                    {ops.exitAmountEdit && can('EXIT_CREATE') && !result.pass?.validHere && (
                      <AmountEdit
                        key={session._id}
                        session={session}
                        pending={lookup.isPending}
                        error={lookup.error}
                        onApply={(amount, reason) => lookup.mutate({ ...withoutEdit(lastLookup), editedAmount: amount, editReason: reason })}
                        onReset={() => lookup.mutate(withoutEdit(lastLookup))}
                      />
                    )}
                    <PaymentStep
                      // A changed amount starts the payment step over, so the cash shown matches it.
                      key={`${session._id}-${amountDue(session)}`}
                      session={session}
                      recalculating={lookup.isPending}
                      // A FASTag reader gave us this vehicle: the likely way it is paying.
                      startMethod={result.fastagCharge || detection?.source === 'FASTAG' ? 'FASTAG' : 'CASH'}
                      wallet={result.wallet}
                      detectedTag={detection?.tagId || ''}
                      pendingCharge={result.fastagCharge || null}
                      onLock={setLock}
                      onRecalculate={() => lookup.mutate(lastLookup)}
                      onPaid={done}
                      // Online: the server already released the vehicle; show the finished view.
                      onPaidOnline={done}
                    />
                    <Button variant="secondary" className="w-full" disabled={paymentLocked} onClick={next}>Cancel</Button>
                    {paymentLocked && (
                      <p className="text-center text-xs font-medium text-amber-700" role="status">
                        {session.vehicleNumber} has a payment in progress. Complete or release it before clearing this vehicle.
                      </p>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <LivePreview locationId={locationId} direction="EXIT" gate={gate} />
          <GateCameraNote camera={gateCamera} direction="EXIT" gate={gate} fills="the search box" />
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
