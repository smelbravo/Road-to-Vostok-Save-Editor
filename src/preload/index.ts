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

  // Save-slot mods (Save Slots / Multi Save Slots Reborn)
  getSourceInfo: (): Promise<SourceInfo> => ipcRenderer.invoke('saves:source-info'),
  setSaveSource: (source: SaveSource): Promise<SourceInfo> =>
    ipcRenderer.invoke('saves:set-source', source),

  // Installed mods (Gear Storage Expansion, item mods, ...) and the game's own items
  scanMods: (force = false): Promise<ModScan> => ipcRenderer.invoke('mods:scan', force),
  scanGameItems: (force = false): Promise<GameCatalog> =>
    ipcRenderer.invoke('mods:scan-game', force),
  scanGameTasks: (force = false): Promise<GameTaskScan> =>
    ipcRenderer.invoke('mods:scan-tasks', force),

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
  location: 'mods' | 'library'
  enabled: boolean | null
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
  /** ItemData.subtype */
  subtype?: string
  /** Weapons: attachments listed as compatible */
  compatible?: string[]
  /** Weapons: attachment overlays of the inventory icon (from the mod's `tetris` scene) */
  layout?: {
    base: string
    overlays: {
      name: string
      position: [number, number]
      scale: number
      behind: boolean
      /** Icon cache key of the sprite's own texture */
      iconFile?: string
      fill?: boolean
    }[]
    hidden: string[]
  }
  iconFile?: string
}

export interface ModScan {
  modsDir: string | null
  mods: InstalledMod[]
  items: ModItem[]
  gseSettingsIni: string | null
  activeProfile: string
  profiles: string[]
  iconProblems: { reason: string; count: number; examples: string[] }[]
  warnings: string[]
}

export type SaveSource = { kind: 'live' } | { kind: 'slot'; slot: number }

export interface SlotInfo {
  slot: number
  active: boolean
  occupied: boolean
  displayName: string
  lastMap: string
  lastPlayIso: string
  dead: boolean
  profile: string
}

export interface SourceInfo {
  source: SaveSource
  slotsAvailable: boolean
  activeSlot: number
  slots: SlotInfo[]
  dir: string
}

export interface GameTask {
  path: string
  scriptClass: string
  props: Record<string, string | number | boolean | (string | number | boolean)[] | null>
}

export interface GameTaskScan {
  tasks: GameTask[]
  checked: number
  propertyNames: string[]
}

export interface GameCatalog {
  items: (ModItem & { parsed: boolean })[]
  totalFiles: number
  samplePaths: string[]
  scanned: number
  unreadable: number
  pckPath: string | null
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
