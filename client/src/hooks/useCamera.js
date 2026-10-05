import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'sp_camera_on'

const remembered = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
const remember = (on) => {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // Not remembering the choice is harmless.
  }
}

const explain = (error) => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot use the camera here. The camera needs a secure address (https) or localhost.'
  }
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was refused. Allow the camera for this site in the browser settings, then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.'
    case 'NotReadableError':
      return 'The camera is being used by another program. Close it and try again.'
    default:
      return 'The camera could not be started.'
  }
}

// A live camera preview for the gate screen.
//   const camera = useCamera()
//   <video ref={camera.videoRef} autoPlay playsInline muted />
//   camera.start() / camera.stop() / await camera.capture()  -> JPEG Blob of the current frame
// The camera is switched off when the page is left. If it was on last time on
// this device, it is started again automatically (the browser keeps the permission).
export function useCamera({ maxSide = 1600, quality = 0.85 } = {}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  // off | starting | on | error. Starts as "starting" when the camera was on last time.
  const [state, setState] = useState(() => (remembered() ? 'starting' : 'off'))
  const [error, setError] = useState('')

  const stop = useCallback((forget = true) => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState('off')
    if (forget) remember(false)
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return
    setError('')
    setState('starting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setState('on')
      remember(true)
    } catch (err) {
      streamRef.current = null
      setError(explain(err))
      setState('error')
      remember(false)
    }
  }, [])

  // The video element appears only after the first render; attach the stream if it arrived earlier.
  useEffect(() => {
    if (state === 'on' && videoRef.current && !videoRef.current.srcObject && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [state])

  // Restart if it was on last time; always release the camera when leaving.
  useEffect(() => {
    // Started a moment later (not inside the effect body itself).
    if (remembered()) Promise.resolve().then(start)
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [start])

  // The current frame as a JPEG, or null when the camera is not showing a picture yet.
  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || state !== 'on' || !video.videoWidth) return null
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  }, [state, maxSide, quality])

  return { videoRef, state, error, start, stop, capture }
}
