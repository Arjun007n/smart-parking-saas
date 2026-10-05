import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from '../ui'

const supportsScanning = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia)

// Reads a ticket or pass QR code with the device camera. It relies on the
// browser's own barcode reader (Chrome on Android and recent desktop Chrome and
// Edge). Where that is missing, a USB barcode scanner still works: it types
// into the box on the page like a keyboard.
export default function QrScanner({ onScan, onClose }) {
  const video = useRef(null)
  // Always call the latest handler without restarting the camera.
  const handler = useRef(onScan)
  useEffect(() => {
    handler.current = onScan
  })
  const [problem, setProblem] = useState(() => (supportsScanning() ? '' : 'This browser cannot scan with the camera. Use a USB scanner, or type the number.'))

  useEffect(() => {
    if (!supportsScanning()) return undefined
    let stopped = false
    let stream
    let timer

    const start = async () => {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        video.current.srcObject = stream
        await video.current.play()
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video.current)
            const text = codes[0]?.rawValue
            if (text && !stopped) {
              stopped = true
              handler.current(text.trim())
            }
          } catch {
            // A frame that cannot be read is simply skipped.
          }
        }, 250)
      } catch (error) {
        if (stopped) return
        setProblem(
          error?.name === 'NotAllowedError'
            ? 'Camera access was refused. Allow the camera for this site, or type the number.'
            : 'The camera could not be started. Type the number instead.',
        )
      }
    }
    start()

    return () => {
      stopped = true
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
      {problem ? (
        <Alert type="info">{problem}</Alert>
      ) : (
        <>
          <video ref={video} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />
          <p className="text-center text-xs text-slate-500">Hold the QR code of the ticket or pass in front of the camera.</p>
        </>
      )}
      <Button variant="secondary" className="w-full" onClick={onClose}>Close camera</Button>
    </div>
  )
}
