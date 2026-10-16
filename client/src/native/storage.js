// Where the sign-in token is kept inside the phone app: the phone's secure storage (the Android Keystore, through the
// capacitor-secure-storage-plugin). If that plugin is missing or fails:
//   * in a release app the token is NOT written anywhere else; the person stays signed in for this run only (memory);
//   * in test mode (APP_DEV=1, the pages are served from http://localhost) the WebView's own storage is used instead,
//     so testing on an emulator or phone keeps working.
// In a normal browser (not the phone app) the token lives in localStorage as before (see services/api.js).
import { isNative, nativePlugin } from './platform'

const secure = () => (isNative ? nativePlugin('SecureStoragePlugin') : null)

// Test mode: the build was made with APP_DEV=1 (mobile/scripts/build-web.mjs sets VITE_APP_DEV, and the app is served
// over plain http). A release app is always https://localhost.
const testMode = () =>
  import.meta.env?.VITE_APP_DEV === '1' || (typeof location !== 'undefined' && location.protocol === 'http:')
const mayUseLocal = () => !isNative || testMode()

// The saved value, or null.
export async function loadSecret(key) {
  const store = secure()
  if (store) {
    try {
      const { value } = await store.get({ key })
      if (typeof value === 'string' && value) return value
    } catch {
      // Nothing saved there (the plugin says so with an error), or no plugin: try the fallback.
    }
  }
  if (!mayUseLocal()) {
    try {
      localStorage.removeItem(key) // a copy left by an older version of the app
    } catch {
      // ignore
    }
    return null
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// Saves the value. It never throws: the person is signed in for this run even if saving failed.
export async function saveSecret(key, value) {
  const store = secure()
  if (store) {
    try {
      await store.set({ key, value })
      localStorage.removeItem(key) // no second copy
      return
    } catch {
      // fall through to the WebView's storage (test mode only)
    }
  }
  if (!mayUseLocal()) return // release app: memory only for this run
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked: the token stays in memory for this run only
  }
}

export async function removeSecret(key) {
  const store = secure()
  if (store) {
    try {
      await store.remove({ key })
    } catch {
      // not there
    }
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
