import { computed, ref } from 'vue'
import { parseTresFile } from '../lib/tres/parser'
import {
  parseShelter,
  parseShelterLooseItems,
  serializeShelter,
  type ShelterLooseItem,
  type ShelterResource
} from '../lib/tres/codec'
import type { SlotItemData } from '../lib/tres/codec'
import type { TresFile } from '../lib/tres/types'
import { serializeTresFile } from '../lib/tres/serializer'
import { ITEMS_BY_PATH, ITEMS_META, getItemSize } from '../data/items'
import { freshSlotItem } from './saveEditorState'
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
  /** Parsed file and its data, kept to write edits back */
  tres: TresFile
  data: ShelterResource
  dirty: boolean
}

/** What the shelter files of the current save hold (read only). */
export const shelters = ref<ShelterView[]>([])
export const sheltersLoading = ref(false)
export const sheltersError = ref<string | null>(null)

/** Edit mode of the Shelter tab. Nothing is written until the edits are saved. */
export const shelterEditing = ref(false)
export const sheltersDirty = computed(() => shelters.value.some((s) => s.dirty))

const CELL = 64

function viewOf(fileName: string): ShelterView | undefined {
  return shelters.value.find((s) => s.fileName === fileName)
}

function storageOf(fileName: string, furnitureId: string): SlotItemData[] | null {
  return viewOf(fileName)?.data.furnitures.find((f) => f.id === furnitureId)?.storage ?? null
}

export function updateShelterItem(
  fileName: string,
  item: SlotItemData,
  updates: { condition?: number; amount?: number }
): void {
  if (updates.condition !== undefined) item.condition = updates.condition
  if (updates.amount !== undefined) item.amount = updates.amount
  const view = viewOf(fileName)
  if (view) view.dirty = true
}

export function removeShelterItem(fileName: string, furnitureId: string, itemId: string): void {
  const storage = storageOf(fileName, furnitureId)
  const view = viewOf(fileName)
  if (!storage || !view) return
  const at = storage.findIndex((i) => i.id === itemId)
  if (at < 0) return
  storage.splice(at, 1)
  view.dirty = true
}

function firstFree(
  storage: SlotItemData[],
  grid: { w: number; h: number },
  itemPath: string
): { col: number; row: number; rotated: boolean } | null {
  const taken = new Set<string>()
  for (const s of storage) {
    const meta = ITEMS_BY_PATH.get(s.itemData)
    const base = meta ? getItemSize(meta) : { w: 1, h: 1 }
    const w = s.gridRotated ? base.h : base.w
    const h = s.gridRotated ? base.w : base.h
    const c0 = Math.round(s.gridPosition.x / CELL)
    const r0 = Math.round(s.gridPosition.y / CELL)
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) taken.add(`${c},${r}`)
  }
  const meta = ITEMS_BY_PATH.get(itemPath)
  const base = meta ? getItemSize(meta) : { w: 1, h: 1 }
  const fits = (col: number, row: number, w: number, h: number): boolean => {
    if (col + w > grid.w || row + h > grid.h) return false
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++) if (taken.has(`${c},${r}`)) return false
    return true
  }
  for (const rotated of base.w === base.h ? [false] : [false, true]) {
    const w = rotated ? base.h : base.w
    const h = rotated ? base.w : base.h
    for (let row = 0; row < grid.h; row++)
      for (let col = 0; col < grid.w; col++) if (fits(col, row, w, h)) return { col, row, rotated }
  }
  return null
}

/** Puts a new item into a container of a shelter; returns an error text when it does not fit. */
export function addShelterItem(
  fileName: string,
  furnitureId: string,
  itemPath: string,
  opts: { amount?: number } = {}
): string | null {
  const view = viewOf(fileName)
  const furniture = view?.data.furnitures.find((f) => f.id === furnitureId)
  if (!view || !furniture) return 'That container is no longer in the file.'
  const size = ITEMS_BY_PATH.get(furniture.itemData)?.containerSize
  if (!size) return 'The size of this container is unknown, so a free spot cannot be chosen.'
  const spot = firstFree(furniture.storage, size, itemPath)
  if (!spot) return 'No room left in this container.'
  const meta = ITEMS_META.get(itemPath)
  furniture.storage.push(
    freshSlotItem(itemPath, {
      amount: opts.amount ?? meta?.defaultAmount,
      gridCol: spot.col,
      gridRow: spot.row,
      gridRotated: spot.rotated,
      idSource: view.tres
    })
  )
  view.dirty = true
  return null
}

/** Writes every edited shelter file (after a backup of the save). */
export async function saveShelterEdits(): Promise<number> {
  let written = 0
  if (sheltersDirty.value) await window.api.backupSave()
  for (const view of shelters.value) {
    if (!view.dirty) continue
    const out = serializeShelter(view.data, view.tres)
    await window.api.saveSave(view.fileName, serializeTresFile(out))
    view.dirty = false
    written++
  }
  if (written > 0) await loadShelters()
  return written
}

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
          loose: parseShelterLooseItems(tres),
          tres,
          data: parsed,
          dirty: false
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
