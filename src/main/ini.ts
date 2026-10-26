/**
 * Reader for Godot `ConfigFile` text (what `mod_config.cfg`, the save slot mods'
 * `state.cfg` / `_meta.cfg` and MCM's `.ini` files are). Only reads; never writes.
 *
 * Format: `[section]` headers and `key=value` lines. Keys may be quoted
 * (`"gse@1.1.7"=true`); values are kept raw and converted with the helpers below.
 */

export type IniSections = Map<string, Map<string, string>>

function unquoteKey(raw: string): string {
  const key = raw.trim()
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    return key.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return key
}

/** Splits `key=value` at the first `=` that is not inside a quoted key. */
function splitPair(line: string): [string, string] | null {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && inQuote) {
      i++
      continue
    }
    if (ch === '"') inQuote = !inQuote
    else if (ch === '=' && !inQuote) return [line.slice(0, i), line.slice(i + 1)]
  }
  return null
}

export function parseIni(text: string): IniSections {
  const sections: IniSections = new Map()
  let current = ''
  sections.set(current, new Map())
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = header[1]
      if (!sections.has(current)) sections.set(current, new Map())
      continue
    }
    const pair = splitPair(line)
    if (!pair) continue
    sections.get(current)?.set(unquoteKey(pair[0]), pair[1].trim())
  }
  return sections
}

export function iniString(raw: string | undefined, fallback = ''): string {
  if (raw === undefined) return fallback
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return v
}

export function iniInt(raw: string | undefined, fallback = 0): number {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(n) ? n : fallback
}

export function iniBool(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined) return fallback
  const v = raw.trim().toLowerCase()
  return v === 'true' ? true : v === 'false' ? false : fallback
}
