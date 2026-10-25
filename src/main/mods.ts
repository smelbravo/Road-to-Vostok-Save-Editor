import { readdir, readFile, stat } from 'fs/promises'
import { join, extname } from 'path'
import { inflateRaw } from 'zlib'
import { promisify } from 'util'

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
}

export interface ModScan {
  modsDir: string | null
  mods: InstalledMod[]
  items: ModItem[]
  /** Parsed text of user://MCM/GSE/*.ini (newest first) when Gear Storage Expansion saved settings */
  gseSettingsIni: string | null
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

function resourceProps(text: string): Record<string, string> {
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
    modId
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const MOD_EXTENSIONS = new Set(['.vmz', '.zip'])
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_TRES_BYTES = 256 * 1024

export async function scanModArchive(
  file: string,
  buf: Buffer
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
    author: info.author ?? ''
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
  return { mod, items }
}

export async function scanMods(
  modsDir: string | null,
  mcmDir: string | null
): Promise<Omit<ModScan, 'modsDir'>> {
  const result: Omit<ModScan, 'modsDir'> = {
    mods: [],
    items: [],
    gseSettingsIni: null,
    warnings: []
  }
  if (modsDir) {
    let names: string[] = []
    try {
      names = await readdir(modsDir)
    } catch {
      names = []
    }
    for (const name of names.sort()) {
      if (!MOD_EXTENSIONS.has(extname(name).toLowerCase())) continue
      const full = join(modsDir, name)
      try {
        const info = await stat(full)
        if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES) continue
        const { mod, items } = await scanModArchive(name, await readFile(full))
        result.mods.push(mod)
        result.items.push(...items)
      } catch (e) {
        result.warnings.push(`${name}: ${e instanceof Error ? e.message : 'unreadable'}`)
      }
    }
  }
  if (mcmDir) {
    try {
      const gseDir = join(mcmDir, 'GSE')
      const inis = await Promise.all(
        (await readdir(gseDir))
          .filter((n) => n.toLowerCase().endsWith('.ini'))
          .map(async (n) => ({ n, t: (await stat(join(gseDir, n))).mtimeMs }))
      )
      inis.sort((a, b) => b.t - a.t)
      if (inis.length > 0) result.gseSettingsIni = await readFile(join(gseDir, inis[0].n), 'utf8')
    } catch {
      // GSE never saved settings: its defaults apply
    }
  }
  return result
}
