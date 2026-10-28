/**
 * Reader/editor for the files Mod Configuration Menu (MCM) writes. They are Godot ConfigFile
 * text: `[Type]` sections (Bool, Int, Float, String, Dropdown, Color, Vector2, ...) holding
 * `id={ "name": ..., "tooltip": ..., "default": ..., "value": ... }`, where the dictionary
 * may span several lines.
 *
 * Editing replaces only the text of one `"value"`, so everything else in the file (what the
 * mod wrote, comments, order) stays exactly as it was.
 */

export type McmNode =
  | { kind: 'string'; value: string; start: number; end: number }
  | { kind: 'number'; value: number; raw: string; start: number; end: number }
  | { kind: 'bool'; value: boolean; start: number; end: number }
  | { kind: 'null'; start: number; end: number }
  | { kind: 'array'; items: McmNode[]; start: number; end: number }
  | {
      kind: 'dict'
      entries: { key: McmNode; value: McmNode }[]
      start: number
      end: number
    }
  /** `Vector2(1, 2)`, `Color(1, 0, 0, 1)`, `Key(...)` ... */
  | { kind: 'call'; name: string; args: McmNode[]; start: number; end: number }

class Reader {
  pos: number
  constructor(readonly text: string, pos: number) {
    this.pos = pos
  }

  ws(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++
  }

  node(): McmNode {
    this.ws()
    const t = this.text
    const start = this.pos
    const ch = t[start]
    if (ch === undefined) throw new Error('Unexpected end of settings')
    if (ch === '"') return this.string()
    if (ch === '{') return this.dict()
    if (ch === '[') return this.array()
    const num = /^-?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf|nan)/.exec(
      t.slice(start, start + 40)
    )
    if (num) {
      this.pos += num[0].length
      return {
        kind: 'number',
        value: Number(num[0]),
        raw: num[0],
        start,
        end: this.pos
      }
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(t.slice(start, start + 64))
    if (!word) throw new Error(`Unexpected "${ch}" in settings`)
    this.pos += word[0].length
    if (word[0] === 'true' || word[0] === 'false')
      return { kind: 'bool', value: word[0] === 'true', start, end: this.pos }
    if (word[0] === 'null') return { kind: 'null', start, end: this.pos }
    // Typed arrays/dictionaries and constructors: Name(args) / Array[Type]([..])
    if (t[this.pos] === '[') {
      let depth = 0
      do {
        if (t[this.pos] === '[') depth++
        else if (t[this.pos] === ']') depth--
        this.pos++
      } while (depth > 0 && this.pos < t.length)
    }
    this.ws()
    if (t[this.pos] !== '(') return { kind: 'null', start, end: this.pos }
    this.pos++
    const args: McmNode[] = []
    this.ws()
    while (t[this.pos] !== ')') {
      args.push(this.node())
      this.ws()
      if (t[this.pos] === ',') this.pos++
      this.ws()
      if (this.pos >= t.length) throw new Error('Unterminated value in settings')
    }
    this.pos++
    return { kind: 'call', name: word[0], args, start, end: this.pos }
  }

  string(): McmNode {
    const start = this.pos
    let i = start + 1
    let out = ''
    for (; i < this.text.length; i++) {
      const c = this.text[i]
      if (c === '\\') {
        const n = this.text[++i]
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : (n ?? '')
        continue
      }
      if (c === '"') break
      out += c
    }
    this.pos = i + 1
    return { kind: 'string', value: out, start, end: this.pos }
  }

  array(): McmNode {
    const start = this.pos++
    const items: McmNode[] = []
    this.ws()
    while (this.text[this.pos] !== ']') {
      items.push(this.node())
      this.ws()
      if (this.text[this.pos] === ',') this.pos++
      this.ws()
      if (this.pos >= this.text.length) throw new Error('Unterminated list in settings')
    }
    this.pos++
    return { kind: 'array', items, start, end: this.pos }
  }

  dict(): McmNode {
    const start = this.pos++
    const entries: { key: McmNode; value: McmNode }[] = []
    this.ws()
    while (this.text[this.pos] !== '}') {
      const key = this.node()
      this.ws()
      if (this.text[this.pos] !== ':') throw new Error('Expected ":" in settings')
      this.pos++
      const value = this.node()
      entries.push({ key, value })
      this.ws()
      if (this.text[this.pos] === ',') this.pos++
      this.ws()
      if (this.pos >= this.text.length) throw new Error('Unterminated dictionary in settings')
    }
    this.pos++
    return { kind: 'dict', entries, start, end: this.pos }
  }
}

export interface McmEntry {
  /** The MCM type: "Bool", "Int", "Float", "String", "Dropdown", "Color", "Category", ... */
  section: string
  id: string
  /** Fields of the stored dictionary, by name */
  fields: Map<string, McmNode>
  /** Where the dictionary sits in the file text */
  start: number
  end: number
}

/** Reads every `id={...}` of an MCM file. Entries that do not parse are skipped. */
export function parseMcm(text: string): McmEntry[] {
  const entries: McmEntry[] = []
  let section = ''
  let pos = 0
  while (pos < text.length) {
    let eol = text.indexOf('\n', pos)
    if (eol < 0) eol = text.length
    const line = text.slice(pos, eol).trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      section = header[1]
      pos = eol + 1
      continue
    }
    const m = /^("?)([^"=]+)\1\s*=\s*/.exec(text.slice(pos, eol + 1))
    if (!line || line.startsWith(';') || !m) {
      pos = eol + 1
      continue
    }
    const reader = new Reader(text, pos + m[0].length)
    try {
      const value = reader.node()
      if (value.kind === 'dict') {
        const fields = new Map<string, McmNode>()
        for (const e of value.entries) if (e.key.kind === 'string') fields.set(e.key.value, e.value)
        entries.push({ section, id: m[2].trim(), fields, start: value.start, end: value.end })
      }
      pos = Math.max(reader.pos, eol + 1)
    } catch {
      pos = eol + 1
    }
  }
  return entries
}

// ---------- reading a value in a form the editor can use ----------

export function plain(node: McmNode | undefined): unknown {
  if (!node) return undefined
  switch (node.kind) {
    case 'string':
    case 'bool':
      return node.value
    case 'number':
      return node.value
    case 'null':
      return null
    case 'array':
      return node.items.map(plain)
    case 'dict':
      return Object.fromEntries(
        node.entries.flatMap((e) => (e.key.kind === 'string' ? [[e.key.value, plain(e.value)]] : []))
      )
    case 'call':
      return { call: node.name, args: node.args.map(plain) }
  }
}

export interface McmSetting {
  id: string
  type: string
  name: string
  tooltip: string
  category: string
  menuPos: number
  value: unknown
  defaultValue: unknown
  min?: unknown
  max?: unknown
  step?: number
  options?: Record<string, string>
  /** The ini line this setting came from */
  entry: McmEntry
}

export function settingsOf(entries: McmEntry[]): McmSetting[] {
  return entries
    .filter((e) => e.section !== 'Category' && e.fields.has('value'))
    .map((entry) => {
      const f = entry.fields
      const str = (k: string): string => {
        const v = plain(f.get(k))
        return typeof v === 'string' ? v : ''
      }
      const stepV = plain(f.get('step'))
      const optV = plain(f.get('options'))
      return {
        id: entry.id,
        type: entry.section,
        name: str('name') || entry.id,
        tooltip: str('tooltip'),
        category: str('category'),
        menuPos: typeof plain(f.get('menu_pos')) === 'number' ? (plain(f.get('menu_pos')) as number) : 0,
        value: plain(f.get('value')),
        defaultValue: plain(f.get('default')),
        min: plain(f.get('minRange')),
        max: plain(f.get('maxRange')),
        ...(typeof stepV === 'number' ? { step: stepV } : {}),
        ...(optV && typeof optV === 'object' && !Array.isArray(optV)
          ? { options: optV as Record<string, string> }
          : {}),
        entry
      }
    })
}

/** Category headers by id -> display name and position */
export function categoriesOf(entries: McmEntry[]): Map<string, { name: string; pos: number }> {
  const out = new Map<string, { name: string; pos: number }>()
  for (const e of entries) {
    if (e.section !== 'Category') continue
    const name = plain(e.fields.get('name'))
    const pos = plain(e.fields.get('menu_pos'))
    out.set(e.id, {
      name: typeof name === 'string' ? name : e.id,
      pos: typeof pos === 'number' ? pos : 0
    })
  }
  return out
}

// ---------- writing ----------

export function godotString(s: string): string {
  return (
    '"' +
    s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') +
    '"'
  )
}

/** A float the way Godot prints it: whole numbers keep a ".0" */
export function godotFloat(n: number): string {
  if (!Number.isFinite(n)) return '0.0'
  const s = String(n)
  return /[.eE]/.test(s) ? s : s + '.0'
}

/**
 * Returns the file text with the `"value"` of one setting replaced by `valueText` (already in
 * Godot syntax). null when the setting no longer has a value in the file.
 */
export function withValue(text: string, entryStart: number, valueText: string): string | null {
  const reader = new Reader(text, entryStart)
  let dict: McmNode
  try {
    dict = reader.node()
  } catch {
    return null
  }
  if (dict.kind !== 'dict') return null
  const hit = dict.entries.find((e) => e.key.kind === 'string' && e.key.value === 'value')
  if (!hit) return null
  return text.slice(0, hit.value.start) + valueText + text.slice(hit.value.end)
}
