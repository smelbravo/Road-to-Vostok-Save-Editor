import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'fs/promises'
import { join, basename } from 'path'
import { parseIni, iniInt, iniString, iniBool } from './ini'

/**
 * Where the editor reads/writes save files.
 *
 * Without a save-slot mod the saves live directly in `user://` (the "live" folder). The two
 * slot mods (Save Slots by Joni / built into RTV Mod Manager, and Multi Save Slots Reborn)
 * keep copies in `user://MultiSaveSlots/slotN/` and treat the files in the live folder as the
 * working copy of the ACTIVE slot (`state.cfg` -> `[state] active_slot`).
 *
 * So:
 *  - live                  -> the root folder
 *  - the active slot       -> the root folder, and every write is mirrored into slotN so the
 *                             mod's mtime based sync/crash-recovery never sees a stale copy
 *  - any other slot        -> only that slotN folder (the mod copies it in when loaded)
 */

export type SaveSource = { kind: 'live' } | { kind: 'slot'; slot: number }

export interface SlotInfo {
  slot: number
  active: boolean
  occupied: boolean
  displayName: string
  lastMap: string
  lastPlayIso: string
  dead: boolean
  /** Profile name stored by Save Slots (v0.1+), '' otherwise */
  profile: string
}

export interface SourceInfo {
  source: SaveSource
  /** a slot mod's folder exists */
  slotsAvailable: boolean
  activeSlot: number
  slots: SlotInfo[]
  /** folder files are currently read from */
  dir: string
}

export const SLOTS_DIR_NAME = 'MultiSaveSlots'
const OCCUPANCY_MARKER = 'Character.tres'

let rootDir = ''
let current: SaveSource = { kind: 'live' }

export function configureSaveRoot(dir: string): void {
  rootDir = dir
}

export function getRoot(): string {
  if (!rootDir) throw new Error('Save directory not configured')
  return rootDir
}

export function getSource(): SaveSource {
  return current
}

export function slotDir(n: number): string {
  return join(getRoot(), SLOTS_DIR_NAME, `slot${n}`)
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function readActiveSlot(): Promise<number | null> {
  const text = await readText(join(getRoot(), SLOTS_DIR_NAME, 'state.cfg'))
  if (text === null) return null
  const n = iniInt(parseIni(text).get('state')?.get('active_slot'), 0)
  return n >= 1 ? n : null
}

async function listSlotNumbers(): Promise<number[]> {
  try {
    const entries = await readdir(join(getRoot(), SLOTS_DIR_NAME), { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => /^slot(\d+)$/.exec(e.name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function getSourceInfo(): Promise<SourceInfo> {
  const active = await readActiveSlot()
  const numbers = await listSlotNumbers()
  const slotsAvailable = numbers.length > 0 || active !== null
  const all = new Set(numbers)
  if (active !== null) all.add(active)
  const slots: SlotInfo[] = []
  for (const n of [...all].sort((a, b) => a - b)) {
    const dir = slotDir(n)
    const metaText = await readText(join(dir, '_meta.cfg'))
    const meta = metaText ? parseIni(metaText).get('meta') : undefined
    // the active slot's live files are the truth for "has a save"
    const occupied =
      (await exists(join(dir, OCCUPANCY_MARKER))) ||
      (n === active && (await exists(join(getRoot(), OCCUPANCY_MARKER))))
    slots.push({
      slot: n,
      active: n === active,
      occupied,
      displayName: iniString(meta?.get('display_name')),
      lastMap: iniString(meta?.get('last_map')),
      lastPlayIso: iniString(meta?.get('last_play_iso')),
      dead: iniBool(meta?.get('dead')),
      profile: iniString(meta?.get('profile'))
    })
  }
  return { source: current, slotsAvailable, activeSlot: active ?? 0, slots, dir: await readDir() }
}

/** Switches the source. A slot that no longer exists falls back to live. */
export async function setSource(next: SaveSource): Promise<SourceInfo> {
  if (next.kind === 'slot') {
    const wanted = next.slot
    const info = await getSourceInfo()
    if (!info.slots.some((s) => s.slot === wanted)) next = { kind: 'live' }
  }
  current = next
  return getSourceInfo()
}

/** Folder reads/writes go to for the current source. */
export async function readDir(): Promise<string> {
  if (current.kind === 'live') return getRoot()
  const active = await readActiveSlot()
  return active === current.slot ? getRoot() : slotDir(current.slot)
}

/** Extra folder a write must be mirrored to (the active slot's copy), or null. */
async function mirrorDir(): Promise<string | null> {
  if (current.kind !== 'slot') return null
  const active = await readActiveSlot()
  return active === current.slot ? slotDir(current.slot) : null
}

export function validateTresName(fileName: string): void {
  if (fileName !== basename(fileName) || fileName.includes('..') || !fileName.endsWith('.tres')) {
    throw new Error(`Invalid save file name: ${fileName}`)
  }
}

export async function writeSaveFile(fileName: string, content: string): Promise<void> {
  validateTresName(fileName)
  await writeFile(join(await readDir(), fileName), content, 'utf-8')
  const mirror = await mirrorDir()
  if (mirror) {
    await mkdir(mirror, { recursive: true })
    await writeFile(join(mirror, fileName), content, 'utf-8')
  }
}

/** `wx` create; false when the file already exists. */
export async function createSaveFile(fileName: string, content: string): Promise<boolean> {
  validateTresName(fileName)
  try {
    await writeFile(join(await readDir(), fileName), content, { encoding: 'utf-8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  const mirror = await mirrorDir()
  if (mirror) {
    await mkdir(mirror, { recursive: true })
    await writeFile(join(mirror, fileName), content, 'utf-8')
  }
  return true
}

/** Used by restore: copies a file into the source (and its mirror). */
export async function copyIntoSource(from: string, fileName: string): Promise<void> {
  validateTresName(fileName)
  await copyFile(from, join(await readDir(), fileName))
  const mirror = await mirrorDir()
  if (mirror) {
    await mkdir(mirror, { recursive: true })
    await copyFile(from, join(mirror, fileName))
  }
}

/** Short tag used to keep backups of different sources apart ('' for live). */
export function sourceTag(): string {
  return current.kind === 'slot' ? `slot${current.slot}_` : ''
}

export async function removeFromSource(fileName: string): Promise<void> {
  validateTresName(fileName)
  const { rm } = await import('fs/promises')
  await rm(join(await readDir(), fileName), { force: true })
  const mirror = await mirrorDir()
  if (mirror) await rm(join(mirror, fileName), { force: true })
}
