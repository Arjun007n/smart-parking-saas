import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi, passApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { playCue } from '../../utils/sound'
import { markLocalAction } from '../../utils/localAction'
import { rememberLocation, useMyLocations } from '../../hooks/useMyLocations'
import { assignedLane } from '../../hooks/useLane'
import { gateTakes } from '../../utils/lanes'
import { useGateCamera } from '../../hooks/useGateCamera'
import { entrySchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { PAYMENT_LABELS, VEHICLE_LABELS, dateTime, money, newRequestKey } from '../../utils/format'
import { Alert, Button, Card, Field, PageLoader } from '../../components/ui'
import LaneBar from '../../components/operator/LaneBar'
import LivePreview from '../../components/operator/LivePreview'
import GateCameraNote from '../../components/operator/GateCameraNote'
import AutoSwitch from '../../components/operator/AutoSwitch'
import DeviceStatus, { OpenBarrierButton } from '../../components/operator/DeviceStatus'
import PlateSuggestions from '../../components/operator/PlateSuggestions'
import EntryCamera from '../../components/operator/EntryCamera'
import EntryHistory from '../../components/operator/EntryHistory'
import BookingsPanel from '../../components/operator/BookingsPanel'
import DuplicateEntryModal from '../../components/operator/DuplicateEntryModal'
import { useBookings } from '../../hooks/useBookings'
import PassBanner from '../../components/pass/PassBanner'
import PhotoPanel from '../../components/operator/PhotoPanel'
import QrCode from '../../components/QrCode'
import { receiptSettings } from '../../utils/receiptSettings'
import { operationSettings } from '../../utils/operations'
import TicketPhoto from '../../components/operator/TicketPhoto'
import { printerAvailable } from '../../native/printer'
import { printTicketOnPhone } from '../../native/slips'
import { plateReaderAvailable } from '../../native/plateReader'
import { formatPlate } from '../../native/plate'
import { isPhoneWidth } from '../../utils/phone'
import GateBar, { ModeSwitch, OnlinePill } from '../../components/operator/GateBar'
import PlateCamera from '../../components/operator/PlateCamera'

function Ticket({ session, locationName, repeated, settings, operations, reprinted = false, autoPrint = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const look = receiptSettings(settings)
  const ops = operationSettings(operations)
  // In the phone app the ticket goes to the Bluetooth printer; in a browser it goes through the print dialog.
  const printOnPhone = async () => {
    try {
      await printTicketOnPhone({ session, locationName, settings, operations })
    } catch (error) {
      toast({ title: 'Ticket not printed', message: error.message, tone: 'error' })
    }
  }
  const print = () => {
    // A ticket opened again from the history is a reprint: counted for the operator's report.
    if (reprinted) parkingApi.reprint(session._id).catch(() => {})
    if (printerAvailable) printOnPhone()
    else window.print()
  }
  // A new ticket (made by the camera or by tapping the vehicle type) is printed by itself, once, unless the gate's own printer already got it.
  // A ticket opened again from the history is a reprint and waits for the button.
  useEffect(() => {
    if (!autoPrint || repeated) return undefined
    const timer = setTimeout(() => (printerAvailable ? printOnPhone() : window.print()), 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per ticket
  }, [autoPrint, repeated, session._id])
  return (
    <div className="print-area rounded-xl border-2 border-dashed border-slate-400 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-slate-600">{locationName}</p>
      {look.headerNote && <p className="text-xs text-slate-600">{look.headerNote}</p>}
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Parking ticket</p>
      {ops.printTicketNumber && <p className="mt-3 font-mono text-3xl font-bold tracking-wider text-slate-900">{session.ticketNumber}</p>}
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
      {ops.printPhoto && <TicketPhoto sessionId={session._id} />}
      {session.advance?.amount > 0 && (
        <p className="mt-3 text-sm font-semibold text-slate-800">
          Advance paid: {money(session.advance.amount)} ({PAYMENT_LABELS[session.advance.method] || session.advance.method})
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">{look.ticketFooter}</p>
      {repeated && <p className="mt-2 text-xs text-slate-500">(This ticket was already created.)</p>}
      {!(reprinted && user?.access?.reprint === false) && (
        <Button variant="secondary" className="no-print mt-4" onClick={print}>
          {printerAvailable && !reprinted ? 'Print again' : 'Print ticket'}
        </Button>
      )}
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
  const { user } = useAuth()
  const print = useMutation({ mutationFn: () => parkingApi.print(session._id) })
  // The admin can switch reprinting off for a person.
  if (user?.access?.reprint === false) return null
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

// The vehicle type a suggestion carries, if this location takes that type.
// A lane takes only its own class of vehicle, so a type the lane refuses is not suggested.
const laneOf = (location, gate) => (location?.gates || []).find((g) => g.name === gate)
const knownType = (suggestion, location, gate) =>
  suggestion.vehicleType && (!location || location.vehicleTypes.includes(suggestion.vehicleType)) && gateTakes(laneOf(location, gate), suggestion.vehicleType)
    ? suggestion.vehicleType
    : ''

// What the type buttons go back to for the next vehicle: the lane's own vehicle type, else a car.
const defaultTypeFor = (location, gate) => {
  const lane = laneOf(location, gate)
  const types = (location ? location.vehicleTypes : []).filter((t) => gateTakes(lane, t))
  const laneType = lane?.vehicleType
  if (laneType && types.includes(laneType)) return laneType
  return types.includes('CAR') ? 'CAR' : types[0] || 'CAR'
}

// Where an automatically chosen vehicle type came from, for the line under the type buttons.
const TYPE_SOURCE = {
  CAMERA: 'the camera',
  HISTORY: 'an earlier visit of this vehicle',
  LANE: 'the vehicle type set for this lane',
}

function EntryForm({ locations, defaultId }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // No money is taken at entry: the fee is worked out and paid at the exit.
  const { can, company, user } = useAuth()
  // One key per entry attempt; kept across retries, renewed after success.
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [ticket, setTicket] = useState(null)
  // The camera suggestion the operator chose to use, if any.
  const [detection, setDetection] = useState(null)
  // The picture taken at the gate camera; attached to the ticket when it is created.
  const [photo, setPhoto] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const [showBookings, setShowBookings] = useState(false)
  // "Vehicle Already Entered": the open ticket of the plate that was tried again.
  const [duplicate, setDuplicate] = useState(null)
  // Automatic entry always starts OFF when the page opens (also after a refresh, like ismartparking.com): the operator
  // switches it on, so a refresh can never start making tickets by itself.
  const [autoEntry, setAutoEntry] = useState(false)
  const recent = useRef({ plate: '', until: 0 })
  const ticketRef = useRef(null)
  const cameraCapture = useRef(null)
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
    defaultValues: (() => {
      const lane = assignedLane(locations, user?.lanes, 'ENTRY', defaultId)
      return { ...lane, vehicleNumber: '', vehicleType: defaultTypeFor(locations.find((l) => l._id === lane.locationId), lane.gate) }
    })(),
  })
  const locationId = useWatch({ control, name: 'locationId' })
  const gate = useWatch({ control, name: 'gate' })
  const typedPlate = useWatch({ control, name: 'vehicleNumber' })
  const chosenType = useWatch({ control, name: 'vehicleType' })
  const location = locations.find((l) => l._id === locationId)
  const ops = operationSettings(location?.operations)
  // Only the vehicle types this lane takes (a 2-wheeler lane shows bikes, a 4-wheeler lane the rest).
  const types = (location ? location.vehicleTypes : Object.keys(VEHICLE_LABELS)).filter((t) => gateTakes(laneOf(location, gate), t))
  // With a camera registered for this gate, that one camera reads the plates (and fills the vehicle
  // number box). This computer's own camera is only shown when the operator asks for it.
  const gateCamera = useGateCamera(locationId, 'ENTRY', gate)
  const [ownCamera, setOwnCamera] = useState(false)
  // Phone only: which keyboard the vehicle number opens with (123 = number pad, ABC = letters).
  const [keys, setKeys] = useState('123')
  // Phone: read the plate with the camera, or type it (the two choices at the top of the screen).
  const [phone] = useState(isPhoneWidth)
  const [mode, setMode] = useState(phone && plateReaderAvailable ? 'camera' : 'keyboard')
  const [cameraKey, setCameraKey] = useState(0)
  const camera = phone && plateReaderAvailable && mode === 'camera'
  // How the vehicle type was chosen for the plate in the box: { from: CAMERA | HISTORY | LANE } or { from: null } when the
  // camera could not tell (the operator is asked to check it).
  const [typeNote, setTypeNote] = useState(null)
  const showOwnCamera = ownCamera
  const { bookings } = useBookings(locationId)
  // Is the plate being typed one that booked ahead?
  const booked = bookings.find((b) => b.vehicleNumber === cleanPlate(typedPlate))
  // Does the plate being typed hold a monthly pass? Looked up a moment after the typing stops (the PASS tag of ismartparking.com).
  const [passPlate, setPassPlate] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setPassPlate(cleanPlate(typedPlate)), 400)
    return () => clearTimeout(timer)
  }, [typedPlate])
  const passLookup = useQuery({
    queryKey: ['pass-lookup', locationId, passPlate],
    queryFn: () => passApi.lookup({ vehicleNumber: passPlate, locationId }),
    enabled: passPlate.length >= 6 && Boolean(locationId),
    staleTime: 30_000,
  })
  const typedPass = passPlate && passPlate === cleanPlate(typedPlate) ? passLookup.data?.pass : null

  const toast = useToast()
  const create = useMutation({
    // `auto` is set when the camera makes the ticket by itself: { detectionId, key, photo }.
    mutationFn: ({ gate, auto, ...values }) => {
      // The picture taken with the ticket (values.captured) goes up separately, not in the entry request.
      const body = { ...values }
      delete body.captured
      return parkingApi.entry({
        ...body,
        ...(gate ? { gate } : {}),
        ...(auto ? { detectionId: auto.detectionId } : detection ? { detectionId: detection._id } : {}),
        idempotencyKey: auto ? auto.key : requestKey,
      })
    },
    onError: (error, values) => {
      const data = error?.response?.data?.data
      // A car the camera keeps seeing must not be tried again every few seconds.
      if (values.auto) recent.current = { plate: cleanPlate(values.vehicleNumber), until: Date.now() + RECENT_MS }
      else if (data && data.code === 'ALREADY_INSIDE') {
        setDuplicate(data.session)
        playCue('error')
      } else {
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
      const picture = values.auto ? values.auto.photo : values.captured || photo
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
      // The next vehicle starts from the lane's type, not from the last vehicle's.
      setValue('vehicleType', defaultTypeFor(locations.find((l) => l._id === values.locationId), values.gate))
      setTypeNote(null)
      setFocus('vehicleNumber')
    },
  })


  // Tapping a vehicle type makes the ticket for the number in the box (no separate button, like ismartparking.com).
  const chooseType = (type) => {
    setValue('vehicleType', type)
    handleSubmit(submitEntry)()
  }

  // "Take the entry photo automatically": with this computer's camera on, the picture is taken as the
  // ticket is made, unless one was already kept.
  const submitEntry = async (values) => {
    let captured = null
    if (ops.photoAutoCapture && showOwnCamera && !photo && cameraCapture.current) {
      captured = await cameraCapture.current().catch(() => null)
    }
    create.mutate({ ...values, ...(captured ? { captured } : {}) })
  }

  // Automatic entry: the camera read a plate clearly, so make the ticket. Every
  // server rule still applies (blocked vehicle, already inside, full parking).
  // Nothing is done while a ticket is being made, a number is typed, or no
  // vehicle type has room.
  const autoCreate = (suggestion, frame) => {
    const values = getValues()
    // The vehicle type the camera (or our memory of this plate) gave wins over the one chosen below.
    const vehicleType = knownType(suggestion, location, values.gate) || values.vehicleType
    const key = CAPACITY_KEY[vehicleType]
    const free = location && key ? location.capacity[key] - location.occupied[key] : 1
    if (create.isPending || !suggestion.plate || values.vehicleNumber.trim() || free <= 0) return false
    setValue('vehicleNumber', suggestion.plate)
    setValue('vehicleType', vehicleType)
    setTypeNote({ from: knownType(suggestion, location, values.gate) ? suggestion.vehicleTypeFrom || 'CAMERA' : null })
    create.mutate({
      locationId: values.locationId,
      vehicleNumber: suggestion.plate,
      vehicleType,
      gate: values.gate,
      auto: { detectionId: suggestion._id, key: `auto-${suggestion._id}`, photo: frame },
    })
    return true
  }

  const applySuggestion = (suggestion) => {
    setDetection(suggestion)
    if (suggestion.plate) setValue('vehicleNumber', suggestion.plate, { shouldValidate: true })
    // The vehicle type fills in by itself when the camera or the plate's history says what it is.
    const type = knownType(suggestion, location, getValues('gate'))
    // No type known for this vehicle: go back to the lane's type rather than keep whatever was chosen before.
    setValue('vehicleType', type || defaultTypeFor(location, getValues('gate')), { shouldValidate: true })
    setTypeNote({ from: type ? suggestion.vehicleTypeFrom || 'CAMERA' : null })
    setFocus('vehicleNumber')
  }

  // A ticket opened again from the history shows beside the form.
  const reprint = (session) => setTicket({ session, locationName: location?.name, reprint: true })
  useEffect(() => {
    if (ticket?.reprint) ticketRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [ticket])

  return (
    <div className="space-y-4">
      <GateBar other={can('EXIT_CREATE') ? 'exit' : 'entry'}>
        {can('ENTRY_CREATE') && <OpenBarrierButton locationId={locationId} direction="ENTRY" gate={gate} />}
      </GateBar>
      {plateReaderAvailable && (
        <ModeSwitch
          value={mode}
          onChange={setMode}
          options={[['camera', 'Camera'], ['keyboard', 'Keyboard']]}
        />
      )}
      <OnlinePill />
      <div className="max-md:hidden">
      <LaneBar location={location} gate={gate} company={company} parkingType={location?.parkingType}>
        {can('ENTRY_CREATE') && <OpenBarrierButton locationId={locationId} direction="ENTRY" gate={gate} />}
        <AutoSwitch
          label="AUTO ENTRY"
          on={autoEntry}
          onChange={setAutoEntry}
          hint="When the gate camera reads a number plate clearly, the ticket is made, printed and the barrier opens by itself, with the vehicle type chosen below. No money is taken at entry. A wrong reading must be cancelled by an admin."
        />
      </LaneBar>
      </div>
      {/* The location and gate are the lane the admin assigned: the operator does not choose them. */}
      <input type="hidden" {...register('locationId')} />
      <input type="hidden" {...register('gate')} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* Middle: the camera, the number, the vehicle type and the button (first on a phone). */}
        <div className="order-1 min-w-0 space-y-4 lg:order-2 lg:col-span-5">
          {camera && (
            <div className="md:hidden">
              <PlateCamera
                paused={Boolean(typedPlate?.trim()) || create.isPending || Boolean(ticket && !ticket.reprint)}
                resetKey={cameraKey}
                onProblem={() => setMode('keyboard')}
                onPlate={(plate) => {
                  // The car that just got its ticket is still in front of the camera: not read again for a minute.
                  if (plate === recent.current.plate && Date.now() < recent.current.until) return
                  setValue('vehicleNumber', formatPlate(plate), { shouldValidate: true })
                  setTypeNote(null)
                  playCue('entry')
                }}
              />
            </div>
          )}
          <div className="max-md:hidden">
            <LivePreview locationId={locationId} direction="ENTRY" gate={gate} />
            {showOwnCamera ? (
              <EntryCamera onPhoto={setPhoto} hasPhoto={Boolean(photo)} captureRef={cameraCapture} />
            ) : (
              <GateCameraNote camera={gateCamera} direction="ENTRY" gate={gate} fills="the vehicle number below" onUseOwn={() => setOwnCamera(true)} ownLabel="Take an entry photo with this computer's camera" />
            )}
          </div>

          <Card className="no-print">
            <form onSubmit={(event) => handleSubmit(submitEntry)(event)} className="flex flex-col gap-5" noValidate>
              <Alert>{create.error && errorMessage(create.error)}</Alert>
              {/* On a phone the vehicle type buttons come first, so the keyboard never hides them. */}
              <div className={`space-y-5 md:order-1 ${camera ? 'order-1' : 'order-2'}`}>
              <Field
                label="Vehicle number"
                placeholder="Enter or scan vehicle number"
                data-plate-box
                autoFocus={!camera}
                autoComplete="off"
                autoCapitalize="characters"
                inputMode={keys === '123' ? 'numeric' : 'text'}
                className={`${camera && typedPlate?.trim() ? '[&_input]:border-emerald-400 [&_input]:bg-emerald-50' : ''} [&_input]:rounded-xl [&_input]:border-2 [&_input]:text-xl [&_input]:font-bold [&_input]:uppercase [&_input]:tracking-normal [&_input]:py-3 sm:[&_input]:text-2xl sm:[&_input]:tracking-wider`}
                error={errors.vehicleNumber?.message}
                {...register('vehicleNumber')}
              />
              {camera && typedPlate?.trim() && (
                <button
                  type="button"
                  onClick={() => { resetField('vehicleNumber'); setCameraKey((k) => k + 1) }}
                  className="-mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 py-2 text-sm font-bold text-red-600 md:hidden"
                >
                  ⟳ Read another plate
                </button>
              )}
              <div className={`justify-center md:hidden ${camera ? 'hidden' : 'flex'}`} role="group" aria-label="Keyboard">
                <div className="inline-flex rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
                  {[['123', '123'], ['ABC', 'ABC']].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={keys === value}
                      onClick={() => { setKeys(value); setTimeout(() => setFocus('vehicleNumber'), 50) }}
                      className={`min-w-16 rounded-full px-4 py-1.5 text-sm font-bold ${keys === value ? 'bg-[#2563eb] text-white shadow' : 'text-slate-600'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {booked && (
                <p className="-mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
                  Booked ahead{booked.customerName ? ` by ${booked.customerName}` : ''}
                  {booked.phone ? ` (${booked.phone})` : ''}. Expected {dateTime(booked.expectedAt)}.
                </p>
              )}
              {typedPass && <PassBanner pass={typedPass} at="entry" />}
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
              </div>
              <fieldset className={`md:order-2 ${camera ? 'order-2' : 'order-1'}`}>
                <legend className="mb-2 text-sm font-medium text-slate-700">
                  Vehicle type
                  {typedPlate?.trim() && typeNote?.from && (
                    <span className="ml-2 text-xs font-semibold text-green-700">Chosen automatically from {TYPE_SOURCE[typeNote.from]}</span>
                  )}
                  {typedPlate?.trim() && typeNote && !typeNote.from && (
                    <span className="ml-2 text-xs font-semibold text-amber-700">The camera could not tell the type. Check it.</span>
                  )}
                </legend>
                <input type="hidden" {...register('vehicleType')} />
                <div className="grid grid-cols-3 gap-2">
                  {types.map((type) => {
                    const key = CAPACITY_KEY[type]
                    const free = location && key ? location.capacity[key] - location.occupied[key] : null
                    const full = free !== null && free <= 0
                    const highlighted = chosenType === type && Boolean(typedPlate?.trim())
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={create.isPending || full}
                        onClick={() => chooseType(type)}
                        className={`sp-press flex w-full flex-col items-center rounded-xl bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] px-2 py-4 text-center text-white shadow transition hover:from-[#2f74e8] hover:to-[#1a45c0] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                          highlighted ? 'ring-4 ring-blue-300' : ''
                        }`}
                      >
                        <span className="text-base font-bold">{VEHICLE_LABELS[type]}</span>
                        {!create.isPending && !full && location?.startingFees?.[type] !== undefined && (
                          <span className="text-sm font-extrabold md:hidden">{money(location.startingFees[type])}</span>
                        )}
                        <span className="text-[11px] opacity-90">{create.isPending ? 'Please wait…' : full ? 'Full' : free !== null ? `${free} free` : ''}</span>
                      </button>
                    )
                  })}
                </div>
                {errors.vehicleType && <p className="mt-1 text-sm text-red-600">{errors.vehicleType.message}</p>}
                <p className="mt-2 text-xs text-slate-500">Type the number, then tap the vehicle type to create the ticket. The Enter key uses the highlighted type.</p>
              </fieldset>
            </form>
          </Card>
        </div>

        {/* Left: camera suggestions, the ticket that was just made and customer bookings. */}
        <div className="order-2 min-w-0 space-y-4 lg:order-1 lg:col-span-3">
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
              <div
                role="status"
                className={ticket.reprint ? '' : 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:overflow-y-auto max-md:bg-slate-900/60 max-md:p-4'}
              >
                <div className={ticket.reprint ? '' : 'max-md:mx-auto max-md:max-w-sm'}>
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
                <Ticket
                  session={ticket.session}
                  locationName={ticket.locationName}
                  repeated={ticket.repeated}
                  reprinted={Boolean(ticket.reprint)}
                  autoPrint={!ticket.reprint && !ticket.hardware?.print}
                  settings={locations.find((l) => l._id === ticket.session.locationId)?.receiptSettings}
                  operations={locations.find((l) => l._id === ticket.session.locationId)?.operations}
                />
                {ticket.reprint ? (
                  <ReprintBar session={ticket.session} />
                ) : (
                  <div className="no-print mt-3 space-y-4">
                    <DeviceStatus hardware={ticket.hardware} sessionId={ticket.session._id} direction="ENTRY" />
                    <PhotoPanel key={ticket.session._id} sessionId={ticket.session._id} kind="ENTRY" />
                    <Button type="button" className="w-full md:hidden" onClick={() => setTicket(null)}>OK</Button>
                  </div>
                )}
                </div>
              </div>
            ) : (
              <Card className="no-print">
                <p className="text-sm text-slate-500">The ticket appears here after you tap a vehicle type.</p>
              </Card>
            )}
          </div>
          <Card className="no-print">
            <Button type="button" variant="secondary" className="w-full" onClick={() => setShowBookings((open) => !open)}>
              {showBookings ? 'Hide customer bookings' : `View customer bookings${bookings.length ? ` (${bookings.length})` : ''}`}
            </Button>
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

        </div>

        {/* Right: who is inside, with search, Print and Re-entry. */}
        <div className="order-3 min-w-0 lg:col-span-4">
          <EntryHistory
            compact
            locationId={locationId}
            onPrint={reprint}
            onReEntry={can('ENTRY_CREATE') ? (data) => setTicket({ ...data, locationName: location?.name }) : undefined}
          />
        </div>
      </div>
      {duplicate && (
        <DuplicateEntryModal
          session={duplicate}
          onClose={() => { setDuplicate(null); setFocus('vehicleNumber') }}
          onReprint={(session) => { reprint(session); setDuplicate(null); resetField('vehicleNumber') }}
          onReEntry={can('ENTRY_CREATE') ? (data) => { setTicket({ ...data, locationName: location?.name }); setDuplicate(null); resetField('vehicleNumber') } : undefined}
          onExit={can('EXIT_CREATE') ? (session) => navigate(`/operator/exit?ticket=${encodeURIComponent(session.ticketNumber)}`) : undefined}
        />
      )}
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
