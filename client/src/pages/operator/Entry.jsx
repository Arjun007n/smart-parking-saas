import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi, paymentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { playCue } from '../../utils/sound'
import { markLocalAction } from '../../utils/localAction'
import { rememberLocation, useMyLocations } from '../../hooks/useMyLocations'
import { initialLane, useRememberLane } from '../../hooks/useLane'
import { useGateCamera } from '../../hooks/useGateCamera'
import { entrySchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, dateTime, money, newRequestKey } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader } from '../../components/ui'
import LocationPicker from '../../components/operator/LocationPicker'
import LaneBar from '../../components/operator/LaneBar'
import LivePreview from '../../components/operator/LivePreview'
import GateCameraNote from '../../components/operator/GateCameraNote'
import AutoSwitch from '../../components/operator/AutoSwitch'
import DeviceStatus, { OpenBarrierButton } from '../../components/operator/DeviceStatus'
import PlateSuggestions from '../../components/operator/PlateSuggestions'
import EntryCamera from '../../components/operator/EntryCamera'
import EntryHistory from '../../components/operator/EntryHistory'
import BookingsPanel from '../../components/operator/BookingsPanel'
import { useBookings } from '../../hooks/useBookings'
import PassBanner from '../../components/pass/PassBanner'
import PhotoPanel from '../../components/operator/PhotoPanel'
import QrCode from '../../components/QrCode'
import { receiptSettings } from '../../utils/receiptSettings'

function Ticket({ session, locationName, repeated, settings }) {
  const look = receiptSettings(settings)
  return (
    <div className="print-area rounded-xl border-2 border-dashed border-slate-400 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-slate-600">{locationName}</p>
      {look.headerNote && <p className="text-xs text-slate-600">{look.headerNote}</p>}
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Parking ticket</p>
      <p className="mt-3 font-mono text-3xl font-bold tracking-wider text-slate-900">{session.ticketNumber}</p>
      <p className="mt-3 text-xl font-semibold text-slate-900">{session.vehicleNumber}</p>
      <p className="text-sm text-slate-600">
        {VEHICLE_LABELS[session.vehicleType]} · In at {dateTime(session.entryTime)}
        {session.entryGate ? ` · ${session.entryGate}` : ''}
      </p>
      {look.showQr !== 'OFF' && (
        <div className="mt-3 flex justify-center">
          <QrCode value={session.ticketNumber} size={110} label={`QR code for ticket ${session.ticketNumber}`} />
        </div>
      )}
      {session.advance?.amount > 0 && (
        <p className="mt-3 text-sm font-semibold text-slate-800">
          Advance paid: {money(session.advance.amount)} ({PAYMENT_LABELS[session.advance.method] || session.advance.method})
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">{look.ticketFooter}</p>
      {repeated && <p className="mt-2 text-xs text-slate-500">(This ticket was already created.)</p>}
      <Button variant="secondary" className="no-print mt-4" onClick={() => window.print()}>
        Print ticket
      </Button>
    </div>
  )
}

// Which capacity counter belongs to which vehicle type.
const CAPACITY_KEY = Object.fromEntries(Object.keys(VEHICLE_LABELS).map((type) => [type, type.toLowerCase()]))
const cleanPlate = (value) => String(value || '').toUpperCase().replace(/[\s-]/g, '')
// The car that just got its ticket stays in front of the camera for a while.
const RECENT_MS = 60_000

// A ticket opened again from the entry history: print it in the browser (above)
// or on the gate's thermal printer (below).
function ReprintBar({ session }) {
  const print = useMutation({ mutationFn: () => parkingApi.print(session._id) })
  return (
    <div className="no-print mt-3 space-y-2">
      <Button variant="secondary" loading={print.isPending} onClick={() => print.mutate()}>
        Send to thermal printer
      </Button>
      <Alert>{print.error && errorMessage(print.error)}</Alert>
      <Alert type="success">{print.isSuccess && 'Sent to the printer.'}</Alert>
    </div>
  )
}

const ADVANCE_METHODS = ['CASH', 'UPI', 'CARD', 'FASTAG']

function EntryForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  // Taking money at the gate needs the permission to collect payments.
  const { can, company } = useAuth()
  const canTakeAdvance = can('PAYMENT_COLLECT')
  // With a FASTag partner set up, FASTag means charging the tag, which only the exit screen does.
  const paymentOptions = useQuery({ queryKey: ['payment-options'], queryFn: paymentApi.options, staleTime: 5 * 60 * 1000, enabled: canTakeAdvance })
  const fastagCharges = Boolean(paymentOptions.data?.fastag)
  const advanceMethods = ADVANCE_METHODS.filter((value) => !(value === 'FASTAG' && fastagCharges))
  // One key per entry attempt; kept across retries, renewed after success.
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [ticket, setTicket] = useState(null)
  // The camera suggestion the operator chose to use, if any.
  const [detection, setDetection] = useState(null)
  // The picture taken at the gate camera; attached to the ticket when it is created.
  const [photo, setPhoto] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const [showBookings, setShowBookings] = useState(false)
  // Automatic entry: with a gate camera it starts ON (the gate works by itself, like a real ANPR gate) and the
  // operator can pause it with the switch. Without a gate camera it is off.
  const [autoEntryChoice, setAutoEntry] = useState(null)
  const recent = useRef({ plate: '', until: 0 })
  const ticketRef = useRef(null)
  const {
    register,
    control,
    handleSubmit,
    getValues,
    resetField,
    setFocus,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      ...initialLane(locations, defaultId, 'ENTRY'), vehicleNumber: '', vehicleType: 'CAR',
      advanceAmount: '', advanceMethod: 'CASH', advanceReference: '',
    },
  })
  const locationId = useWatch({ control, name: 'locationId' })
  const gate = useWatch({ control, name: 'gate' })
  const typedPlate = useWatch({ control, name: 'vehicleNumber' })
  const advanceMethod = useWatch({ control, name: 'advanceMethod' })
  const location = locations.find((l) => l._id === locationId)
  // FASTag only appears here while it is a record; once a partner is set up it is charged at the exit.
  useEffect(() => {
    if (fastagCharges && advanceMethod === 'FASTAG') setValue('advanceMethod', 'CASH')
  }, [fastagCharges, advanceMethod, setValue])
  // This computer keeps its lane (location and gate) between visits.
  useRememberLane('ENTRY', locationId, gate)
  // With a camera registered for this gate, that one camera reads the plates (and fills the vehicle
  // number box). This computer's own camera is only shown when the operator asks for it.
  const gateCamera = useGateCamera(locationId, 'ENTRY', gate)
  const [ownCamera, setOwnCamera] = useState(false)
  const showOwnCamera = ownCamera
  // Until the operator uses the switch, automatic follows the camera: ON when this gate has one.
  const autoEntry = autoEntryChoice ?? gateCamera.hasCamera
  const { bookings } = useBookings(locationId)
  // Is the plate being typed one that booked ahead?
  const booked = bookings.find((b) => b.vehicleNumber === cleanPlate(typedPlate))

  const toast = useToast()
  const create = useMutation({
    // `auto` is set when the camera makes the ticket by itself: { detectionId, key, photo }.
    mutationFn: ({ gate, advanceAmount, advanceMethod: method, advanceReference, auto, ...values }) =>
      parkingApi.entry({
        ...values,
        ...(gate ? { gate } : {}),
        ...(canTakeAdvance && Number(advanceAmount) > 0
          ? {
              advance: {
                amount: Number(advanceAmount),
                method,
                ...(method !== 'CASH' && advanceReference ? { transactionId: advanceReference } : {}),
              },
            }
          : {}),
        ...(auto ? { detectionId: auto.detectionId } : detection ? { detectionId: detection._id } : {}),
        idempotencyKey: auto ? auto.key : requestKey,
      }),
    onError: (error, values) => {
      // A car the camera keeps seeing must not be tried again every few seconds.
      if (values.auto) recent.current = { plate: cleanPlate(values.vehicleNumber), until: Date.now() + RECENT_MS }
      else {
        toast({ title: 'Ticket not created', message: errorMessage(error), tone: 'error' })
        playCue('error')
      }
    },
    onSuccess: (data, values) => {
      if (!values.auto) setRequestKey(newRequestKey())
      setDetection(null)
      rememberLocation(values.locationId)
      recent.current = { plate: cleanPlate(values.vehicleNumber), until: Date.now() + RECENT_MS }
      markLocalAction()
      toast({
        title: data.repeated ? 'Ticket already issued' : 'Ticket created',
        message: `${data.session.vehicleNumber} · ${data.session.ticketNumber}`,
        tone: 'success',
      })
      if (!data.repeated) playCue('entry')
      setTicket({ ...data, auto: Boolean(values.auto), locationName: locations.find((l) => l._id === values.locationId)?.name })
      // The gate camera picture becomes this vehicle's entry photo (never blocks the ticket).
      setPhotoError('')
      const picture = values.auto ? values.auto.photo : photo
      if (picture && !data.repeated) {
        parkingApi
          .uploadPhoto(data.session._id, picture, 'ENTRY')
          .then(() => queryClient.invalidateQueries({ queryKey: ['session-photos', data.session._id] }))
          .catch((error) => setPhotoError(`The ticket was created, but the camera picture could not be saved: ${errorMessage(error)}`))
      }
      setPhoto(null)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      queryClient.invalidateQueries({ queryKey: ['entries'] })
      resetField('vehicleNumber')
      resetField('advanceAmount')
      resetField('advanceReference')
      setFocus('vehicleNumber')
    },
  })

  const types = location ? location.vehicleTypes : Object.keys(VEHICLE_LABELS)

  // Automatic entry: the camera read a plate clearly, so make the ticket. Every
  // server rule still applies (blocked vehicle, already inside, full parking).
  // Nothing is done while a ticket is being made, a number is typed, or no
  // vehicle type has room.
  const autoCreate = (suggestion, frame) => {
    const values = getValues()
    const key = CAPACITY_KEY[values.vehicleType]
    const free = location && key ? location.capacity[key] - location.occupied[key] : 1
    if (create.isPending || !suggestion.plate || values.vehicleNumber.trim() || free <= 0) return false
    setValue('vehicleNumber', suggestion.plate)
    create.mutate({
      locationId: values.locationId,
      vehicleNumber: suggestion.plate,
      vehicleType: values.vehicleType,
      gate: values.gate,
      auto: { detectionId: suggestion._id, key: `auto-${suggestion._id}`, photo: frame },
    })
    return true
  }

  const applySuggestion = (suggestion) => {
    setDetection(suggestion)
    if (suggestion.plate) setValue('vehicleNumber', suggestion.plate, { shouldValidate: true })
    setFocus('vehicleNumber')
  }

  // A ticket opened again from the history shows beside the form.
  const reprint = (session) => setTicket({ session, locationName: location?.name, reprint: true })
  useEffect(() => {
    if (ticket?.reprint) ticketRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [ticket])

  return (
    <div className="space-y-6">
      <LaneBar location={location} gate={gate} company={company}>
        {can('ENTRY_CREATE') && <OpenBarrierButton locationId={locationId} direction="ENTRY" gate={gate} />}
        <AutoSwitch label="AUTO ENTRY" on={autoEntry} onChange={setAutoEntry} />
      </LaneBar>
      {autoEntry && (
        <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          Automatic entry is ON. When the gate camera reads a number plate clearly (no "Check this plate" warning), the ticket is made, printed and the barrier
          opens by itself, with the vehicle type chosen below and no advance. A wrong reading must be cancelled by an admin. Switch it off to pause.
        </p>
      )}
      <LivePreview locationId={locationId} direction="ENTRY" gate={gate} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="no-print">
            <LocationPicker locations={locations} selectedId={locationId} register={register} errors={errors} gateTypes={['ENTRY', 'BOTH']} />
            <div className="mt-3">
              <Button type="button" variant="secondary" onClick={() => setShowBookings((open) => !open)}>
                {showBookings ? 'Hide customer bookings' : `View customer bookings${bookings.length ? ` (${bookings.length})` : ''}`}
              </Button>
            </div>
          </Card>

          {showBookings && (
            <BookingsPanel
              location={location}
              vehicleTypes={types}
              onClose={() => setShowBookings(false)}
              onUse={(b) => {
                setValue('vehicleNumber', b.vehicleNumber, { shouldValidate: true })
                setValue('vehicleType', b.vehicleType)
                setShowBookings(false)
                setFocus('vehicleNumber')
              }}
            />
          )}

          {showOwnCamera ? (
            <EntryCamera
              locationId={locationId}
              canAutoRead={!typedPlate?.trim() && !create.isPending}
              onDetection={applySuggestion}
              onPhoto={setPhoto}
              hasPhoto={Boolean(photo)}
              isRecentPlate={(plate) => recent.current.plate === plate && Date.now() < recent.current.until}
              autoEntry={autoEntry}
              onAutoEntryChange={setAutoEntry}
              onAutoEntry={autoCreate}
            />
          ) : (
            <GateCameraNote camera={gateCamera} direction="ENTRY" gate={gate} fills="the vehicle number below" onUseOwn={() => setOwnCamera(true)} />
          )}

          <Card className="no-print">
            <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-5" noValidate>
              <Alert>{create.error && errorMessage(create.error)}</Alert>
              <Field
                label="Vehicle number"
                placeholder="RJ14 AB 1234"
                data-plate-box
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                className="[&_input]:text-2xl [&_input]:font-bold [&_input]:uppercase [&_input]:tracking-wider [&_input]:py-3"
                error={errors.vehicleNumber?.message}
                {...register('vehicleNumber')}
              />
              {booked && (
                <p className="-mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
                  Booked ahead{booked.customerName ? ` by ${booked.customerName}` : ''}
                  {booked.phone ? ` (${booked.phone})` : ''}. Expected {dateTime(booked.expectedAt)}.
                </p>
              )}
              {detection && (
                <p className="-mt-3 flex flex-wrap items-center gap-2 text-xs text-blue-800">
                  Using the {detection.source === 'PHOTO' ? 'photo' : 'camera'} reading {detection.plate || '(not read)'}. Check the plate and correct it if needed.
                  {detection.imageUrl && (
                    <a href={detection.imageUrl} target="_blank" rel="noreferrer" className="underline">
                      View photo
                    </a>
                  )}
                  <button type="button" className="underline" onClick={() => setDetection(null)}>
                    Stop using it
                  </button>
                </p>
              )}
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-700">Vehicle type</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {types.map((type) => {
                    const key = CAPACITY_KEY[type]
                    const free = location && key ? location.capacity[key] - location.occupied[key] : null
                    const full = free !== null && free <= 0
                    return (
                      <label
                        key={type}
                        className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-slate-300 px-4 py-4 text-center transition has-[:checked]:border-[#07417f] has-[:checked]:bg-[#07417f] has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${
                          full ? 'opacity-50' : 'hover:border-blue-400'
                        }`}
                      >
                        <input type="radio" value={type} className="sr-only" {...register('vehicleType')} />
                        <span className="text-lg font-bold">{VEHICLE_LABELS[type]}</span>
                        <span className="text-xs">{full ? 'Full' : free !== null ? `${free} free` : ''}</span>
                      </label>
                    )
                  })}
                </div>
                {errors.vehicleType && <p className="mt-1 text-sm text-red-600">{errors.vehicleType.message}</p>}
              </fieldset>
              {canTakeAdvance && (
                <fieldset className="rounded-xl border border-slate-200 p-4">
                  <legend className="px-1 text-sm font-medium text-slate-700">Advance payment (optional)</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Amount (₹)"
                      inputMode="decimal"
                      placeholder="0"
                      autoComplete="off"
                      hint="Set against the fee when the vehicle leaves; any extra is given back"
                      error={errors.advanceAmount?.message}
                      {...register('advanceAmount')}
                    />
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium text-slate-700">Payment mode</legend>
                      <div className="flex flex-wrap gap-2">
                        {advanceMethods.map((value) => (
                          <label
                            key={value}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
                          >
                            <input type="radio" value={value} {...register('advanceMethod')} />
                            {PAYMENT_LABELS[value]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                  {advanceMethod !== 'CASH' && (
                    <div className="mt-4">
                      <Field
                        label={`${PAYMENT_LABELS[advanceMethod]} reference (optional)`}
                        autoComplete="off"
                        hint="Transaction or approval number, if you have it"
                        error={errors.advanceReference?.message}
                        {...register('advanceReference')}
                      />
                    </div>
                  )}
                </fieldset>
              )}
              <Button type="submit" loading={create.isPending} className="gate-btn-entry w-full py-4 text-lg font-bold">
                Create ticket
              </Button>
            </form>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <PlateSuggestions
            locationId={locationId}
            direction="ENTRY"
            onUse={applySuggestion}
            usedId={detection?._id}
            canFill={!typedPlate?.trim() && !detection && !create.isPending}
            auto={autoEntry}
            onAuto={autoCreate}
          />
          <div ref={ticketRef}>
            {photoError && <Alert>{photoError}</Alert>}
            {ticket ? (
              <div role="status">
                {!ticket.reprint && (
                  <div className="no-print mb-3 space-y-2">
                    <PassBanner pass={ticket.pass} at="entry" />
                    {ticket.auto && <Alert type="info">Created automatically from the camera. If the plate is wrong, ask an admin to cancel this ticket.</Alert>}
                    {ticket.booking && (
                      <Alert type="success">
                        Customer booking found{ticket.booking.customerName ? `: ${ticket.booking.customerName}` : ''}
                        {ticket.booking.phone ? ` (${ticket.booking.phone})` : ''}.
                        {ticket.booking.feePaidOnline ? ` Booking fee of ${money(ticket.booking.feePaidOnline)} paid online and taken as the advance.` : ''}
                      </Alert>
                    )}
                  </div>
                )}
                <Ticket session={ticket.session} locationName={ticket.locationName} repeated={ticket.repeated} settings={locations.find((l) => l._id === ticket.session.locationId)?.receiptSettings} />
                {ticket.reprint ? (
                  <ReprintBar session={ticket.session} />
                ) : (
                  <div className="no-print mt-3 space-y-4">
                    <DeviceStatus hardware={ticket.hardware} sessionId={ticket.session._id} direction="ENTRY" />
                    <PhotoPanel key={ticket.session._id} sessionId={ticket.session._id} kind="ENTRY" />
                  </div>
                )}
              </div>
            ) : (
              <Card className="no-print">
                <p className="text-sm text-slate-500">The ticket appears here after you press Create ticket.</p>
              </Card>
            )}
          </div>
        </div>
      </div>

      <EntryHistory
        locationId={locationId}
        onPrint={reprint}
        onReEntry={can('ENTRY_CREATE') ? (data) => setTicket({ ...data, locationName: location?.name }) : undefined}
      />
    </div>
  )
}

export default function Entry() {
  const { locations, defaultId, isLoading, error } = useMyLocations()

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Vehicle Entry</h1>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : locations.length === 0 ? (
        <Alert type="info">No open parking location is assigned to you. Ask your admin.</Alert>
      ) : (
        <EntryForm locations={locations} defaultId={defaultId} />
      )}
    </div>
  )
}
