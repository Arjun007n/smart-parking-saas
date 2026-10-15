// Where the sign-in token is kept inside the phone app: the phone's secure storage (the Android Keystore, through the
// capacitor-secure-storage-plugin). If that plugin is missing or fails, the app still works and falls back to the
// WebView's own storage, which only this app can read.
import { isNative, nativePlugin } from './platform'

const secure = () => (isNative ? nativePlugin('SecureStoragePlugin') : null)

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
      // fall through to the WebView's storage
    }
  }
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
