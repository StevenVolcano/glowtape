// Photos straight off a phone carry EXIF metadata — including the GPS
// location where they were taken. Re-encoding through a canvas drops all of
// it (and shrinks 12-megapixel camera shots to something the server and
// everyone's data plan will thank us for). Applied to every photo upload.

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85

export async function scrubImage(file: File): Promise<File> {
  // Animated GIFs would be flattened by a canvas pass; they don't carry
  // EXIF/GPS, so let them through untouched.
  if (file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // Transparency flattens to white — these are photos, not logos.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) return file
    const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    // An odd format the browser can't decode — send as-is rather than fail.
    return file
  }
}
