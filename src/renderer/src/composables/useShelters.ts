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
    // Every save file that is a ShelterSave, so shelters added by game updates show up too
    const files = (await window.api.listSaves())
      .map((s) => s.fileName)
      .filter((n) => !/^(Character|World|Traders)\.tres$/i.test(n))
    const known = new Map<string, string>(SAFEHOUSES.map((h) => [h.fileName, h.name]))
    const out: ShelterView[] = []
    for (const fileName of files) {
      try {
        const tres = parseTresFile(await window.api.loadSave(fileName))
        if (tres.header.scriptClass !== 'ShelterSave') continue
        const parsed = parseShelter(tres)
        out.push({
          name: known.get(fileName) ?? fileName.replace(/\.tres$/i, '').replace(/_/g, ' '),
          fileName,
          furniture: parsed.furnitures.map((f) => ({
            id: f.id,
            name: f.name,
            itemData: f.itemData,
            storage: f.storage
          })),
          loose: parseShelterLooseItems(tres)
        })
      } catch {
        // a file that does not read is left out, the others still show
      }
    }
    // The known shelters first, in the game's order
    const order = [...known.keys()]
    out.sort((a, b) => {
      const ia = order.indexOf(a.fileName)
      const ib = order.indexOf(b.fileName)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name)
    })
    shelters.value = out
  } catch (e) {
    sheltersError.value = e instanceof Error ? e.message : 'Could not read the shelters'
  } finally {
    sheltersLoading.value = false
  }
}
