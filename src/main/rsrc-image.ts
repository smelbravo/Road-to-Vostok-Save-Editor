import { parseRsrc, magicOf, type RsrcValue } from './rsrc'

/**
 * Pulls the pixels out of a binary `.res` texture (ImageTexture / Image), which is how some mods
 * ship their item icons. Only uncompressed formats are converted here; VRAM formats are returned
 * as raw data for the caller to decode.
 */

export interface RsrcImage {
  width: number
  height: number
  /** Godot Image format name, e.g. "RGBA8", "DXT5" */
  format: string
  data: Buffer
  /** A ready-made PNG / WebP file (portable compressed textures keep lossless images that way) */
  encoded?: 'png' | 'webp'
}

const isDict = (v: RsrcValue | undefined): v is { dict: Record<string, RsrcValue> } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && 'dict' in v

export function imageFromRsrc(buf: Buffer): RsrcImage | string {
  const res = parseRsrc(buf)
  if (!res) return `not a Godot binary resource (file starts with ${magicOf(buf)})`
  // The dictionary lives on an Image sub-resource (ImageTexture -> image), or on the main one.
  const holders = [
    ...res.subResources.filter((s) => s.type === 'Image').map((s) => s.props),
    ...(res.type === 'Image' ? [res.props] : [])
  ]
  const dict = holders.map((p) => p.get('data')).find(isDict)?.dict
  const packed = res.props.get('_data')
  if (!dict && Buffer.isBuffer(packed)) {
    const found = embeddedImage(packed)
    if (found) return found
    return `portable texture without a lossless image (${packed.length} bytes)`
  }
  if (!dict)
    return `no image data in ${res.type || 'resource'}${res.failure ? ` (${res.failure})` : ''}`
  const width = Number(dict.width)
  const height = Number(dict.height)
  const format = String(dict.format ?? '')
  const data = dict.data
  if (!Buffer.isBuffer(data) || !(width > 0) || !(height > 0)) return 'image data incomplete'
  if (width > 8192 || height > 8192) return 'image too large'
  return { width, height, format, data }
}

/** RGBA8 pixels for the plain formats, null when the format needs a real decoder. */
export function toRgba(img: RsrcImage): Uint8Array | null {
  const n = img.width * img.height
  const src = img.data
  const out = new Uint8Array(n * 4)
  const need = (bytes: number): boolean => src.length >= bytes
  switch (img.format) {
    case 'RGBA8':
      if (!need(n * 4)) return null
      out.set(src.subarray(0, n * 4))
      return out
    case 'RGB8':
      if (!need(n * 3)) return null
      for (let i = 0; i < n; i++) {
        out[i * 4] = src[i * 3]
        out[i * 4 + 1] = src[i * 3 + 1]
        out[i * 4 + 2] = src[i * 3 + 2]
        out[i * 4 + 3] = 255
      }
      return out
    case 'LA8':
      if (!need(n * 2)) return null
      for (let i = 0; i < n; i++) {
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = src[i * 2]
        out[i * 4 + 3] = src[i * 2 + 1]
      }
      return out
    case 'L8':
      if (!need(n)) return null
      for (let i = 0; i < n; i++) {
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = src[i]
        out[i * 4 + 3] = 255
      }
      return out
    default:
      return null
  }
}

/** DXT1 (BC1) to RGBA8; the first mip level only */
export function decodeDxt1(data: Buffer, width: number, height: number): Uint8Array | null {
  const bx = Math.ceil(width / 4)
  const by = Math.ceil(height / 4)
  if (data.length < bx * by * 8) return null
  const out = new Uint8Array(width * height * 4)
  const expand = (c: number): [number, number, number] => [
    ((c >> 11) & 31) * 8 + ((c >> 13) & 7),
    ((c >> 5) & 63) * 4 + ((c >> 9) & 3),
    (c & 31) * 8 + ((c >> 2) & 7)
  ]
  for (let y = 0; y < by; y++) {
    for (let x = 0; x < bx; x++) {
      const o = (y * bx + x) * 8
      const c0 = data.readUInt16LE(o)
      const c1 = data.readUInt16LE(o + 2)
      const a = expand(c0)
      const b = expand(c1)
      const pal: number[][] = [
        [...a, 255],
        [...b, 255],
        c0 > c1
          ? [(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3, 255]
          : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 255],
        c0 > c1
          ? [(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3, 255]
          : [0, 0, 0, 0]
      ]
      const bits = data.readUInt32LE(o + 4)
      for (let i = 0; i < 16; i++) {
        const px = x * 4 + (i & 3)
        const py = y * 4 + (i >> 2)
        if (px >= width || py >= height) continue
        const p = pal[(bits >> (i * 2)) & 3]
        const at = (py * width + px) * 4
        out[at] = p[0]
        out[at + 1] = p[1]
        out[at + 2] = p[2]
        out[at + 3] = p[3]
      }
    }
  }
  return out
}

/** Lossless PNG / WebP inside a PortableCompressedTexture2D's `_data` (16-byte header, then the file) */
function embeddedImage(data: Buffer): RsrcImage | null {
  const width = data.length >= 8 ? data.readUInt16LE(4) : 0
  const height = data.length >= 8 ? data.readUInt16LE(6) : 0
  const riff = data.indexOf('RIFF', 0, 'latin1')
  if (riff >= 0 && data.toString('latin1', riff + 8, riff + 12) === 'WEBP') {
    const size = data.readUInt32LE(riff + 4) + 8
    return {
      width,
      height,
      format: 'WEBP',
      data: data.subarray(riff, riff + size),
      encoded: 'webp'
    }
  }
  const png = data.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  if (png >= 0) return { width, height, format: 'PNG', data: data.subarray(png), encoded: 'png' }
  return null
}
