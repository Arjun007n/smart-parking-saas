import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { paymentApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { amountDue, money, timeOnly } from '../../utils/format'
import { Alert, Button } from '../ui'
import QrCode from '../QrCode'
import { useFallbackInterval } from '../../hooks/useLive'

// Online payment at the exit: shows a QR code the customer scans with any UPI
// app, then waits for the gateway to confirm. The vehicle is released by the
// server the moment the payment is confirmed; this screen only follows along.
export default function OnlinePayment({ session, simulated, onPaid, onBack }) {
  const [payment, setPayment] = useState(null)

  const start = useMutation({
    mutationFn: () => paymentApi.create({ sessionId: session._id, method: 'GATEWAY', amount: amountDue(session) }),
    onSuccess: (data) => setPayment(data.payment),
  })

  // The server announces a confirmed payment at once; the timer is a safety net while that works.
  const interval = useFallbackInterval(8000, 2000)
  const status = useQuery({
    queryKey: ['payment', payment?._id],
    queryFn: () => paymentApi.get(payment._id),
    enabled: Boolean(payment) && payment.status === 'PENDING',
    refetchInterval: (query) => (['SUCCESS', 'FAILED'].includes(query.state.data?.payment.status) ? false : interval),
  })

  const latest = status.data?.payment || payment
  const done = status.data && latest?.status === 'SUCCESS' && status.data.completed

  const cancel = useMutation({
    mutationFn: () => paymentApi.cancel(payment._id),
    onSuccess: onBack,
  })
  const play = useMutation({ mutationFn: (outcome) => paymentApi.simulate(payment._id, outcome) })

  // Paid and the vehicle released: hand over to the normal "exit complete" view.
  useEffect(() => {
    if (done) onPaid({ session: status.data.session, hardware: status.data.hardware })
  }, [done, status.data, onPaid])
  if (done) return null

  if (!payment) {
    return (
      <div className="space-y-3">
        <Alert>{start.error && errorMessage(start.error)}</Alert>
        <Button className="w-full py-3 text-base" loading={start.isPending} onClick={() => start.mutate()}>
          Show payment QR for {money(amountDue(session))}
        </Button>
        <Button variant="secondary" className="w-full" onClick={onBack}>Choose another method</Button>
      </div>
    )
  }

  if (latest.status === 'FAILED') {
    return (
      <div className="space-y-3">
        <Alert>{`The online payment did not go through${latest.failureReason ? `: ${latest.failureReason}` : '.'}`}</Alert>
        <Button className="w-full" onClick={() => setPayment(null)}>Try online payment again</Button>
        <Button variant="secondary" className="w-full" onClick={onBack}>Take cash, UPI or card instead</Button>
      </div>
    )
  }

  if (latest.status === 'SUCCESS') {
    // Money taken, but the session was closed in the meantime (for example by an admin).
    if (status.data && !status.data.completed) {
      return <Alert>Payment received, but this vehicle was no longer waiting to pay. Tell your admin; they have been alerted.</Alert>
    }
    return <Alert type="success">Payment received. Releasing the vehicle…</Alert>
  }

  return (
    <div className="space-y-4" role="status">
      <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-4">
        {latest.payUrl ? (
          <QrCode value={latest.payUrl} size={192} level="M" label="QR code to pay online" />
        ) : (
          <p className="text-sm text-slate-600">Waiting for the payment gateway…</p>
        )}
        <p className="text-lg font-bold text-slate-900">{money(latest.amount)}</p>
        <p className="text-center text-sm text-slate-600">
          Ask the customer to scan this code and pay. This screen updates by itself.
        </p>
        <p className="text-xs text-slate-500">
          Reference {latest.transactionId}
          {latest.expiresAt ? ` · valid until ${timeOnly(latest.expiresAt)}` : ''}
        </p>
      </div>
      <Alert>{(cancel.error && errorMessage(cancel.error)) || (status.error && errorMessage(status.error))}</Alert>
      {simulated && (
        <div className="space-y-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">Test mode: no real money is involved.</p>
          <Alert>{play.error && errorMessage(play.error)}</Alert>
          <div className="flex gap-2">
            <Button variant="secondary" loading={play.isPending} onClick={() => play.mutate('SUCCESS')}>Simulate: customer paid</Button>
            <Button variant="secondary" loading={play.isPending} onClick={() => play.mutate('FAILED')}>Simulate: payment failed</Button>
          </div>
        </div>
      )}
      <Button variant="secondary" className="w-full" loading={cancel.isPending} onClick={() => cancel.mutate()}>
        Cancel and choose another method
      </Button>
    </div>
  )
}
