import { useState } from 'react'
import { useGateCamera } from '../../hooks/useGateCamera'
import { Button } from '../ui'

// The live picture of the gate camera, drawn by the AI service (with the plate box on it).
// It is a plain video stream shown in an <img>. Nothing is shown when the gate has no camera
// with a picture address. If the AI service is not running, the panel says so and offers a retry.
export default function LivePreview({ locationId, direction, gate }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const camera = useGateCamera(locationId, direction, gate)
  const url = camera.previewUrl
  if (!locationId || !url) return null

  // A new query string makes the browser open the stream again.
  const src = `${url}${url.includes('?') ? '&' : '?'}n=${attempt}`
  const retry = () => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  return (
    <div className="no-print rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Live camera{camera.name ? ` · ${camera.name}` : ''}</h2>
        <span className={`text-xs ${failed ? 'text-red-700' : 'text-slate-500'}`}>{failed ? 'Not running' : 'Plate box shows what the camera reads'}</span>
      </div>
      {failed ? (
        <div className="flex flex-col items-start gap-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
          <p>The camera picture is not available. Start the AI service on the gate computer, then try again.</p>
          <Button variant="secondary" onClick={retry}>Try again</Button>
        </div>
      ) : (
        <img
          key={attempt}
          src={src}
          alt="Live picture from the gate camera"
          className="aspect-video w-full max-w-xl rounded-lg bg-slate-900 object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
