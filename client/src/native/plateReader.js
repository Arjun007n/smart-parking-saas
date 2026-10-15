// Reading a number plate in the phone app: the page shows the camera and sends a picture of the plate area to the phone's
// text reader (the PlateReader plugin, ML Kit); native/plate.js then finds the plate in the lines that come back.
import { isNative, nativePlugin } from './platform'

export const plateReaderAvailable = isNative

// The lines of text in one JPEG picture (a data: URL or plain base64).
export async function readPlateText(image) {
  const result = await nativePlugin('PlateReader').read({ image })
  return Array.isArray(result?.lines) ? result.lines : []
}
