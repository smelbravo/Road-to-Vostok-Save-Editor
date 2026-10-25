/**
 * Self-contained checks for the nested `storage` support in the codec
 * (Gear Storage Expansion keeps everything stored in worn gear there).
 *
 * Run with: npx tsx scripts/test-storage-codec.ts   (or: bun scripts/test-storage-codec.ts)
 * Exits with code 1 on the first failed check. Needs no game files or save.
 */

import { parseTresFile } from '../src/renderer/src/lib/tres/parser'
import { serializeTresFile } from '../src/renderer/src/lib/tres/serializer'
import {
  parseCharacter,
  serializeCharacter,
  newSubResourceId,
  type SlotItemData
} from '../src/renderer/src/lib/tres/codec'

// A Character.tres as Godot writes it: sub-resources are listed children first.
const FIXTURE = `[gd_resource type="Resource" script_class="CharacterSave" load_steps=13 format=3 uid="uid://test"]

[ext_resource type="Script" path="res://Scripts/CharacterSave.gd" id="1_char"]
[ext_resource type="Script" path="res://Scripts/SlotData.gd" id="2_slot"]
[ext_resource type="Resource" path="res://Items/Backpacks/Backpack_Patrol/Backpack_Patrol.tres" id="3_bag"]
[ext_resource type="Resource" path="res://Items/Weapons/AKM/AKM.tres" id="4_akm"]
[ext_resource type="Resource" path="res://Items/Weapons/AKM/AKM_Magazine.tres" id="5_mag"]
[ext_resource type="Resource" path="res://Items/Medical/Bandage/Bandage.tres" id="6_bandage"]
[ext_resource type="Resource" path="res://mods/Other/Thing.tres" id="7_mod"]
[ext_resource type="Script" path="res://Scripts/ItemData.gd" id="8_idata"]

[sub_resource type="Resource" id="Resource_gun1"]
script = ExtResource("2_slot")
itemData = ExtResource("4_akm")
nested = Array[ExtResource("8_idata")]([ExtResource("5_mag")])
condition = 83
chamber = true
slot = "gun1"
modderField = "keep me"

[sub_resource type="Resource" id="Resource_med1"]
script = ExtResource("2_slot")
itemData = ExtResource("6_bandage")
amount = 2
gridPosition = Vector2(0, 0)
slot = "med"

[sub_resource type="Resource" id="Resource_main1"]
script = ExtResource("2_slot")
itemData = ExtResource("7_mod")
gridPosition = Vector2(64, 128)
gridRotated = true
slot = "main"

[sub_resource type="Resource" id="Resource_bag"]
script = ExtResource("2_slot")
itemData = ExtResource("3_bag")
storage = Array[ExtResource("2_slot")]([SubResource("Resource_gun1"), SubResource("Resource_med1"), SubResource("Resource_main1")])
condition = 100
slot = "Backpack"

[resource]
script = ExtResource("1_char")
equipment = Array[ExtResource("2_slot")]([SubResource("Resource_bag")])
`

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}${ok || !detail ? '' : '\n' + detail}`)
  if (!ok) failures++
}

function reload(text: string) {
  const tres = parseTresFile(text)
  return { tres, character: parseCharacter(tres) }
}

// 1. Parsing exposes the nested contents.
const base = reload(FIXTURE)
const bag = base.character.equipment[0]
check('bag parsed', bag?.itemData.endsWith('Backpack_Patrol.tres') === true)
check('storage parsed (3 entries)', bag.storage.length === 3)
check('storage keys', bag.storage.map((s) => s.slot).join(',') === 'gun1,med,main')
check(
  'storage grid position',
  bag.storage[2].gridPosition.x === 64 && bag.storage[2].gridPosition.y === 128
)
check('storage nested attachments', bag.storage[0].nested.length === 1)

// 2. Untouched data round-trips byte for byte.
const same = serializeTresFile(serializeCharacter(base.character, base.tres))
check('byte-identical round trip', same === FIXTURE, same)

// 3. Edit values inside storage.
{
  const { tres, character } = reload(FIXTURE)
  character.equipment[0].storage[0].condition = 100
  const out = serializeTresFile(serializeCharacter(character, tres))
  check(
    'edit inside storage is written',
    reload(out).character.equipment[0].storage[0].condition === 100
  )
  check('unknown field inside storage kept', out.includes('modderField = "keep me"'))
}

// 4. Add an item to the bag: new sub-resource must come BEFORE the bag.
{
  const { tres, character } = reload(FIXTURE)
  const id = newSubResourceId(tres)
  const added: SlotItemData = {
    id,
    script: 'res://Scripts/SlotData.gd',
    itemData: 'res://Items/Weapons/AKM/AKM_Magazine.tres',
    nested: [],
    storage: [],
    condition: 0,
    amount: 30,
    position: 0,
    mode: 1,
    zoom: 1,
    chamber: false,
    casing: false,
    state: '',
    gridPosition: { x: 0, y: 64 },
    gridRotated: false,
    slot: 'mag1'
  }
  character.equipment[0].storage.push(added)
  const out = serializeTresFile(serializeCharacter(character, tres))
  const posNew = out.indexOf(`id="${id}"`)
  const posBag = out.indexOf('id="Resource_bag"')
  check('new stored item is defined before its bag', posNew > 0 && posNew < posBag)
  const again = reload(out).character.equipment[0].storage
  check(
    'new stored item survives reload',
    again.length === 4 && again[3].slot === 'mag1' && again[3].amount === 30
  )
  check('load_steps updated', /load_steps=14/.test(out))
  // Dropped empty `storage` arrays are not invented for items that had none.
  check(
    'no stray storage on stored items',
    out.split('\n').filter((l) => l.startsWith('storage =')).length === 1
  )
}

// 5. Remove the bag: it and everything inside it must disappear.
{
  const { tres, character } = reload(FIXTURE)
  character.equipment.splice(0, 1)
  const out = serializeTresFile(serializeCharacter(character, tres))
  check('removed bag leaves no orphans', !/sub_resource/.test(out), out)
}

// 6. Move a stored item out of the bag (into the inventory): kept with its unknown fields.
{
  const { tres, character } = reload(FIXTURE)
  const [gun] = character.equipment[0].storage.splice(0, 1)
  gun.slot = ''
  character.inventory.push(gun)
  const out = serializeTresFile(serializeCharacter(character, tres))
  check('moved item keeps unknown field', out.includes('modderField = "keep me"'))
  const re = reload(out).character
  check(
    'moved item is now in inventory',
    re.inventory.length === 1 && re.equipment[0].storage.length === 2
  )
}

// 7. A save without any storage keeps omitting the property.
{
  const plain = FIXTURE.replace(/storage = [^\n]*\n/, '')
  const { tres, character } = reload(plain)
  const out = serializeTresFile(serializeCharacter(character, tres))
  check('no storage property invented', !out.includes('storage ='), out)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll storage codec checks passed')
