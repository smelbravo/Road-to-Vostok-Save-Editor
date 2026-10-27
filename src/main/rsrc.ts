import * as zlib from 'zlib'
import { inflateSync, gunzipSync } from 'zlib'
/**
 * Strict reader for Godot 4 binary resources (`RSRC`, `.res`). It was written from the engine's
 * documented layout and is deliberately defensive: anything it does not understand makes it stop
 * (properties read so far are kept, `complete` is false) or return null, never guess.
 */

class Reader {
  pos = 0
  constructor(
    readonly buf: Buffer,
    readonly big = false
  ) {}
  need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('eof')
  }
  u32(): number {
    this.need(4)
    const v = this.big ? this.buf.readUInt32BE(this.pos) : this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.big ? this.buf.readInt32BE(this.pos) : this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }
  u64(): number {
    this.need(8)
    const v = this.big ? this.buf.readBigUInt64BE(this.pos) : this.buf.readBigUInt64LE(this.pos)
    this.pos += 8
    return Number(v)
  }
  f32(): number {
    this.need(4)
    const v = this.big ? this.buf.readFloatBE(this.pos) : this.buf.readFloatLE(this.pos)
    this.pos += 4
    return v
  }
  f64(): number {
    this.need(8)
    const v = this.big ? this.buf.readDoubleBE(this.pos) : this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }
  /** u32 length (including the terminating NUL) + bytes */
  str(): string {
    const len = this.u32()
    if (len > 1 << 20) throw new Error('string too long')
    this.need(len)
    const s = this.buf.toString('utf8', this.pos, this.pos + len).replace(/\0+$/, '')
    this.pos += len
    return s
  }
}

export type RsrcValue =
  | string
  | number
  | boolean
  | null
  | number[]
  | RsrcValue[]
  | Buffer
  | { ref: string }
  | { dict: Record<string, RsrcValue> }

export interface RsrcResource {
  type: string
  scriptClass: string
  /** properties read before the reader gave up (or all of them) */
  props: Map<string, RsrcValue>
  complete: boolean
  /** Every internal (sub) resource in file order; `{ref:'local:N'}` values point into this list */
  subResources: { type: string; props: Map<string, RsrcValue> }[]
  /** Why reading stopped early, when it did */
  failure?: string
}

// Variant ids of Godot's binary resource format (resource_format_binary.cpp)
const V = {
  NIL: 1,
  BOOL: 2,
  INT: 3,
  FLOAT: 4,
  STRING: 5,
  VECTOR2: 10,
  VECTOR3: 12,
  COLOR: 20,
  NODE_PATH: 22,
  OBJECT: 24,
  ARRAY: 30,
  DICTIONARY: 26,
  RAW_ARRAY: 31,
  INT32_ARRAY: 32,
  FLOAT32_ARRAY: 33,
  STRING_ARRAY: 34,
  INT64: 40,
  DOUBLE: 41,
  STRING_NAME: 44,
  VECTOR2I: 45
} as const

class Unsupported extends Error {}

const fail = (e: unknown): string => (e instanceof Error ? e.message : 'unreadable')

export function parseRsrc(buf: Buffer): RsrcResource | null {
  try {
    return parseRsrcInner(unpackRscc(buf))
  } catch {
    return null
  }
}

/** First bytes of a file, printable, for diagnostics ("RSRC", "GDST", ...) */
export function magicOf(buf: Buffer): string {
  return JSON.stringify(buf.toString('latin1', 0, 4).replace(/[^\x20-\x7e]/g, '.'))
}

function fastlzDecompress(src: Buffer, outSize: number): Buffer {
  const out = Buffer.alloc(outSize)
  const level = (src[0] >> 5) + 1
  let ip = 0
  let op = 0
  let ctrl = src[ip++] & 31
  for (;;) {
    if (ctrl >= 32) {
      let len = (ctrl >> 5) - 1
      let ofs = (ctrl & 31) << 8
      let ref = op - ofs - 1
      if (level === 1) {
        if (len === 6) len += src[ip++]
        ref -= src[ip++]
      } else {
        if (len === 6) {
          let code: number
          do {
            code = src[ip++]
            len += code
          } while (code === 255)
        }
        const code = src[ip++]
        ref -= code
        if (code === 255 && ofs === 31 << 8) {
          ofs = src[ip++] << 8
          ofs += src[ip++]
          ref = op - ofs - 8191
        }
      }
      len += 3
      if (ref < 0 || op + len > outSize) throw new Unsupported('corrupt compressed data')
      for (let i = 0; i < len; i++) out[op++] = out[ref++]
    } else {
      ctrl++
      if (op + ctrl > outSize || ip + ctrl > src.length)
        throw new Unsupported('corrupt compressed data')
      src.copy(out, op, ip, ip + ctrl)
      op += ctrl
      ip += ctrl
    }
    if (ip >= src.length) break
    ctrl = src[ip++]
  }
  return out
}

/** Godot's compressed resource wrapper ("RSCC": mode, block size, total size, block table, blocks) */
export function unpackRscc(buf: Buffer): Buffer {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'RSCC') return buf
  const mode = buf.readUInt32LE(4)
  const blockSize = buf.readUInt32LE(8)
  const total = buf.readUInt32LE(12)
  if (!blockSize || total > 1 << 28) throw new Unsupported('bad compressed header')
  const blocks = Math.floor(total / blockSize) + 1
  let pos = 16 + blocks * 4
  const parts: Buffer[] = []
  let done = 0
  for (let i = 0; i < blocks; i++) {
    const csize = buf.readUInt32LE(16 + i * 4)
    const want = Math.min(blockSize, total - done)
    if (want <= 0) break
    const chunk = buf.subarray(pos, pos + csize)
    pos += csize
    let plain: Buffer
    if (mode === 0) plain = fastlzDecompress(chunk, want)
    else if (mode === 1) plain = inflateSync(chunk)
    else if (mode === 3) plain = gunzipSync(chunk)
    else if (mode === 2) {
      const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer })
        .zstdDecompressSync
      if (!zstd) throw new Unsupported('zstd compressed resource needs a newer runtime')
      plain = zstd(chunk)
    } else throw new Unsupported(`unknown compression ${mode}`)
    parts.push(plain)
    done += plain.length
  }
  return Buffer.concat(parts)
}

function parseRsrcInner(buf: Buffer): RsrcResource | null {
  if (buf.length < 64 || buf.toString('ascii', 0, 4) !== 'RSRC') return null
  const probe = new Reader(buf)
  probe.pos = 4
  const big = probe.u32() !== 0
  const r = new Reader(buf, big)
  r.pos = 8
  const real64 = r.u32() !== 0
  const major = r.u32()
  r.u32() // minor
  const format = r.u32()
  if (major !== 4 || format < 3 || format > 6) return null
  const type = r.str()
  r.u64() // metadata offset
  const flags = r.u32()
  r.u64() // uid
  const scriptClass = flags & 8 ? r.str() : ''
  for (let i = 0; i < 11; i++) r.u32()

  const strings: string[] = []
  const stringCount = r.u32()
  if (stringCount > 100000) return null
  for (let i = 0; i < stringCount; i++) strings.push(r.str())

  const extCount = r.u32()
  if (extCount > 100000) return null
  const ext: string[] = []
  for (let i = 0; i < extCount; i++) {
    r.str() // type
    ext.push(r.str())
    if (flags & 2) r.u64() // uid
  }

  const intCount = r.u32()
  if (intCount < 1 || intCount > 100000) return null
  const offsets: number[] = []
  for (let i = 0; i < intCount; i++) {
    r.str() // path
    offsets.push(r.u64())
  }

  const readVariant = (): RsrcValue => {
    const t = r.u32()
    switch (t) {
      case V.NIL:
        return null
      case V.BOOL:
        return r.u32() !== 0
      case V.INT:
        return r.i32()
      case V.INT64:
        return r.u64()
      case V.FLOAT:
        return real64 ? r.f64() : r.f32()
      case V.DOUBLE:
        return r.f64()
      case V.STRING:
      case V.STRING_NAME:
      case V.NODE_PATH:
        return t === V.NODE_PATH ? skipNodePath() : r.str()
      case V.VECTOR2:
        return real64 ? [r.f64(), r.f64()] : [r.f32(), r.f32()]
      case V.VECTOR2I:
        return [r.i32(), r.i32()]
      case V.VECTOR3:
        return real64 ? [r.f64(), r.f64(), r.f64()] : [r.f32(), r.f32(), r.f32()]
      case V.COLOR:
        return [r.f32(), r.f32(), r.f32(), r.f32()]
      case V.ARRAY: {
        const n = r.u32() & 0x7fffffff
        if (n > 100000) throw new Unsupported()
        const out: RsrcValue[] = []
        for (let i = 0; i < n; i++) out.push(readVariant())
        return out
      }
      case V.DICTIONARY: {
        const n = r.u32() & 0x7fffffff
        if (n > 100000) throw new Unsupported()
        const dict: Record<string, RsrcValue> = {}
        for (let i = 0; i < n; i++) {
          const k = readVariant()
          dict[String(k)] = readVariant()
        }
        return { dict }
      }
      case V.RAW_ARRAY: {
        const n = r.u32()
        r.need(n)
        const out = Buffer.from(r.buf.subarray(r.pos, r.pos + n))
        r.pos += n + ((4 - (n % 4)) % 4)
        return out
      }
      case V.INT32_ARRAY: {
        const n = r.u32()
        if (n > 1 << 24) throw new Unsupported()
        const out: number[] = []
        for (let i = 0; i < n; i++) out.push(r.i32())
        return out
      }
      case V.FLOAT32_ARRAY: {
        const n = r.u32()
        if (n > 1 << 24) throw new Unsupported()
        const out: number[] = []
        for (let i = 0; i < n; i++) out.push(r.f32())
        return out
      }
      case V.STRING_ARRAY: {
        const n = r.u32()
        if (n > 100000) throw new Unsupported()
        const out: string[] = []
        for (let i = 0; i < n; i++) out.push(r.str())
        return out
      }
      case V.OBJECT: {
        const kind = r.u32()
        if (kind === 0) return null
        if (kind === 1) return { ref: `local:${r.u32()}` }
        if (kind === 2) {
          r.str()
          return { ref: r.str() }
        }
        if (kind === 3) return { ref: ext[r.u32()] ?? '' }
        throw new Unsupported()
      }
      default:
        throw new Unsupported(`unsupported value type ${t}`)
    }
  }
  const skipNodePath = (): string => {
    // names + subnames + flags; rarely used by item data, kept simple
    const names = r.u32() & 0x7fffffff
    const sub = r.u32()
    r.u32()
    const parts: string[] = []
    for (let i = 0; i < names + sub; i++) parts.push(strings[r.u32()] ?? '')
    return parts.join('/')
  }

  // every internal resource, in file order; the main one is the last
  const subResources: RsrcResource['subResources'] = []
  let mainType = ''
  let mainProps = new Map<string, RsrcValue>()
  let complete = true
  let failure: string | undefined
  for (let idx = 0; idx < offsets.length; idx++) {
    const props = new Map<string, RsrcValue>()
    let ok = true
    let resType = ''
    try {
      r.pos = offsets[idx]
      resType = r.str()
      const count = r.u32()
      if (count > 10000) throw new Unsupported()
      for (let i = 0; i < count; i++) {
        const name = strings[r.u32()]
        if (name === undefined) throw new Unsupported()
        props.set(name, readVariant())
      }
    } catch (e) {
      ok = false
      failure ??= fail(e)
    }
    if (idx === offsets.length - 1) {
      mainType = resType
      mainProps = props
      complete = ok
    } else {
      subResources.push({ type: resType, props })
    }
  }
  return { type: mainType || type, scriptClass, props: mainProps, complete, subResources, failure }
}
