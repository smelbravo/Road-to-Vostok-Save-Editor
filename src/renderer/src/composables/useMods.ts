import { computed, ref } from 'vue'
import { forgetMissingIcons } from './useItemIcons'
import { registerModItems } from '../data/mod-items'
import { ITEMS_BY_PATH } from '../data/items'
import { parseGseSettings, type GseSettings } from '../data/gse'

/** Result of looking at the player's mods folder (empty when the game is not found). */
export const modScan = ref<ModScan | null>(null)
export const modScanError = ref<string | null>(null)
export const modScanning = ref(false)

const GSE_ID = 'gse'

export const installedMods = computed<InstalledMod[]>(() => modScan.value?.mods ?? [])

/** Gear Storage Expansion is installed (the mod.txt id is "gse"). */
export const gseMod = computed<InstalledMod | null>(
  () => installedMods.value.find((m) => m.id.toLowerCase() === GSE_ID) ?? null
)

/** GSE is installed but the active profile switched it off, so the game will not use it. */
export const gseDisabled = computed(() => gseMod.value?.enabled === false)

/** Settings GSE saved through MCM, used to draw the same boxes the mod draws. */
export const gseSettings = computed<GseSettings | undefined>(() => {
  const ini = modScan.value?.gseSettingsIni
  return ini ? parseGseSettings(ini) : undefined
})

/** Scans mods once at startup. A failure only means modded items stay unnamed. */
export async function loadMods(force = false): Promise<void> {
  modScanning.value = true
  try {
    const scan = await window.api.scanMods(force)
    if (force) forgetMissingIcons()
    modScan.value = scan
    registerModItems(scan.items)
    modScanError.value = null
  } catch (e) {
    modScanError.value = e instanceof Error ? e.message : 'Could not scan the mods folder'
  } finally {
    modScanning.value = false
  }
}

export interface GameCatalogStats {
  found: boolean
  /** Files in RTV.pck and a few sample paths (to diagnose a scan that finds no items) */
  totalFiles: number
  samplePaths: string[]
  scanned: number
  /** Items whose data was read from the resource itself (vs. only their path) */
  parsed: number
  /** Vanilla items the reader could be checked against the built-in catalog */
  checked: number
  matched: number
  /** Items added to the catalog that the built-in list did not know */
  added: number
  /** The reader agreed with the built-in catalog, so its data is used */
  trusted: boolean
  /** Built-in items whose icon file name was updated from the game files */
  iconsFixed: number
  warnings: string[]
}

export const gameCatalog = ref<GameCatalogStats | null>(null)

/**
 * Reads the game's own item resources and adds the ones the built-in catalog lacks (items from
 * game updates). The binary reader is checked against the built-in catalog first: if it does
 * not reproduce known items, only path-derived entries (id + category) are used.
 */
export async function loadGameItems(): Promise<void> {
  try {
    const cat = await window.api.scanGameItems()
    let checked = 0
    let matched = 0
    for (const it of cat.items) {
      const known = ITEMS_BY_PATH.get(it.resourcePath)
      if (!known || !it.parsed) continue
      checked++
      if (
        known.displayName === it.displayName &&
        (known.sizeW ?? 1) === it.sizeW &&
        (known.sizeH ?? 1) === it.sizeH
      ) {
        matched++
      }
    }
    // Build 2 re-imported some textures, which changes the hash in the icon file name. The
    // game files are the truth, so existing entries get the icon file the game really has.
    let iconsFixed = 0
    for (const it of cat.items) {
      const known = ITEMS_BY_PATH.get(it.resourcePath)
      if (known && it.iconFile && known.iconFile !== it.iconFile) {
        known.iconFile = it.iconFile
        iconsFixed++
      }
    }
    const parsed = cat.items.filter((i) => i.parsed).length
    const trusted = parsed === 0 || (checked >= 5 && matched / checked >= 0.9)
    const fresh = cat.items
      .filter((i) => !ITEMS_BY_PATH.has(i.resourcePath))
      .map((i) =>
        trusted || !i.parsed
          ? i
          : { ...i, displayName: i.id.replace(/_/g, ' '), sizeW: 1, sizeH: 1, parsed: false }
      )
    registerModItems(fresh, true)
    gameCatalog.value = {
      found: cat.pckPath !== null,
      totalFiles: cat.totalFiles,
      samplePaths: cat.samplePaths,
      scanned: cat.scanned,
      parsed,
      checked,
      matched,
      added: fresh.length,
      trusted,
      iconsFixed,
      warnings: cat.warnings
    }
  } catch (e) {
    gameCatalog.value = {
      found: false,
      totalFiles: 0,
      samplePaths: [],
      scanned: 0,
      parsed: 0,
      checked: 0,
      matched: 0,
      added: 0,
      trusted: false,
      iconsFixed: 0,
      warnings: [e instanceof Error ? e.message : 'Could not read the game files']
    }
  }
}
