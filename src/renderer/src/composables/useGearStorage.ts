import { computed } from 'vue'
import type { SlotItemData } from '../lib/tres/codec'
import type { SlotItem } from '../lib/types'
import { ITEMS_BY_PATH, ITEMS_META, getItemSize } from '../data/items'
import {
  boxAccepts,
  gseFamilyOf,
  gseLayoutFor,
  isBox,
  specsForUnlistedKeys,
  type GridSpec,
  type ItemFacts
} from '../data/gse'
import {
  character,
  findItemDeep,
  freshSlotItem,
  markDirty,
  slotItemDataToSlotItem
} from './saveEditorState'
import { gseMod, gseSettings } from './useMods'
import { useInventoryGrid, GRID_COLS, GRID_ROWS } from './useInventoryGrid'

const CELL = 64

let sharedGrid: ReturnType<typeof useInventoryGrid> | null = null
function inventoryGrid(): ReturnType<typeof useInventoryGrid> {
  if (!sharedGrid) sharedGrid = useInventoryGrid()
  return sharedGrid
}

/** One thing sitting in a stored grid or box, ready to draw. */
export interface StoredEntry {
  id: string
  item: SlotItem
  /** Cell position inside its open grid */
  col: number
  row: number
  w: number
  h: number
  /** Warning shown next to the item (wrong kind for its box, does not fit, unknown slot) */
  problem: string
}

export interface StorageSection {
  spec: GridSpec
  entries: StoredEntry[]
}

export interface StorageContainer {
  /** Sub-resource id of the item that holds everything */
  holderId: string
  holder: SlotItem
  /** "Equipped" or "Inventory" */
  where: string
  /** Equipment slot, "" when it lies in the inventory grid */
  equipSlot: string
  family: string
  sections: StorageSection[]
  totalItems: number
  /** The mod would give this gear storage, but nothing is stored yet */
  empty: boolean
}

function factsOf(path: string): ItemFacts {
  const cat = ITEMS_BY_PATH.get(path)
  return { path, category: cat?.category ?? '', slots: cat?.slots ?? [] }
}

function sizeOf(path: string, rotated: boolean): { w: number; h: number } {
  const cat = ITEMS_BY_PATH.get(path)
  const base = cat ? getItemSize(cat) : { w: 1, h: 1 }
  return rotated ? { w: base.h, h: base.w } : base
}

function entryFor(data: SlotItemData, spec: GridSpec): StoredEntry {
  const size = sizeOf(data.itemData, data.gridRotated)
  const col = Math.round(data.gridPosition.x / CELL)
  const row = Math.round(data.gridPosition.y / CELL)
  let problem = ''
  if (!ITEMS_BY_PATH.has(data.itemData)) {
    problem = 'Item not in the catalog (modded or new). It is kept as is.'
  } else if (isBox(spec.kind) && !boxAccepts(spec.kind, factsOf(data.itemData))) {
    problem = `Normally not accepted by this slot (${spec.tip}). GSE may move it when the game loads.`
  } else if (
    !isBox(spec.kind) &&
    (col < 0 || row < 0 || col + size.w > spec.w || row + size.h > spec.h)
  ) {
    problem = 'Outside the grid. GSE will relocate it when the game loads.'
  }
  return {
    id: data.id,
    item: slotItemDataToSlotItem(data),
    col,
    row,
    w: size.w,
    h: size.h,
    problem
  }
}

function buildContainer(data: SlotItemData, equipSlot: string): StorageContainer | null {
  const holder = slotItemDataToSlotItem(data)
  const cat = ITEMS_BY_PATH.get(data.itemData)
  const gseKnown = gseMod.value !== null
  const layout =
    gseKnown || data.storage.length > 0
      ? gseLayoutFor(data.itemData, equipSlot, cat?.slots ?? [], gseSettings.value)
      : []
  if (layout.length === 0 && data.storage.length === 0) return null

  // Keys present in the data that the computed layout does not list stay visible.
  const hints = new Map<string, [number, number]>()
  for (const s of data.storage) {
    const size = sizeOf(s.itemData, s.gridRotated)
    const col = Math.round(s.gridPosition.x / CELL)
    const row = Math.round(s.gridPosition.y / CELL)
    const prev = hints.get(s.slot) ?? [1, 1]
    hints.set(s.slot, [Math.max(prev[0], col + size.w), Math.max(prev[1], row + size.h)])
  }
  const keys = [...new Set(data.storage.map((s) => s.slot))]
  const specs = [...layout, ...specsForUnlistedKeys(keys, layout, hints)]
  const sections: StorageSection[] = specs.map((spec) => ({
    spec,
    entries: data.storage.filter((s) => s.slot === spec.key).map((s) => entryFor(s, spec))
  }))
  return {
    holderId: data.id,
    holder,
    where: equipSlot ? 'Equipped' : 'Inventory',
    equipSlot,
    family: gseFamilyOf(data.itemData, equipSlot, cat?.slots ?? []),
    sections,
    totalItems: data.storage.length,
    empty: data.storage.length === 0
  }
}

/** Every worn or carried item that holds other items, plus gear GSE would give storage. */
export const storageContainers = computed<StorageContainer[]>(() => {
  const c = character.value
  if (!c) return []
  const out: StorageContainer[] = []
  for (const item of c.equipment) {
    const built = buildContainer(item, item.slot)
    if (built) out.push(built)
  }
  for (const item of c.inventory) {
    // Gear lying in the inventory only shows up when something is stored in it.
    if (item.storage.length === 0) continue
    // Weapons carry their attachments, they are edited in the inventory
    if (ITEMS_BY_PATH.get(item.itemData)?.category === 'Weapons') continue
    const built = buildContainer(item, '')
    if (built) out.push(built)
  }
  return out
})

/** Total number of items stored anywhere in gear. */
export const storedItemCount = computed(() =>
  storageContainers.value.reduce((sum, c) => sum + c.totalItems, 0)
)

// ---------- Editing ----------

function holderOf(holderId: string): SlotItemData | null {
  return findItemDeep(holderId)?.item ?? null
}

function cellsTaken(entries: StoredEntry[]): Set<string> {
  const taken = new Set<string>()
  for (const e of entries)
    for (let r = e.row; r < e.row + e.h; r++)
      for (let c = e.col; c < e.col + e.w; c++) taken.add(`${c},${r}`)
  return taken
}

/** First free spot for an item inside an open grid, trying both orientations. */
export function findFreeCell(
  spec: GridSpec,
  entries: StoredEntry[],
  itemPath: string
): { col: number; row: number; rotated: boolean } | null {
  const taken = cellsTaken(entries)
  const fits = (col: number, row: number, w: number, h: number): boolean => {
    if (col + w > spec.w || row + h > spec.h) return false
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++) if (taken.has(`${c},${r}`)) return false
    return true
  }
  const base = sizeOf(itemPath, false)
  for (let row = 0; row < spec.h; row++)
    for (let col = 0; col < spec.w; col++)
      if (fits(col, row, base.w, base.h)) return { col, row, rotated: false }
  if (base.w !== base.h) {
    for (let row = 0; row < spec.h; row++)
      for (let col = 0; col < spec.w; col++)
        if (fits(col, row, base.h, base.w)) return { col, row, rotated: true }
  }
  return null
}

export interface StoreResult {
  ok: boolean
  /** Why nothing was added, or a non-blocking warning when ok */
  message: string
}

/** Puts a new item into one grid or box of a container. */
export function storeNewItem(
  holderId: string,
  section: StorageSection,
  itemPath: string,
  opts: { condition?: number; amount?: number } = {}
): StoreResult {
  const holder = holderOf(holderId)
  if (!holder) return { ok: false, message: 'That bag is no longer in the save.' }
  const { spec } = section
  let col = 0
  let row = 0
  let rotated = false
  if (isBox(spec.kind)) {
    if (section.entries.length > 0)
      return { ok: false, message: `${spec.caption} is already occupied.` }
  } else {
    const spot = findFreeCell(spec, section.entries, itemPath)
    if (!spot) return { ok: false, message: `No room left in ${spec.caption}.` }
    col = spot.col
    row = spot.row
    rotated = spot.rotated
  }
  const fresh = freshSlotItem(itemPath, {
    condition: opts.condition,
    amount: opts.amount,
    gridCol: col,
    gridRow: row,
    gridRotated: rotated,
    slot: spec.key
  })
  holder.storage.push(fresh)
  markDirty()
  const warn =
    isBox(spec.kind) && ITEMS_BY_PATH.has(itemPath) && !boxAccepts(spec.kind, factsOf(itemPath))
      ? `This is not a usual ${spec.caption.toLowerCase()} item (${spec.tip}); GSE may move it when the game loads.`
      : ''
  return { ok: true, message: warn }
}

/** Takes an item out of its bag and puts it into the main inventory grid. */
export function moveStoredToInventory(itemId: string): StoreResult {
  const found = findItemDeep(itemId)
  const c = character.value
  if (!found || !c) return { ok: false, message: 'Item not found.' }
  const { item } = found
  const { findFreeSlot } = inventoryGrid()
  const size = sizeOf(item.itemData, false)
  const spot = findFreeSlot(size.w, size.h)
  if (!spot)
    return { ok: false, message: `No room in the inventory grid (${GRID_COLS}x${GRID_ROWS}).` }
  found.owner.splice(found.owner.indexOf(item), 1)
  item.slot = ''
  item.gridPosition = { x: spot.col * CELL, y: spot.row * CELL }
  item.gridRotated = spot.rotated
  c.inventory.push(item)
  markDirty()
  return { ok: true, message: '' }
}

function containsDeep(root: SlotItemData, id: string): boolean {
  return root.storage.some((s) => s.id === id || containsDeep(s, id))
}

/**
 * Moves a stored item to another slot or grid cell, in the same bag or in another one.
 * `col`/`row` are the top-left cell inside an open grid (ignored for boxes).
 */
export function moveStoredItem(
  itemId: string,
  targetHolderId: string,
  section: StorageSection,
  col: number,
  row: number
): StoreResult {
  const found = findItemDeep(itemId)
  const target = holderOf(targetHolderId)
  if (!found || !target) return { ok: false, message: 'Item not found.' }
  const { item } = found
  if (target.id === item.id || containsDeep(item, target.id))
    return { ok: false, message: 'A bag cannot be put inside itself.' }
  const { spec } = section
  // everything already in that section except the item being moved
  const others = section.entries.filter((e) => e.id !== itemId)
  let gridCol = 0
  let gridRow = 0
  if (isBox(spec.kind)) {
    if (others.length > 0) return { ok: false, message: `${spec.caption} is already occupied.` }
  } else {
    const size = sizeOf(item.itemData, item.gridRotated)
    if (col < 0 || row < 0 || col + size.w > spec.w || row + size.h > spec.h)
      return { ok: false, message: `Does not fit there in ${spec.caption}.` }
    const taken = cellsTaken(others)
    for (let r = row; r < row + size.h; r++)
      for (let c = col; c < col + size.w; c++)
        if (taken.has(`${c},${r}`)) return { ok: false, message: 'That spot is taken.' }
    gridCol = col
    gridRow = row
  }
  const sameOwner = found.owner === target.storage
  if (!sameOwner) {
    found.owner.splice(found.owner.indexOf(item), 1)
    target.storage.push(item)
  }
  item.slot = spec.key
  item.gridPosition = { x: gridCol * CELL, y: gridRow * CELL }
  markDirty()
  const warn =
    isBox(spec.kind) &&
    ITEMS_BY_PATH.has(item.itemData) &&
    !boxAccepts(spec.kind, factsOf(item.itemData))
      ? `This is not a usual ${spec.caption.toLowerCase()} item (${spec.tip}); GSE may move it when the game loads.`
      : ''
  return { ok: true, message: warn }
}

/** Turns an item stored in an open grid by 90 degrees (the R key); it must still fit where it is. */
export function rotateStoredItem(itemId: string, section: StorageSection): StoreResult {
  const found = findItemDeep(itemId)
  if (!found) return { ok: false, message: 'Item not found.' }
  const { spec } = section
  if (isBox(spec.kind)) return { ok: false, message: 'Items in a single-item slot cannot be rotated.' }
  const { item } = found
  const base = sizeOf(item.itemData, false)
  if (base.w === base.h) return { ok: false, message: '' }
  const col = Math.round(item.gridPosition.x / CELL)
  const row = Math.round(item.gridPosition.y / CELL)
  const next = !item.gridRotated
  const size = next ? { w: base.h, h: base.w } : base
  if (col + size.w > spec.w || row + size.h > spec.h)
    return { ok: false, message: 'No room to rotate it there.' }
  const taken = cellsTaken(section.entries.filter((e) => e.id !== itemId))
  for (let r = row; r < row + size.h; r++)
    for (let c = col; c < col + size.w; c++)
      if (taken.has(`${c},${r}`)) return { ok: false, message: 'No room to rotate it there.' }
  item.gridRotated = next
  markDirty()
  return { ok: true, message: '' }
}

export function removeStoredItem(itemId: string): void {
  const found = findItemDeep(itemId)
  if (!found) return
  found.owner.splice(found.owner.indexOf(found.item), 1)
  markDirty()
}

export function updateStoredItem(
  itemId: string,
  updates: { condition?: number; amount?: number }
): void {
  const found = findItemDeep(itemId)
  if (!found) return
  if (updates.condition !== undefined) found.item.condition = updates.condition
  if (updates.amount !== undefined) found.item.amount = updates.amount
  markDirty()
}

/** Condition and amount the editor may offer for an item (same rules as the main inventory). */
export function editableFields(path: string): {
  condition: boolean
  amount: boolean
  maxAmount: number | undefined
} {
  const meta = ITEMS_META.get(path)
  return {
    condition: meta?.showCondition ?? false,
    amount: meta?.showAmount ?? false,
    maxAmount: meta?.maxAmount
  }
}
