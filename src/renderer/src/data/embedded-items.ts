import type { TresFile, TresValue } from '../lib/tres/types'
import { ITEMS_BY_PATH, ITEMS_META, resolveItemMeta } from './items'
import { modItems } from './mod-items'
import { registerInlineIcon } from '../composables/useItemIcons'
import type { GameItem, ItemCategory } from '../lib/types'

/**
 * Some mods give the game items made at run time (no `.tres` file). The game then saves the whole
 * ItemData inside the save, as a sub-resource, even its icon as raw pixels. Those items have no
 * path the editor could look up, so they are read from the save and registered under
 * `embedded://<sub-resource id>`; that same string is what the slot codec reports as their path.
 */
export const EMBEDDED_PREFIX = 'embedded://'

const TYPE_TO_CATEGORY: Record<string, ItemCategory> = {
  Ammo: 'Ammo',
  Armor: 'Armor',
  Attachment: 'Attachments',
  Backpack: 'Backpacks',
  'Belt Pouch': 'Belts',
  Clothing: 'Clothing',
  Consumable: 'Consumables',
  Consumables: 'Consumables',
  Electronics: 'Electronics',
  Fish: 'Fishing',
  Fishing: 'Fishing',
  Furniture: 'Furniture',
  Grenade: 'Grenades',
  Helmet: 'Helmets',
  Instrument: 'Instruments',
  Key: 'Keys',
  Knife: 'Knives',
  Literature: 'Books',
  Lore: 'Lore',
  Medical: 'Medical',
  Misc: 'Misc',
  Rig: 'Rigs',
  Weapon: 'Weapons'
}

const str = (v: TresValue | undefined): string => (v?.kind === 'string' ? v.value : '')

/** Pixels of an embedded `Image` sub-resource as a data URL (RGBA8 only) */
function imageToDataUrl(raw: string): string | null {
  if (typeof document === 'undefined') return null
  const width = Number(/"width":\s*(\d+)/.exec(raw)?.[1])
  const height = Number(/"height":\s*(\d+)/.exec(raw)?.[1])
  const format = /"format":\s*"([^"]+)"/.exec(raw)?.[1]
  const bytes = /PackedByteArray\(([^)]*)\)/.exec(raw)?.[1]
  if (!width || !height || format !== 'RGBA8' || !bytes) return null
  const data = Uint8ClampedArray.from(bytes.split(',').map((n) => Number(n.trim()) || 0))
  if (data.length !== width * height * 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(data, width, height), 0, 0)
  return canvas.toDataURL('image/png')
}

export function registerEmbeddedItems(tres: TresFile): void {
  const byId = new Map(tres.subResources.map((s) => [s.id, s]))
  const ids = new Set<string>()
  for (const sub of tres.subResources) {
    const v = sub.properties.find((p) => p.key === 'itemData')?.value
    if (v?.kind === 'sub_resource') ids.add(v.id)
  }
  const added: GameItem[] = []
  for (const id of ids) {
    const sub = byId.get(id)
    const path = EMBEDDED_PREFIX + id
    if (!sub || ITEMS_BY_PATH.has(path)) continue
    const prop = (k: string): TresValue | undefined => sub.properties.find((p) => p.key === k)?.value
    const name = str(prop('name'))
    const type = str(prop('type'))
    if (!name || !type) continue
    const size = prop('size')
    const item: GameItem = {
      category: TYPE_TO_CATEGORY[type] ?? 'Misc',
      id: str(prop('file')) || id,
      displayName: name,
      resourcePath: path,
      modded: true,
      modId: 'embedded in save'
    }
    if (size?.kind === 'vector2') {
      if (size.x > 1) item.sizeW = Math.round(size.x)
      if (size.y > 1) item.sizeH = Math.round(size.y)
    }
    const icon = prop('icon')
    const tex = icon?.kind === 'sub_resource' ? byId.get(icon.id) : undefined
    const imgRef = tex?.properties.find((p) => p.key === 'image')?.value
    const img = imgRef?.kind === 'sub_resource' ? byId.get(imgRef.id) : undefined
    const dict = img?.properties.find((p) => p.key === 'data')?.value
    const url = dict?.kind === 'dict' ? imageToDataUrl(dict.raw) : null
    if (url) {
      item.iconFile = `embedded_${id}`
      registerInlineIcon(item.iconFile, url)
    }
    ITEMS_BY_PATH.set(path, item)
    ITEMS_META.set(path, resolveItemMeta(item))
    added.push(item)
  }
  if (added.length > 0) modItems.value = [...modItems.value, ...added]
}
