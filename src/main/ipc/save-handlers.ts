import { ipcMain, shell } from 'electron'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { createBackup } from './backup-handlers'
import {
  configureSaveRoot,
  createSaveFile,
  getSourceInfo,
  readDir,
  setSource,
  validateTresName,
  writeSaveFile,
  type SaveSource
} from '../save-source'

export const SAVE_DIR_NAME = 'Road to Vostok'

/** The game's `user://` folder (never a slot folder). */
export function getSaveDir(): string {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('APPDATA environment variable not set')
  const dir = join(appData, SAVE_DIR_NAME)
  configureSaveRoot(dir)
  return dir
}

export function registerSaveHandlers(): void {
  ipcMain.handle('saves:list', async () => {
    getSaveDir()
    const entries = await readdir(await readDir())
    return entries.filter((f) => f.endsWith('.tres')).map((fileName) => ({ fileName }))
  })

  ipcMain.handle('saves:load', async (_event, fileName: string) => {
    getSaveDir()
    validateTresName(fileName)
    return readFile(join(await readDir(), fileName), 'utf-8')
  })

  // Folder the editor currently reads from (live folder or a slot folder)
  ipcMain.handle('saves:get-dir', async () => {
    getSaveDir()
    return readDir()
  })

  ipcMain.handle('saves:open-dir', async () => {
    getSaveDir()
    await shell.openPath(await readDir())
  })

  ipcMain.handle('saves:save', async (_event, fileName: string, content: string) => {
    getSaveDir()
    await writeSaveFile(fileName, content)
  })

  ipcMain.handle('saves:create', async (_event, fileName: string, content: string) => {
    getSaveDir()
    return createSaveFile(fileName, content)
  })

  ipcMain.handle('saves:backup', async () => {
    getSaveDir()
    await createBackup()
  })

  // Save-slot mods (Save Slots / Multi Save Slots Reborn)
  ipcMain.handle('saves:source-info', async () => {
    getSaveDir()
    return getSourceInfo()
  })

  ipcMain.handle('saves:set-source', async (_event, source: SaveSource) => {
    getSaveDir()
    if (source.kind === 'slot' && !Number.isInteger(source.slot)) throw new Error('Invalid slot')
    return setSource(
      source.kind === 'slot' ? { kind: 'slot', slot: source.slot } : { kind: 'live' }
    )
  })
}
