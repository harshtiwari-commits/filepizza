// Preview support for the downloader.
//
// Security note: never trust the MIME type the uploader declares. We decide what a
// file is by looking at its first few bytes ("magic numbers") and only ever render
// it with an element that cannot execute script. HTML and SVG are deliberately
// absent from every signature list below, so they can never be previewed inline.

/** Largest file we will buffer into memory for a preview. */
export const PREVIEW_MAX_BYTES = 64 * 1024 * 1024 // 64 MB

export type PreviewKind = 'image'

const asciiAt = (bytes: Uint8Array, offset: number, length: number): string => {
  let out = ''
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i])
  }
  return out
}

const IMAGE_SIGNATURES: Array<{
  mimeType: string
  test: (b: Uint8Array) => boolean
}> = [
  {
    mimeType: 'image/png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mimeType: 'image/jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/gif',
    test: (b) =>
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    mimeType: 'image/webp',
    test: (b) => asciiAt(b, 0, 4) === 'RIFF' && asciiAt(b, 8, 4) === 'WEBP',
  },
  {
    mimeType: 'image/bmp',
    test: (b) => b[0] === 0x42 && b[1] === 0x4d,
  },
  {
    mimeType: 'image/avif',
    test: (b) =>
      asciiAt(b, 4, 4) === 'ftyp' && asciiAt(b, 8, 4).startsWith('avif'),
  },
]

/**
 * Identify an image from its leading bytes. Returns null for anything we do not
 * explicitly recognise, including HTML and SVG.
 */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.test(bytes)) return signature.mimeType
  }
  return null
}

/**
 * Cheap pre-flight check we can do before transferring anything, to decide whether
 * to offer a Preview button. Returns a human-readable reason when preview is not
 * possible, or null when it might be.
 */
export function previewBlockedReason(file: { size: number }): string | null {
  if (file.size === 0) return 'This file is empty'
  if (file.size > PREVIEW_MAX_BYTES) return 'Too large to preview'
  return null
}
