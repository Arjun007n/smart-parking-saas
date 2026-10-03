import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, SESSION_STATUS, VEHICLE_LABELS, dateTime, duration, money } from '../../utils/format'
import { Alert, Button, PageLoader } from '../../components/ui'

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

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>

  const address = [r.location.address?.line1, r.location.address?.city, r.location.address?.state, r.location.address?.pincode]
    .filter(Boolean)
    .join(', ')
  const b = r.amount.breakdown

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link to="/operator/exit" className="text-sm text-blue-700 hover:underline">
          ← Back to exit
        </Link>
        <Button onClick={() => window.print()}>Print / save as PDF</Button>
      </div>

      <article className="print-area rounded-xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200">
        <header className="border-b border-slate-200 pb-4 text-center">
          <h1 className="text-lg font-bold text-slate-900">{r.company.legalName || r.company.name}</h1>
          <p className="text-slate-700">{r.location.name}</p>
          {address && <p className="text-xs text-slate-500">{address}</p>}
          {r.company.gstNumber && <p className="text-xs text-slate-500">GSTIN: {r.company.gstNumber}</p>}
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
          {r.note && <Row label="Note">{r.note}</Row>}
          {r.operators.exit && <Row label="Operator">{r.operators.exit}</Row>}
        </dl>

        <p className="text-center text-xs text-slate-500">Reference: {r.reference} · Thank you</p>
      </article>
    </div>
  )
}
