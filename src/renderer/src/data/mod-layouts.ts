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

export interface ModWeaponInput {
  resourcePath: string
  category: string
  subtype?: string
  compatible?: string[]
  modId?: string
  layout?: {
    base: string
    overlays: { name: string; position: [number, number]; scale: number; behind: boolean }[]
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
    if (item.category !== 'Attachments' || !item.subtype) continue
    if (KNOWN_SUBTYPES.has(item.subtype) && !ATTACHMENT_SUBTYPE.has(item.resourcePath)) {
      ATTACHMENT_SUBTYPE.set(item.resourcePath, item.subtype as AttachmentSubtype)
    }
  }
}

export function registerModWeaponLayouts(items: ModWeaponInput[]): void {
  for (const weapon of items) {
    if (weapon.category !== 'Weapons' || !weapon.layout) continue
    if (WEAPON_ATTACHMENT_LAYOUTS.has(weapon.resourcePath)) continue
    const { layout } = weapon
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
        behind: overlay.behind
      }
      const at = result.findIndex((o) => o.attachmentPath === target)
      if (at >= 0) result[at] = entry
      else result.push(entry)
    }

    // When the weapon lists what it accepts, only those attachments are offered
    const finalLayout =
      compatible.size > 0
        ? result.filter((o) => compatible.has(o.attachmentPath) || isMagazineAlias(o, compatible))
        : result
    if (finalLayout.length > 0) WEAPON_ATTACHMENT_LAYOUTS.set(weapon.resourcePath, finalLayout)
  }
}

// Vanilla layouts key some magazines by a weapon-specific path; the .tres lists the real one.
function isMagazineAlias(overlay: AttachmentOverlay, compatible: Set<string>): boolean {
  const stem = stemOf(overlay.attachmentPath)
  return [...compatible].some((p) => stemOf(p) === stem)
}
