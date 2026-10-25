import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  listSaves: (): Promise<{ fileName: string }[]> => ipcRenderer.invoke('saves:list'),
  loadSave: (fileName: string): Promise<string> => ipcRenderer.invoke('saves:load', fileName),
  saveSave: (fileName: string, content: string): Promise<void> =>
    ipcRenderer.invoke('saves:save', fileName, content),
  createSave: (fileName: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('saves:create', fileName, content),
  backupSave: (): Promise<void> => ipcRenderer.invoke('saves:backup'),
  getSaveDir: (): Promise<string> => ipcRenderer.invoke('saves:get-dir'),
  openSaveDir: (): Promise<void> => ipcRenderer.invoke('saves:open-dir'),

  // Installed mods (Gear Storage Expansion, item mods, ...)
  scanMods: (): Promise<ModScan> => ipcRenderer.invoke('mods:scan'),

  // Backups
  listBackups: (): Promise<BackupEntry[]> => ipcRenderer.invoke('backups:list'),
  restoreBackup: (folderName: string): Promise<void> =>
    ipcRenderer.invoke('backups:restore', folderName),
  openBackupsDir: (): Promise<void> => ipcRenderer.invoke('backups:open-dir'),

  // Icons
  getIconStatus: (): Promise<IconStatus> => ipcRenderer.invoke('icons:get-status'),
  extractIcons: (force?: boolean): Promise<void> => ipcRenderer.invoke('icons:extract-all', force),
  getIcon: (itemId: string): Promise<string | null> => ipcRenderer.invoke('icons:get', itemId),
  onIconProgress: (cb: (data: { current: number; total: number }) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { current: number; total: number }
    ): void => cb(data)
    ipcRenderer.on('icons:progress', handler)
    return () => ipcRenderer.removeListener('icons:progress', handler)
  }
}

export interface InstalledMod {
  file: string
  id: string
  name: string
  version: string
  author: string
}

export interface ModItem {
  category: string
  id: string
  displayName: string
  resourcePath: string
  sizeW: number
  sizeH: number
  stackable: boolean
  showAmount: boolean
  defaultAmount: number
  maxAmount: number
  showCondition: boolean
  slots: string[]
  modId: string
}

export interface ModScan {
  modsDir: string | null
  mods: InstalledMod[]
  items: ModItem[]
  gseSettingsIni: string | null
  warnings: string[]
}

export interface BackupEntry {
  folderName: string
  timestamp: number
  size: number
}

export type IconStatus =
  | { status: 'idle' }
  | { status: 'extracting'; progress: number; total: number }
  | { status: 'done' }
  | { status: 'error'; error: string }
  | { status: 'not-found' }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
