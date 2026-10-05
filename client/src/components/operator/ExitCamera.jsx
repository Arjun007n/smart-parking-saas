import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { anprApi } from '../../services/api'
import { useCamera } from '../../hooks/useCamera'
import { errorMessage } from '../../utils/errors'
import { shrinkImage } from '../../utils/image'
import { Alert, Badge, Button, Checkbox } from '../ui'
import { AUTO_ENTRY_MIN_CONFIDENCE } from './EntryCamera'

const AUTO_EVERY_MS = 4000

// The live camera at the exit gate. A reading is a SUGGESTION that fills in the
// search box. With "Auto exit" on, a clear reading looks the vehicle up by itself
// (see onAutoExit in pages/operator/Exit.jsx): the fee is shown and payment is still
// taken by the operator.
export default function ExitCamera({ locationId, busy: pageBusy, onDetection, onAutoExit, autoExit, onAutoExitChange, isRecentPlate }) {
  const { videoRef, state: cameraState, error: cameraError, start: startCamera, stop: stopCamera, capture: grab } = useCamera()
  const input = useRef(null)
  const working = useRef(false)
  const [last, setLast] = useState(null)
  const [note, setNote] = useState('')

  const options = useQuery({ queryKey: ['anpr-options'], queryFn: anprApi.options, staleTime: 5 * 60 * 1000 })
  const reading = Boolean(options.data?.photoReading)
  const on = cameraState === 'on'

  const latest = useRef({})
  useEffect(() => {
    latest.current = { onDetection, onAutoExit, autoExit, isRecentPlate }
  })

  const readFrame = useMutation({ mutationFn: (blob) => anprApi.read(locationId, 'EXIT', blob) })

  const handle = async (blob) => {
    if (!blob) {
      setNote('The camera is not showing a picture yet. Wait a second and try again.')
      return
    }
    setNote('')
    try {
      const data = await readFrame.mutateAsync(blob)
      setLast(data)
      if (data.detection) onDetection(data.detection)
    } catch {
      // Shown from readFrame.error below.
    }
  }

  const capture = async () => {
    if (working.current) return
    working.current = true
    try {
      await handle(await grab())
    } finally {
      working.current = false
    }
  }

  const onPick = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || working.current) return
    working.current = true
    try {
      await handle(await shrinkImage(file, { maxSide: 1600, quality: 0.85 }))
    } catch (error) {
      setNote(error.message)
    } finally {
      working.current = false
    }
  }

  // Auto exit: only while the camera shows a picture, no vehicle is being handled and this tab is in front.
  const watching = autoExit && reading && on && !pageBusy && Boolean(locationId)
  useEffect(() => {
    if (!watching) return undefined
    const tick = async () => {
      if (working.current || document.visibilityState === 'hidden') return
      working.current = true
      try {
        const frame = await grab()
        if (!frame) return
        const data = await anprApi.read(locationId, 'EXIT', frame)
        if (data.detection && !latest.current.isRecentPlate(data.plate)) {
          setLast(data)
          const sure = data.readable && data.confidence != null && data.confidence >= AUTO_ENTRY_MIN_CONFIDENCE && data.reviewReasons.length === 0
          if (sure) latest.current.onAutoExit(data.detection)
          else latest.current.onDetection(data.detection)
        }
      } catch (error) {
        setNote(`Auto exit stopped: ${errorMessage(error)}`)
        onAutoExitChange(false)
      } finally {
        working.current = false
      }
    }
    const timer = setInterval(tick, AUTO_EVERY_MS)
    return () => clearInterval(timer)
  }, [watching, grab, locationId, onAutoExitChange])

  return (
    <section className="no-print space-y-3 rounded-xl bg-slate-900 p-3 shadow-sm" aria-label="Exit gate camera">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-slate-200">
            <p className="text-sm">{cameraState === 'starting' ? 'Starting the camera…' : cameraError || 'The camera is off.'}</p>
            {cameraState !== 'starting' && <Button onClick={startCamera}>{cameraState === 'error' ? 'Try again' : 'Start camera'}</Button>}
          </div>
        )}
        {on && watching && (
          <span className="absolute left-3 top-3 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white">Auto exit on</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {reading ? (
          <>
            <Button onClick={capture} disabled={!on} loading={readFrame.isPending}>Capture & read plate</Button>
            <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Choose a picture of the number plate" onChange={onPick} />
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={readFrame.isPending}>Use a picture</Button>
          </>
        ) : (
          <p className="text-xs text-slate-300">Plate reading is not switched on for this server. Search by typing the number.</p>
        )}
        {on && <Button variant="secondary" className="ml-auto" onClick={() => stopCamera()}>Stop camera</Button>}
      </div>

      {reading && (
        <div className="space-y-2 rounded-lg bg-slate-800 px-3 py-2 text-slate-100">
          <Checkbox
            label="Auto exit: look the vehicle up by itself when a plate is read clearly"
            checked={autoExit}
            disabled={!on}
            onChange={(event) => {
              setNote('')
              onAutoExitChange(event.target.checked)
            }}
          />
          {autoExit && (
            <p className="text-xs text-amber-300">
              Auto exit is ON for readings {Math.round(AUTO_ENTRY_MIN_CONFIDENCE * 100)}% sure or more. The fee appears on screen and you still take the payment.
              A vehicle with nothing to pay is released at once, so check the plate in view.
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
