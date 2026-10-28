import { existsSync, readFileSync } from 'fs'
import { parseItemTres, parseTetrisScene } from '../src/main/mods'
import { registerModItems } from '../src/renderer/src/data/mod-items'
import { WEAPON_ATTACHMENT_LAYOUTS } from '../src/renderer/src/data/weapon-attachments'
import { ensureNestedLayout } from '../src/renderer/src/data/mod-layouts'
import { ATTACHMENT_SUBTYPE, getWeaponSlots } from '../src/renderer/src/data/attachment-subtypes'

// Needs the SV-98 mod unpacked at argv[2] (items/ and Scenes/ folders)
const dir = process.argv[2] ?? '/tmp/claude-0/sv98/sv98_green_swamp__v1.0.0'
if (!existsSync(`${dir}/Items/SV98.tres`)) {
  console.log('SV-98 sample not found, skipping (pass its folder as argument)')
  process.exit(0)
}
let fails = 0
const check = (name: string, ok: boolean): void => {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}`)
  if (!ok) fails++
}
const items = ['SV98', 'SV98_Magazine', 'SV98_Scope', 'SV98_Suppressor', 'SV98_Camo'].flatMap(
  (n) => {
    const it = parseItemTres(
      readFileSync(`${dir}/Items/${n}.tres`, 'utf8'),
      `res://mods/SV98/Items/${n}.tres`,
      'sv98'
    )
    return it ? [it] : []
  }
)
const rifle = items.find((i) => i.id === 'SV98')!
rifle.layout = parseTetrisScene(readFileSync(`${dir}/Scenes/SV98_7x2.tscn`, 'utf8'))!
check('rifle parsed with 13 compatible attachments', rifle.compatible?.length === 13)
registerModItems(items as never)
const path = rifle.resourcePath
const layout = WEAPON_ATTACHMENT_LAYOUTS.get(path)
check('layout registered', !!layout)
const names = (layout ?? []).map((o) => o.attachmentPath.split('/').pop())
check('mod scope placed', names.includes('SV98_Scope.tres'))
check(
  'mod magazine placed behind',
  !!layout?.find((o) => o.attachmentPath.endsWith('SV98_Magazine.tres'))?.behind
)
check('inherited vanilla ACOG kept', names.includes('ACOG.tres'))
check('borrowed SVD magazine dropped', !names.includes('SVD_Magazine.tres'))
check('incompatible optics filtered', !names.includes('RMR.tres'))
check(
  'subtype Optic registered',
  ATTACHMENT_SUBTYPE.get('res://mods/SV98/Items/SV98_Scope.tres') === 'Optic'
)
const slots = getWeaponSlots(path)
check(
  'slots: Magazine/Optic/Muzzle',
  ['Magazine', 'Optic', 'Muzzle'].every((k) => slots.has(k as never))
)
check(
  'camo selectable (not drawn)',
  !!layout?.find((o) => o.attachmentPath.endsWith('SV98_Camo.tres'))?.noOverlay
)
check(
  'mod mag keeps its overlay',
  !layout?.find((o) => o.attachmentPath.endsWith('SV98_Magazine.tres'))?.noOverlay
)
// G28-style scene: full-size layers without a position, a magazine instance with its own offset
const g28 = parseTetrisScene(`[gd_scene format=3]

[ext_resource type="PackedScene" path="res://Items/Weapons/M78/M78_7x2.tscn" id="tile"]
[ext_resource type="Texture2D" path="res://mods/G28/Icons/Over_Scope.png" id="o_Scope"]

[node name="G28" instance=ExtResource("tile")]

[node name="G28_Magazine" parent="." instance=ExtResource("tile")]
visible = false
show_behind_parent = true
position = Vector2(-28.7, 42.8)
scale = Vector2(0.903, 0.903)

[node name="G28_Scope" type="Sprite2D" parent="."]
visible = false
use_parent_material = true
texture = ExtResource("o_Scope")
`)!
check(
  'G28 full-size layer parsed',
  g28.overlays.some((o) => o.name === 'G28_Scope' && !!o.texture && o.position[0] === 0)
)
check(
  'G28 magazine instance is a positioned overlay, not a hidden node',
  g28.overlays.some((o) => o.name === 'G28_Magazine' && o.position[0] === -28.7) &&
    g28.hidden.length === 0
)
// Equipped attachments the layout does not list still get a slot
const acog = [...ATTACHMENT_SUBTYPE].find(([k, v]) => v === 'Optic' && k.includes('/ACOG/'))![0]
const muzzle = [...ATTACHMENT_SUBTYPE].find(([, v]) => v === 'Muzzle')![0]
const bare = ensureNestedLayout('res://Items/Weapons/Test/Bare.tres', [acog, muzzle])
check('bare weapon gets selectable slots', bare.length === 2 && bare.every((o) => o.noOverlay))
const borrowed = ensureNestedLayout(path, [muzzle])
check(
  'extra muzzle borrows the position of the weapon muzzle slot',
  borrowed.some((o) => o.attachmentPath === muzzle)
)
console.log(names.join(', '))
process.exit(fails ? 1 : 0)
