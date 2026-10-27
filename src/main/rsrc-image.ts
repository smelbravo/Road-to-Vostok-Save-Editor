import { parseRsrc, type RsrcValue } from './rsrc'

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
}

const isDict = (v: RsrcValue | undefined): v is { dict: Record<string, RsrcValue> } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && 'dict' in v

export function imageFromRsrc(buf: Buffer): RsrcImage | string {
  const res = parseRsrc(buf)
  if (!res) return 'not a Godot binary resource'
  // The dictionary lives on an Image sub-resource (ImageTexture -> image), or on the main one.
  const holders = [
    ...res.subResources.filter((s) => s.type === 'Image').map((s) => s.props),
    ...(res.type === 'Image' ? [res.props] : [])
  ]
  const dict = holders.map((p) => p.get('data')).find(isDict)?.dict
  if (!dict) return `no image data in ${res.type || 'resource'}`
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
