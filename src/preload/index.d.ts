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

  // Save-slot mods (Save Slots / Multi Save Slots Reborn)
  getSourceInfo(): Promise<SourceInfo>
  setSaveSource(source: SaveSource): Promise<SourceInfo>

  // Installed mods
  scanMods(): Promise<ModScan>
  scanGameItems(): Promise<GameCatalog>
  scanGameTasks(): Promise<GameTaskScan>

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
    /** Lives in mods/ or in RTV Mod Manager's mods/Library */
    location: 'mods' | 'library'
    /** Enabled in the active profile; null when no profile mentions it */
    enabled: boolean | null
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
    /** Icon cache key (extracted from the mod or the game files) */
    iconFile?: string
  }

  interface ModScan {
    modsDir: string | null
    mods: InstalledMod[]
    items: ModItem[]
    /** Text of the newest user://MCM/GSE/*.ini, when Gear Storage Expansion saved settings */
    gseSettingsIni: string | null
    /** Active Metro Mod Loader / RTV Mod Manager profile ('' when none) and every known profile */
    activeProfile: string
    profiles: string[]
    /** Modded items without an icon, by reason, with examples */
    iconProblems: { reason: string; count: number; examples: string[] }[]
    warnings: string[]
  }

  type SaveSource = { kind: 'live' } | { kind: 'slot'; slot: number }

  interface SlotInfo {
    slot: number
    active: boolean
    occupied: boolean
    displayName: string
    lastMap: string
    lastPlayIso: string
    dead: boolean
    profile: string
  }

  interface SourceInfo {
    source: SaveSource
    slotsAvailable: boolean
    activeSlot: number
    slots: SlotInfo[]
    /** Folder the editor currently reads from */
    dir: string
  }

  interface GameTask {
    path: string
    scriptClass: string
    props: Record<string, string | number | boolean | (string | number | boolean)[] | null>
  }

  interface GameTaskScan {
    tasks: GameTask[]
    checked: number
    propertyNames: string[]
  }

  interface GameCatalog {
    /** Items found in the game's own files, in the same shape as mod items */
    items: (ModItem & { parsed: boolean })[]
    /** How many resources the scan looked at and how many could not be read */
    totalFiles: number
    samplePaths: string[]
    scanned: number
    unreadable: number
    pckPath: string | null
    warnings: string[]
  }

  interface Window {
    electron: ElectronAPI
    api: SaveApi
  }
}
