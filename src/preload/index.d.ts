import { ElectronAPI } from '@electron-toolkit/preload'

interface BackupEntry {
  folderName: string
  timestamp: number
  size: number
}

type IconStatus =
  | { status: 'idle' }
  | { status: 'extracting'; progress: number; total: number }
  | { status: 'done' }
  | { status: 'error'; error: string }
  | { status: 'not-found' }

interface SaveApi {
  getAppVersion(): Promise<string>
  listSaves(): Promise<{ fileName: string }[]>
  loadSave(fileName: string): Promise<string>
  saveSave(fileName: string, content: string): Promise<void>
  createSave(fileName: string, content: string): Promise<boolean>
  backupSave(): Promise<void>
  getSaveDir(): Promise<string>
  openSaveDir(): Promise<void>

  // Installed mods
  scanMods(): Promise<ModScan>

  // Backups
  listBackups(): Promise<BackupEntry[]>
  restoreBackup(folderName: string): Promise<void>
  openBackupsDir(): Promise<void>

  // Icons
  getIconStatus(): Promise<IconStatus>
  extractIcons(force?: boolean): Promise<void>
  getIcon(itemId: string): Promise<string | null>
  onIconProgress(cb: (data: { current: number; total: number }) => void): () => void
}

declare global {
  interface InstalledMod {
    file: string
    id: string
    name: string
    version: string
    author: string
  }

  interface ModItem {
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

  interface ModScan {
    modsDir: string | null
    mods: InstalledMod[]
    items: ModItem[]
    /** Text of the newest user://MCM/GSE/*.ini, when Gear Storage Expansion saved settings */
    gseSettingsIni: string | null
    warnings: string[]
  }

  interface Window {
    electron: ElectronAPI
    api: SaveApi
  }
}
