import { f } from '../fields'
import { resource } from '../resource'
import type { TresFile } from '../../types'
import { slotItemSchema, SLOT_DATA_SCRIPT, type SlotItemData } from './slotItem'

/** Furniture placed in a shelter (`FurnitureSave`). Only what the shelter viewer needs. */
export const furnitureSchema = resource({
  name: f.string({ default: '' }),
  container: f.bool({ default: false }),
  itemData: f.extRef({ default: '' }),
  storage: f.subRefArray(slotItemSchema, { elementTypePath: SLOT_DATA_SCRIPT })
})

/** The [resource] section of a shelter file (`ShelterSave`), without the loose items. */
export const shelterSchema = resource({
  initialVisit: f.bool({ default: true }),
  lastVisit: f.int({ default: 0 }),
  furnitures: f.subRefArray(furnitureSchema, { elementTypePath: 'res://Scripts/FurnitureSave.gd' })
})

export interface ShelterLooseItem {
  name: string
  item: SlotItemData
}

/** Items lying around the shelter (`ItemSave`: a name, a position and one SlotData). */
export function parseShelterLooseItems(tres: TresFile): ShelterLooseItem[] {
  const list = tres.resource.find((p) => p.key === 'items')?.value
  if (!list || list.kind !== 'typed_array') return []
  const out: ShelterLooseItem[] = []
  for (const el of list.elements) {
    if (el.kind !== 'sub_resource') continue
    const sub = tres.subResources.find((s) => s.id === el.id)
    if (!sub) continue
    const name = sub.properties.find((p) => p.key === 'name')?.value
    const slot = sub.properties.find((p) => p.key === 'slotData')?.value
    if (!slot || slot.kind !== 'sub_resource') continue
    const slotSub = tres.subResources.find((s) => s.id === slot.id)
    if (!slotSub) continue
    out.push({
      name: name?.kind === 'string' ? name.value : '',
      item: { id: slotSub.id, ...slotItemSchema.parse(slotSub.properties, { tres }) }
    })
  }
  return out
}
