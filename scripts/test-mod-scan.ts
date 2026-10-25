/**
 * Checks the mod archive reader. Run with: npx tsx scripts/test-mod-scan.ts <archive.vmz> [more archives]
 * With no arguments it only runs the built-in mod.txt / ItemData parsing checks.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseItemTres, parseModTxt, scanModArchive } from '../src/main/mods'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}${ok || !detail ? '' : ' ' + detail}`)
  if (!ok) failures++
}

const txt = parseModTxt(
  '[mod]\nname="Gear Storage"\nid="gse"\nversion="1.1.7"\n[autoload]\nGSE="res://x.gd"\n'
)
check('mod.txt id', txt.id === 'gse' && txt.version === '1.1.7' && txt.name === 'Gear Storage')

const item = parseItemTres(
  '[gd_resource type="Resource" script_class="ItemData" format=3]\n\n[resource]\nfile = "A"\nname = "Thing"\ntype = "Medical"\nsize = Vector2(2, 1)\n',
  'res://mods/x/A.tres',
  'x'
)
check(
  'item parsed',
  item?.displayName === 'Thing' && item.category === 'Medical' && item.sizeW === 2
)
check(
  'non-item resource ignored',
  parseItemTres(
    '[gd_resource type="Resource" script_class="LootTable" format=3]\n\n[resource]\nitems = []\n',
    'res://a.tres',
    ''
  ) === null
)

for (const file of process.argv.slice(2)) {
  const { mod, items } = await scanModArchive(basename(file), readFileSync(file))
  console.log(`      ${mod.file}: id=${mod.id} version=${mod.version} items=${items.length}`)
  for (const it of items)
    console.log(
      `        ${it.resourcePath} -> ${it.displayName} (${it.category}, ${it.sizeW}x${it.sizeH})`
    )
}

if (failures > 0) process.exit(1)
