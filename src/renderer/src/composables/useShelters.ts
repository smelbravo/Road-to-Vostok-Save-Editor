import { ref } from 'vue'
import { parseTresFile } from '../lib/tres/parser'
import { parseShelter, parseShelterLooseItems, type ShelterLooseItem } from '../lib/tres/codec'
import type { SlotItemData } from '../lib/tres/codec'
import { SAFEHOUSES } from './useSafehouses'

export interface ShelterFurniture {
  id: string
  name: string
  itemData: string
  storage: SlotItemData[]
}

export interface ShelterView {
  name: string
  fileName: string
  furniture: ShelterFurniture[]
  loose: ShelterLooseItem[]
}

/** What the shelter files of the current save hold (read only). */
export const shelters = ref<ShelterView[]>([])
export const sheltersLoading = ref(false)
export const sheltersError = ref<string | null>(null)

export async function loadShelters(): Promise<void> {
  sheltersLoading.value = true
  sheltersError.value = null
  try {
    const present = new Set((await window.api.listSaves()).map((s) => s.fileName))
    const out: ShelterView[] = []
    for (const house of SAFEHOUSES) {
      if (!present.has(house.fileName)) continue
      try {
        const tres = parseTresFile(await window.api.loadSave(house.fileName))
        const parsed = parseShelter(tres)
        out.push({
          name: house.name,
          fileName: house.fileName,
          furniture: parsed.furnitures.map((f) => ({
            id: f.id,
            name: f.name,
            itemData: f.itemData,
            storage: f.storage
          })),
          loose: parseShelterLooseItems(tres)
        })
      } catch {
        // a shelter file that does not read is left out, the others still show
      }
    }
    shelters.value = out
  } catch (e) {
    sheltersError.value = e instanceof Error ? e.message : 'Could not read the shelters'
  } finally {
    sheltersLoading.value = false
  }
}
