/**
 * Checks the Gear Storage Expansion layout tables against the mod's documented defaults.
 * Run with: npx tsx scripts/test-gse-layout.ts
 */
import {
  describeKey,
  gseLayoutFor,
  parseGseSettings,
  specsForUnlistedKeys
} from '../src/renderer/src/data/gse'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}${ok || !detail ? '' : ' ' + detail}`)
  if (!ok) failures++
}
const keys = (
  path: string,
  slot = '',
  slots: string[] = [],
  s?: ReturnType<typeof parseGseSettings>
) =>
  gseLayoutFor(path, slot, slots, s)
    .map((g) => g.key)
    .join(',')

check(
  'Patrol backpack',
  keys('res://Items/Backpacks/Backpack_Patrol/Backpack_Patrol.tres') ===
    'main,gun1,gun2,sleep,mess,water,carrier,med'
)
check(
  'Patrol open grid is 4x5',
  gseLayoutFor('res://x/Backpack_Patrol.tres')[0].w === 4 &&
    gseLayoutFor('res://x/Backpack_Patrol.tres')[0].h === 5
)
check(
  'K19 rig uses layout B',
  keys('res://x/K19.tres') === 'holster,mag1,mag2,mag3,mag4,pmag1,pmag2,ammo,ammo2,med,med2'
)
check('Combat boots holster', keys('res://x/Boots_Combat.tres') === 'holster')
check('Jeans: two pockets', keys('res://x/Jeans_Black.tres') === 'main,main2')
check(
  'Unknown gear from a mod falls back by slot',
  keys('res://mods/x/Cool_Pack.tres', 'Backpack') === 'main,gun1,sleep,mess,water,med'
)
check('Helmet has no storage', keys('res://x/Helmet.tres', 'Helmet') === '')

const settings = parseGseSettings(
  [
    '[jaeger]',
    'jaeger_open_size={ "name": "Open grid size", "value": Vector2(6, 7) }',
    'jaeger_box_weapon={ "value": 3 }',
    '[rigsel]',
    'rigsel2_K19={ "value": "C" }',
    '[global]',
    'gs_size_preset={ "value": "compact" }'
  ].join('\n')
)
check(
  'MCM settings parsed',
  JSON.stringify(settings.values['jaeger_open_size']) === '[6,7]' &&
    settings.values['jaeger_box_weapon'] === 3
)
check(
  'MCM rig layout choice',
  keys('res://x/K19.tres', '', [], settings) === 'holster,anymag1,anymag2,anymag3,anymag4,ammo,med'
)
const compact = gseLayoutFor('res://x/Backpack_Jaeger_Black.tres', '', [], settings)[0]
check(
  'compact preset scales the open grid',
  compact.w === 5 && compact.h === 5,
  JSON.stringify(compact)
)

check(
  'key kinds',
  describeKey('mag2')?.kind === 'magazine_long' &&
    describeKey('main3')?.index === 2 &&
    describeKey('pmag1')?.kind === 'magazine_pistol'
)
check(
  'unknown keys are kept visible',
  specsForUnlistedKeys(['zzz', 'gun3'], [], new Map()).length === 2
)

if (failures > 0) process.exit(1)
console.log('\nAll layout checks passed')
