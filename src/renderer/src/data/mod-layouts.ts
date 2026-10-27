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
  Other: [200, 70]
}

function subtypeOf(item: { subtype?: string; resourcePath: string }): AttachmentSubtype {
  if (item.subtype && KNOWN_SUBTYPES.has(item.subtype)) return item.subtype as AttachmentSubtype
  return /camo|cover|skin/i.test(`${item.subtype ?? ''} ${item.resourcePath}`) ? 'Camo' : 'Other'
}

export interface ModWeaponInput {
  resourcePath: string
  category: string
  subtype?: string
  compatible?: string[]
  modId?: string
  layout?: {
    base: string
    overlays: {
      name: string
      position: [number, number]
      scale: number
      behind: boolean
      iconFile?: string
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
  for (const weapon of items) {
    if (weapon.category !== 'Weapons') continue
    if (!weapon.layout && !weapon.compatible?.length) continue
    if (WEAPON_ATTACHMENT_LAYOUTS.has(weapon.resourcePath)) continue
    const layout = weapon.layout ?? { base: '', overlays: [], hidden: [] }
    const hidden = new Set(layout.hidden)
    const compatible = new Set(weapon.compatible ?? [])

    const result: AttachmentOverlay[] = baseLayout(layout.base).filter(
      (o) => !hidden.has(stemOf(o.attachmentPath))
    )

    for (const overlay of layout.overlays) {
      // Same mod first (SV98_Scope), then any item of that name (ACOG)
      const target = [...compatible].find((p) => stemOf(p) === overlay.name)
      if (!target || !ITEMS_BY_PATH.has(target)) continue
      const entry: AttachmentOverlay = {
        attachmentPath: target,
        position: overlay.position,
        scale: overlay.scale,
        behind: overlay.behind,
        ...(overlay.iconFile ? { iconFile: overlay.iconFile } : {})
      }
      const at = result.findIndex((o) => o.attachmentPath === target)
      if (at >= 0) result[at] = entry
      else result.push(entry)
    }

    // When the weapon lists what it accepts, only those attachments are offered; accepted
    // attachments the scene places nowhere stay selectable (just not drawn on the icon)
    let finalLayout = result
    if (compatible.size > 0) {
      finalLayout = result.filter(
        (o) => compatible.has(o.attachmentPath) || isMagazineAlias(o, compatible)
      )
      for (const path of compatible) {
        if (
          finalLayout.some(
            (o) => o.attachmentPath === path || stemOf(o.attachmentPath) === stemOf(path)
          )
        )
          continue
        const subtype = ATTACHMENT_SUBTYPE.get(path)
        if (!subtype || !ITEMS_BY_PATH.has(path)) continue
        finalLayout.push({
          attachmentPath: path,
          position: DEFAULT_DOT[subtype] ?? [0, 0],
          scale: 0.5,
          noOverlay: true
        })
      }
    }
    if (finalLayout.length > 0) WEAPON_ATTACHMENT_LAYOUTS.set(weapon.resourcePath, finalLayout)
  }
}

// Vanilla layouts key some magazines by a weapon-specific path; the .tres lists the real one.
function isMagazineAlias(overlay: AttachmentOverlay, compatible: Set<string>): boolean {
  const stem = stemOf(overlay.attachmentPath)
  return [...compatible].some((p) => stemOf(p) === stem)
}
