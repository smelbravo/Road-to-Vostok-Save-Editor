import { ipcMain, nativeImage } from 'electron'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { findGamePckPath } from '../game-path'
import { scanMods, type ModScan } from '../mods'
import { open, mkdir, writeFile, stat, readdir } from 'fs/promises'
import { getSaveDir } from './save-handlers'
import { scanGameItems, scanGameTasks } from '../game-items'
import { listPckEntries, decodeCtex, decodeDxt5, encodePng, getCacheDir } from '../icon-extractor'
import { imageFromRsrc, toRgba, decodeDxt1 } from '../rsrc-image'

/**
 * Pulls the embedded image out of a Godot 4 .ctex. Lossless/lossy textures keep a normal
 * PNG/WebP stream inside; VRAM-compressed ones (DXT5) are decoded by the icon extractor.
 */
function ctexToImage(data: Buffer): { ext: 'png' | 'webp'; data: Buffer } | string {
  if (data.length < 56 || data.toString('ascii', 0, 4) !== 'GST2') return 'not a Godot texture'
  const png = data.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 36)
  if (png >= 0) return { ext: 'png', data: data.subarray(png) }
  const riff = data.indexOf(Buffer.from('RIFF'), 36)
  if (riff >= 0 && data.toString('ascii', riff + 8, riff + 12) === 'WEBP') {
    return { ext: 'webp', data: data.subarray(riff) }
  }
  try {
    const d = decodeCtex(data)
    return { ext: 'png', data: encodePng(d.rgba, d.width, d.height) }
  } catch (e) {
    return e instanceof Error ? e.message : 'unsupported texture format'
  }
}

/** Writes an icon found inside a mod to the icon cache as `<key>.png` (what ItemIcon loads). */
async function storeModIcon(key: string, ext: string, data: Buffer): Promise<true | string> {
  try {
    let out: Buffer
    if (ext === 'png' || ext === 'webp')
      out = data // the browser sniffs the real format
    else if (ext === 'jpg' || ext === 'jpeg') out = nativeImage.createFromBuffer(data).toPNG()
    else if (ext === 'ctex') {
      const img = ctexToImage(data)
      if (typeof img === 'string') return img
      out = img.data
    } else if (ext === 'res') {
      const img = imageFromRsrc(data)
      if (typeof img === 'string') return img
      let rgba = toRgba(img)
      if (!rgba && img.format === 'DXT5') rgba = decodeDxt5(img.data, img.width, img.height)
      if (!rgba && img.format === 'DXT1') rgba = decodeDxt1(img.data, img.width, img.height)
      if (!rgba) return `unsupported image format ${img.format}`
      out = encodePng(rgba, img.width, img.height)
    } else return `unsupported icon format .${ext}`
    if (out.length === 0) return 'empty image'
    const dir = getCacheDir()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${key}.png`), out)
    return true
  } catch (e) {
    return e instanceof Error ? e.message : 'could not write the icon'
  }
}

// Scans are expensive (zip central directories, PCK reads, icon conversion) and the renderer asks
// on every init / slot switch. Results are reused while the inputs are unchanged.
const gameCache = new Map<string, unknown>()
let modCache: { key: string; scan: ModScan } | null = null

async function statKey(path: string): Promise<string> {
  try {
    const st = await stat(path)
    return `${path}|${st.size}|${st.mtimeMs}`
  } catch {
    return `${path}|missing`
  }
}

async function modsSignature(modsDir: string | null, userDir: string | null): Promise<string> {
  const parts: string[] = [`user:${userDir}`]
  if (modsDir) {
    try {
      for (const name of (await readdir(modsDir)).sort())
        parts.push(await statKey(join(modsDir, name)))
    } catch {
      parts.push('unreadable')
    }
  }
  return parts.join('\n')
}

export function registerModHandlers(): void {
  // What mods are installed and which items they add. Never throws: a missing game
  // install simply means an empty result (the editor then works from its built-in catalog).
  ipcMain.handle('mods:scan', async (_event, force?: boolean): Promise<ModScan> => {
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
    const key = await modsSignature(modsDir, userDir)
    if (!force && modCache?.key === key) return modCache.scan
    const scan = {
      modsDir,
      ...(await scanMods({ modsDir, userDir, managerDir, onIcon: storeModIcon }))
    }
    modCache = { key, scan }
    return scan
  })

  // Items found in the game's own files (RTV.pck). Never throws.
  ipcMain.handle('mods:scan-game', async (_event, force?: boolean) => {
    const empty = {
      totalFiles: 0,
      samplePaths: [] as string[],
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
      const key = await statKey(pck)
      const hit = gameCache.get(`items:${key}`)
      if (!force && hit) return hit
      const entries = await listPckEntries(pck)
      fh = await open(pck, 'r')
      const handle = fh
      const result = await scanGameItems(entries, async (f) => {
        const buf = Buffer.alloc(f.size)
        await handle.read(buf, 0, f.size, f.offset)
        return buf
      })
      const out = { ...result, pckPath: pck }
      gameCache.set(`items:${key}`, out)
      return out
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

  // Tasks (TaskData) found in the game's own files. Never throws.
  ipcMain.handle('mods:scan-tasks', async (_event, force?: boolean) => {
    const empty = { tasks: [], checked: 0, propertyNames: [] as string[] }
    let fh: Awaited<ReturnType<typeof open>> | null = null
    try {
      const pck = await findGamePckPath()
      if (!pck) return empty
      const key = `tasks:${await statKey(pck)}`
      const hit = gameCache.get(key)
      if (!force && hit) return hit as Awaited<ReturnType<typeof scanGameTasks>>
      const entries = await listPckEntries(pck)
      fh = await open(pck, 'r')
      const handle = fh
      const result = await scanGameTasks(entries, async (f) => {
        const buf = Buffer.alloc(f.size)
        await handle.read(buf, 0, f.size, f.offset)
        return buf
      })
      gameCache.set(key, result)
      return result
    } catch {
      return empty
    } finally {
      await fh?.close()
    }
  })
}
