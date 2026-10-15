// Runs once before the app draws its first screen, only inside the phone app.
import { isNative } from './platform'
import { tokenStore } from '../services/api'

export async function bootNative() {
  if (!isNative) return
  document.documentElement.classList.add('native-app')
  // The saved sign-in token is read from secure storage first, so the first screen already knows if someone is signed in.
  await tokenStore.load()
}
