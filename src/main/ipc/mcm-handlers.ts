import { ipcMain } from 'electron'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSaveDir } from './save-handlers'

/**
 * Mod Configuration Menu (MCM) keeps one folder per mod in the game's user:// folder, with one
 * `.ini` per RTV Mod Manager profile (`config.ini` for "Default"). The files hold, for every
 * setting, its current value and everything needed to draw it (name, tooltip, range, options).
 */

const MAX_INI_BYTES = 2 * 1024 * 1024
const SAFE_NAME = /^[^/\\:*?"<>|]+$/

export interface McmModFiles {
  modId: string
  files: { name: string; text: string }[]
}

async function listMcm(): Promise<{ dir: string; mods: McmModFiles[] }> {
  const dir = join(getSaveDir(), 'MCM')
  const mods: McmModFiles[] = []
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return { dir, mods }
  }
  for (const modId of names.sort((a, b) => a.localeCompare(b))) {
    const modDir = join(dir, modId)
    try {
      if (!(await stat(modDir)).isDirectory()) continue
      const files: McmModFiles['files'] = []
      for (const name of (await readdir(modDir)).sort()) {
        if (!name.toLowerCase().endsWith('.ini')) continue
        const full = join(modDir, name)
        if ((await stat(full)).size > MAX_INI_BYTES) continue
        files.push({ name, text: await readFile(full, 'utf-8') })
      }
      if (files.length > 0) mods.push({ modId, files })
    } catch {
      // an unreadable mod folder must not hide the others
    }
  }
  return { dir, mods }
}

export function registerMcmHandlers(): void {
  ipcMain.handle('mcm:list', () => listMcm())

  ipcMain.handle('mcm:save', async (_event, modId: string, fileName: string, text: string) => {
    if (!SAFE_NAME.test(modId) || !SAFE_NAME.test(fileName) || !fileName.endsWith('.ini'))
      throw new Error('Invalid MCM file name')
    if (Buffer.byteLength(text) > MAX_INI_BYTES) throw new Error('Settings file is too large')
    const modDir = join(getSaveDir(), 'MCM', modId)
    const file = join(modDir, fileName)
    await mkdir(modDir, { recursive: true })
    // Keep the previous version next to it, so a bad edit can be undone by hand
    try {
      await copyFile(file, file + '.editor-backup')
    } catch {
      // no previous file
    }
    await writeFile(file, text, 'utf-8')
  })
}
