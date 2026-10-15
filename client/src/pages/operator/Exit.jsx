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
import { printerAvailable } from '../../native/printer'
import { nativeScannerAvailable, scanQrNative } from '../../native/scanner'
import { printBillOnPhone } from '../../native/slips'
import { plateReaderAvailable } from '../../native/plateReader'
import { formatPlate } from '../../native/plate'
import { isPhoneWidth } from '../../utils/phone'
import GateBar, { ModeSwitch, OnlinePill } from '../../components/operator/GateBar'
import PlateCamera from '../../components/operator/PlateCamera'

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

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold leading-snug text-slate-900">{value}</dd>
    </div>
  )
}

// The bill of the vehicle that is leaving, as cards (phone): who it is, the times, the money, and the amount to take.
function PhoneSummary({ session }) {
  const fee = session.fee
  const tiles = [
    ['Entry Time', dateTime(session.entryTime)],
    session.exitTime && ['Exit Time', dateTime(session.exitTime)],
    ['Total Time', duration(session.durationMinutes)],
    ['Advance Paid', money(fee.advanceApplied || 0)],
    ['Parking Amount', money(fee.breakdown.base)],
    fee.breakdown.overnight > 0 && ['Overnight Charge', money(fee.breakdown.overnight)],
    fee.breakdown.lostTicket > 0 && ['Lost Ticket Penalty', money(fee.breakdown.lostTicket)],
    fee.taxPercent > 0 && [`Tax (${fee.taxPercent}%${fee.taxInclusive ? ', included' : ''})`, money(fee.tax)],
    fee.advanceApplied > 0 && ['Total Fee', money(fee.total)],
    session.feeEdit?.reason && ['Amount changed', `from ${money(session.feeEdit.calculated)}: ${session.feeEdit.reason}`],
  ].filter(Boolean)
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <p className="break-all text-2xl font-extrabold tracking-wide text-[#1d4ed8]">{session.vehicleNumber}</p>
          <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#1d4ed8] ring-1 ring-blue-200">{VEHICLE_LABELS[session.vehicleType]}</span>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-600">Token: {session.ticketNumber}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map(([label, value]) => (
          <InfoTile key={label} label={label} value={value} />
        ))}
      </dl>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
        <span className="flex items-center gap-2 text-base font-bold text-emerald-800">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-sm text-white">✓</span>
          Take Amount
        </span>
        <span className="text-2xl font-extrabold text-emerald-700">{money(amountDue(session))}</span>
      </div>
    </div>
  )
}

function SessionSummary({ session, phone = false }) {
  if (phone) return <PhoneSummary session={session} />
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

function PaymentStep({ session, onPaid, onPaidOnline, onRecalculate, recalculating, startMethod = 'CASH', wallet, detectedTag = '', pendingCharge = null, onLock, phone = false, onCancel, cancelDisabled = false }) {
  const { can } = useAuth()
  const due = amountDue(session)
  // The location's UPI id (set by the admin in the receipt settings): on a phone a QR code for it, with the amount, is shown.
  const { locations: myLocations } = useMyLocations()
  const here = myLocations.find((l) => l._id === (session.locationId?._id || session.locationId))
  const upiId = here?.receiptSettings?.upiId || ''
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
        <legend className="mb-2 text-sm font-medium text-slate-700">{phone ? 'PAYMENT METHOD' : 'Payment mode'}</legend>
        <div className="flex flex-wrap gap-3">
          {methods.map((value) => (
            <label
              key={value}
              className={phone
                ? 'flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-600 has-[:checked]:text-white'
                : 'flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50'}
            >
              <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className={phone ? 'sr-only' : ''} />
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
          {phone && method === 'UPI' && upiId && (
            <div className="flex flex-col items-center gap-1 py-1 text-center">
              <p className="text-base font-extrabold text-slate-900">Scan to pay {money(due)}</p>
              <QrCode
                value={`upi://pay?pa=${upiId}&pn=${encodeURIComponent(here?.name || 'Parking')}&am=${Number(due).toFixed(2)}&cu=INR&tn=${encodeURIComponent(session.ticketNumber || session.vehicleNumber || 'Parking')}`}
                size={190}
                label={`UPI QR code to pay ${money(due)}`}
              />
              <p className="text-xs text-slate-500">{upiId}</p>
              <p className="text-xs text-slate-500">Check the payment on the customer&apos;s phone, then tap Exit.</p>
            </div>
          )}
          {cash ? (
            <div className="space-y-2">
              {phone && (
                <div className="flex flex-col items-center gap-1 py-1 text-center">
                  <p className="text-base font-extrabold text-slate-900">Collect Cash</p>
                  <svg width="84" height="64" viewBox="0 0 84 64" aria-hidden="true" className="text-emerald-600">
                    <rect x="6" y="14" width="60" height="38" rx="6" fill="currentColor" />
                    <rect x="18" y="8" width="60" height="38" rx="6" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.4" />
                    <circle cx="36" cy="33" r="9" fill="#fff" />
                    <rect x="12" y="22" width="6" height="4" rx="2" fill="#fff" opacity="0.8" />
                    <rect x="54" y="40" width="6" height="4" rx="2" fill="#fff" opacity="0.8" />
                  </svg>
                  <p className="text-sm font-bold text-emerald-700">Amount: {money(due)}</p>
                </div>
              )}
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
          <div className={phone
            ? 'fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-slate-200 bg-white p-3 shadow-[0_-2px_8px_rgba(15,23,42,0.1)]'
            : 'flex items-center gap-3'}>
            <Button
              className="w-full py-3 text-base"
              loading={pay.isPending}
              disabled={!ready}
              onClick={() => pay.mutate()}
            >
              {chargeTag
                ? (waiting ? 'Check FASTag charge again' : `Charge FASTag ${money(due)} and exit`)
                : phone ? `Exit · ${money(payable)}` : `Exit — ${money(payable)} received`}
            </Button>
            {phone && onCancel && (
              <Button type="button" variant="secondary" className="w-full py-3 text-base" disabled={cancelDisabled} onClick={onCancel}>
                Scan Again
              </Button>
            )}
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

function Done({ session, paid, method, advance, hardware, onNext, skipReceipt = false, phone = false }) {
  const { user } = useAuth()
  const mayPrint = user?.access?.reprint !== false
  const covered = !paid && session.fee.total > 0 && session.fee.advanceApplied > 0
  const giveBack = session.fee.advanceRefunded || advance?.refund || 0
  // In the phone app the bill goes to the phone's Bluetooth printer; at a gate PC it goes to the gate's printer.
  const print = useMutation({
    mutationFn: async () => {
      if (!printerAvailable) return parkingApi.print(session._id)
      await printBillOnPhone(await parkingApi.receipt(session._id))
      return null
    },
  })
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
  if (phone) {
    // The invoice as a popup: OK goes back to the camera, Print Receipt sends it to the phone's printer.
    const lines = [
      ['TOKEN', session.ticketNumber],
      ['VEHICLE', session.vehicleNumber],
      ['TYPE', VEHICLE_LABELS[session.vehicleType]],
      ['IN TIME', dateTime(session.entryTime)],
      ['OUT TIME', dateTime(session.exitTime)],
      ['DURATION', duration(session.durationMinutes)],
    ]
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4" role="status">
        <div className="mx-auto mt-4 max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-2xl">
          <div className="rounded-lg border border-slate-200 p-3 font-mono text-[13px] leading-6 text-slate-900">
            <p className="text-center text-lg font-bold">INVOICE</p>
            <hr className="my-2 border-dashed border-slate-400" />
            {lines.map(([label, value]) => (
              <p key={label} className="flex justify-between gap-3"><span>{label}:</span><span className="text-right">{value}</span></p>
            ))}
            <hr className="my-2 border-dashed border-slate-400" />
            <p className="flex justify-between gap-3 text-base font-bold"><span>PARKING CHARGE:</span><span>{money(amountDue(session))}</span></p>
            <p className="mt-2 text-center text-xs text-slate-500">THANK YOU AND HAVE A NICE DAY, DRIVE SAFE</p>
          </div>
          {giveBack > 0 && (
            <Alert type="info">
              Give {money(giveBack)} back to the customer
              {advance?.method ? ` (the advance was paid by ${PAYMENT_LABELS[advance.method] || advance.method})` : ''}.
            </Alert>
          )}
          <DeviceStatus hardware={hardware} sessionId={session._id} direction="EXIT" />
          <Alert>{print.error && errorMessage(print.error)}</Alert>
          <Alert type="success">{print.isSuccess && 'Receipt sent to the printer.'}</Alert>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="py-3" autoFocus onClick={onNext}>OK</Button>
            {canPrint ? (
              <Button className="py-3" loading={print.isPending} onClick={() => print.mutate()}>Print Receipt</Button>
            ) : (
              <span />
            )}
          </div>
          {!skipReceipt && (
            <Link to={`/operator/receipt/${session._id}`} className="block text-center text-sm font-semibold text-[#2563eb]">View receipt</Link>
          )}
        </div>
      </div>
    )
  }
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
function VehicleSearch({ locationId, text, onText, onPick, onSubmitText, disabled, phone = false }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  // On a phone the list of vehicles inside is always shown under the box (no dropdown) and the keyboard can be numbers or letters.
  const [keys, setKeys] = useState('123')
  const showList = open || phone
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
    enabled: Boolean(locationId) && showList,
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
        autoFocus={!phone}
        autoComplete="off"
        autoCapitalize="characters"
        disabled={disabled}
        value={text}
        placeholder={phone ? 'Search vehicle number' : 'Type min 3 characters to search…'}
        inputMode={phone && keys === '123' ? 'numeric' : 'text'}
        className="w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-4 text-xl font-bold uppercase tracking-normal sm:px-4 sm:text-2xl sm:tracking-wider text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-300 disabled:bg-slate-100"
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
      {phone && (
        <div className="mt-2 flex justify-center">
          <div className="inline-flex rounded-full bg-slate-100 p-1 ring-1 ring-slate-200" role="group" aria-label="Keyboard">
            {['123', 'ABC'].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={keys === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setKeys(value); document.getElementById('exit-search')?.blur(); setTimeout(() => document.getElementById('exit-search')?.focus(), 80) }}
                className={`min-w-16 rounded-full px-4 py-1.5 text-sm font-bold ${keys === value ? 'bg-[#2563eb] text-white shadow' : 'text-slate-600'}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      )}
      {showList && !disabled && (
        <div className={`${phone ? 'mt-3' : 'absolute z-20 mt-1 max-h-96'} w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg`} role="listbox" aria-label="Vehicles inside">
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
                    ? `${phone ? 'Latest entry vehicles: newest' : 'Newest'} ${all.length} of ${total} vehicles inside. Type to find another.`
                    : `${phone ? 'Latest entry vehicles: ' : ''}${total} vehicle${total === 1 ? '' : 's'} inside`}
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
  // Phone: the camera reads the number plate ("Vehicle Number") or the phone's scanner reads the ticket's QR code.
  const [phone] = useState(isPhoneWidth)
  const [mode, setMode] = useState('plate')
  const [cameraKey, setCameraKey] = useState(0)
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
  // In the phone app the phone's own scanner opens; if it cannot, the page's camera reader is shown instead.
  const startScan = async () => {
    if (!nativeScannerAvailable) return setScanning(true)
    try {
      const scanned = await scanQrNative()
      if (scanned) onScan(scanned)
    } catch {
      setScanning(true)
    }
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
    setCameraKey((k) => k + 1)
  }
  // "Scan Again" / "OK" on a phone: clear this vehicle and be ready for the next one (the scanner opens again in QR mode).
  const again = () => {
    next()
    if (phone && mode === 'qr') setTimeout(startScan, 300)
  }
  // The camera read a plate clearly: look the vehicle up. A plate that was just handled (or not found) is left alone for a minute.
  const onCameraPlate = (plate) => {
    if (lookup.isPending || result) return
    if (plate === plateKey(recent.current.plate || '') && Date.now() < recent.current.until) return
    setText(formatPlate(plate))
    run(plate)
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
      <GateBar other={can('ENTRY_CREATE') ? 'entry' : 'exit'}>
        {can('EXIT_CREATE') && <OpenBarrierButton locationId={locationId} direction="EXIT" gate={gate} />}
      </GateBar>
      <OnlinePill />
      <div className="max-md:hidden">
      <LaneBar location={location} gate={gate} company={company} parkingType={location?.parkingType}>
        {can('EXIT_CREATE') && <OpenBarrierButton locationId={locationId} direction="EXIT" gate={gate} />}
        <AutoSwitch
          label="AUTO EXIT"
          on={autoExit}
          onChange={setAutoExit}
          hint="When the gate camera reads a number plate clearly, the vehicle is found and the fee is shown by itself. The barrier opens the moment the payment is recorded (or at once when nothing is due)."
        />
      </LaneBar>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          <div className="no-print space-y-3">
            <Alert>{lookup.error && errorMessage(lookup.error)}</Alert>
            {phone && !result && mode === 'plate' && plateReaderAvailable && (
              <PlateCamera paused={Boolean(result) || lookup.isPending} resetKey={cameraKey} onPlate={onCameraPlate} />
            )}
            {phone && !result && (
              <ModeSwitch
                value={mode}
                onChange={(value) => {
                  setMode(value)
                  if (value === 'qr') startScan()
                }}
                options={[['qr', 'QR Code'], ['plate', 'Vehicle Number']]}
              />
            )}
            {phone && !result && mode === 'qr' && (
              <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-600">Scan the QR code on the customer's ticket. The fee is shown at once.</p>
                <Button type="button" className="mt-4 w-full py-3 text-base" loading={lookup.isPending} onClick={startScan}>Scan QR code</Button>
              </div>
            )}
            {(!phone || (mode === 'plate' && !result)) && (
              <>
                <VehicleSearch
                  locationId={locationId}
                  text={text}
                  onText={(value) => {
                    setText(value)
                    setDetection((d) => (d && plateKey(value) === d.plate ? d : null))
                  }}
                  onPick={pick}
                  onSubmitText={run}
                  phone={phone}
                  disabled={Boolean(result) || lookup.isPending || !locationId}
                />
                {!locationId && <p className="text-sm text-slate-500">Choose a parking location first.</p>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={lostTicket} onChange={(event) => setLostTicket(event.target.checked)} />
                    Ticket is lost (type the vehicle number, then press Enter)
                  </label>
                  <Button type="button" variant="secondary" className="max-md:hidden" onClick={scanning ? () => setScanning(false) : startScan}>
                    {scanning ? 'Close camera' : 'Scan QR code'}
                  </Button>
                </div>
              </>
            )}
            {scanning && <QrScanner onScan={onScan} onClose={() => setScanning(false)} />}
          </div>

          <div className="max-md:hidden">
            <PlateSuggestions
              locationId={locationId}
              direction="EXIT"
              onUse={applySuggestion}
              usedId={detection?._id}
              canFill={!text.trim() && !detection && !result && !lookup.isPending}
              auto={autoExit}
              onAuto={autoLookup}
            />
          </div>

          {session && (
            <Card title={phone ? undefined : finished ? 'Exit complete' : 'Fee to collect'} className={phone ? 'max-md:p-3' : ''}>
              <div className="space-y-5">
                <PassBanner pass={result.pass} at="exit" />
                <SessionSummary session={session} phone={phone} />
                <PhotoPanel key={session._id} sessionId={session._id} kind="EXIT" />
                {finished ? (
                  <Done
                    session={session}
                    paid={result.paid}
                    method={result.method}
                    advance={result.advance}
                    hardware={result.hardware}
                    onNext={again}
                    // A location can switch the receipt off for pass holders, who pay nothing.
                    skipReceipt={session.status === 'PASS_EXIT' && !ops.printPassReceipt}
                    phone={phone}
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
                      phone={phone}
                      onCancel={again}
                      cancelDisabled={paymentLocked}
                    />
                    {!phone && <Button variant="secondary" className="w-full" disabled={paymentLocked} onClick={next}>Cancel</Button>}
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

        <div className="min-w-0 space-y-4 max-md:hidden lg:col-span-2">
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
