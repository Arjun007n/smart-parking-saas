import { useEffect, useRef, useState } from 'react'
import { findPlate, plateWatcher } from '../../native/plate'
import { readPlateText } from '../../native/plateReader'

// The part of the picture that the on-screen frame shows (fractions of the visible camera area). A little more is read
// than is drawn, so a plate touching the frame still counts.
const FRAME = { left: 0.1, top: 0.26, width: 0.8, height: 0.4 }
const READ = { left: 0.05, top: 0.2, width: 0.9, height: 0.52 }
const EVERY_MS = 650

// The camera view for reading number plates (phone app). It looks at the camera picture a few times a second and calls
// onPlate(plate) once the same plate has been read twice. Nothing is read while `paused` is true (a plate is already
// in the box); `resetKey` starts a fresh reading.
export default function PlateCamera({ onPlate, onProblem, paused = false, resetKey = 0, aspect = 4 / 3 }) {
  const video = useRef(null)
  const handler = useRef(onPlate)
  const problemHandler = useRef(onProblem)
  const pausedRef = useRef(paused)
  const watcher = useRef(plateWatcher())
  const [problem, setProblem] = useState('')
  const [seeing, setSeeing] = useState(false)

  useEffect(() => {
    handler.current = onPlate
    problemHandler.current = onProblem
    pausedRef.current = paused
  })
  useEffect(() => {
    watcher.current.reset()
  }, [resetKey, paused])

  useEffect(() => {
    let stopped = false
    let stream
    let timer
    const canvas = document.createElement('canvas')

    const tick = async () => {
      if (stopped) return
      try {
        const v = video.current
        if (!pausedRef.current && v && v.readyState >= 2 && v.videoWidth > 0) {
          // The area of the camera picture that is on screen (the video fills its box, the edges are cut off).
          const w = v.videoWidth
          const h = v.videoHeight
          let vw = w
          let vh = h
          if (w / h > aspect) vw = h * aspect
          else vh = w / aspect
          const vx = (w - vw) / 2
          const vy = (h - vh) / 2
          const sx = vx + vw * READ.left
          const sy = vy + vh * READ.top
          const sw = vw * READ.width
          const sh = vh * READ.height
          const scale = Math.min(1.5, 960 / sw)
          canvas.width = Math.round(sw * scale)
          canvas.height = Math.round(sh * scale)
          canvas.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
          const lines = await readPlateText(canvas.toDataURL('image/jpeg', 0.8))
          if (stopped || pausedRef.current) return
          const plate = findPlate(lines)
          setSeeing(Boolean(plate))
          const trusted = watcher.current.add(plate)
          if (trusted) {
            watcher.current.reset()
            handler.current?.(trusted)
          }
        }
      } catch {
        // A picture that cannot be read is skipped; the next one is tried.
      }
      if (!stopped) timer = setTimeout(tick, EVERY_MS)
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        const message = 'The camera is not available here. Type the vehicle number.'
        setProblem(message)
        problemHandler.current?.(message)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        video.current.srcObject = stream
        await video.current.play()
        timer = setTimeout(tick, EVERY_MS)
      } catch (error) {
        if (stopped) return
        const message = error?.name === 'NotAllowedError'
          ? 'The camera is not allowed. Allow the camera for this app in the phone settings, or type the number.'
          : 'The camera could not be started. Type the vehicle number.'
        setProblem(message)
        problemHandler.current?.(message)
      }
    }
    start()

    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [aspect])

  if (problem) {
    return <p className="rounded-2xl bg-amber-50 p-4 text-sm font-medium text-amber-900 ring-1 ring-amber-200" role="alert">{problem}</p>
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: String(aspect) }}>
      <video ref={video} muted playsInline className="h-full w-full object-cover" />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-xl border-2 ${seeing ? 'border-emerald-400' : 'border-white/90'}`}
        style={{ left: `${FRAME.left * 100}%`, top: `${FRAME.top * 100}%`, width: `${FRAME.width * 100}%`, height: `${FRAME.height * 100}%` }}
      />
      <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-center text-xs font-medium text-white">
        Keep the plate inside the frame
      </p>
    </div>
  )
}
