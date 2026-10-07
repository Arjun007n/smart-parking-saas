import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { publicBookingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime, money, waitText } from '../../utils/format'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../hooks/useToast'
import { playCue } from '../../utils/sound'
import { Skeleton } from '../../components/motion'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert, Badge, Button } from '../../components/ui'
import { rememberBooking } from './bookingMemory'

// What the customer sees when the booking moves on while this page is open.
const CHANGE = {
  BOOKED: { title: 'Booking confirmed', message: 'Your payment went through.', tone: 'success', cue: 'success' },
  ARRIVED: { title: 'Vehicle entered', message: 'Your vehicle has entered the parking.', tone: 'success', cue: 'entry' },
  CANCELLED: { title: 'Booking cancelled', message: '', tone: 'error', cue: 'error' },
  EXPIRED: { title: 'Booking expired', message: 'The payment was not completed in time.', tone: 'error', cue: 'error' },
}

// The steps a booking goes through, for the progress strip.
const STEPS = ['Booked', 'Paid', 'Arrived']
const stepReached = (booking) => {
  if (booking.status === 'ARRIVED') return 3
  if (booking.status === 'BOOKED') return booking.payment?.state === 'PAID' ? 2 : 1
  return 0
}

const STATUS = {
  AWAITING_PAYMENT: { label: 'Waiting for payment', tone: 'blue' },
  BOOKED: { label: 'Confirmed', tone: 'green' },
  ARRIVED: { label: 'Vehicle entered', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
  EXPIRED: { label: 'Expired', tone: 'red' },
}

export default function BookingStatus() {
  usePageTitle('Your booking')
  const { id } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-booking', id],
    queryFn: () => publicBookingApi.get(id, token),
    enabled: Boolean(token),
    retry: false,
    // While the customer is paying, look again every few seconds.
    refetchInterval: (query) => (query.state.data?.booking?.status === 'AWAITING_PAYMENT' ? 4000 : false),
  })
  const toast = useToast()
  const lastStatus = useRef(null)
  const status = data?.booking?.status
  useEffect(() => {
    if (!status) return
    const before = lastStatus.current
    lastStatus.current = status
    const change = CHANGE[status]
    if (before && before !== status && change) {
      toast({ title: change.title, message: change.message, tone: change.tone })
      playCue(change.cue)
    }
  }, [status, toast])
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancel = useMutation({
    mutationFn: () => publicBookingApi.cancel(id, token),
    onSuccess: () => {
      setConfirmCancel(false)
      queryClient.invalidateQueries({ queryKey: ['public-booking', id] })
    },
  })
  const simulate = useMutation({
    mutationFn: (outcome) => publicBookingApi.simulate(id, token, outcome),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-booking', id] }),
  })

  if (!token) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert>This booking link is incomplete. Open the link exactly as it was shown after booking.</Alert>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading your booking" className="mx-auto max-w-xl space-y-3 px-4 py-16">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert>{error ? errorMessage(error) : 'Booking not found.'}</Alert>
        <p className="mt-4"><Link to="/book" className="text-blue-700 hover:underline">Book a parking</Link></p>
      </div>
    )
  }

  const { booking, simulated } = data
  const look = STATUS[booking.status] || { label: booking.status, tone: 'slate' }
  const reached = stepReached(booking)
  const payUrl = booking.payment?.payUrl
  const realPage = typeof payUrl === 'string' && /^https:\/\//i.test(payUrl)
  const refundDue = booking.payment?.state === 'REFUND_DUE'
  const paid = booking.payment?.state === 'PAID'

  return (
    <>
      <PageHeader title="Your booking" intro={booking.location?.name} />
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="sp-row-in rounded-xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-2xl font-bold tracking-wider text-slate-900">{booking.code}</p>
            <span key={booking.status} className="sp-pop"><Badge tone={look.tone}>{look.label}</Badge></span>
          </div>
          {reached > 0 && (
            <ol aria-label="Booking progress" className="mt-4 flex items-center gap-2 text-xs">
              {STEPS.map((step, i) => (
                <li key={step} className="flex flex-1 items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-bold transition-colors duration-500 ${i < reached ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {i < reached ? '✓' : i + 1}
                  </span>
                  <span className={i < reached ? 'font-medium text-slate-900' : 'text-slate-500'}>{step}</span>
                  {i < STEPS.length - 1 && <span aria-hidden="true" className={`h-0.5 flex-1 rounded transition-colors duration-500 ${i + 1 < reached ? 'bg-green-600' : 'bg-slate-200'}`} />}
                </li>
              ))}
            </ol>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-slate-500">Vehicle</dt>
            <dd className="font-mono font-semibold text-slate-900">{booking.vehicleNumber} <span className="font-sans font-normal text-slate-500">{VEHICLE_LABELS[booking.vehicleType]}</span></dd>
            <dt className="text-slate-500">Arriving</dt>
            <dd className="text-slate-900">{dateTime(booking.expectedAt)}</dd>
            <dt className="text-slate-500">Parking</dt>
            <dd className="text-slate-900">{[booking.location?.name, booking.location?.address, booking.location?.city].filter(Boolean).join(', ')}</dd>
            <dt className="text-slate-500">Booking fee</dt>
            <dd className="text-slate-900">{booking.amount > 0 ? `${money(booking.amount)}${paid ? ' · paid' : ''}` : 'Free'}</dd>
          </dl>
        </div>

        <div className="mt-5 space-y-4">
          {booking.status === 'AWAITING_PAYMENT' && (
            <>
              <Alert type="info">
                Your booking is not confirmed until the payment goes through.
                {booking.payment?.expiresAt ? ` Pay before ${dateTime(booking.payment.expiresAt)}.` : ''}
              </Alert>
              {realPage && (
                <a
                  href={payUrl}
                  onClick={() => rememberBooking(id, token)}
                  className="block rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Pay {money(booking.amount)}
                </a>
              )}
              {!realPage && simulated && (
                <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-4">
                  <p className="text-sm text-slate-600">Test mode: no real payment page. Play the customer paying.</p>
                  <Alert>{simulate.error && errorMessage(simulate.error)}</Alert>
                  <div className="flex gap-2">
                    <Button loading={simulate.isPending} onClick={() => simulate.mutate('SUCCESS')}>Customer paid</Button>
                    <Button variant="secondary" disabled={simulate.isPending} onClick={() => simulate.mutate('FAILED')}>Payment failed</Button>
                  </div>
                </div>
              )}
            </>
          )}
          {booking.status === 'BOOKED' && (
            <Alert type="success">
              Booking confirmed. At the gate, give your reference {booking.code} or your vehicle number.
              {paid ? ' Your booking fee is taken off your parking charge.' : ''} We keep the booking for {waitText(booking.waitingMinutes ?? booking.graceHours * 60)} after your arrival time.
            </Alert>
          )}
          {booking.status === 'BOOKED' && booking.canCancel && (
            <div className="space-y-2">
              <Alert>{cancel.error && errorMessage(cancel.error)}</Alert>
              {confirmCancel ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-700">
                    Cancel this booking?{paid ? ' Your booking fee will be refunded by the parking.' : ''}
                  </span>
                  <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Yes, cancel it</Button>
                  <Button variant="secondary" disabled={cancel.isPending} onClick={() => setConfirmCancel(false)}>Keep it</Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>Cancel booking</Button>
              )}
              <p className="text-xs text-slate-500">You can cancel until {waitText(booking.cancelBeforeMinutes)} before your arrival time.</p>
            </div>
          )}
          {booking.status === 'ARRIVED' && <Alert type="success">Your vehicle has entered. Thank you!</Alert>}
          {['CANCELLED', 'EXPIRED'].includes(booking.status) && !refundDue && (
            <Alert>This booking is {look.label.toLowerCase()}. <Link to="/book" className="underline">Book again</Link></Alert>
          )}
          {refundDue && (
            <Alert type="info">
              Your payment of {money(booking.amount)} could not be used for this booking. The parking has been told and will refund it. Quote {booking.code} if you need to ask.
            </Alert>
          )}
          <p className="text-xs text-slate-500">Keep this page address: it is how you open your booking. Do not share it.</p>
        </div>
      </div>
    </>
  )
}
