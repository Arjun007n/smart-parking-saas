import { useEffect, useRef, useState } from 'react'
import { useCamera } from '../../hooks/useCamera'
import { shrinkImage } from '../../utils/image'
import { Alert, Button } from '../ui'

// This computer's own camera at the entry gate, used only to keep a picture of the vehicle.
// "Capture photo" keeps the current picture as the vehicle's entry photo (attached when the ticket is created).
// It never reads the number: the number comes from the gate's ANPR camera (suggestions beside the form) or is typed.
export default function EntryCamera({ onPhoto, hasPhoto, captureRef }) {
  const { videoRef, state: cameraState, error: cameraError, start: startCamera, stop: stopCamera, capture: grab } = useCamera()
  const input = useRef(null)
  // The page can ask this camera for a picture without a click (the "take the photo automatically" switch).
  useEffect(() => {
    if (!captureRef) return undefined
    captureRef.current = grab
    return () => {
      captureRef.current = null
    }
  }, [captureRef, grab])
  const busy = useRef(false)
  const [note, setNote] = useState('')

  const handle = (blob) => {
    if (!blob) {
      setNote('The camera is not showing a picture yet. Wait a second and try again.')
      return
    }
    setNote('')
    onPhoto(blob)
  }

  const capture = async () => {
    if (busy.current) return
    busy.current = true
    try {
      handle(await grab())
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
      handle(await shrinkImage(file, { maxSide: 1600, quality: 0.85 }))
    } catch (error) {
      setNote(error.message)
    } finally {
      busy.current = false
    }
  }

  const on = cameraState === 'on'
  return (
    <section className="no-print space-y-3 rounded-xl bg-slate-900 p-3 shadow-sm" aria-label="Entry photo camera">
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
        {hasPhoto && (
          <span className="absolute right-3 top-3 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
            Photo kept for this ticket
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={capture} disabled={!on}>Capture photo</Button>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Choose a picture of the vehicle" onChange={onPick} />
        <Button variant="secondary" onClick={() => input.current?.click()}>Use a picture</Button>
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

      {note && <Alert type="info">{note}</Alert>}
    </section>
  )
}
