import { parseMcm, settingsOf, categoriesOf, withValue, godotFloat } from '../src/renderer/src/data/mcm'

let fails = 0
const check = (name: string, ok: boolean): void => {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}`)
  if (!ok) fails++
}
// Multi-line (what Godot writes) and one-line dictionaries, mixed types
const text = `[Category]

general={
"menu_pos": 1,
"name": "General"
}

[Int]

testInt={
"category": "General",
"default": 5,
"maxRange": 20,
"menu_pos": 1,
"minRange": 0,
"name": "Test Int",
"tooltip": "A test int",
"value": 7
}

[Bool]

flag={ "default": false, "name": "Flag", "tooltip": "x", "value": true }

[Vector2]

vec={
"default": Vector2(10, 10),
"name": "Vec",
"tooltip": "",
"value": Vector2(3.5, 4)
}

[Dropdown]

dd={
"default": "opt_1",
"name": "Pick",
"options": {
"opt_1": "Option 1",
"opt_2": "Option 2"
},
"tooltip": "",
"value": "opt_2"
}

[Array]

arr={
"default": [],
"name": "Arr",
"tooltip": "",
"value": [Vector3(1, 2, 3), Vector3(0, 0, 0)]
}
`
const entries = parseMcm(text)
const s = settingsOf(entries)
check('all settings found', s.length === 5)
check('int value', s.find((x) => x.id === 'testInt')?.value === 7)
check('int range', s.find((x) => x.id === 'testInt')?.max === 20)
check('bool one-line', s.find((x) => x.id === 'flag')?.value === true)
check('dropdown options', s.find((x) => x.id === 'dd')?.options?.opt_2 === 'Option 2')
check('category', categoriesOf(entries).get('general')?.name === 'General')
const int = s.find((x) => x.id === 'testInt')!
const edited = withValue(text, int.entry.start, '12')!
check('edit replaces only the value', edited === text.replace('"value": 7', '"value": 12'))
const again = settingsOf(parseMcm(edited))
check('reparse after edit', again.find((x) => x.id === 'testInt')?.value === 12 && again.length === 5)
const flag = s.find((x) => x.id === 'flag')!
check('edit one-line', withValue(text, flag.entry.start, 'false')!.includes('"value": false }'))
check('float text', godotFloat(3) === '3.0' && godotFloat(2.5) === '2.5')
process.exit(fails ? 1 : 0)
