import { createHash } from 'crypto'
import { parseRsrc } from './rsrc'
import { itemFromRsrc } from './game-items'
import { open, readdir, readFile, stat } from 'fs/promises'
import { join, extname } from 'path'
import { inflateRaw } from 'zlib'
import { promisify } from 'util'
import { isModEnabled, mcmIniName, readProfileState } from './profiles'

const inflateRawAsync = promisify(inflateRaw)

/**
 * Looks at the mods the player has installed (Metro/Vostok mod loader archives in
 * `<game>/mods`) so the editor can
 *  - tell which mods are present (e.g. Gear Storage Expansion), and
 *  - learn the items they add, so modded items get a name, size and category instead of
 *    showing up as unknown entries.
 * Nothing here ever writes to the mods folder.
 */

/** Items each scanned archive contributed, so copies the active profile does not load can be dropped */
const itemsOfMod = new WeakMap<InstalledMod, ModItem[]>()

export interface InstalledMod {
  /** Archive name inside the mods folder */
  file: string
  id: string
  name: string
  version: string
  author: string
  /** Lives in `mods/` or in RTV Mod Manager's `mods/Library` */
  location: 'mods' | 'library'
  /** Enabled in the active profile; null when no profile says anything about it */
  enabled: boolean | null
  /** Items found in the archive, and resource files that could not be read as items */
  itemCount?: number
  skipped?: string[]
}

export interface ModItem {
  category: string
  id: string
  displayName: string
  /** res:// path the save refers to */
  resourcePath: string
  sizeW: number
  sizeH: number
  stackable: boolean
  showAmount: boolean
  defaultAmount: number
  maxAmount: number
  showCondition: boolean
  slots: string[]
  /** Id of the mod that ships it (mod.txt id), '' when unknown */
  modId: string
  /** res:// path of the icon texture the item points at ('' when none) */
  iconPath?: string
  /** Icon cache key once the icon was extracted (see ScanOptions.onIcon) */
  iconFile?: string
  /** Why no icon could be extracted (diagnostics) */
  iconProblem?: string
  /** ItemData.subtype ("Optic", "Muzzle", "Magazine", "Rifle", ...) */
  subtype?: string
  /** Weapons: resource paths of the attachments the item lists as `compatible` */
  compatible?: string[]
  /** Weapons: res:// path of the inventory scene (`tetris`) */
  tetrisPath?: string
  /** Weapons: how attachments are drawn on the icon, read from the `tetris` scene */
  layout?: ModLayout
}

export interface ModLayoutOverlay {
  /** Node name in the scene; matches the attachment's `file` (e.g. "SV98_Scope", "ACOG") */
  name: string
  position: [number, number]
  scale: number
  behind: boolean
  /** res:// path of the sprite's own texture (often differs from the attachment's inventory icon) */
  texture?: string
  /** Icon cache key once the texture was extracted */
  iconFile?: string
  /** A layer the size of the weapon icon, drawn over it when the attachment is fitted */
  fill?: boolean
}

export interface ModLayout {
  /** res:// path of the scene the weapon's scene inherits from (e.g. SVD_8x2.tscn) */
  base: string
  overlays: ModLayoutOverlay[]
  /** Inherited nodes the scene hides (e.g. the borrowed weapon's own magazine) */
  hidden: string[]
}

export interface ModScan {
  modsDir: string | null
  mods: InstalledMod[]
  items: ModItem[]
  /** Parsed text of user://MCM/GSE/*.ini (newest first) when Gear Storage Expansion saved settings */
  gseSettingsIni: string | null
  /** Active Metro Mod Loader / RTV Mod Manager profile ('' when none) and all known names */
  activeProfile: string
  profiles: string[]
  /** Modded items that got no icon, by reason, with a few examples */
  iconProblems: { reason: string; count: number; examples: string[] }[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Minimal zip reader (central directory + deflate/store). Mods are small and we only
// read a handful of text files, so no dependency is needed.
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  offset: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** Random access to the bytes of an archive (a file on disk or a buffer in memory). */
export interface ByteSource {
  length: number
  read(offset: number, len: number): Promise<Buffer>
}

export function bufferSource(buf: Buffer): ByteSource {
  return { length: buf.length, read: async (o, n) => buf.subarray(o, o + n) }
}

/** Reads only what is asked for, so big mods (hundreds of MB of textures) are never loaded whole. */
export async function fileSource(
  path: string
): Promise<{ src: ByteSource; close(): Promise<void> }> {
  const fh = await open(path, 'r')
  const { size } = await fh.stat()
  return {
    src: {
      length: size,
      read: async (offset, len) => {
        const n = Math.max(0, Math.min(len, size - offset))
        const out = Buffer.alloc(n)
        if (n > 0) await fh.read(out, 0, n, offset)
        return out
      }
    },
    close: () => fh.close()
  }
}

type ZipInput = Buffer | ByteSource
const asSource = (b: ZipInput): ByteSource => (Buffer.isBuffer(b) ? bufferSource(b) : b)

function parseCentral(buf: Buffer, count: number): ZipEntry[] {
  let pos = 0
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE) break
    const flags = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const size = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const offset = buf.readUInt32LE(pos + 42)
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', pos + 46, pos + 46 + nameLen)
    entries.push({ name: name.replace(/\\/g, '/'), method, compressedSize, size, offset })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export async function listZipEntries(input: ZipInput): Promise<ZipEntry[]> {
  const src = asSource(input)
  const tailLen = Math.min(src.length, 0xffff + 22)
  const tail = await src.read(src.length - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const count = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  return parseCentral(await src.read(cdOffset, cdSize), count)
}

export async function readZipEntry(input: ZipInput, entry: ZipEntry): Promise<Buffer> {
  const src = asSource(input)
  const head = await src.read(entry.offset, 30)
  if (head.length < 30 || head.readUInt32LE(0) !== LOCAL_SIGNATURE)
    throw new Error('bad local header')
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const data = await src.read(start, entry.compressedSize)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) return inflateRawAsync(data)
  throw new Error(`unsupported zip method ${entry.method}`)
}

// ---------------------------------------------------------------------------
// mod.txt and ItemData .tres
// ---------------------------------------------------------------------------

/** `[mod]` keys of a mod.txt (INI-like; values may be quoted). */
export function parseModTxt(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let section = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = /^\[([^\]]+)\]$/.exec(line)
    if (sec) {
      section = sec[1].toLowerCase()
      continue
    }
    if (section !== 'mod') continue
    const kv = /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      value = value.slice(1, -1)
    out[kv[1].toLowerCase()] = value
  }
  return out
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

export function resourceProps(text: string): Record<string, string> {
  const idx = text.search(/^\[resource\]\s*$/m)
  if (idx < 0) return {}
  const props: Record<string, string> = {}
  for (const line of text.slice(idx).split(/\r?\n/).slice(1)) {
    if (line.startsWith('[')) break
    const m = /^(\w+)\s*=\s*(.+)$/.exec(line)
    if (m) props[m[1]] = m[2].trim()
  }
  return props
}

const unquote = (raw: string | undefined): string =>
  raw && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : (raw ?? '')

/** Reads a .tres and returns the item it describes, or null when it is not an ItemData resource. */
export function parseItemTres(text: string, resourcePath: string, modId: string): ModItem | null {
  const head = text.split('\n', 1)[0]
  if (!/script_class="/.test(head)) return null
  const props = resourceProps(text)
  const name = unquote(props.name)
  const type = unquote(props.type)
  // ItemData always has both; this skips loot tables, audio libraries and other resources.
  if (!name || !type) return null
  const size = /^Vector2\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(props.size ?? '')
  const slots = [...(props.slots ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
  const extPaths = extResourcePaths(text)
  const refPath = (raw: string | undefined): string => {
    const id = /^ExtResource\(\s*"?([^")]+)"?\s*\)$/.exec(raw ?? '')?.[1]
    return (id && extPaths.get(id)) || ''
  }
  const iconPath = refPath(props.icon)
  const subtype = unquote(props.subtype)
  const compatible = [...(props.compatible ?? '').matchAll(/ExtResource\(\s*"?([^")]+)"?\s*\)/g)]
    .map((m) => extPaths.get(m[1]) ?? '')
    .filter((p) => p.endsWith('.tres'))
  const tetrisPath = refPath(props.tetris)
  const file = unquote(props.file) || (resourcePath.split('/').pop() ?? '').replace(/\.tres$/, '')
  const num = (raw: string | undefined): number => {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  return {
    category: TYPE_TO_CATEGORY[type] ?? 'Misc',
    id: file,
    displayName: name || file,
    resourcePath,
    sizeW: size ? Math.max(1, Math.round(parseFloat(size[1]))) : 1,
    sizeH: size ? Math.max(1, Math.round(parseFloat(size[2]))) : 1,
    stackable: props.stackable === 'true',
    showAmount: props.showAmount === 'true',
    defaultAmount: num(props.defaultAmount),
    maxAmount: num(props.maxAmount),
    showCondition: props.showCondition === 'true',
    slots,
    modId,
    iconPath,
    ...(subtype ? { subtype } : {}),
    ...(compatible.length > 0 ? { compatible } : {}),
    ...(tetrisPath ? { tetrisPath } : {})
  }
}

/** `id` -> `path` of every [ext_resource] in a .tres / .tscn */
function extResourcePaths(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(/^\[ext_resource\s+([^\]]*)\]/gm)) {
    const id = /\bid="([^"]+)"/.exec(m[1])?.[1]
    const path = /\bpath="([^"]+)"/.exec(m[1])?.[1]
    if (id && path) out.set(id, path)
  }
  return out
}

/**
 * Reads the inventory scene of a weapon (its `tetris` .tscn): the Sprite2D children are the
 * attachments drawn on the icon, with their position and scale. Nodes without a type override
 * an inherited node; only their visibility matters here.
 */
export function parseTetrisScene(text: string): ModLayout | null {
  const ext = extResourcePaths(text)
  const blocks = text.split(/^(?=\[node )/m).filter((b) => b.startsWith('[node '))
  if (blocks.length === 0) return null
  let base = ''
  const overlays: ModLayoutOverlay[] = []
  const hidden: string[] = []
  const vec = (raw: string | undefined): [number, number] | null => {
    const m = /^Vector2\(\s*(-?[\d.e+-]+)\s*,\s*(-?[\d.e+-]+)\s*\)$/.exec((raw ?? '').trim())
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null
  }
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const head = lines[0]
    const name = /\bname="([^"]+)"/.exec(head)?.[1]
    const parent = /\bparent="([^"]*)"/.exec(head)?.[1]
    if (!name) continue
    const props: Record<string, string> = {}
    for (const line of lines.slice(1)) {
      const eq = line.indexOf('=')
      if (eq > 0) props[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    if (parent === undefined) {
      const inst = /\binstance=ExtResource\(\s*"?([^")]+)"?\s*\)/.exec(head)?.[1]
      base = (inst && ext.get(inst)) || ''
      continue
    }
    if (parent !== '.') continue
    const isNew = /\btype="/.test(head) || /\binstance=/.test(head)
    if (props.visible === 'false' && !isNew) hidden.push(name)
    const position = vec(props.position)
    const texId = /^ExtResource\(\s*"?([^")]+)"?\s*\)$/.exec(props.texture ?? '')?.[1]
    const texture = texId ? ext.get(texId) : undefined
    if (!position) {
      // A Sprite2D left at the origin sits in the middle of the icon (G28-style full-size layers);
      // its size is the texture's own, times the node's scale
      if (/\btype="Sprite2D"/.test(head) && texture) {
        const scale = vec(props.scale)
        overlays.push({
          name,
          position: vec(props.offset) ?? [0, 0],
          scale: scale ? scale[0] : 1,
          behind: props.show_behind_parent === 'true',
          texture
        })
      }
      continue
    }
    const scale = vec(props.scale)
    // A built-in attachment tile dropped in without a scale keeps the 0.5 its own scene uses
    // (the same value the built-in weapons' layouts carry); drawn at 1 it came out twice as big
    const instId = /\binstance=ExtResource\(\s*"?([^")]+)"?\s*\)/.exec(head)?.[1]
    const instPath = instId ? ext.get(instId) : undefined
    const defaultScale = instPath?.startsWith('res://Items/Attachments/') ? 0.5 : 1
    overlays.push({
      name,
      position,
      scale: scale ? scale[0] : defaultScale,
      behind: props.show_behind_parent === 'true',
      ...(texture ? { texture } : {})
    })
  }
  return { base, overlays, hidden }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const MOD_EXTENSIONS = new Set(['.vmz', '.zip'])
const MAX_TRES_BYTES = 2 * 1024 * 1024
/** Binary item resources (.res) are small; the big ones are icons, meshes and animations */
const MAX_RES_ITEM_BYTES = 256 * 1024

/** Receives an icon found inside a mod; returns true when it was stored under `key`. */
/** true when stored, otherwise the reason it could not be */
export type IconSink = (key: string, ext: string, data: Buffer) => Promise<true | string>

const safeKey = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80)

async function extractItemIcon(
  buf: ZipInput,
  entries: ZipEntry[],
  item: ModItem,
  sink: IconSink
): Promise<void> {
  if (!item.iconPath) {
    // No icon property (some mods load it from a script): look for an icon file next to the item
    const dir = item.resourcePath
      .replace(/^res:\/\//, '')
      .replace(/[^/]*$/, '')
      .toLowerCase()
    const near = entries.filter((e) => {
      const n = e.name.toLowerCase()
      const file = n.split('/').pop() ?? ''
      return n.startsWith(dir) && /^icon[^/]*\.(png|webp|jpe?g|res)$/.test(file)
    })
    const pick =
      near.length === 1
        ? near[0]
        : near.filter((e) => e.name.toLowerCase().includes(item.id.toLowerCase())).at(0)
    if (!pick || !dir) {
      item.iconProblem = 'item has no icon property'
      return
    }
    item.iconPath = 'res://' + pick.name
  }
  const r = await extractIconPath(buf, entries, item.iconPath, item.modId, sink)
  if ('key' in r) item.iconFile = r.key
  else item.iconProblem = r.problem
}

/** Finds the image a `res://` path names inside the archive and hands it to the sink. */
async function extractIconPath(
  buf: ZipInput,
  entries: ZipEntry[],
  iconPath: string,
  modId: string,
  sink: IconSink
): Promise<{ key: string } | { problem: string }> {
  const want = iconPath.replace(/^res:\/\//, '').toLowerCase()
  const find = (name: string): ZipEntry | undefined =>
    entries.find((e) => e.name.toLowerCase() === name)
  const stem = (iconPath.split('/').pop() ?? 'icon').replace(/\.[^.]+$/, '')
  // The folder is part of the key: many mods name every icon `Icon.res`
  const key = `mod_${safeKey(modId)}_${safeKey(stem)}_${createHash('md5').update(want).digest('hex').slice(0, 8)}`
  const done = (r: true | string): { key: string } | { problem: string } =>
    r === true ? { key } : { problem: r }
  // Some archives keep the file under another folder than the one the item names; fall back to
  // the file name when it is unique inside the archive.
  const baseName = want.split('/').pop() ?? want
  const sameName = entries.filter((e) => e.name.toLowerCase().split('/').pop() === baseName)
  // Still nothing: an image whose name carries the item's name (`G28_Scope` -> `Icon_G28_Scope.png`)
  const wantStem = baseName.replace(/\.[^.]+$/, '')
  const similar =
    wantStem.length >= 4
      ? entries.filter((e) => {
          const n = e.name.toLowerCase()
          const file = n.split('/').pop() ?? ''
          return (
            /\.(png|webp|jpe?g|res)$/.test(file) &&
            file.replace(/\.[^.]+$/, '').includes(wantStem) &&
            !/reticle|normal|albedo|rough|metal/.test(file)
          )
        })
      : []
  const direct =
    find(want) ??
    (sameName.length === 1 ? sameName[0] : undefined) ??
    (similar.length === 1 ? similar[0] : undefined)
  const ext = (direct ? direct.name.toLowerCase() : want).split('.').pop() ?? ''
  if (
    direct &&
    direct.size < 16 * 1024 * 1024 &&
    ['png', 'jpg', 'jpeg', 'webp', 'res'].includes(ext)
  ) {
    return done(await sink(key, ext, await readZipEntry(buf, direct)))
  }
  // Imported texture: <icon>.import names the .ctex that holds the pixels
  const imp = find(want + '.import')
  if (imp) {
    const target = /^path(?:\.[a-z0-9]+)?\s*=\s*"res:\/\/([^"]+)"/m.exec(
      (await readZipEntry(buf, imp)).toString('utf8')
    )?.[1]
    const ctex = target ? find(target.toLowerCase()) : undefined
    if (ctex && ctex.size < 16 * 1024 * 1024) {
      return done(await sink(key, 'ctex', await readZipEntry(buf, ctex)))
    }
    return { problem: 'imported texture (.ctex) not in archive' }
  }
  // Last resort: any imported texture that belongs to this image
  const loose = baseName
    ? entries.find((e) => {
        const n = e.name.toLowerCase()
        return n.endsWith('.ctex') && n.includes(baseName)
      })
    : undefined
  if (loose && loose.size < 16 * 1024 * 1024) {
    return done(await sink(key, 'ctex', await readZipEntry(buf, loose)))
  }
  return {
    problem: direct ? `unsupported icon format .${ext}` : 'icon file not found in the mod archive'
  }
}

export async function scanModArchive(
  file: string,
  buf: ZipInput,
  onIcon?: IconSink
): Promise<{ mod: InstalledMod; items: ModItem[] }> {
  const entries = await listZipEntries(buf)
  const manifest = entries.find((e) => e.name.toLowerCase() === 'mod.txt')
  let info: Record<string, string> = {}
  if (manifest) info = parseModTxt((await readZipEntry(buf, manifest)).toString('utf8'))
  const stem = file.replace(/\.[^.]+$/, '')
  const mod: InstalledMod = {
    file,
    id: info.id ?? stem,
    name: info.name ?? stem,
    version: info.version ?? '',
    author: info.author ?? '',
    location: 'mods',
    enabled: null
  }
  const items: ModItem[] = []
  const skipped: string[] = []
  for (const entry of entries) {
    const lower = entry.name.toLowerCase()
    const isTres = lower.endsWith('.tres')
    const isRes = lower.endsWith('.res')
    if (!isTres && !isRes) continue
    if (entry.size > (isTres ? MAX_TRES_BYTES : MAX_RES_ITEM_BYTES)) {
      if (isTres) skipped.push(`${entry.name} (too big)`)
      continue
    }
    try {
      const data = await readZipEntry(buf, entry)
      const item = isTres
        ? parseItemTres(data.toString('utf8'), 'res://' + entry.name, mod.id)
        : itemFromBinary(data, 'res://' + entry.name, mod.id)
      if (item) items.push(item)
    } catch {
      // one unreadable resource must not hide the rest of the mod
      if (isTres) skipped.push(`${entry.name} (unreadable)`)
    }
  }
  for (const item of items) {
    if (item.category !== 'Weapons' || !item.tetrisPath) continue
    try {
      const want = item.tetrisPath.replace(/^res:\/\//, '').toLowerCase()
      const base = want.split('/').pop() ?? want
      const same = entries.filter((e) => e.name.toLowerCase().split('/').pop() === base)
      const hit =
        entries.find((e) => e.name.toLowerCase() === want) ?? (same.length === 1 ? same[0] : null)
      if (!hit || hit.size > MAX_TRES_BYTES) continue
      const layout = parseTetrisScene((await readZipEntry(buf, hit)).toString('utf8'))
      if (layout) item.layout = layout
    } catch {
      // binary scene or unreadable: the weapon just gets no attachment overlays
    }
  }
  if (onIcon) {
    for (const item of items) {
      try {
        await extractItemIcon(buf, entries, item, onIcon)
      } catch {
        // a broken icon must not hide the item
      }
      for (const overlay of item.layout?.overlays ?? []) {
        if (!overlay.texture) continue
        try {
          const r = await extractIconPath(buf, entries, overlay.texture, mod.id, onIcon)
          if ('key' in r) overlay.iconFile = r.key
        } catch {
          // the overlay falls back to the attachment's own icon
        }
      }
    }
  }
  mod.itemCount = items.length
  if (skipped.length > 0) mod.skipped = skipped.slice(0, 8)
  return { mod, items }
}

export interface ScanOptions {
  modsDir: string | null
  /** The game's user:// folder (mod_config.cfg, MCM) */
  userDir: string | null
  /** %APPDATA%/VostokModManager */
  managerDir: string | null
  /** Stores icons found in mods (the main process writes them to the icon cache) */
  onIcon?: IconSink
}

async function scanFolder(
  dir: string,
  location: InstalledMod['location'],
  result: Omit<ModScan, 'modsDir'>,
  onIcon?: IconSink
): Promise<void> {
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names.sort()) {
    if (!MOD_EXTENSIONS.has(extname(name).toLowerCase())) continue
    const full = join(dir, name)
    try {
      const info = await stat(full)
      if (!info.isFile()) continue
      const handle = await fileSource(full)
      let scanned: Awaited<ReturnType<typeof scanModArchive>>
      try {
        scanned = await scanModArchive(name, handle.src, onIcon)
      } finally {
        await handle.close()
      }
      const { mod, items } = scanned
      mod.location = location
      // the same mod can sit in mods/ and mods/Library: keep one entry, prefer mods/
      if (result.mods.some((m) => m.id === mod.id && m.version === mod.version)) continue
      result.mods.push(mod)
      itemsOfMod.set(mod, items)
      result.items.push(...items)
    } catch (e) {
      result.warnings.push(`${name}: ${e instanceof Error ? e.message : 'unreadable'}`)
    }
  }
}

export async function scanMods(opts: ScanOptions): Promise<Omit<ModScan, 'modsDir'>> {
  const result: Omit<ModScan, 'modsDir'> = {
    mods: [],
    items: [],
    gseSettingsIni: null,
    activeProfile: '',
    profiles: [],
    iconProblems: [],
    warnings: []
  }
  if (opts.modsDir) {
    await scanFolder(opts.modsDir, 'mods', result, opts.onIcon)
    await scanFolder(join(opts.modsDir, 'Library'), 'library', result, opts.onIcon)
  }

  const problems = new Map<string, { count: number; examples: string[] }>()
  for (const item of result.items) {
    if (!item.iconProblem) continue
    const entry = problems.get(item.iconProblem) ?? { count: 0, examples: [] }
    entry.count++
    if (entry.examples.length < 4)
      entry.examples.push(
        `${item.modId}: ${item.id}${item.iconPath ? ` (${item.iconPath.replace(/^res:\/\//, '')})` : ''}`
      )
    problems.set(item.iconProblem, entry)
  }
  result.iconProblems = [...problems].map(([reason, v]) => ({ reason, ...v }))

  const state = await readProfileState(opts.userDir, opts.managerDir)
  result.activeProfile = state.active
  result.profiles = state.names
  for (const mod of result.mods) {
    mod.enabled = isModEnabled(mod, state.enabled)
    // Library copies are only loaded when a profile enables them; loose files in mods/ are
    // loaded unless a profile switches them off.
    if (mod.enabled === null && mod.location === 'library' && state.enabled) mod.enabled = false
  }

  // Only what the active profile loads counts: items of switched-off copies (several versions of
  // one mod can sit in the library) are dropped, and of copies sharing an id only one stays.
  const exact = (m: InstalledMod): boolean => {
    const stem = m.file.replace(/\.[^.]+$/, '')
    return [`${m.id}@${m.version}`, m.file, stem].some((k) => state.enabled?.get(k) === true)
  }
  const kept = new Set<InstalledMod>()
  for (const mod of result.mods) {
    if (mod.enabled === false) continue
    const rivals = result.mods.filter((m) => m.id === mod.id && m.enabled !== false)
    if (rivals.length > 1 && state.enabled) {
      const pick = rivals.find(exact) ?? rivals[0]
      if (pick !== mod) {
        mod.enabled = false
        continue
      }
    }
    kept.add(mod)
  }
  if (state.enabled) {
    result.items = result.mods.filter((m) => kept.has(m)).flatMap((m) => itemsOfMod.get(m) ?? [])
  }

  if (opts.userDir) {
    try {
      const gseDir = join(opts.userDir, 'MCM', 'GSE')
      const inis = (await readdir(gseDir)).filter((n) => n.toLowerCase().endsWith('.ini'))
      let chosen: string | undefined = inis.find(
        (n) => n.toLowerCase() === mcmIniName(state.active).toLowerCase()
      )
      if (!chosen && !state.active) {
        // no profile information: fall back to the most recently saved settings
        const timed = await Promise.all(
          inis.map(async (n) => ({ n, t: (await stat(join(gseDir, n))).mtimeMs }))
        )
        timed.sort((a, b) => b.t - a.t)
        chosen = timed[0]?.n
      }
      if (chosen) result.gseSettingsIni = await readFile(join(gseDir, chosen), 'utf8')
    } catch {
      // GSE never saved settings: its defaults apply
    }
  }
  return result
}

/** An item stored as a binary resource (`.res`); null for every other kind of resource */
function itemFromBinary(data: Buffer, resourcePath: string, modId: string): ModItem | null {
  const res = parseRsrc(data)
  if (!res) return null
  const item = itemFromRsrc(res, resourcePath)
  if (!item) return null
  const refs = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.flatMap((x) =>
          x && typeof x === 'object' && 'ref' in x && typeof x.ref === 'string' ? [x.ref] : []
        )
      : []
  const ref = (v: unknown): string => refs([v])[0] ?? ''
  const subtype = res.props.get('subtype')
  const compatible = refs(res.props.get('compatible')).filter((p) => p.endsWith('.tres'))
  const tetris = ref(res.props.get('tetris'))
  const { parsed: _parsed, ...rest } = item
  void _parsed
  return {
    ...rest,
    modId,
    ...(typeof subtype === 'string' && subtype ? { subtype } : {}),
    ...(compatible.length > 0 ? { compatible } : {}),
    ...(tetris ? { tetrisPath: tetris } : {})
  }
}
