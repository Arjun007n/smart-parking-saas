import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, SESSION_STATUS, VEHICLE_LABELS, dateTime, duration, money } from '../../utils/format'
import { printThermal } from '../../utils/print'
import { Alert, Button, PageLoader } from '../../components/ui'
import DeviceStatus from '../../components/operator/DeviceStatus'
import QrCode from '../../components/QrCode'
import { receiptSettings } from '../../utils/receiptSettings'
import PhotoPanel from '../../components/operator/PhotoPanel'

function Row({ label, children, strong }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'text-base font-bold text-slate-900' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

export default function Receipt() {
  const { id } = useParams()
  const { data: r, isLoading, error } = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => parkingApi.receipt(id),
  })

  // Sends the receipt to the thermal printer at the gate (if one is set up).
  const { user } = useAuth()
  const thermal = useMutation({ mutationFn: () => parkingApi.print(id) })

  // A receipt printed from the browser is counted as a reprint for the person who printed it.
  const printHere = (action) => {
    parkingApi.reprint(id).catch(() => {})
    action()
  }

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>

  const address = [r.location.address?.line1, r.location.address?.city, r.location.address?.state, r.location.address?.pincode]
    .filter(Boolean)
    .join(', ')
  const b = r.amount.breakdown
  const look = receiptSettings(r.settings)

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link to="/operator/exit" className="text-sm text-blue-700 hover:underline">
          ← Back to exit
        </Link>
        <div className="flex flex-wrap gap-2">
          {user?.access?.reprint !== false && (
            <Button variant="secondary" loading={thermal.isPending} onClick={() => thermal.mutate()}>
              Print on gate printer
            </Button>
          )}
          <Button variant="secondary" onClick={() => printHere(() => printThermal(80))}>Print 80 mm slip</Button>
          <Button onClick={() => printHere(() => window.print())}>Print / save as PDF</Button>
        </div>
      </div>
      <div className="no-print space-y-2">
        <Alert>{thermal.error && errorMessage(thermal.error)}</Alert>
        {thermal.data && (
          <DeviceStatus
            key={thermal.data.commandId}
            hardware={{ print: thermal.data }}
            sessionId={id}
            direction="EXIT"
          />
        )}
      </div>

      {r.photos?.length > 0 && (
        <div className="no-print rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <PhotoPanel sessionId={id} readOnly />
        </div>
      )}

      <article className="print-area rounded-xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200">
        <header className="border-b border-slate-200 pb-4 text-center">
          <h1 className="text-lg font-bold text-slate-900">{r.company.legalName || r.company.name}</h1>
          <p className="text-slate-700">{r.location.name}</p>
          {look.showAddress && address && <p className="text-xs text-slate-500">{address}</p>}
          {look.showGst && r.company.gstNumber && <p className="text-xs text-slate-500">GSTIN: {r.company.gstNumber}</p>}
          {look.headerNote && <p className="mt-1 text-xs text-slate-600">{look.headerNote}</p>}
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Parking receipt</p>
        </header>

        <dl className="space-y-2 border-b border-slate-200 py-4">
          <Row label="Receipt no.">{r.receiptNumber}</Row>
          <Row label="Ticket no."><span className="font-mono">{r.ticketNumber}</span></Row>
          <Row label="Vehicle">{r.vehicle.number} ({VEHICLE_LABELS[r.vehicle.type]})</Row>
          <Row label="Entry">{dateTime(r.entryTime)}{r.entryGate ? ` · ${r.entryGate}` : ''}</Row>
          <Row label="Exit">{dateTime(r.exitTime)}{r.exitGate ? ` · ${r.exitGate}` : ''}</Row>
          {r.durationMinutes != null && <Row label="Duration">{duration(r.durationMinutes)}</Row>}
          <Row label="Status">{SESSION_STATUS[r.status]?.label || r.status}</Row>
        </dl>

        <dl className="space-y-2 border-b border-slate-200 py-4">
          <Row label="Parking fee">{money(b.base)}</Row>
          {b.overnight > 0 && <Row label="Overnight charge">{money(b.overnight)}</Row>}
          {b.lostTicket > 0 && <Row label="Lost ticket penalty">{money(b.lostTicket)}</Row>}
          {b.discount > 0 && <Row label="Discount">−{money(b.discount)}</Row>}
          {r.amount.taxPercent > 0 && (
            <>
              <Row label="Amount before tax">{money(r.amount.subtotal)}</Row>
              <Row label={`Tax (${r.amount.taxPercent}%)`}>{money(r.amount.tax)}</Row>
            </>
          )}
          <Row label="Total" strong>{money(r.amount.total)}</Row>
          {r.advance && (
            <>
              <Row label={`Advance paid at entry (${PAYMENT_LABELS[r.advance.method] || r.advance.method})`}>{money(r.advance.amount)}</Row>
              {r.advance.refunded > 0 && <Row label="Advance given back">−{money(r.advance.refunded)}</Row>}
            </>
          )}
          <Row label="Paid" strong>{money(r.paid)}</Row>
        </dl>

        <dl className="space-y-2 py-4">
          {r.payment ? (
            <>
              <Row label="Paid by">{PAYMENT_LABELS[r.payment.method] || r.payment.method}</Row>
              {r.payment.transactionId && <Row label="Reference">{r.payment.transactionId}</Row>}
              <Row label="Paid at">{dateTime(r.payment.paidAt)}</Row>
            </>
          ) : (
            <Row label="Payment">None</Row>
          )}
          {r.pass && <Row label="Monthly pass">{r.pass.passNumber} · {r.pass.holderName}</Row>}
          {r.note && <Row label="Note">{r.note}</Row>}
          {r.operators.exit && <Row label="Operator">{r.operators.exit}</Row>}
        </dl>

        {look.showQr !== 'OFF' && (
          <div className="mb-3 flex justify-center">
            <QrCode value={r.ticketNumber} size={96} label={`QR code for ticket ${r.ticketNumber}`} />
          </div>
        )}
        <p className="text-center text-xs text-slate-500">Reference: {r.reference}</p>
        <p className="mt-1 text-center text-xs text-slate-500">{look.receiptFooter}</p>
      </article>
    </div>
  )
}
