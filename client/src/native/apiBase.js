// The server address the page calls. In the website it is whatever the build says (empty = the same site).
//
// In the phone app, a test build points at the PC's address on the Wi-Fi (for the real phone). The Android emulator
// cannot reach that address, but it reaches the PC as 10.0.2.2, so on an emulator the Wi-Fi address is swapped for
// that one. This only ever changes a private (test) address, never a real https server.
const PRIVATE_HOST = /^(https?:\/\/)(192\.168\.\d{1,3}\.\d{1,3}|10\.(?!0\.2\.2(?::|\/|$))\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?=[:/]|$)/i
const EMULATOR = /sdk_gphone|google_sdk|Android SDK built for|Emulator|generic_x86|ranchu/i

export const apiOrigin = (base, { native = false, userAgent = '' } = {}) => {
  const origin = base || ''
  if (!native || !EMULATOR.test(userAgent)) return origin
  return origin.replace(PRIVATE_HOST, '$1' + '10.0.2.2')
}
