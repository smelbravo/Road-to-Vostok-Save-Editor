import { computed, ref } from 'vue'

/** Save-slot mods (Save Slots / Multi Save Slots Reborn) and which slot the editor works on. */
export const sourceInfo = ref<SourceInfo | null>(null)

export const hasSlots = computed(() => sourceInfo.value?.slotsAvailable === true)

export async function refreshSourceInfo(): Promise<void> {
  try {
    sourceInfo.value = await window.api.getSourceInfo()
  } catch {
    sourceInfo.value = null
  }
}

export async function chooseSource(source: SaveSource): Promise<void> {
  sourceInfo.value = await window.api.setSaveSource(source)
}

export function slotLabel(s: SlotInfo): string {
  const name = s.displayName ? ` - ${s.displayName}` : ''
  const state = s.occupied ? '' : ' (empty)'
  const active = s.active ? ' [active in game]' : ''
  const dead = s.dead ? ' (dead)' : ''
  return `Slot ${s.slot}${name}${dead}${state}${active}`
}
