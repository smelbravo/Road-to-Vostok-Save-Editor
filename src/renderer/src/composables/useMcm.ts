import { computed, ref } from 'vue'
import { categoriesOf, parseMcm, settingsOf, withValue, type McmSetting } from '../data/mcm'

/** Mod Configuration Menu files found in user://MCM, and the edits made to them here. */
export const mcmDir = ref('')
export const mcmMods = ref<{ modId: string; files: { name: string; text: string }[] }[]>([])
export const mcmLoading = ref(false)
export const mcmError = ref<string | null>(null)

/** Edited text by `<mod>/<file>`; a file is dirty while it differs from what was read */
const edited = ref<Record<string, string>>({})

export const keyOf = (modId: string, file: string): string => `${modId}/${file}`

export async function loadMcm(): Promise<void> {
  mcmLoading.value = true
  mcmError.value = null
  try {
    const res = await window.api.listMcm()
    mcmDir.value = res.dir
    mcmMods.value = res.mods
    edited.value = {}
  } catch (e) {
    mcmError.value = e instanceof Error ? e.message : 'Could not read the MCM folder'
  } finally {
    mcmLoading.value = false
  }
}

export function textOf(modId: string, file: string): string {
  const key = keyOf(modId, file)
  if (key in edited.value) return edited.value[key]
  return mcmMods.value.find((m) => m.modId === modId)?.files.find((f) => f.name === file)?.text ?? ''
}

export function isDirty(modId: string, file: string): boolean {
  return keyOf(modId, file) in edited.value
}

export const dirtyCount = computed(() => Object.keys(edited.value).length)

export interface McmGroup {
  name: string
  settings: McmSetting[]
}

/** Settings of a file, grouped like the in-game menu (category header order, then position, then name) */
export function groupsOf(modId: string, file: string): McmGroup[] {
  const entries = parseMcm(textOf(modId, file))
  const categories = categoriesOf(entries)
  const byCategory = new Map<string, McmSetting[]>()
  for (const s of settingsOf(entries)) {
    const list = byCategory.get(s.category) ?? []
    list.push(s)
    byCategory.set(s.category, list)
  }
  const order = (cat: string): number => (cat ? (categories.get(cat)?.pos ?? 1000) : -1)
  return [...byCategory]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([cat, settings]) => ({
      name: cat ? (categories.get(cat)?.name ?? cat) : '',
      settings: settings.sort(
        (a, b) => (a.menuPos || 1000) - (b.menuPos || 1000) || a.name.localeCompare(b.name)
      )
    }))
}

/** Sets one value (given in Godot syntax). Returns false when the setting could not be found. */
export function setValue(modId: string, file: string, id: string, valueText: string): boolean {
  const text = textOf(modId, file)
  const hit = settingsOf(parseMcm(text)).find((s) => s.id === id)
  if (!hit) return false
  const next = withValue(text, hit.entry.start, valueText)
  if (next === null) return false
  const original = mcmMods.value.find((m) => m.modId === modId)?.files.find((f) => f.name === file)
  const key = keyOf(modId, file)
  if (original && next === original.text) {
    const rest = { ...edited.value }
    delete rest[key]
    edited.value = rest
  } else {
    edited.value = { ...edited.value, [key]: next }
  }
  return true
}

export function revert(modId: string, file: string): void {
  const rest = { ...edited.value }
  delete rest[keyOf(modId, file)]
  edited.value = rest
}

export async function saveFile(modId: string, file: string): Promise<void> {
  const text = textOf(modId, file)
  await window.api.saveMcm(modId, file, text)
  const mod = mcmMods.value.find((m) => m.modId === modId)
  const f = mod?.files.find((x) => x.name === file)
  if (f) f.text = text
  revert(modId, file)
}
