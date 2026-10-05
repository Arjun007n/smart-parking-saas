// Makes a camera picture small enough to upload quickly over a gate's mobile
// connection: at most `maxSide` pixels on the long edge, saved as JPEG.
// Phone cameras produce 3-8 MB pictures; this makes them around 100-250 KB.

const loadBitmap = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      // "from-image" turns a sideways phone picture upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Fall through to the slower route below.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('unreadable'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function shrinkImage(file, { maxSide = 1280, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (JPEG, PNG or WebP).')
  let bitmap
  try {
    bitmap = await loadBitmap(file)
  } catch {
    throw new Error('This picture could not be read. Try taking it again as a JPEG.')
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  if (typeof bitmap.close === 'function') bitmap.close()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('This picture could not be prepared. Try again.')
  return blob
}
