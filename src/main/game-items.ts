import { parseItemTres, resourceProps, type ModItem } from './mods'

/**
 * Reads the game's own items out of the game archive (RTV.pck), so items added by game
 * updates show up without waiting for a new editor release.
 *
 * Exported Godot projects ship item resources in one of two forms:
 *  - text: `res://Items/.../X.tres` is in the pck as is,
 *  - binary: `X.tres.remap` points to a `.res` (RSRC) file under `res://.godot/exported/`.
 *
 * The text form is parsed with the same code used for mods. The binary form is read by a small,
 * strict RSRC reader below. It gives up (returns null) at the first thing it does not
 * understand instead of guessing; the caller then falls back to what the path alone says
 * (`res://Items/<Category>/<id>/<id>.tres`).
 */

export interface PckFile {
  path: string
  offset: number
  size: number
}

/** `Icon_AK-12.png` -> full imported name `Icon_AK-12.png-<hash>.s3tc.ctex` (the icon cache key). */
export function buildIconIndex(files: PckFile[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const f of files) {
    const name = f.path.split('/').pop() ?? ''
    const m = /^(.+)-[0-9a-f]{32}\.s3tc\.ctex$/.exec(name)
    if (m && name.startsWith('Icon_')) index.set(m[1].toLowerCase(), name)
  }
  return index
}

export interface GameItem extends ModItem {
  /** true when name/size/etc. were read from the resource, false when derived from the path */
  parsed: boolean
}

export interface GameCatalogResult {
  /** Files in the archive and a few of their paths, to diagnose a scan that finds nothing */
  totalFiles: number
  samplePaths: string[]
  items: GameItem[]
  scanned: number
  unreadable: number
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Binary resource (RSRC) reader
// ---------------------------------------------------------------------------

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

export type RsrcValue = string | number | boolean | null | number[] | RsrcValue[] | { ref: string }

export interface RsrcResource {
  type: string
  scriptClass: string
  /** properties read before the reader gave up (or all of them) */
  props: Map<string, RsrcValue>
  complete: boolean
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

  // the main resource is the last one stored
  r.pos = offsets[offsets.length - 1]
  const mainType = r.str()
  const count = r.u32()
  if (count > 10000) return null

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

  const props = new Map<string, RsrcValue>()
  let complete = true
  try {
    for (let i = 0; i < count; i++) {
      const name = strings[r.u32()]
      if (name === undefined) throw new Unsupported()
      props.set(name, readVariant())
    }
  } catch {
    complete = false
  }
  return { type: mainType || type, scriptClass, props, complete }
}

// ---------------------------------------------------------------------------
// Item catalog
// ---------------------------------------------------------------------------

const ITEM_PATH = /^res:\/\/Items\/([^/]+)\/(?:[^/]+\/)*([^/]+)\.tres(?:\.remap)?$/i

const FOLDER_TO_CATEGORY: Record<string, string> = {
  Ammo: 'Ammo',
  Armor: 'Armor',
  Attachments: 'Attachments',
  Backpacks: 'Backpacks',
  Belts: 'Belts',
  Books: 'Books',
  Clothing: 'Clothing',
  Consumables: 'Consumables',
  Electronics: 'Electronics',
  Fishing: 'Fishing',
  Furniture: 'Furniture',
  Grenades: 'Grenades',
  Helmets: 'Helmets',
  Instruments: 'Instruments',
  Keys: 'Keys',
  Knives: 'Knives',
  Lore: 'Lore',
  Medical: 'Medical',
  Misc: 'Misc',
  Rigs: 'Rigs',
  Weapons: 'Weapons'
}

const TYPE_TO_CATEGORY: Record<string, string> = {
  Ammo: 'Ammo',
  Armor: 'Armor',
  Attachment: 'Attachments',
  Backpack: 'Backpacks',
  'Belt Pouch': 'Belts',
  Clothing: 'Clothing',
  Consumable: 'Consumables',
  Consumables: 'Consumables',
  Electronics: 'Electronics',
  Fish: 'Fishing',
  Fishing: 'Fishing',
  Furniture: 'Furniture',
  Grenade: 'Grenades',
  Helmet: 'Helmets',
  Instrument: 'Instruments',
  Key: 'Keys',
  Knife: 'Knives',
  Literature: 'Books',
  Lore: 'Lore',
  Medical: 'Medical',
  Misc: 'Misc',
  Rig: 'Rigs',
  Weapon: 'Weapons'
}

function resolveIcon(
  index: Map<string, string>,
  iconPath: string | undefined,
  id: string
): string | undefined {
  const base = iconPath?.split('/').pop()?.toLowerCase()
  return (base ? index.get(base) : undefined) ?? index.get(`icon_${id}.png`.toLowerCase())
}

const asString = (v: RsrcValue | undefined): string => (typeof v === 'string' ? v : '')
const asNumber = (v: RsrcValue | undefined): number => (typeof v === 'number' ? v : 0)

/** Turns a parsed ItemData resource into a catalog entry, or null if it does not look like one. */
export function itemFromRsrc(res: RsrcResource, resourcePath: string): GameItem | null {
  const name = asString(res.props.get('name'))
  const type = asString(res.props.get('type'))
  if (!name || !type) return null
  const size = res.props.get('size')
  const sizeOk = Array.isArray(size) && size.length === 2
  const dim = (i: number): number =>
    sizeOk ? Math.min(16, Math.max(1, Math.round(Number((size as number[])[i])) || 1)) : 1
  const file =
    asString(res.props.get('file')) || (resourcePath.split('/').pop() ?? '').replace(/\.tres$/, '')
  const slots = res.props.get('slots')
  return {
    category: TYPE_TO_CATEGORY[type] ?? 'Misc',
    id: file,
    displayName: name,
    resourcePath,
    sizeW: dim(0),
    sizeH: dim(1),
    stackable: res.props.get('stackable') === true,
    showAmount: res.props.get('showAmount') === true,
    defaultAmount: asNumber(res.props.get('defaultAmount')),
    maxAmount: asNumber(res.props.get('maxAmount')),
    showCondition: res.props.get('showCondition') === true,
    slots: Array.isArray(slots)
      ? (slots as RsrcValue[]).filter((s): s is string => typeof s === 'string')
      : [],
    modId: '',
    iconPath: ((): string => {
      const icon = res.props.get('icon')
      return typeof icon === 'object' && icon !== null && !Array.isArray(icon) ? icon.ref : ''
    })(),
    parsed: true
  }
}

/** What the path alone tells us (always available; the name is the file id). */
export function itemFromPath(resourcePath: string): GameItem | null {
  const m = ITEM_PATH.exec(resourcePath)
  if (!m) return null
  const id = m[2]
  return {
    category: FOLDER_TO_CATEGORY[m[1]] ?? 'Misc',
    id,
    displayName: id.replace(/_/g, ' '),
    resourcePath: resourcePath.replace(/\.remap$/, ''),
    sizeW: 1,
    sizeH: 1,
    stackable: false,
    showAmount: false,
    defaultAmount: 0,
    maxAmount: 0,
    showCondition: false,
    slots: [],
    modId: '',
    parsed: false
  }
}

const REMAP_PATH = /^\s*path\s*=\s*"([^"]+)"/m

export async function scanGameItems(
  files: PckFile[],
  read: (file: PckFile) => Promise<Buffer>
): Promise<GameCatalogResult> {
  // Godot stores paths with or without the `res://` prefix depending on the version
  const norm = (p: string): string => {
    const clean = p.replace(/\\/g, '/').replace(/^\/+/, '')
    return clean.startsWith('res://') ? clean : 'res://' + clean
  }
  const rawFiles = files
  files = files.map((f) => ({ ...f, path: norm(f.path) }))
  const result: GameCatalogResult = {
    totalFiles: files.length,
    samplePaths: [
      ...rawFiles.filter((f) => /items/i.test(f.path)).slice(0, 3),
      ...rawFiles.slice(0, 2)
    ].map((f) => f.path),
    items: [],
    scanned: 0,
    unreadable: 0,
    warnings: []
  }
  const byPath = new Map(files.map((f) => [f.path, f]))
  const iconIndex = buildIconIndex(files)
  const seen = new Set<string>()

  for (const file of files) {
    const base = file.path.replace(/\.remap$/, '')
    if (!ITEM_PATH.test(file.path) || seen.has(base)) continue
    seen.add(base)
    result.scanned++
    let item: GameItem | null = null
    let failed = false
    try {
      if (file.path.endsWith('.remap')) {
        const target = REMAP_PATH.exec((await read(file)).toString('utf8'))?.[1]
        const targetFile = target ? byPath.get(norm(target)) : undefined
        if (targetFile) {
          const res = parseRsrc(await read(targetFile))
          if (res) item = itemFromRsrc(res, base)
        }
      } else {
        const parsed = parseItemTres((await read(file)).toString('utf8'), base, '')
        if (parsed) item = { ...parsed, parsed: true }
      }
    } catch {
      failed = true
    }
    // not an ItemData (or unreadable): keep the path-derived entry so the item is at least listed
    const fallback = itemFromPath(base)
    if (item) {
      item.iconFile = resolveIcon(iconIndex, item.iconPath, item.id)
      result.items.push(item)
    } else if (fallback) {
      result.unreadable++
      fallback.iconFile = resolveIcon(iconIndex, undefined, fallback.id)
      result.items.push(fallback)
    } else if (failed) result.unreadable++
  }
  return result
}

// ---------------------------------------------------------------------------
// Tasks (TaskData resources). The property names are not known for sure, so every simple
// property is returned and the renderer picks the ones it understands.
// ---------------------------------------------------------------------------

export interface GameTask {
  path: string
  scriptClass: string
  props: Record<string, string | number | boolean | (string | number | boolean)[] | null>
}

export interface GameTaskScan {
  tasks: GameTask[]
  /** Resources looked at, and the property names seen (for diagnostics) */
  checked: number
  propertyNames: string[]
}

type TaskValue = GameTask['props'][string]

function simplify(v: RsrcValue | undefined): TaskValue {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    return v.map((x) =>
      typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
        ? x
        : x && typeof x === 'object' && !Array.isArray(x)
          ? x.ref
          : ''
    )
  }
  return v.ref
}

function textValue(raw: string): TaskValue {
  const t = raw.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  return [...t.matchAll(/"([^"]*)"/g)].map((m) => m[1])
}

export async function scanGameTasks(
  files: PckFile[],
  read: (file: PckFile) => Promise<Buffer>
): Promise<GameTaskScan> {
  const norm = (p: string): string => {
    const clean = p.replace(/\\/g, '/').replace(/^\/+/, '')
    return clean.startsWith('res://') ? clean : 'res://' + clean
  }
  const all = files.map((f) => ({ ...f, path: norm(f.path) }))
  const byPath = new Map(all.map((f) => [f.path, f]))
  const stubs = all.filter((f) => /\.tres(\.remap)?$/.test(f.path))
  let candidates = stubs.filter((f) => /task|quest/i.test(f.path))
  if (candidates.length === 0) {
    candidates = stubs.filter((f) => !/\/(items|assets)\//i.test(f.path)).slice(0, 4000)
  }
  const out: GameTaskScan = { tasks: [], checked: 0, propertyNames: [] }
  const names = new Set<string>()
  for (const file of candidates) {
    out.checked++
    try {
      const base = file.path.replace(/\.remap$/, '')
      if (file.path.endsWith('.remap')) {
        const target = REMAP_PATH.exec((await read(file)).toString('utf8'))?.[1]
        const tf = target ? byPath.get(norm(target)) : undefined
        if (!tf) continue
        const res = parseRsrc(await read(tf))
        if (!res || !/task/i.test(res.scriptClass)) continue
        const props: GameTask['props'] = {}
        for (const [k, v] of res.props) {
          props[k] = simplify(v)
          names.add(k)
        }
        out.tasks.push({ path: base, scriptClass: res.scriptClass, props })
      } else {
        const text = (await read(file)).toString('utf8')
        const cls = /script_class="([^"]+)"/.exec(text.split('\n', 1)[0])?.[1] ?? ''
        if (!/task/i.test(cls)) continue
        const props: GameTask['props'] = {}
        for (const [k, v] of Object.entries(resourceProps(text))) {
          props[k] = textValue(v)
          names.add(k)
        }
        out.tasks.push({ path: base, scriptClass: cls, props })
      }
    } catch {
      // unreadable resource: skip
    }
  }
  out.propertyNames = [...names].sort()
  return out
}
