import { readdir, readFile, stat } from 'fs/promises'
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

export function listZipEntries(buf: Buffer): ZipEntry[] {
  const minEocd = 22
  let eocd = -1
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
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

export async function readZipEntry(buf: Buffer, entry: ZipEntry): Promise<Buffer> {
  if (buf.readUInt32LE(entry.offset) !== LOCAL_SIGNATURE) throw new Error('bad local header')
  const nameLen = buf.readUInt16LE(entry.offset + 26)
  const extraLen = buf.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + entry.compressedSize)
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
  const iconId = /^ExtResource\(\s*"?([^")]+)"?\s*\)$/.exec(props.icon ?? '')?.[1]
  let iconPath = ''
  if (iconId) {
    for (const m of text.matchAll(/^\[ext_resource\s+([^\]]*)\]/gm)) {
      const attrs = m[1]
      if (new RegExp(`\\bid="${iconId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(attrs)) {
        iconPath = /\bpath="([^"]+)"/.exec(attrs)?.[1] ?? ''
        break
      }
    }
  }
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
    iconPath
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const MOD_EXTENSIONS = new Set(['.vmz', '.zip'])
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_TRES_BYTES = 256 * 1024

/** Receives an icon found inside a mod; returns true when it was stored under `key`. */
/** true when stored, otherwise the reason it could not be */
export type IconSink = (key: string, ext: string, data: Buffer) => Promise<true | string>

const safeKey = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80)

async function extractItemIcon(
  buf: Buffer,
  entries: ZipEntry[],
  item: ModItem,
  sink: IconSink
): Promise<void> {
  if (!item.iconPath) {
    item.iconProblem = 'item has no icon property'
    return
  }
  const want = item.iconPath.replace(/^res:\/\//, '').toLowerCase()
  const find = (name: string): ZipEntry | undefined =>
    entries.find((e) => e.name.toLowerCase() === name)
  const stem = (item.iconPath.split('/').pop() ?? 'icon').replace(/\.[^.]+$/, '')
  const key = `mod_${safeKey(item.modId)}_${safeKey(stem)}`
  const done = (r: true | string): void => {
    if (r === true) item.iconFile = key
    else item.iconProblem = r
  }
  const direct = find(want)
  const ext = want.split('.').pop() ?? ''
  if (direct && direct.size < 16 * 1024 * 1024 && ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    done(await sink(key, ext, await readZipEntry(buf, direct)))
    return
  }
  // Imported texture: <icon>.import names the .ctex that holds the pixels
  const imp = find(want + '.import')
  if (imp) {
    const target = /^path(?:\.[a-z0-9]+)?\s*=\s*"res:\/\/([^"]+)"/m.exec(
      (await readZipEntry(buf, imp)).toString('utf8')
    )?.[1]
    const ctex = target ? find(target.toLowerCase()) : undefined
    if (ctex && ctex.size < 16 * 1024 * 1024) {
      done(await sink(key, 'ctex', await readZipEntry(buf, ctex)))
      return
    }
    item.iconProblem = 'imported texture (.ctex) not in archive'
    return
  }
  // Last resort: any imported texture that belongs to this image
  const base = (item.iconPath.split('/').pop() ?? '').toLowerCase()
  const loose = base
    ? entries.find((e) => {
        const n = e.name.toLowerCase()
        return n.endsWith('.ctex') && n.includes(base)
      })
    : undefined
  if (loose && loose.size < 16 * 1024 * 1024) {
    done(await sink(key, 'ctex', await readZipEntry(buf, loose)))
    return
  }
  item.iconProblem = direct
    ? `unsupported icon format .${ext}`
    : 'icon file not found in the mod archive'
}

export async function scanModArchive(
  file: string,
  buf: Buffer,
  onIcon?: IconSink
): Promise<{ mod: InstalledMod; items: ModItem[] }> {
  const entries = listZipEntries(buf)
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
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.tres') || entry.size > MAX_TRES_BYTES) continue
    try {
      const text = (await readZipEntry(buf, entry)).toString('utf8')
      const item = parseItemTres(text, 'res://' + entry.name, mod.id)
      if (item) items.push(item)
    } catch {
      // one unreadable resource must not hide the rest of the mod
    }
  }
  if (onIcon) {
    for (const item of items) {
      try {
        await extractItemIcon(buf, entries, item, onIcon)
      } catch {
        // a broken icon must not hide the item
      }
    }
  }
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
      if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES) continue
      const { mod, items } = await scanModArchive(name, await readFile(full), onIcon)
      mod.location = location
      // the same mod can sit in mods/ and mods/Library: keep one entry, prefer mods/
      if (result.mods.some((m) => m.id === mod.id && m.version === mod.version)) continue
      result.mods.push(mod)
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
    if (entry.examples.length < 4) entry.examples.push(`${item.modId}: ${item.id}`)
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
