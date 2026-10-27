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

export function parseRsrc(buf: Buffer): RsrcResource | null {
  try {
    return parseRsrcInner(buf)
  } catch {
    return null
  }
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
        throw new Unsupported()
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
    } catch {
      ok = false
    }
    if (idx === offsets.length - 1) {
      mainType = resType
      mainProps = props
      complete = ok
    } else {
      subResources.push({ type: resType, props })
    }
  }
  return { type: mainType || type, scriptClass, props: mainProps, complete, subResources }
}
