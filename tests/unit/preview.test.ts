import { describe, it, expect } from 'vitest'
import {
  PREVIEW_MAX_BYTES,
  previewBlockedReason,
  sniffImageMimeType,
} from '../../src/utils/preview'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('sniffImageMimeType', () => {
  it('detects PNG', () => {
    expect(sniffImageMimeType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png')
  })

  it('detects JPEG', () => {
    expect(sniffImageMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(
      'image/jpeg',
    )
  })

  it('detects GIF', () => {
    expect(sniffImageMimeType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(
      'image/gif',
    )
  })

  it('detects BMP', () => {
    expect(sniffImageMimeType(bytes(0x42, 0x4d))).toBe('image/bmp')
  })

  it('rejects HTML', () => {
    expect(sniffImageMimeType(ascii('<html><script>alert(1)</script>'))).toBe(
      null,
    )
  })

  it('rejects SVG', () => {
    expect(
      sniffImageMimeType(ascii('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBe(null)
  })

  it('rejects empty input', () => {
    expect(sniffImageMimeType(bytes())).toBe(null)
  })
})

describe('previewBlockedReason', () => {
  it('blocks empty files', () => {
    expect(previewBlockedReason({ size: 0 })).toBe('This file is empty')
  })

  it('blocks oversized files', () => {
    expect(previewBlockedReason({ size: PREVIEW_MAX_BYTES + 1 })).toBe(
      'Too large to preview',
    )
  })

  it('allows files inside the cap', () => {
    expect(previewBlockedReason({ size: 1024 })).toBe(null)
  })
})
