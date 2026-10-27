import { computed, shallowRef } from 'vue'
import { ITEMS, ITEMS_BY_PATH, ITEMS_META, resolveItemMeta } from './items'
import { ITEMS_BY_SLOT } from './equipment-slots'
import type { GameItem, ItemCategory } from '../lib/types'

/**
 * Items that installed mods add (found by scanning the mods folder), kept apart from the
 * generated built-in catalog so regenerating `items.ts` never touches them.
 * Saves reference them by `res://` path, so once registered they get a name, size and
 * category everywhere in the editor like any vanilla item.
 */
export const modItems = shallowRef<GameItem[]>([])

/** Built-in catalog followed by the items found in installed mods. */
export const allItems = computed<GameItem[]>(() => [...(ITEMS as GameItem[]), ...modItems.value])

const CATEGORIES: ReadonlySet<string> = new Set<ItemCategory>([
  'Ammo',
  'Armor',
  'Attachments',
  'Backpacks',
  'Belts',
  'Books',
  'Clothing',
  'Consumables',
  'Electronics',
  'Fishing',
  'Furniture',
  'Grenades',
  'Helmets',
  'Instruments',
  'Keys',
  'Knives',
  'Lore',
  'Medical',
  'Misc',
  'Rigs',
  'Weapons'
])

/** Registers scanned mod items (or, with `fromGame`, items found in the game's own files). Items already known by path (vanilla or earlier scan) are skipped. */
export function registerModItems(found: ModItem[], fromGame = false): void {
  const added: GameItem[] = []
  const touched = new Set<GameItem[]>()
  for (const m of found) {
    if (ITEMS_BY_PATH.has(m.resourcePath)) continue
    const item: GameItem = {
      category: (CATEGORIES.has(m.category) ? m.category : 'Misc') as ItemCategory,
      id: m.id,
      displayName: m.displayName,
      resourcePath: m.resourcePath,
      ...(fromGame ? {} : { modded: true, modId: m.modId })
    }
    if (m.iconFile) item.iconFile = m.iconFile
    if (m.sizeW > 1) item.sizeW = m.sizeW
    if (m.sizeH > 1) item.sizeH = m.sizeH
    if (m.stackable) item.stackable = true
    if (m.showAmount) item.showAmount = true
    if (m.defaultAmount) item.defaultAmount = m.defaultAmount
    if (m.maxAmount) item.maxAmount = m.maxAmount
    if (m.showCondition) item.showCondition = true
    if (m.slots.length > 0) item.slots = m.slots
    added.push(item)
    ITEMS_BY_PATH.set(item.resourcePath, item)
    ITEMS_META.set(item.resourcePath, resolveItemMeta(item))
    for (const slot of item.slots ?? []) {
      let list = ITEMS_BY_SLOT.get(slot)
      if (!list) {
        list = []
        ITEMS_BY_SLOT.set(slot, list)
      }
      list.push(item)
      touched.add(list)
    }
  }
  for (const list of touched) list.sort((a, b) => a.displayName.localeCompare(b.displayName))
  if (added.length > 0) modItems.value = [...modItems.value, ...added]
}
