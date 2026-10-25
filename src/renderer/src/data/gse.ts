/**
 * Gear Storage Expansion (GSE) knowledge, mirrored from the mod's Config.gd (v1.1.x).
 *
 * GSE keeps what you store in worn (or carried) gear inside the item itself:
 * `SlotData.storage` is an array of SlotData whose `slot` is the key of the grid or
 * single-item box it sits in ("main", "gun1", "mag2", "med", ...) and whose
 * `gridPosition` is in 64 px cells. Nothing here is required to read or write those
 * entries — the editor always shows the real contents — but the layout tables let it
 * draw the same boxes the mod draws, with captions, even for empty slots.
 */

/** Single-item box kinds, in the order the mod lays them out. */
export const BOX_KINDS = [
  'weapon',
  'pistol',
  'magazine_long',
  'magazine_pistol',
  'magazine',
  'ammo',
  'sleep',
  'mess',
  'water',
  'carrier',
  'medical'
] as const
export type BoxKind = (typeof BOX_KINDS)[number]
export type GridKind = 'any' | BoxKind

/** SlotData.slot key base per box kind (BOX_KEYS in Config.gd). */
const BOX_KEY_BASE: Record<BoxKind, string> = {
  weapon: 'gun',
  pistol: 'holster',
  magazine_long: 'mag',
  magazine_pistol: 'pmag',
  magazine: 'anymag',
  ammo: 'ammo',
  medical: 'med',
  sleep: 'sleep',
  mess: 'mess',
  water: 'water',
  carrier: 'carrier'
}
/** Kinds whose first box already carries a number ("gun1", "mag1"). */
const NUMBERED_KINDS: BoxKind[] = ['weapon', 'magazine_long', 'magazine_pistol', 'magazine']

export const BOX_CAPTIONS: Record<BoxKind, string> = {
  weapon: 'Gun',
  pistol: 'Holster',
  magazine_long: 'Rifle mag',
  magazine_pistol: 'Pistol mag',
  magazine: 'Mag',
  ammo: 'Ammo',
  medical: 'Medical',
  sleep: 'Sleeping bag',
  mess: 'Mess kit',
  water: 'Water',
  carrier: 'Plate carrier'
}

const BOX_TIPS: Record<BoxKind, string> = {
  weapon: 'Any weapon',
  pistol: 'Pistols',
  magazine_long: 'Rifle and SMG magazines',
  magazine_pistol: 'Pistol magazines',
  magazine: 'Any magazine',
  ammo: 'Ammunition',
  medical: 'Medical items',
  sleep: 'Sleeping bag',
  mess: 'Mess kit',
  water: 'Water bottle or energy drink',
  carrier: 'Plate carrier or rig'
}

/** ItemData.file -> storage family (FAMILY_FILES in Config.gd). */
export const GSE_FAMILY_FILES: Record<string, string> = {
  Backpack_Jaeger_Black: 'jaeger',
  Backpack_Jaeger_Brown: 'jaeger',
  Backpack_Jaeger_Green: 'jaeger',
  Backpack_Jaeger_M05: 'jaeger',
  Backpack_Patrol: 'patrol',
  Backpack_Kantamus: 'kantamus',
  Duffel_Retro: 'duffel',
  Backpack_Nomad: 'nomad',
  Hoodie_Border_Zone: 'hoodie',
  Fleece_Tactical_Brown: 'fleece',
  Fleece_Tactical_Green: 'fleece',
  Pants_Hiking: 'legs',
  Jeans_Black: 'legs',
  Kukkaro_Black: 'belt',
  Kukkaro_Brown: 'belt',
  Kukkaro_Green: 'belt',
  Kukkaro_M05: 'belt',
  Boots_Combat: 'boots',
  Vest_Fishing: 'rig',
  K19: 'rig',
  LVPC_Green: 'rig',
  LVPC_M05: 'rig',
  LVPC_Winter: 'rig'
}

/** Equipment slot -> family used by the mod for gear it does not know by file name. */
const SLOT_FALLBACK_FAMILY: Record<string, string> = {
  Backpack: 'jaeger',
  Rig: 'rig',
  Torso: 'torso',
  Legs: 'legs',
  Belt: 'belt'
}

interface FamilyLayout {
  openCount: number
  openSize: [number, number]
  boxes: Partial<Record<BoxKind, number>>
}

const FAMILY_DEFAULTS: Record<string, FamilyLayout> = {
  jaeger: {
    openCount: 1,
    openSize: [3, 5],
    boxes: { weapon: 1, sleep: 1, mess: 1, water: 1, medical: 1 }
  },
  patrol: {
    openCount: 1,
    openSize: [4, 5],
    boxes: { weapon: 2, sleep: 1, mess: 1, water: 1, carrier: 1, medical: 1 }
  },
  kantamus: {
    openCount: 1,
    openSize: [4, 8],
    boxes: { weapon: 2, sleep: 1, mess: 1, water: 1, carrier: 1, medical: 1 }
  },
  duffel: { openCount: 1, openSize: [3, 3], boxes: { sleep: 1, mess: 1, water: 1, medical: 1 } },
  nomad: { openCount: 1, openSize: [3, 4], boxes: { sleep: 1, mess: 1, water: 1, medical: 1 } },
  torso: { openCount: 1, openSize: [1, 2], boxes: {} },
  hoodie: { openCount: 1, openSize: [3, 2], boxes: {} },
  fleece: { openCount: 2, openSize: [1, 2], boxes: {} },
  legs: { openCount: 2, openSize: [1, 2], boxes: {} },
  belt: { openCount: 1, openSize: [4, 1], boxes: {} },
  boots: { openCount: 0, openSize: [1, 2], boxes: { pistol: 1 } },
  riga: { openCount: 2, openSize: [2, 2], boxes: {} },
  rigb: {
    openCount: 0,
    openSize: [1, 2],
    boxes: { magazine_long: 4, magazine_pistol: 2, ammo: 2, medical: 2, pistol: 1 }
  },
  rigc: { openCount: 0, openSize: [1, 2], boxes: { magazine: 4, ammo: 1, medical: 1, pistol: 1 } },
  rigd: { openCount: 1, openSize: [1, 2], boxes: { magazine: 2, medical: 2 } }
}

const RIG_LAYOUTS = ['a', 'b', 'c', 'd']
const DEFAULT_RIG_LAYOUT = 'b'

/** Settings the player changed in MCM (user://MCM/GSE/config.ini), keyed by value id. */
export interface GseSettings {
  /** value id ("jaeger_open_count", "patrol_box_weapon", "rigsel2_K19", "gs_size_preset") -> value */
  values: Record<string, number | string | [number, number]>
}

export interface GridSpec {
  /** SlotData.slot key */
  key: string
  kind: GridKind
  /** Size in cells (open grids) or 1x1 for boxes */
  w: number
  h: number
  caption: string
  tip: string
  /** False when the layout was inferred from the stored data only (unknown or modded gear). */
  known: boolean
}

export function fileOfPath(itemPath: string): string {
  return (itemPath.split('/').pop() ?? '').replace(/\.tres$/, '')
}

/** Storage family of an item, mirroring Config.family_of. '' = the mod gives it no storage. */
export function gseFamilyOf(itemPath: string, equipSlot = '', slotsOfItem: string[] = []): string {
  const file = fileOfPath(itemPath)
  const direct = GSE_FAMILY_FILES[file]
  if (direct) return direct
  // Gear from other mods: the closest vanilla family for the slot it fits.
  for (const slot of [equipSlot, ...slotsOfItem]) {
    if (slot && SLOT_FALLBACK_FAMILY[slot]) return SLOT_FALLBACK_FAMILY[slot]
  }
  return ''
}

function layoutFamily(family: string, file: string, settings?: GseSettings): string {
  if (family !== 'rig') return family
  const raw = settings?.values['rigsel2_' + file]
  const choice = typeof raw === 'string' ? raw.toLowerCase() : DEFAULT_RIG_LAYOUT
  return 'rig' + (RIG_LAYOUTS.includes(choice) ? choice : DEFAULT_RIG_LAYOUT)
}

function numbered(base: string, index: number): string {
  return index === 0 ? base : base + String(index + 1)
}

export function boxKey(kind: BoxKind, index: number): string {
  const base = BOX_KEY_BASE[kind]
  return NUMBERED_KINDS.includes(kind) ? base + String(index + 1) : numbered(base, index)
}

function presetSize([w, h]: [number, number], preset: unknown): [number, number] {
  if (preset === 'compact')
    return [Math.max(Math.round(w * 0.75), 1), Math.max(Math.round(h * 0.75), 1)]
  if (preset === 'generous') return [Math.min(w + 1, 8), Math.min(h + 1, 8)]
  return [w, h]
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

/**
 * The grids and boxes the mod builds for an item (Config.layout_for): open grids first,
 * then the boxes in BOX_KINDS order. Empty when the mod would give the item no storage.
 */
export function gseLayoutFor(
  itemPath: string,
  equipSlot = '',
  slotsOfItem: string[] = [],
  settings?: GseSettings
): GridSpec[] {
  const family = gseFamilyOf(itemPath, equipSlot, slotsOfItem)
  if (!family) return []
  const lf = layoutFamily(family, fileOfPath(itemPath), settings)
  const defaults = FAMILY_DEFAULTS[lf]
  if (!defaults) return []
  const vals = settings?.values ?? {}
  const sizeRaw = vals[lf + '_open_size']
  const size = presetSize(
    Array.isArray(sizeRaw) ? [sizeRaw[0], sizeRaw[1]] : defaults.openSize,
    vals['gs_size_preset']
  )
  const out: GridSpec[] = []
  const openCount = asInt(vals[lf + '_open_count'], defaults.openCount)
  for (let i = 0; i < openCount; i++) {
    out.push({
      key: numbered('main', i),
      kind: 'any',
      w: size[0],
      h: size[1],
      caption: openCount > 1 ? `Storage ${i + 1}` : 'Storage',
      tip: 'Any item',
      known: true
    })
  }
  for (const kind of BOX_KINDS) {
    const count = asInt(vals[`${lf}_box_${kind}`], defaults.boxes[kind] ?? 0)
    for (let i = 0; i < count; i++) {
      out.push({
        key: boxKey(kind, i),
        kind,
        w: 1,
        h: 1,
        caption: BOX_CAPTIONS[kind] + (count > 1 ? ` ${i + 1}` : ''),
        tip: BOX_TIPS[kind],
        known: true
      })
    }
  }
  return out
}

/** Work out kind and index from a stored `slot` key ("mag2" -> magazine_long #2). null = not a GSE key. */
export function describeKey(key: string): { kind: GridKind; index: number } | null {
  const open = /^main(\d*)$/.exec(key)
  if (open) return { kind: 'any', index: open[1] ? parseInt(open[1], 10) - 1 : 0 }
  for (const kind of BOX_KINDS) {
    const base = BOX_KEY_BASE[kind]
    const m = new RegExp(`^${base}(\\d*)$`).exec(key)
    if (!m) continue
    const n = m[1] ? parseInt(m[1], 10) : 1
    return { kind, index: Math.max(n - 1, 0) }
  }
  return null
}

/**
 * Specs for every key that appears in the stored data but not in the computed layout
 * (settings changed since the save, gear from another mod, a different GSE version).
 * They are kept, shown and editable instead of being hidden.
 */
export function specsForUnlistedKeys(
  keys: string[],
  known: GridSpec[],
  gridCellsHint: Map<string, [number, number]>
): GridSpec[] {
  const have = new Set(known.map((s) => s.key))
  const out: GridSpec[] = []
  for (const key of keys) {
    if (have.has(key)) continue
    have.add(key)
    const info = describeKey(key)
    const hint = gridCellsHint.get(key) ?? [1, 1]
    if (info && info.kind !== 'any') {
      out.push({
        key,
        kind: info.kind,
        w: 1,
        h: 1,
        caption: BOX_CAPTIONS[info.kind] + ` ${info.index + 1}`,
        tip: BOX_TIPS[info.kind],
        known: false
      })
    } else {
      out.push({
        key,
        kind: 'any',
        w: Math.max(hint[0], 1),
        h: Math.max(hint[1], 1),
        caption: info ? `Storage ${info.index + 1}` : key,
        tip: info ? 'Any item' : 'Slot added by another mod',
        known: info !== null
      })
    }
  }
  return out
}

/**
 * Parse the MCM file GSE saves its settings to (ConfigFile text: `[section]` then
 * `id={ "value": 3, ... }`). Best effort: anything that does not parse is simply left at
 * the defaults, which only affects how many empty boxes are drawn.
 */
export function parseGseSettings(ini: string): GseSettings {
  const values: GseSettings['values'] = {}
  for (const line of ini.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)\s*=\s*(\{.*\})\s*$/.exec(line.trim())
    if (!m) continue
    const id = m[1]
    const body = m[2]
    const v =
      /"value"\s*:\s*(Vector2i?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)|"((?:[^"\\]|\\.)*)"|-?\d+(?:\.\d+)?|true|false)/.exec(
        body
      )
    if (!v) continue
    if (v[2] !== undefined && v[3] !== undefined) values[id] = [parseFloat(v[2]), parseFloat(v[3])]
    else if (v[4] !== undefined) values[id] = v[4]
    else if (v[1] === 'true' || v[1] === 'false') values[id] = v[1] === 'true' ? 1 : 0
    else values[id] = parseFloat(v[1])
  }
  return { values }
}

// ---------- What a box accepts (BagGrid filters) ----------

export interface ItemFacts {
  path: string
  category: string
  /** Equipment slots from the catalog (["Primary"], ["Secondary"], ...) */
  slots: string[]
  stackable?: boolean
}

function isMagazine(f: ItemFacts): boolean {
  return /magazine|_mag(\b|_)|\bmag\b/i.test(fileOfPath(f.path))
}

function isPistolCaliberHint(f: ItemFacts): boolean {
  return /glock|1911|colt|pistol|makarov|\bmp-?\d|p226|mk23/i.test(fileOfPath(f.path))
}

/**
 * Whether the mod would keep this item in a box of `kind`. Heuristic (the catalog does not carry
 * ItemData.type/subtype) and only used to warn: the mod relocates what it refuses on load.
 */
export function boxAccepts(kind: GridKind, f: ItemFacts): boolean {
  const file = fileOfPath(f.path)
  switch (kind) {
    case 'any':
      return f.category !== 'Backpacks'
    case 'weapon':
      return f.category === 'Weapons' && !isMagazine(f)
    case 'pistol':
      return f.category === 'Weapons' && !isMagazine(f) && f.slots.includes('Secondary')
    case 'magazine':
      return isMagazine(f)
    case 'magazine_pistol':
      return isMagazine(f) && isPistolCaliberHint(f)
    case 'magazine_long':
      return isMagazine(f) && !isPistolCaliberHint(f)
    case 'ammo':
      return f.category === 'Ammo'
    case 'medical':
      return f.category === 'Medical'
    case 'sleep':
      return file === 'Sleeping_Bag'
    case 'mess':
      return file === 'Mess_Kit'
    case 'water':
      return file === 'Water_Bottle' || file === 'Energy_Drink'
    case 'carrier':
      return f.category === 'Rigs'
  }
}

/** Boxes hold exactly one item; open grids hold anything that fits. */
export function isBox(kind: GridKind): boolean {
  return kind !== 'any'
}
