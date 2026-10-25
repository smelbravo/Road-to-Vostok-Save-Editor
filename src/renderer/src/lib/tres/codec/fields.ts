import type { TresTypedArray } from '../types'
import type { FieldCodec, ParseCtx, SerializeCtx, ResourceCodec, WithId } from './types'

/**
 * Resolve (or create) ext_resource entries for the given paths and return
 * their ids. Matches the behavior of the legacy `ensureExtResourceIds` helper.
 */
export function ensureExtIds(ctx: SerializeCtx, paths: string[]): string[] {
  const { tres } = ctx
  return paths.map((path) => {
    const existing = tres.extResources.find((e) => e.path === path)?.id
    if (existing) return existing
    const id = String(Math.max(0, ...tres.extResources.map((e) => parseInt(e.id, 10))) + 1)
    tres.extResources.push({
      id,
      type: 'Resource',
      path,
      raw: `[ext_resource type="Resource" path="${path}" id="${id}"]`
    })
    return id
  })
}

function resolveExtPath(ctx: ParseCtx, id: string): string {
  return ctx.tres.extResources.find((e) => e.id === id)?.path ?? ''
}

// ---------- Primitive fields ----------

interface PrimitiveOpts<T> {
  default: T
}

export function int(opts: PrimitiveOpts<number> = { default: 0 }): FieldCodec<number> {
  return {
    default: opts.default,
    parse: (v) => (v && (v.kind === 'int' || v.kind === 'float') ? v.value : opts.default),
    serialize: (current, source) => {
      if (source && source.kind === 'int' && source.value === current) return source
      if (!source && current === opts.default) return null
      return { kind: 'int', value: current, raw: String(current) }
    }
  }
}

export function float(opts: PrimitiveOpts<number> = { default: 0 }): FieldCodec<number> {
  return {
    default: opts.default,
    parse: (v) => (v && (v.kind === 'float' || v.kind === 'int') ? v.value : opts.default),
    serialize: (current, source) => {
      if (source && source.kind === 'float' && source.value === current) return source
      if (!source && current === opts.default) return null
      return { kind: 'float', value: current, raw: String(current) }
    }
  }
}

export function bool(opts: PrimitiveOpts<boolean> = { default: false }): FieldCodec<boolean> {
  return {
    default: opts.default,
    parse: (v) => (v && v.kind === 'bool' ? v.value : opts.default),
    serialize: (current, source) => {
      if (source && source.kind === 'bool' && source.value === current) return source
      if (!source && current === opts.default) return null
      return { kind: 'bool', value: current }
    }
  }
}

export function string(opts: PrimitiveOpts<string> = { default: '' }): FieldCodec<string> {
  return {
    default: opts.default,
    parse: (v) => (v && v.kind === 'string' ? v.value : opts.default),
    serialize: (current, source) => {
      if (source && source.kind === 'string' && source.value === current) return source
      if (!source && current === opts.default) return null
      return { kind: 'string', value: current }
    }
  }
}

// ---------- Vector2 ----------

export interface Vec2 {
  x: number
  y: number
}

const DEFAULT_VEC2: Vec2 = { x: 0, y: 0 }

export function vector2(opts: PrimitiveOpts<Vec2> = { default: DEFAULT_VEC2 }): FieldCodec<Vec2> {
  return {
    default: opts.default,
    parse: (v) => (v && v.kind === 'vector2' ? { x: v.x, y: v.y } : opts.default),
    serialize: (current, source) => {
      if (source && source.kind === 'vector2' && source.x === current.x && source.y === current.y) {
        return source
      }
      if (!source && current.x === opts.default.x && current.y === opts.default.y) return null
      return {
        kind: 'vector2',
        x: current.x,
        y: current.y,
        raw: `Vector2(${current.x}, ${current.y})`
      }
    }
  }
}

// ---------- Ext-resource refs ----------

/**
 * A single ext_resource ref stored as its resolved path. `default` is the path
 * used on new resources; an empty string means "absent is OK".
 */
export function extRef(
  opts: PrimitiveOpts<string> & { required?: boolean } = { default: '' }
): FieldCodec<string> {
  return {
    default: opts.default,
    parse: (v, ctx) => (v && v.kind === 'ext_resource' ? resolveExtPath(ctx, v.id) : opts.default),
    serialize: (current, source, ctx) => {
      if (source && source.kind === 'ext_resource') {
        const sourcePath = resolveExtPath(ctx, source.id)
        if (sourcePath === current) return source
      }
      if (!source && current === opts.default && !opts.required) return null
      if (!current) return null
      const [id] = ensureExtIds(ctx, [current])
      return { kind: 'ext_resource', id }
    }
  }
}

/**
 * A typed_array<ext_resource> stored as resolved paths.
 *
 * `elementTypeFor` determines the `Array[...]` annotation. It's a function so
 * callers can key it to a particular ext_resource's id (which may not exist
 * until serialize time).
 */
export function extRefArray(opts: {
  default?: string[]
  /** The script/type referenced in the Array[ExtResource("id")] annotation. */
  elementTypePath: string
}): FieldCodec<string[]> {
  const defaultValue = opts.default ?? []
  return {
    default: defaultValue,
    parse: (v, ctx) => {
      if (!v || v.kind !== 'typed_array') return [...defaultValue]
      return v.elements
        .filter((el): el is { kind: 'ext_resource'; id: string } => el.kind === 'ext_resource')
        .map((el) => resolveExtPath(ctx, el.id))
    },
    serialize: (current, source, ctx) => {
      const [typeId] = ensureExtIds(ctx, [opts.elementTypePath])
      const elementType = `ExtResource("${typeId}")`

      if (source && source.kind === 'typed_array') {
        const sourcePaths = source.elements
          .filter((el): el is { kind: 'ext_resource'; id: string } => el.kind === 'ext_resource')
          .map((el) => resolveExtPath(ctx, el.id))
        if (arraysEqual(sourcePaths, current) && source.elementType === elementType) {
          return source
        }
      }

      if (!source && current.length === 0 && defaultValue.length === 0) return null

      const ids = ensureExtIds(ctx, current)
      return {
        kind: 'typed_array',
        elementType,
        elements: ids.map((id) => ({ kind: 'ext_resource' as const, id }))
      }
    }
  }
}

// ---------- String arrays ----------

export function stringArray(opts: { default?: string[] } = {}): FieldCodec<string[]> {
  const defaultValue = opts.default ?? []
  return {
    default: defaultValue,
    parse: (v) => {
      if (!v || v.kind !== 'typed_array') return [...defaultValue]
      return v.elements
        .filter((el): el is { kind: 'string'; value: string } => el.kind === 'string')
        .map((el) => el.value)
    },
    serialize: (current, source) => {
      if (source && source.kind === 'typed_array' && source.elementType === 'String') {
        const sourceVals = source.elements
          .filter((el): el is { kind: 'string'; value: string } => el.kind === 'string')
          .map((el) => el.value)
        if (arraysEqual(sourceVals, current)) return source
      }
      if (!source && current.length === 0) return null
      return {
        kind: 'typed_array',
        elementType: 'String',
        elements: current.map((value) => ({ kind: 'string' as const, value }))
      }
    }
  }
}

// ---------- Sub-resource arrays ----------

/**
 * A typed_array<sub_resource> where each element is a fully-parsed typed value
 * from the supplied `itemSchema`. The returned items carry an `id` (their
 * SubResource id) so downstream code can reference them stably.
 *
 * `elementTypePath` is the script that the array is declared as (e.g. the
 * SlotData script in Character.tres). It's used in the `Array[...]` annotation.
 */
export function subRefArray<T>(
  itemSchemaOrGetter: ResourceCodec<T> | (() => ResourceCodec<T>),
  opts: {
    default?: WithId<T>[]
    elementTypePath: string
  }
): FieldCodec<WithId<T>[]> {
  const defaultValue = opts.default ?? []
  // A getter lets a schema refer to itself (SlotData.storage holds SlotData).
  const schema = (): ResourceCodec<T> =>
    typeof itemSchemaOrGetter === 'function' ? itemSchemaOrGetter() : itemSchemaOrGetter
  return {
    default: defaultValue,
    parse: (v, ctx) => {
      if (!v || v.kind !== 'typed_array') return [...defaultValue]
      const items: WithId<T>[] = []
      for (const el of v.elements) {
        if (el.kind !== 'sub_resource') continue
        const sub = ctx.tres.subResources.find((s) => s.id === el.id)
        if (!sub) continue
        items.push({ id: sub.id, ...schema().parse(sub.properties, ctx) } as WithId<T>)
      }
      return items
    },
    serialize: (current, source, ctx) => {
      // Absent in the file and still empty: keep omitting it (the game does too).
      if (!source && current.length === 0 && defaultValue.length === 0) return null

      const [typeId] = ensureExtIds(ctx, [opts.elementTypePath])
      const elementType = `ExtResource("${typeId}")`

      // Build new SubResource list from `current`. Preserve existing
      // sub-resources (matched by id) so unknown properties pass through.
      const existingSubs = new Map(ctx.tres.subResources.map((s) => [s.id, s]))
      const newElements: TresTypedArray['elements'] = []
      const newIds: string[] = []

      for (const item of current) {
        const { id, ...data } = item as WithId<T> & { id: string }
        const existing = existingSubs.get(id)
        const sub = {
          id,
          type: 'Resource',
          properties: schema().serialize(data as T, existing ? existing.properties : null, ctx)
        }
        // Replace in place (keeps insertion order) or append
        const idx = ctx.tres.subResources.findIndex((s) => s.id === id)
        if (idx >= 0) {
          ctx.tres.subResources[idx] = sub
        } else {
          ctx.tres.subResources.push(sub)
        }
        newElements.push({ kind: 'sub_resource', id })
        newIds.push(id)
      }

      // Same members in the same order as the source: keep its exact tokens.
      if (
        source &&
        source.kind === 'typed_array' &&
        source.elementType === elementType &&
        source.elements.length === newIds.length &&
        source.elements.every((el, i) => el.kind === 'sub_resource' && el.id === newIds[i])
      ) {
        return source
      }

      // Sub-resources that this array no longer references are NOT dropped here:
      // the item may have moved to another array (inventory -> equipment) and
      // must keep its unknown properties. `finalizeSubResources` removes the
      // ones that really became unreachable once the whole file is rebuilt.

      return {
        kind: 'typed_array',
        elementType,
        elements: newElements
      }
    }
  }
}

// ---------- Helpers ----------

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Handy re-export for schema files. */
export const f = {
  int,
  float,
  bool,
  string,
  vector2,
  extRef,
  extRefArray,
  stringArray,
  subRefArray
}
