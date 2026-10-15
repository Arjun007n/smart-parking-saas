// QR scanning in the phone app: the phone's own scanner screen (Google's code scanner, through the QrScanner plugin).
// It opens full screen with its own camera view and returns the text of the first code it reads.
// In a normal browser, or if the scanner is not available on the phone, the page's own camera reader is used instead.
import { isNative, nativePlugin } from './platform'

export const nativeScannerAvailable = isNative

// The text of the code, or null when the person closed the scanner. Throws when the scanner cannot be used at all
// (for example a phone without Google Play services), so the caller can fall back to the page's own reader.
export async function scanQrNative() {
  try {
    const { text } = await nativePlugin('QrScanner').scan()
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch (error) {
    if (error?.code === 'CANCELLED') return null
    throw error
  }
}
