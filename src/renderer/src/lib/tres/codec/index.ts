import type { Property, TresFile, TresValue } from '../types'
import { characterSchema, type CharacterResource } from './schemas/character'
import { worldSchema, type WorldResource } from './schemas/world'
import { tradersSchema, type TradersResource } from './schemas/traders'
import { shelterSchema } from './schemas/shelter'

export type { CharacterResource } from './schemas/character'
export type { WorldResource } from './schemas/world'
export type { TradersResource } from './schemas/traders'
export type { StoredSlotItem, SlotItemData } from './schemas/slotItem'
export { characterSchema } from './schemas/character'
export { worldSchema } from './schemas/world'
export { tradersSchema } from './schemas/traders'
export { shelterSchema, furnitureSchema, parseShelterLooseItems } from './schemas/shelter'
export type { ShelterLooseItem } from './schemas/shelter'
export { slotItemSchema } from './schemas/slotItem'
export { f } from './fields'
export { resource } from './resource'
export type { FieldCodec, ResourceCodec, Infer, InferFields, WithId } from './types'

/**
 * Parse the [resource] section of a Character.tres file into a typed object.
 */
export function parseCharacter(tres: TresFile): CharacterResource {
  return characterSchema.parse(tres.resource, { tres })
}

/**
 * Serialize a typed CharacterResource back to a TresFile. Overlays on the
 * `source` file so unknown properties, original `raw` tokenization, and
 * sub-resources not touched by the schema are preserved.
 *
 * Returns a new TresFile (shallow-copied from `source` and then mutated) —
 * does not mutate the input.
 */
export function serializeCharacter(data: CharacterResource, source: TresFile): TresFile {
  const tres = cloneTresFile(source)
  tres.resource = characterSchema.serialize(data, source.resource, { tres })
  finalizeSubResources(tres, source)
  updateLoadSteps(tres)
  return tres
}

export function parseShelter(tres: TresFile) {
  return shelterSchema.parse(tres.resource, { tres })
}

export function parseWorld(tres: TresFile): WorldResource {
  return worldSchema.parse(tres.resource, { tres })
}

export function serializeWorld(data: WorldResource, source: TresFile): TresFile {
  const tres = cloneTresFile(source)
  tres.resource = worldSchema.serialize(data, source.resource, { tres })
  finalizeSubResources(tres, source)
  updateLoadSteps(tres)
  return tres
}

export function parseTraders(tres: TresFile): TradersResource {
  return tradersSchema.parse(tres.resource, { tres })
}

export function serializeTraders(data: TradersResource, source: TresFile): TresFile {
  const tres = cloneTresFile(source)
  tres.resource = tradersSchema.serialize(data, source.resource, { tres })
  finalizeSubResources(tres, source)
  updateLoadSteps(tres)
  return tres
}

/** Generate a fresh, unique `Resource_xxxxx` id for a new sub-resource. */
export function newSubResourceId(tres: TresFile): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id: string
  do {
    let suffix = ''
    for (let i = 0; i < 5; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
    id = 'Resource_' + suffix
  } while (tres.subResources.some((s) => s.id === id))
  return id
}

function cloneTresFile(source: TresFile): TresFile {
  return {
    header: { ...source.header },
    extResources: source.extResources.map((e) => ({ ...e })),
    subResources: source.subResources.map((s) => ({
      id: s.id,
      type: s.type,
      properties: s.properties.map((p) => ({ ...p }))
    })),
    resource: []
  }
}

function updateLoadSteps(tres: TresFile): void {
  if (tres.header.loadSteps === undefined) return
  tres.header.loadSteps = tres.extResources.length + tres.subResources.length + 1
  tres.header.raw = tres.header.raw.replace(/load_steps=\d+/, `load_steps=${tres.header.loadSteps}`)
}

// ---------- Sub-resource bookkeeping ----------

function collectRefs(value: TresValue, into: string[]): void {
  if (value.kind === 'sub_resource') into.push(value.id)
  else if (value.kind === 'typed_array') for (const el of value.elements) collectRefs(el, into)
}

function refsOf(props: Property[]): string[] {
  const out: string[] = []
  for (const p of props) collectRefs(p.value, out)
  return out
}

/** Ids of every sub-resource reachable from the [resource] section. */
function reachableSubIds(tres: TresFile): Set<string> {
  const byId = new Map(tres.subResources.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const stack = refsOf(tres.resource)
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const sub = byId.get(id)
    if (sub) stack.push(...refsOf(sub.properties))
  }
  return seen
}

/**
 * Housekeeping after the typed resources were written back:
 * 1. drop sub-resources that were reachable in `source` but no longer are
 *    (deleted items, including everything that was stored inside them);
 * 2. order the rest so a sub-resource always comes after the ones it refers to
 *    (a bag that gained contents must not point at a sub-resource further down
 *    the file — Godot resolves SubResource refs while it reads).
 * Sub-resources that were already unreachable in the source are left alone.
 */
export function finalizeSubResources(tres: TresFile, source: TresFile): void {
  const before = reachableSubIds(source)
  const after = reachableSubIds(tres)
  tres.subResources = tres.subResources.filter((s) => after.has(s.id) || !before.has(s.id))

  const byId = new Map(tres.subResources.map((s) => [s.id, s]))
  const done = new Set<string>()
  const ordered: TresFile['subResources'] = []
  const visit = (id: string, trail: Set<string>): void => {
    const sub = byId.get(id)
    if (!sub || done.has(id) || trail.has(id)) return
    trail.add(id)
    for (const ref of refsOf(sub.properties)) visit(ref, trail)
    trail.delete(id)
    done.add(id)
    ordered.push(sub)
  }
  for (const sub of tres.subResources) visit(sub.id, new Set())
  tres.subResources = ordered
}
