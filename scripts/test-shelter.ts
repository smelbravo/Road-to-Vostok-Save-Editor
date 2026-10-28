import { existsSync, readFileSync } from 'fs'
import { parseTresFile } from '../src/renderer/src/lib/tres/parser'
import { parseShelter, parseShelterLooseItems } from '../src/renderer/src/lib/tres/codec'

// Needs a Cabin.tres (argv[2])
const file = process.argv[2] ?? '/mnt/user-data/attachments/7b4f6580-7e1a-5a4f-b347-0c3d13fffce7/7f42484c-Cabin.tres'
if (!existsSync(file)) {
  console.log('Cabin.tres not found, skipping')
  process.exit(0)
}
let fails = 0
const check = (name: string, ok: boolean): void => {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}`)
  if (!ok) fails++
}
const tres = parseTresFile(readFileSync(file, 'utf8'))
const s = parseShelter(tres)
const loose = parseShelterLooseItems(tres)
check('22 furniture pieces', s.furnitures.length === 22)
check('cabinet with 9 items', s.furnitures.some((f) => f.name === 'Cabinet (Wood)' && f.storage.length === 9))
check('13 loose items', loose.length === 13)
check('loose items have an item path', loose.every((l) => l.item.itemData.startsWith('res://')))
process.exit(fails ? 1 : 0)
