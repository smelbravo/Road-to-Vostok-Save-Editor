import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { parseIni, iniBool, iniString } from './ini'

/**
 * Mod profiles. Metro Mod Loader keeps them in `user://mod_config.cfg`:
 *
 *   [settings]
 *   active_profile="Default"
 *   [profile.Default.enabled]
 *   "gse@1.1.7"=true
 *
 * RTV Mod Manager manages the same profiles and mirrors them as
 * `%APPDATA%\VostokModManager\profiles\<name>\profile.json`. Both are read-only here.
 */

export type EnabledMap = Map<string, boolean>

export interface ProfileState {
  /** Name of the active profile, '' when no loader profile file exists */
  active: string
  /** Every profile name found (loader file + Mod Manager) */
  names: string[]
  /** Enabled flags of the active profile; null when unknown */
  enabled: EnabledMap | null
}

export function parseModConfig(text: string): {
  active: string
  profiles: Map<string, EnabledMap>
} {
  const ini = parseIni(text)
  const active = iniString(ini.get('settings')?.get('active_profile'))
  const profiles = new Map<string, EnabledMap>()
  for (const [section, values] of ini) {
    const m = /^profile\.(.+)\.enabled$/.exec(section)
    if (!m) continue
    const map: EnabledMap = new Map()
    for (const [key, raw] of values) map.set(key, iniBool(raw))
    profiles.set(m[1], map)
  }
  // a profile with only a priority section still exists
  for (const section of ini.keys()) {
    const m = /^profile\.(.+)\.priority$/.exec(section)
    if (m && !profiles.has(m[1])) profiles.set(m[1], new Map())
  }
  return { active, profiles }
}

/** Mod Manager's profile.json, tolerant about the exact shape. */
export function parseManagerProfile(
  text: string,
  folderName: string
): { name: string; enabled: EnabledMap } | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  const name = typeof obj.name === 'string' && obj.name ? obj.name : folderName
  const enabled: EnabledMap = new Map()
  const raw = obj.enabled
  if (Array.isArray(raw)) {
    for (const v of raw) if (typeof v === 'string') enabled.set(v, true)
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw)) enabled.set(k, v === true)
  }
  return { name, enabled }
}

export async function readProfileState(
  userDir: string | null,
  managerDir: string | null
): Promise<ProfileState> {
  const names = new Set<string>()
  let active = ''
  let enabled: EnabledMap | null = null
  const loader = new Map<string, EnabledMap>()

  if (userDir) {
    try {
      const parsed = parseModConfig(await readFile(join(userDir, 'mod_config.cfg'), 'utf8'))
      active = parsed.active
      for (const [n, m] of parsed.profiles) {
        names.add(n)
        loader.set(n, m)
      }
    } catch {
      // no loader config: every mod in the folder is treated as enabled
    }
  }

  const manager = new Map<string, EnabledMap>()
  if (managerDir) {
    try {
      const profilesDir = join(managerDir, 'profiles')
      for (const entry of await readdir(profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        try {
          const parsed = parseManagerProfile(
            await readFile(join(profilesDir, entry.name, 'profile.json'), 'utf8'),
            entry.name
          )
          if (parsed) {
            names.add(parsed.name)
            manager.set(parsed.name, parsed.enabled)
          }
        } catch {
          // unreadable profile: skip it
        }
      }
    } catch {
      // Mod Manager not installed
    }
  }

  if (!active && names.size === 1) active = [...names][0]
  // the loader file is what the game actually reads; the manager copy is the fallback
  enabled = loader.get(active) ?? manager.get(active) ?? null
  if (enabled && enabled.size === 0) enabled = null
  return { active, names: [...names].sort(), enabled }
}

/** true/false when the profile says so, null when it does not mention the mod. */
export function isModEnabled(
  mod: { id: string; version: string; file: string },
  enabled: EnabledMap | null
): boolean | null {
  if (!enabled) return null
  const stem = mod.file.replace(/\.[^.]+$/, '')
  const keys = [`${mod.id}@${mod.version}`, mod.file, stem, mod.id]
  for (const k of keys) if (enabled.has(k)) return enabled.get(k) === true
  const lower = mod.id.toLowerCase()
  for (const [k, v] of enabled) {
    if (k.toLowerCase() === lower || k.toLowerCase().startsWith(lower + '@')) return v
  }
  return null
}

/** MCM stores the "Default" profile as config.ini and the others as <profile>.ini. */
export function mcmIniName(profile: string): string {
  return !profile || profile === 'Default' ? 'config.ini' : `${profile}.ini`
}
