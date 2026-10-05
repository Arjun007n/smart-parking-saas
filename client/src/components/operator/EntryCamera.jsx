import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { anprApi } from '../../services/api'
import { useCamera } from '../../hooks/useCamera'
import { errorMessage } from '../../utils/errors'
import { shrinkImage } from '../../utils/image'
import { Alert, Badge, Button, Checkbox } from '../ui'

const AUTO_EVERY_MS = 4000
// Automatic entry only acts on a reading this sure and with nothing to double-check.
export const AUTO_ENTRY_MIN_CONFIDENCE = 0.85

// The live camera at the entry gate.
//   - "Capture" keeps the current picture as the vehicle's entry photo (attached when the ticket is created)
//     and, when the server can read plates from photos, fills in the number.
//   - "Auto-read" does that by itself every few seconds while the number box is empty.
// A reading is only a SUGGESTION: the operator checks the number and presses Create ticket.
// Unless "Auto entry" is switched on: then a clear reading creates the ticket by itself
// (see onAutoEntry in pages/operator/Entry.jsx for what it checks first).
export default function EntryCamera({
  locationId, canAutoRead, onDetection, onPhoto, hasPhoto, isRecentPlate, autoEntry, onAutoEntryChange, onAutoEntry,
}) {
  const { videoRef, state: cameraState, error: cameraError, start: startCamera, stop: stopCamera, capture: grab } = useCamera()
  const input = useRef(null)
  const busy = useRef(false)
  const [auto, setAuto] = useState(false)
  const [last, setLast] = useState(null)
  const [note, setNote] = useState('')

  const options = useQuery({ queryKey: ['anpr-options'], queryFn: anprApi.options, staleTime: 5 * 60 * 1000 })
  const reading = Boolean(options.data?.photoReading)

  // The newest callbacks, so the timer below does not restart on every render.
  const latest = useRef({})
  useEffect(() => {
    latest.current = { onDetection, onPhoto, isRecentPlate, onAutoEntry, autoEntry }
  })

  const readFrame = useMutation({
    mutationFn: (blob) => anprApi.read(locationId, 'ENTRY', blob),
  })

  const handle = async (blob) => {
    if (!blob) {
      setNote('The camera is not showing a picture yet. Wait a second and try again.')
      return
    }
    setNote('')
    onPhoto(blob)
    if (!reading) return
    try {
      const data = await readFrame.mutateAsync(blob)
      setLast(data)
      if (data.detection) onDetection(data.detection)
    } catch {
      // The error is shown from readFrame.error below.
    }
  }

  const capture = async () => {
    if (busy.current) return
    busy.current = true
    try {
      await handle(await grab())
    } finally {
      busy.current = false
    }
  }

  const onPick = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy.current) return
    busy.current = true
    try {
      await handle(await shrinkImage(file, { maxSide: 1600, quality: 0.85 }))
    } catch (error) {
      setNote(error.message)
    } finally {
      busy.current = false
    }
  }

  // Auto-read: only while the camera shows a picture, the box is empty and this tab is in front.
  const watching = (auto || autoEntry) && reading && cameraState === 'on' && canAutoRead && Boolean(locationId)
  useEffect(() => {
    if (!watching) return undefined
    const tick = async () => {
      if (busy.current || document.visibilityState === 'hidden') return
      busy.current = true
      try {
        const frame = await grab()
        if (!frame) return
        const data = await anprApi.read(locationId, 'ENTRY', frame)
        // The car that just got its ticket is still in view: do not read it again.
        if (data.detection && !latest.current.isRecentPlate(data.plate)) {
          setLast(data)
          latest.current.onPhoto(frame)
          const sure = data.readable && data.confidence != null && data.confidence >= AUTO_ENTRY_MIN_CONFIDENCE && data.reviewReasons.length === 0
          if (latest.current.autoEntry && sure) latest.current.onAutoEntry(data.detection, frame)
          else latest.current.onDetection(data.detection)
        }
      } catch (error) {
        setNote(`Auto-read stopped: ${errorMessage(error)}`)
        setAuto(false)
        if (latest.current.autoEntry) onAutoEntryChange(false)
      } finally {
        busy.current = false
      }
    }
    const timer = setInterval(tick, AUTO_EVERY_MS)
    return () => clearInterval(timer)
  }, [watching, grab, locationId, onAutoEntryChange])

  const on = cameraState === 'on'
  return (
    <section className="no-print space-y-3 rounded-xl bg-slate-900 p-3 shadow-sm" aria-label="Gate camera">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-slate-200">
            <p className="text-sm">
              {cameraState === 'starting' ? 'Starting the camera…' : cameraError || 'The camera is off.'}
            </p>
            {cameraState !== 'starting' && (
              <Button onClick={startCamera}>{cameraState === 'error' ? 'Try again' : 'Start camera'}</Button>
            )}
          </div>
        )}
        {on && watching && (
          <span className="absolute left-3 top-3 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white">
            {autoEntry ? 'Auto entry on' : 'Auto-read on'}
          </span>
        )}
        {hasPhoto && (
          <span className="absolute right-3 top-3 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
            Photo kept for this ticket
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={capture} disabled={!on} loading={readFrame.isPending}>
          {reading ? 'Capture & read plate' : 'Capture photo'}
        </Button>
        {reading && (
          <>
            <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Choose a picture of the number plate" onChange={onPick} />
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={readFrame.isPending}>
              Use a picture
            </Button>
          </>
        )}
        {hasPhoto && (
          <Button variant="secondary" onClick={() => onPhoto(null)}>
            Discard photo
          </Button>
        )}
        {on && (
          <Button variant="secondary" className="ml-auto" onClick={() => stopCamera()}>
            Stop camera
          </Button>
        )}
      </div>

      {reading && (
        <div className="space-y-2 rounded-lg bg-slate-800 px-3 py-2 text-slate-100">
          <Checkbox
            label="Auto-read plates (you still press Create ticket)"
            checked={auto || autoEntry}
            disabled={!on || autoEntry}
            onChange={(event) => {
              setNote('')
              setAuto(event.target.checked)
            }}
          />
          <Checkbox
            label="Auto entry: create the ticket by itself when a plate is read clearly"
            checked={autoEntry}
            disabled={!on}
            onChange={(event) => {
              setNote('')
              onAutoEntryChange(event.target.checked)
            }}
          />
          {autoEntry && (
            <p className="text-xs text-amber-300">
              Auto entry is ON. Only readings that are {Math.round(AUTO_ENTRY_MIN_CONFIDENCE * 100)}% sure or more are used, no advance is taken, and the vehicle type is the one selected below.
              A wrong reading becomes a real ticket that an admin must cancel, so watch the screen.
            </p>
          )}
        </div>
      )}

      {readFrame.error && <Alert>{errorMessage(readFrame.error)}</Alert>}
      {note && <Alert type="info">{note}</Alert>}
      {last && !readFrame.isPending && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-100" role="status">
          {last.readable ? (
            <>
              <span className="font-mono text-lg font-bold tracking-wider">{last.plate}</span>
              {last.confidence != null && <span className="text-xs text-slate-300">{Math.round(last.confidence * 100)}% sure</span>}
              {last.reviewReasons.length > 0 && <Badge tone="red">Check this plate</Badge>}
            </>
          ) : (
            <span className="text-amber-300">No plate could be read. Move closer, or type the number.</span>
          )}
        </div>
      )}
    </section>
  )
}
