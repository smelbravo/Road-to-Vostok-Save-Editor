import { ITEMS_BY_PATH } from './items'
import { ATTACHMENT_SUBTYPE, type AttachmentSubtype } from './attachment-subtypes'
import { WEAPON_ATTACHMENT_LAYOUTS, type AttachmentOverlay } from './weapon-attachments'

/**
 * Attachment support for modded weapons.
 *
 * A mod weapon's `.tres` lists the attachments it accepts (`compatible`) and its `tetris` scene
 * says where each one is drawn on the inventory icon. Mod weapons are usually built on a vanilla
 * scene (the SV-98 on the SVD's), so the vanilla layout is inherited and the mod's own nodes are
 * laid over it. The result goes into the same tables the built-in weapons use.
 */

const KNOWN_SUBTYPES = new Set<string>(['Optic', 'Muzzle', 'Laser', 'Magazine'])

/** Where the workbench puts the slot dot of an attachment the scene gives no position for */
const DEFAULT_DOT: Record<string, [number, number]> = {
  Optic: [-30, -95],
  Muzzle: [310, -46],
  Laser: [150, -46],
  Magazine: [2, 34],
  Camo: [100, 70],
  Bipod: [250, 40],
  Other: [200, 70]
}

function subtypeOf(item: { subtype?: string; resourcePath: string }): AttachmentSubtype {
  if (item.subtype && KNOWN_SUBTYPES.has(item.subtype)) return item.subtype as AttachmentSubtype
  if (/bipod/i.test(`${item.subtype ?? ''} ${item.resourcePath}`)) return 'Bipod'
  return /camo|cover|skin/i.test(`${item.subtype ?? ''} ${item.resourcePath}`) ? 'Camo' : 'Other'
}

export interface ModWeaponInput {
  resourcePath: string
  category: string
  subtype?: string
  compatible?: string[]
  modId?: string
  id?: string
  layout?: {
    base: string
    overlays: {
      name: string
      position: [number, number]
      scale: number
      behind: boolean
      iconFile?: string
      fill?: boolean
    }[]
    hidden: string[]
  }
}

const stemOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.tres$/, '')

/** Inherited layout: the first built-in weapon living in the same folder as the base scene */
function baseLayout(baseScene: string): AttachmentOverlay[] {
  const dir = baseScene.slice(0, baseScene.lastIndexOf('/') + 1)
  if (!dir) return []
  for (const [weapon, overlays] of WEAPON_ATTACHMENT_LAYOUTS) {
    if (weapon.startsWith(dir)) return overlays
  }
  return []
}

export function registerModAttachmentSubtypes(items: ModWeaponInput[]): void {
  for (const item of items) {
    if (item.category !== 'Attachments') continue
    if (!ATTACHMENT_SUBTYPE.has(item.resourcePath)) {
      ATTACHMENT_SUBTYPE.set(item.resourcePath, subtypeOf(item))
    }
  }
}

export function registerModWeaponLayouts(items: ModWeaponInput[]): void {
  // Attachments by name ("SV98_Scope"), so scene nodes can be tied to the items they draw
  const attachments = items.filter((i) => i.category === 'Attachments')
  const lookup = (name: string, modId?: string): string | undefined => {
    const hits = attachments.filter((a) => a.id === name || stemOf(a.resourcePath) === name)
    return (hits.find((a) => a.modId === modId) ?? hits[0])?.resourcePath
  }

  for (const weapon of items) {
    if (weapon.category !== 'Weapons') continue
    // Attachments can also claim the weapon from their side (`compatible` on the attachment)
    const claimed = attachments
      .filter((a) => a.compatible?.includes(weapon.resourcePath))
      .map((a) => a.resourcePath)
    const compatible = new Set([...(weapon.compatible ?? []), ...claimed])
    if (!weapon.layout && compatible.size === 0) continue
    if (WEAPON_ATTACHMENT_LAYOUTS.has(weapon.resourcePath)) continue
    const layout = weapon.layout ?? { base: '', overlays: [], hidden: [] }
    const hidden = new Set(layout.hidden)

    // Inherited (vanilla) entries the weapon accepts, then the mod's own nodes laid over them
    const inherited = baseLayout(layout.base).filter(
      (o) => !hidden.has(stemOf(o.attachmentPath)) && accepted(o, compatible)
    )
    const result: AttachmentOverlay[] = [...inherited]
    for (const overlay of layout.overlays) {
      const target = lookup(overlay.name, weapon.modId)
      if (!target || !ITEMS_BY_PATH.has(target)) continue
      const entry: AttachmentOverlay = {
        attachmentPath: target,
        position: overlay.position,
        scale: overlay.scale,
        behind: overlay.behind,
        ...(overlay.iconFile ? { iconFile: overlay.iconFile } : {}),
        ...(overlay.fill ? { fill: true } : {})
      }
      const at = result.findIndex((o) => o.attachmentPath === target)
      if (at >= 0) result[at] = entry
      else result.push(entry)
    }

    // Accepted attachments the scene places nowhere stay selectable (just not drawn on the icon)
    for (const path of compatible) {
      if (
        result.some((o) => o.attachmentPath === path || stemOf(o.attachmentPath) === stemOf(path))
      )
        continue
      const subtype = ATTACHMENT_SUBTYPE.get(path)
      if (!subtype || !ITEMS_BY_PATH.has(path)) continue
      result.push({
        attachmentPath: path,
        position: DEFAULT_DOT[subtype] ?? [0, 0],
        scale: 0.5,
        noOverlay: true
      })
    }
    if (result.length > 0) WEAPON_ATTACHMENT_LAYOUTS.set(weapon.resourcePath, result)
  }
}

/** An inherited entry stays when the weapon lists it, or lists the same magazine under its real path */
function accepted(overlay: AttachmentOverlay, compatible: Set<string>): boolean {
  if (compatible.size === 0) return true
  const stem = stemOf(overlay.attachmentPath)
  return compatible.has(overlay.attachmentPath) || [...compatible].some((p) => stemOf(p) === stem)
}
