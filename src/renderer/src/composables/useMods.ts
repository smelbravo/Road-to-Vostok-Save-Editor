import { computed, ref } from 'vue'
import { registerModItems } from '../data/mod-items'
import { parseGseSettings, type GseSettings } from '../data/gse'

/** Result of looking at the player's mods folder (empty when the game is not found). */
export const modScan = ref<ModScan | null>(null)
export const modScanError = ref<string | null>(null)

const GSE_ID = 'gse'

export const installedMods = computed<InstalledMod[]>(() => modScan.value?.mods ?? [])

/** Gear Storage Expansion is in the mods folder (the mod.txt id is "gse"). */
export const gseMod = computed<InstalledMod | null>(
  () => installedMods.value.find((m) => m.id.toLowerCase() === GSE_ID) ?? null
)

/** Settings GSE saved through MCM, used to draw the same boxes the mod draws. */
export const gseSettings = computed<GseSettings | undefined>(() => {
  const ini = modScan.value?.gseSettingsIni
  return ini ? parseGseSettings(ini) : undefined
})

/** Scans mods once at startup. A failure only means modded items stay unnamed. */
export async function loadMods(): Promise<void> {
  try {
    const scan = await window.api.scanMods()
    modScan.value = scan
    registerModItems(scan.items)
    modScanError.value = null
  } catch (e) {
    modScanError.value = e instanceof Error ? e.message : 'Could not scan the mods folder'
  }
}
