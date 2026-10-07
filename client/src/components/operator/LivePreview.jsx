import { useEffect, useState } from 'react'
import { useGateCamera } from '../../hooks/useGateCamera'
import { Button } from '../ui'

// How many times the picture is asked for before the panel gives up and offers "Try again".
const MAX_ATTEMPTS = 5
// Wait this long between attempts.
const RETRY_MS = 2000

// The live picture of the gate's ANPR camera, from the picture address set on the Hardware page.
// It is a plain video stream (MJPEG) shown in an <img>, in a dark frame like the camera screen of a
// real gate. While it connects the panel says "Connecting to the camera... Attempt n of 5"; the picture is
// asked for again by itself up to 5 times, and after that the operator can press "Try again".
// Nothing is shown when the gate has no camera with a picture address.
export default function LivePreview({ locationId, direction, gate }) {
  const [attempt, setAttempt] = useState(1)
  // connecting: asked for, waiting. live: the first picture arrived. error: this attempt failed.
  const [status, setStatus] = useState('connecting')
  const [round, setRound] = useState(0)
  const camera = useGateCamera(locationId, direction, gate)
  const url = camera.previewUrl

  // A failed attempt is repeated after a short wait, until the attempts are used up.
  useEffect(() => {
    if (status !== 'error' || attempt >= MAX_ATTEMPTS) return undefined
    const timer = setTimeout(() => {
      setAttempt((n) => n + 1)
      setStatus('connecting')
    }, RETRY_MS)
    return () => clearTimeout(timer)
  }, [status, attempt])

  if (!locationId || !url) return null

  const gaveUp = status === 'error' && attempt >= MAX_ATTEMPTS
  // A new query string makes the browser open the stream again.
  const src = `${url}${url.includes('?') ? '&' : '?'}n=${round}-${attempt}`
  const retry = () => {
    setAttempt(1)
    setRound((n) => n + 1)
    setStatus('connecting')
  }

  return (
    <div className="no-print space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border-4 border-black bg-slate-900">
        {!gaveUp && (
          <img
            key={`${round}-${attempt}`}
            src={src}
            alt="Live picture from the gate camera"
            className={`h-full w-full object-contain ${status === 'live' ? '' : 'opacity-0'}`}
            onLoad={() => setStatus('live')}
            onError={() => setStatus('error')}
          />
        )}
        {status !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white" role="status">
            {gaveUp ? (
              <>
                <p className="text-sm font-semibold">The camera picture is not available.</p>
                <p className="text-xs text-slate-300">
                  Check that the camera is on and that its live picture address on the Hardware page is right.
                </p>
                <Button variant="secondary" onClick={retry}>Try again</Button>
              </>
            ) : (
              <>
                <p className="text-base font-semibold">Connecting to the camera{camera.name ? ` (${camera.name})` : ''}…</p>
                <p className="text-sm text-slate-300">Attempt {attempt} of {MAX_ATTEMPTS}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
