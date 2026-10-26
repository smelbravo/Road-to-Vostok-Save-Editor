/** Run with: bun scripts/test-slots-profiles.ts */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseIni, iniBool } from '../src/main/ini'
import {
  parseModConfig,
  parseManagerProfile,
  isModEnabled,
  mcmIniName,
  readProfileState
} from '../src/main/profiles'
import {
  configureSaveRoot,
  getSourceInfo,
  setSource,
  writeSaveFile,
  createSaveFile,
  readDir,
  sourceTag
} from '../src/main/save-source'
import {
  parseRsrc,
  itemFromRsrc,
  itemFromPath,
  scanGameItems,
  type PckFile
} from '../src/main/game-items'
import { scanMods, parseItemTres } from '../src/main/mods'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}${ok || !detail ? '' : ' ' + detail}`)
  if (!ok) failures++
}

// ini
const ini = parseIni(
  '[settings]\nactive_profile="My Profile"\n[profile.My Profile.enabled]\n"gse@1.1.7"=true\n"a=b@1"=false\n'
)
check('ini quoted keys', ini.get('profile.My Profile.enabled')?.get('a=b@1') === 'false')
check('ini bool', iniBool(ini.get('profile.My Profile.enabled')?.get('gse@1.1.7')))

// profiles
const cfg = parseModConfig(
  '[settings]\nactive_profile="Hardcore"\n[profile.Default.enabled]\n"gse@1.1.7"=true\n[profile.Hardcore.enabled]\n"gse@1.1.7"=false\n"smel-ucm@2.0"=true\n[profile.Hardcore.priority]\n"gse@1.1.7"=5\n'
)
check('active profile', cfg.active === 'Hardcore' && cfg.profiles.size === 2)
const gse = { id: 'gse', version: '1.1.7', file: 'gse__v1.1.7.vmz' }
check('enabled per profile', isModEnabled(gse, cfg.profiles.get('Default') ?? null) === true)
check('disabled per profile', isModEnabled(gse, cfg.profiles.get('Hardcore') ?? null) === false)
check(
  'unknown mod null',
  isModEnabled({ id: 'zzz', version: '1', file: 'z.vmz' }, cfg.profiles.get('Hardcore') ?? null) ===
    null
)
check(
  'mcm ini names',
  mcmIniName('Default') === 'config.ini' && mcmIniName('Hardcore') === 'Hardcore.ini'
)
check(
  'manager profile',
  parseManagerProfile('{"name":"P","enabled":{"gse@1":true}}', 'f')?.enabled.get('gse@1') === true
)
check('manager bad json', parseManagerProfile('nope', 'f') === null)

// slots
const root = mkdtempSync(join(tmpdir(), 'rtv-'))
configureSaveRoot(root)
writeFileSync(join(root, 'Character.tres'), 'live')
mkdirSync(join(root, 'MultiSaveSlots', 'slot1'), { recursive: true })
mkdirSync(join(root, 'MultiSaveSlots', 'slot2'), { recursive: true })
writeFileSync(join(root, 'MultiSaveSlots', 'state.cfg'), '[state]\nactive_slot=2\n')
writeFileSync(join(root, 'MultiSaveSlots', 'slot1', 'Character.tres'), 'one')
writeFileSync(
  join(root, 'MultiSaveSlots', 'slot1', '_meta.cfg'),
  '[meta]\ndisplay_name="Run A"\ndead=true\nprofile="Hardcore"\n'
)
writeFileSync(join(root, 'MultiSaveSlots', 'slot2', 'Character.tres'), 'two')
let info = await getSourceInfo()
check('slots found', info.slotsAvailable && info.slots.length === 2 && info.activeSlot === 2)
check(
  'meta read',
  info.slots[0].displayName === 'Run A' &&
    info.slots[0].dead &&
    info.slots[0].profile === 'Hardcore'
)
await setSource({ kind: 'slot', slot: 1 })
await writeSaveFile('Character.tres', 'edited1')
check(
  'non-active slot writes slot only',
  readFileSync(join(root, 'MultiSaveSlots/slot1/Character.tres'), 'utf8') === 'edited1' &&
    readFileSync(join(root, 'Character.tres'), 'utf8') === 'live'
)
check('slot tag', sourceTag() === 'slot1_')
await setSource({ kind: 'slot', slot: 2 })
await writeSaveFile('Character.tres', 'edited2')
check(
  'active slot mirrors',
  readFileSync(join(root, 'Character.tres'), 'utf8') === 'edited2' &&
    readFileSync(join(root, 'MultiSaveSlots/slot2/Character.tres'), 'utf8') === 'edited2'
)
check('create refuses existing', (await createSaveFile('Character.tres', 'x')) === false)
await setSource({ kind: 'slot', slot: 9 })
check('missing slot falls back to live', (await readDir()) === root)
let threw = false
try {
  await writeSaveFile('../x.tres', 'x')
} catch {
  threw = true
}
check('path traversal rejected', threw)

// profile-aware scan
const userDir = root
mkdirSync(join(root, 'MCM', 'GSE'), { recursive: true })
writeFileSync(join(root, 'MCM', 'GSE', 'config.ini'), 'default')
writeFileSync(join(root, 'MCM', 'GSE', 'Hardcore.ini'), 'hardcore')
writeFileSync(
  join(root, 'mod_config.cfg'),
  '[settings]\nactive_profile="Hardcore"\n[profile.Hardcore.enabled]\n"gse@1.1.7"=true\n'
)
const scan = await scanMods({ modsDir: null, userDir, managerDir: null })
check(
  'per-profile GSE ini',
  scan.gseSettingsIni === 'hardcore' && scan.activeProfile === 'Hardcore'
)
const st = await readProfileState(userDir, null)
check('profile state', st.names.includes('Hardcore') && st.enabled?.get('gse@1.1.7') === true)
check('no mod_config tolerated', (await readProfileState(join(root, 'nope'), null)).active === '')
check('tmp exists', existsSync(root))

// RSRC (synthetic; built to my reading of the format, NOT produced by Godot)
function str(s: string): Buffer {
  const b = Buffer.from(s + '\0', 'utf8')
  const l = Buffer.alloc(4)
  l.writeUInt32LE(b.length)
  return Buffer.concat([l, b])
}
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: number): Buffer => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
const f32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeFloatLE(n)
  return b
}
function buildRsrc(props: [string, Buffer][], extraBadVariant = false): Buffer {
  const names = props.map((p) => p[0])
  const head = Buffer.concat([
    Buffer.from('RSRC'),
    u32(0),
    u32(0),
    u32(4),
    u32(3),
    u32(5),
    str('Resource'),
    u64(0),
    u32(8),
    u64(0),
    str('ItemData'),
    ...Array.from({ length: 11 }, () => u32(0)),
    u32(names.length),
    ...names.map(str),
    u32(0),
    u32(1)
  ])
  const entry = Buffer.concat([str('res://x.tres')])
  const offsetPos = head.length + entry.length
  const body = Buffer.concat([
    str('Resource'),
    u32(props.length + (extraBadVariant ? 1 : 0)),
    ...props.map(([n, v]) => Buffer.concat([u32(names.indexOf(n)), v])),
    ...(extraBadVariant ? [u32(0), u32(999)] : [])
  ])
  return Buffer.concat([head, entry, u64(offsetPos + 8), body])
}
const sv = (s: string): Buffer => Buffer.concat([u32(5), str(s)])
const rsrc = buildRsrc([
  ['file', sv('Med_X')],
  ['name', sv('Med X')],
  ['type', sv('Medical')],
  ['size', Buffer.concat([u32(10), f32(2), f32(3)])],
  ['stackable', Buffer.concat([u32(2), u32(1)])],
  ['maxAmount', Buffer.concat([u32(3), u32(5)])]
])
const parsed = parseRsrc(rsrc)
const item = parsed && itemFromRsrc(parsed, 'res://Items/Medical/Med_X/Med_X.tres')
check(
  'rsrc item',
  item?.displayName === 'Med X' &&
    item.sizeW === 2 &&
    item.sizeH === 3 &&
    item.stackable &&
    item.maxAmount === 5 &&
    item.category === 'Medical'
)
const partial = parseRsrc(
  buildRsrc(
    [
      ['name', sv('N')],
      ['type', sv('Misc')]
    ],
    true
  )
)
check(
  'unknown variant stops cleanly',
  partial !== null && !partial.complete && partial.props.get('name') === 'N'
)
check('garbage rejected', parseRsrc(Buffer.from('nonsense'.repeat(20))) === null)
check('truncated rejected', parseRsrc(rsrc.subarray(0, 120)) === null)

// pck scan
const store = new Map<string, Buffer>()
const files: PckFile[] = []
const add = (path: string, data: Buffer): void => {
  store.set(path, data)
  files.push({ path, offset: 0, size: data.length })
}
add(
  'res://Items/Medical/Med_X/Med_X.tres.remap',
  Buffer.from('[remap]\n\nimporter="keep"\npath="res://.godot/exported/1/export-a-Med_X.res"\n')
)
add('res://.godot/exported/1/export-a-Med_X.res', rsrc)
add(
  'res://Items/Misc/Odd_Thing/Odd_Thing.tres.remap',
  Buffer.from('[remap]\npath="res://.godot/exported/1/missing.res"\n')
)
add(
  'res://Items/Misc/Txt/Txt.tres',
  Buffer.from(
    '[gd_resource type="Resource" script_class="ItemData" format=3]\n\n[resource]\nfile = "Txt"\nname = "Text Item"\ntype = "Misc"\n'
  )
)
add('res://Other/thing.tres', Buffer.from('x'))
const res = await scanGameItems(files, async (f) => store.get(f.path)!)
check(
  'pck scan counts',
  res.scanned === 3 && res.items.length === 3,
  JSON.stringify(res.items.map((i) => [i.id, i.parsed]))
)
check('pck parsed binary', res.items.find((i) => i.id === 'Med_X')?.parsed === true)
check('pck text parsed', res.items.find((i) => i.id === 'Txt')?.displayName === 'Text Item')
check(
  'pck fallback by path',
  res.items.find((i) => i.id === 'Odd_Thing')?.parsed === false &&
    itemFromPath('res://Items/Misc/Odd_Thing/Odd_Thing.tres')?.displayName === 'Odd Thing'
)

// icons
const iconItem = parseItemTres(
  '[gd_resource type="Resource" script_class="ItemData" format=3]\n\n[ext_resource type="Texture2D" uid="uid://abc" path="res://mods/x/gfx/icon_a.png" id="2_zz"]\n\n[resource]\nname = "A"\ntype = "Misc"\nicon = ExtResource("2_zz")\n',
  'res://mods/x/A.tres',
  'x'
)
check(
  'mod icon path',
  iconItem?.iconPath === 'res://mods/x/gfx/icon_a.png',
  String(iconItem?.iconPath)
)
const iconFiles: PckFile[] = [
  {
    path: 'res://.godot/imported/Icon_Machete.png-0123456789abcdef0123456789abcdef.s3tc.ctex',
    offset: 0,
    size: 1
  },
  { path: 'res://Items/Knives/Machete/Machete.tres', offset: 0, size: 1 }
]
const r2 = await scanGameItems(iconFiles, async () => Buffer.from('x'))
check(
  'game icon by id guess',
  r2.items[0]?.iconFile === 'Icon_Machete.png-0123456789abcdef0123456789abcdef.s3tc.ctex',
  JSON.stringify(r2.items[0])
)

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
