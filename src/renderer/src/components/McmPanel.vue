<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  mcmMods,
  mcmDir,
  mcmLoading,
  mcmError,
  loadMcm,
  groupsOf,
  setValue,
  isDirty,
  revert,
  saveFile
} from '../composables/useMcm'
import { installedMods, modScan } from '../composables/useMods'
import { useToast } from '../composables/useToast'
import { godotFloat, godotString, plain, type McmSetting } from '../data/mcm'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

const toast = useToast()
const search = ref('')
const selectedMod = ref('')
const selectedFile = ref('')

const activeFile = computed(() => {
  const p = modScan.value?.activeProfile
  return !p || p === 'Default' ? 'config.ini' : `${p}.ini`
})

const visibleMods = computed(() => {
  const q = search.value.trim().toLowerCase()
  return mcmMods.value.filter(
    (m) => !q || m.modId.toLowerCase().includes(q) || friendlyName(m.modId).toLowerCase().includes(q)
  )
})

function friendlyName(modId: string): string {
  const found = installedMods.value.find(
    (m) => m.id.toLowerCase() === modId.toLowerCase() || m.name.toLowerCase() === modId.toLowerCase()
  )
  return found?.name ?? modId
}

const mod = computed(() => mcmMods.value.find((m) => m.modId === selectedMod.value))

function chooseMod(modId: string): void {
  selectedMod.value = modId
  const files = mcmMods.value.find((m) => m.modId === modId)?.files ?? []
  selectedFile.value =
    files.find((f) => f.name === activeFile.value)?.name ??
    files.find((f) => f.name === 'config.ini')?.name ??
    files[0]?.name ??
    ''
}

watch(
  () => mcmMods.value,
  (mods) => {
    if (!mods.some((m) => m.modId === selectedMod.value) && mods[0]) chooseMod(mods[0].modId)
  }
)

onMounted(async () => {
  await loadMcm()
  if (mcmMods.value[0] && !selectedMod.value) chooseMod(mcmMods.value[0].modId)
})

const groups = computed(() =>
  selectedMod.value && selectedFile.value ? groupsOf(selectedMod.value, selectedFile.value) : []
)
const dirty = computed(() => isDirty(selectedMod.value, selectedFile.value))

function put(s: McmSetting, valueText: string): void {
  if (!setValue(selectedMod.value, selectedFile.value, s.id, valueText))
    toast.show('Could not change that setting', 'error')
}

function num(s: McmSetting, raw: string | number): void {
  const n = Number(raw)
  if (raw === '' || !Number.isFinite(n)) return
  const lo = typeof s.min === 'number' ? s.min : -Infinity
  const hi = typeof s.max === 'number' ? s.max : Infinity
  const v = Math.min(hi, Math.max(lo, n))
  put(s, s.type === 'Int' ? String(Math.round(v)) : godotFloat(v))
}

type Vec = { call: string; args: number[] }
const vecOf = (s: McmSetting): Vec | null => {
  const v = plain(s.entry.fields.get('value')) as { call?: string; args?: unknown[] } | undefined
  return v && /^Vector[23]i?$/.test(v.call ?? '') && v.args?.every((a) => typeof a === 'number')
    ? { call: v.call!, args: v.args as number[] }
    : null
}

function vecSet(s: McmSetting, i: number, raw: string | number): void {
  const v = vecOf(s)
  const n = Number(raw)
  if (!v || raw === '' || !Number.isFinite(n)) return
  const args = v.args.map((a, k) => (k === i ? n : a))
  const isInt = v.call.endsWith('i')
  put(s, `${v.call}(${args.map((a) => (isInt ? String(Math.round(a)) : String(a))).join(', ')})`)
}

const colorOf = (s: McmSetting): { hex: string; alpha: number } | null => {
  const v = plain(s.entry.fields.get('value')) as { call?: string; args?: unknown[] } | undefined
  if (v?.call !== 'Color' || !v.args || v.args.length < 3) return null
  const a = v.args as number[]
  const h = (x: number): string =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, '0')
  return { hex: `#${h(a[0])}${h(a[1])}${h(a[2])}`, alpha: a[3] ?? 1 }
}

function colorSet(s: McmSetting, hex: string): void {
  const c = colorOf(s)
  const f = (i: number): string => String(Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000)
  put(s, `Color(${f(1)}, ${f(3)}, ${f(5)}, ${c?.alpha ?? 1})`)
}

function shown(v: unknown): string {
  return JSON.stringify(v)
}

async function save(): Promise<void> {
  try {
    await saveFile(selectedMod.value, selectedFile.value)
    toast.show('Settings saved. The game reads them the next time it starts.', 'success')
  } catch (e) {
    toast.show(e instanceof Error ? e.message : 'Could not save the settings', 'error')
  }
}
</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div class="flex items-center gap-3">
      <h2 class="text-sm font-semibold">Mod settings (MCM)</h2>
      <Button variant="outline" size="sm" class="h-7 text-xs" :disabled="mcmLoading" @click="loadMcm">
        {{ mcmLoading ? 'Reading…' : 'Reload' }}
      </Button>
    </div>
    <p class="text-xs text-muted-foreground">
      Settings that Mod Configuration Menu saved for each mod. Close the game before saving: it
      rewrites these files when it exits. Every change keeps the previous file next to it as
      <code>.ini.editor-backup</code>.
    </p>

    <p v-if="mcmError" class="text-sm text-destructive">{{ mcmError }}</p>
    <div
      v-else-if="!mcmLoading && mcmMods.length === 0"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground text-center"
    >
      No MCM settings found{{ mcmDir ? ` in ${mcmDir}` : '' }}. They appear after a mod that uses
      Mod Configuration Menu has run in the game once.
    </div>

    <div v-else class="flex flex-1 min-h-0 gap-4">
      <div class="w-56 shrink-0 flex flex-col gap-2 min-h-0">
        <Input v-model="search" placeholder="Search mods" class="h-8 text-xs" />
        <div class="flex-1 min-h-0 overflow-auto space-y-0.5 pr-1">
          <button
            v-for="m in visibleMods"
            :key="m.modId"
            class="w-full text-left rounded px-2 py-1.5 text-xs hover:bg-muted/60 flex items-center gap-1.5"
            :class="m.modId === selectedMod ? 'bg-muted' : ''"
            @click="chooseMod(m.modId)"
          >
            <span class="truncate">{{ friendlyName(m.modId) }}</span>
            <span
              v-if="m.files.some((f) => isDirty(m.modId, f.name))"
              class="ml-auto h-1.5 w-1.5 rounded-full bg-yellow-400 shrink-0"
            />
          </button>
        </div>
      </div>

      <div v-if="mod" class="flex-1 min-w-0 min-h-0 overflow-auto pr-1 space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">{{ friendlyName(mod.modId) }}</span>
          <select
            v-if="mod.files.length > 1"
            v-model="selectedFile"
            class="h-7 rounded-md border border-input bg-background px-2 text-xs"
            title="Profile"
          >
            <option v-for="f in mod.files" :key="f.name" :value="f.name">
              {{ f.name.replace(/\.ini$/, '') }}{{ f.name === activeFile ? ' (active profile)' : '' }}
            </option>
          </select>
          <span v-else class="text-xs text-muted-foreground">{{ selectedFile }}</span>
          <div class="flex-1" />
          <Button v-if="dirty" variant="outline" size="sm" class="h-7 text-xs" @click="revert(selectedMod, selectedFile)">
            Revert
          </Button>
          <Button size="sm" class="h-7 text-xs" :disabled="!dirty" @click="save">Save settings</Button>
        </div>

        <p v-if="groups.length === 0" class="text-sm text-muted-foreground">
          This file has no settings the editor can show.
        </p>

        <section v-for="g in groups" :key="g.name" class="space-y-1">
          <h3 v-if="g.name" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ g.name }}
          </h3>
          <div
            v-for="s in g.settings"
            :key="s.id"
            class="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2"
          >
            <div class="flex-1 min-w-0">
              <div class="text-sm">{{ s.name }}</div>
              <div v-if="s.tooltip" class="text-xs text-muted-foreground">{{ s.tooltip }}</div>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              <input
                v-if="s.type === 'Bool'"
                type="checkbox"
                class="h-4 w-4"
                :checked="s.value === true"
                @change="put(s, ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
              />
              <Input
                v-else-if="s.type === 'Int' || s.type === 'Float'"
                type="number"
                class="h-8 w-28 text-xs"
                :model-value="s.value as number"
                :min="typeof s.min === 'number' ? s.min : undefined"
                :max="typeof s.max === 'number' ? s.max : undefined"
                :step="s.step ?? (s.type === 'Int' ? 1 : 0.1)"
                @update:model-value="num(s, $event)"
              />
              <Input
                v-else-if="s.type === 'String'"
                class="h-8 w-56 text-xs"
                :model-value="String(s.value ?? '')"
                @update:model-value="put(s, godotString(String($event)))"
              />
              <select
                v-else-if="s.type === 'Dropdown' && s.options"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs"
                :value="String(s.value)"
                @change="put(s, godotString(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="(label, key) in s.options" :key="key" :value="key">
                  {{ label }}
                </option>
              </select>
              <input
                v-else-if="s.type === 'Color' && colorOf(s)"
                type="color"
                class="h-8 w-12 rounded border border-input bg-background"
                :value="colorOf(s)!.hex"
                @change="colorSet(s, ($event.target as HTMLInputElement).value)"
              />
              <template v-else-if="vecOf(s)">
                <Input
                  v-for="(a, i) in vecOf(s)!.args"
                  :key="i"
                  type="number"
                  class="h-8 w-20 text-xs"
                  :model-value="a"
                  @update:model-value="vecSet(s, i, $event)"
                />
              </template>
              <span v-else class="max-w-72 truncate text-xs text-muted-foreground select-text" :title="shown(s.value)">
                {{ shown(s.value) }}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
