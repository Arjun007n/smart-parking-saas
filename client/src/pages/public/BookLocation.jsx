import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { publicBookingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, localInput, money } from '../../utils/format'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert, Button, Field, Select } from '../../components/ui'
import { Skeleton } from '../../components/motion'
import { rememberBooking } from './bookingMemory'
import { directionsUrl } from '../../utils/geo'
import { embedUrl, mapsEnabled } from '../../components/maps/googleMaps'

export default function BookLocation() {
  const { locationId } = useParams()
  const navigate = useNavigate()
  const { data: offer, isLoading, error } = useQuery({
    queryKey: ['public-location', locationId],
    queryFn: () => publicBookingApi.location(locationId),
    retry: false,
  })
  usePageTitle(offer ? `Book at ${offer.name}` : 'Book a parking space')

  const [form, setForm] = useState(() => ({ vehicleNumber: '', vehicleType: '', customerName: '', phone: '', expectedAt: localInput(new Date(Date.now() + 3600_000)), note: '' }))
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const type = form.vehicleType || offer?.types?.[0]?.type || ''
  const fee = offer?.types?.find((t) => t.type === type)?.fee || 0

  const create = useMutation({
    mutationFn: () =>
      publicBookingApi.create({
        locationId,
        vehicleNumber: form.vehicleNumber,
        vehicleType: type,
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        expectedAt: new Date(form.expectedAt).toISOString(),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      }),
    onSuccess: ({ booking, token }) => {
      rememberBooking(booking.id, token)
      navigate(`/booking/${booking.id}?token=${encodeURIComponent(token)}`)
    },
  })

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading" className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <Skeleton className="h-8 w-1/2" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }
  if (error || !offer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Alert>{error ? errorMessage(error) : 'This parking is not available.'}</Alert>
        <p className="mt-4"><Link to="/book" className="text-blue-700 hover:underline">See other parkings</Link></p>
      </div>
    )
  }

  const address = [offer.address?.line1, offer.address?.city, offer.address?.state].filter(Boolean).join(', ')
  return (
    <>
      <PageHeader title={offer.name} intro={address} />
      <div className="mx-auto max-w-xl px-4 py-12">
        {offer.coordinates && (
          <div className="mb-6 space-y-3">
            {mapsEnabled && (
              <iframe
                title={`Map of ${offer.name}`}
                src={embedUrl(offer.coordinates)}
                className="h-56 w-full rounded-xl border border-slate-200"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            )}
            <a href={directionsUrl(offer.coordinates)} target="_blank" rel="noreferrer" className="sp-press inline-block rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
              Get directions
            </a>
          </div>
        )}
        {offer.types.length === 0 ? (
          <Alert type="info">This parking is not taking online bookings right now.</Alert>
        ) : (
          <form
            className="sp-row-in space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            {offer.note && <Alert type="info">{offer.note}</Alert>}
            <Alert>{create.error && errorMessage(create.error)}</Alert>
            <Field label="Vehicle number" name="book-plate" required autoComplete="off" className="[&_input]:uppercase" value={form.vehicleNumber} onChange={(event) => set({ vehicleNumber: event.target.value })} />
            <Select label="Vehicle type" name="book-type" value={type} onChange={(event) => set({ vehicleType: event.target.value })}>
              {offer.types.map((t) => (
                <option key={t.type} value={t.type}>
                  {VEHICLE_LABELS[t.type] || t.type} · {t.fee > 0 ? `${money(t.fee)} booking fee` : 'free'}
                </option>
              ))}
            </Select>
            <Field label="Your name" name="book-name" required autoComplete="name" value={form.customerName} onChange={(event) => set({ customerName: event.target.value })} />
            <Field label="Mobile number" name="book-phone" type="tel" inputMode="tel" required autoComplete="tel" hint="We send your booking confirmation here" value={form.phone} onChange={(event) => set({ phone: event.target.value })} />
            <Field
              label="When will you arrive?"
              name="book-time"
              type="datetime-local"
              required
              hint={`We keep the booking for ${offer.graceHours} hours after this time. A booking does not reserve a particular space.`}
              value={form.expectedAt}
              onChange={(event) => set({ expectedAt: event.target.value })}
            />
            <Field label="Note (optional)" name="book-note" autoComplete="off" value={form.note} onChange={(event) => set({ note: event.target.value })} />
            <Button type="submit" loading={create.isPending}>
              {fee > 0 ? `Continue to pay ${money(fee)}` : 'Book now'}
            </Button>
            {fee > 0 && <p className="text-xs text-slate-500">The fee is taken off your parking charge when you arrive. If you cancel, ask the parking for a refund.</p>}
          </form>
        )}
      </div>
    </>
  )
}
