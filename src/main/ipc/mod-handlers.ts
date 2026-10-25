import { ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { findGamePckPath } from '../game-path'
import { scanMods, type ModScan } from '../mods'
import { getSaveDir } from './save-handlers'

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
    let mcmDir: string | null = null
    try {
      mcmDir = join(getSaveDir(), 'MCM')
    } catch {
      mcmDir = null
    }
    const scan = await scanMods(modsDir, mcmDir)
    return { modsDir, ...scan }
  })
}
