import { ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { findGamePckPath } from '../game-path'
import { scanMods, type ModScan } from '../mods'
import { open } from 'fs/promises'
import { getSaveDir } from './save-handlers'
import { scanGameItems } from '../game-items'
import { listPckEntries } from '../icon-extractor'

export function registerModHandlers(): void {
  // What mods are installed and which items they add. Never throws: a missing game
  // install simply means an empty result (the editor then works from its built-in catalog).
  ipcMain.handle('mods:scan', async (): Promise<ModScan> => {
    let modsDir: string | null = null
    try {
      const pck = await findGamePckPath()
      if (pck) {
        const candidate = join(dirname(pck), 'mods')
        if (existsSync(candidate)) modsDir = candidate
      }
    } catch {
      modsDir = null
    }
    let userDir: string | null = null
    try {
      userDir = getSaveDir()
    } catch {
      userDir = null
    }
    const appData = process.env.APPDATA
    const managerDir = appData ? join(appData, 'VostokModManager') : null
    const scan = await scanMods({ modsDir, userDir, managerDir })
    return { modsDir, ...scan }
  })

  // Items found in the game's own files (RTV.pck). Never throws.
  ipcMain.handle('mods:scan-game', async () => {
    const empty = {
      items: [],
      scanned: 0,
      unreadable: 0,
      pckPath: null as string | null,
      warnings: [] as string[]
    }
    let pck: string | null = null
    try {
      pck = await findGamePckPath()
    } catch {
      pck = null
    }
    if (!pck) return { ...empty, warnings: ['Game files (RTV.pck) not found'] }
    let fh: Awaited<ReturnType<typeof open>> | null = null
    try {
      const entries = await listPckEntries(pck)
      fh = await open(pck, 'r')
      const handle = fh
      const result = await scanGameItems(entries, async (f) => {
        const buf = Buffer.alloc(f.size)
        await handle.read(buf, 0, f.size, f.offset)
        return buf
      })
      return { ...result, pckPath: pck }
    } catch (e) {
      return {
        ...empty,
        pckPath: pck,
        warnings: [e instanceof Error ? e.message : 'Could not read the game files']
      }
    } finally {
      await fh?.close()
    }
  })
}
