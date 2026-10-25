import { f } from '../fields'
import { resource } from '../resource'
import type { ResourceCodec, WithId } from '../types'
import type { Vec2 } from '../fields'

/** Godot script paths that appear as ext_resource refs on slot items. */
export const SLOT_DATA_SCRIPT = 'res://Scripts/SlotData.gd'
export const ITEM_DATA_SCRIPT = 'res://Scripts/ItemData.gd'

/**
 * Shape of a single inventory / equipment / catalog slot item (`SlotData`).
 *
 * `storage` holds the items kept *inside* this item. Vanilla only uses it for
 * a few containers, but mods build on it: Gear Storage Expansion (GSE) keeps
 * everything stored in a backpack / rig / garment there, with `slot` set to
 * the grid key ("main", "gun1", "mag1", ...) and `gridPosition` in 64 px units.
 * The type is written out by hand because the schema refers to itself.
 */
export interface StoredSlotItem {
  script: string
  itemData: string
  nested: string[]
  storage: SlotItemData[]
  condition: number
  amount: number
  position: number
  mode: number
  zoom: number
  chamber: boolean
  casing: boolean
  state: string
  gridPosition: Vec2
  gridRotated: boolean
  slot: string
}

export type SlotItemData = WithId<StoredSlotItem>

/**
 * Schema for a single inventory / equipment / catalog slot item. Mirrors the
 * 16-property template the game writes — all fields have defaults matching
 * the game's omit-when-default convention, so parsed-but-absent fields round
 * trip correctly and fresh items only emit non-default values.
 */
export const slotItemSchema: ResourceCodec<StoredSlotItem> = resource({
  // Slot items live in Array[SlotData]. Without the script property Godot
  // treats a new sub-resource as a generic Resource and rejects the entire
  // typed array when loading the save.
  script: f.extRef({ default: SLOT_DATA_SCRIPT, required: true }),
  itemData: f.extRef({ default: '' }),
  nested: f.extRefArray({ default: [], elementTypePath: ITEM_DATA_SCRIPT }),
  // Nested SlotData sub-resources (see above). Older versions of this editor
  // read this as ext_resource refs, which silently ignored real contents.
  storage: f.subRefArray<StoredSlotItem>(() => slotItemSchema, {
    elementTypePath: SLOT_DATA_SCRIPT
  }),
  condition: f.int({ default: 0 }),
  amount: f.int({ default: 0 }),
  position: f.int({ default: 0 }),
  mode: f.int({ default: 1 }),
  zoom: f.int({ default: 1 }),
  chamber: f.bool({ default: false }),
  casing: f.bool({ default: false }),
  state: f.string({ default: '' }),
  gridPosition: f.vector2({ default: { x: 0, y: 0 } }),
  gridRotated: f.bool({ default: false }),
  slot: f.string({ default: '' })
})
