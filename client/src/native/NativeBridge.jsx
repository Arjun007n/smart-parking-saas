import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isNative, nativePlugin } from './platform'

// The Android back button: one page back inside the app; on the first page it leaves the app (instead of showing an
// old screen). Does nothing in a browser.
export default function NativeBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNative) return undefined
    const app = nativePlugin('App')
    let handle = null
    let stopped = false
    Promise.resolve(
      app.addListener('backButton', () => {
        // react-router keeps the position in the history in `state.idx` (0 = the page the app opened on).
        if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
        else app.exitApp()
      }),
    )
      .then((listener) => {
        if (stopped) listener.remove()
        else handle = listener
      })
      .catch(() => {
        // Without the App plugin the phone's default back behaviour stays.
      })
    return () => {
      stopped = true
      if (handle) handle.remove()
    }
  }, [navigate])

  return null
}
