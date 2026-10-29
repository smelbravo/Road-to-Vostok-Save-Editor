<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  shelters,
  sheltersLoading,
  sheltersError,
  loadShelters,
  shelterEditing,
  sheltersDirty,
  updateShelterItem,
  removeShelterItem,
  addShelterItem,
  saveShelterEdits
} from '../composables/useShelters'
import { editableFields } from '../composables/useGearStorage'
import { useToast } from '../composables/useToast'
import { ITEMS_BY_PATH } from '../data/items'
import { allItems } from '../data/mod-items'
import { Trash2 } from 'lucide-vue-next'
import type { SlotItemData } from '../lib/tres/codec'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import ItemIcon from './ItemIcon.vue'

const search = ref('')
const toast = useToast()
onMounted(loadShelters)

// Edit mode: edits stay in memory until "Save edits"
const addQuery = ref<Record<string, string>>({})
const addError = ref<Record<string, string>>({})

function suggestions(key: string) {
  const q = (addQuery.value[key] ?? '').trim().toLowerCase()
  if (q.length < 2) return []
  return allItems.value
    .filter(
      (i) =>
        i.category !== 'Furniture' &&
        (i.displayName.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
    )
    .slice(0, 8)
}

function add(fileName: string, furnitureId: string, itemPath: string): void {
  const error = addShelterItem(fileName, furnitureId, itemPath)
  addError.value[furnitureId] = error ?? ''
  if (!error) addQuery.value[furnitureId] = ''
}

function setNumber(
  fileName: string,
  item: SlotItemData,
  field: 'condition' | 'amount',
  value: string | number
): void {
  const n = Math.max(0, Math.round(Number(value)))
  if (Number.isFinite(n)) updateShelterItem(fileName, item, { [field]: n })
}

async function saveEdits(): Promise<void> {
  try {
    const n = await saveShelterEdits()
    toast.show(`Saved ${n} shelter file${n === 1 ? '' : 's'}`)
  } catch (e) {
    toast.show(`Saving shelters failed: ${e instanceof Error ? e.message : e}`)
  }
}

async function discardEdits(): Promise<void> {
  await loadShelters()
}

function nameOf(path: string): string {
  return (
    ITEMS_BY_PATH.get(path)?.displayName ??
    (path.split('/').pop() ?? path).replace(/\.tres$/, '').replace(/_/g, ' ')
  )
}

const iconOf = (path: string): string => ITEMS_BY_PATH.get(path)?.iconFile ?? ''

const q = computed(() => search.value.trim().toLowerCase())
const matches = (item: SlotItemData): boolean => !q.value || nameOf(item.itemData).toLowerCase().includes(q.value)

interface Container {
  key: string
  title: string
  size: string
  items: SlotItemData[]
  total: number
}

const views = computed(() =>
  shelters.value.map((s) => {
    // Furniture with the same name is numbered like in the game's own lists
    const seen = new Map<string, number>()
    const counts = new Map<string, number>()
    for (const f of s.furniture) counts.set(f.name, (counts.get(f.name) ?? 0) + 1)
    const containers: Container[] = []
    for (const f of s.furniture) {
      const size = ITEMS_BY_PATH.get(f.itemData)?.containerSize
      if (!size && f.storage.length === 0) continue
      const n = (seen.get(f.name) ?? 0) + 1
      seen.set(f.name, n)
      containers.push({
        key: f.id,
        title: (counts.get(f.name) ?? 0) > 1 ? `${f.name} #${n}` : f.name,
        size: size ? `${size.w}×${size.h}` : '',
        items: f.storage.filter(matches),
        total: f.storage.length
      })
    }
    const loose = s.loose.filter((l) => matches(l.item))
    return {
      shelter: s,
      containers: containers.filter((c) => !q.value || c.items.length > 0),
      allContainers: containers.length,
      stored: containers.reduce((sum, c) => sum + c.total, 0),
      loose
    }
  })
)
</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div class="flex items-center gap-3">
      <h2 class="text-sm font-semibold">Shelter</h2>
      <Button variant="outline" size="sm" class="h-7 text-xs" :disabled="sheltersLoading" @click="loadShelters">
        {{ sheltersLoading ? 'Reading…' : 'Reload' }}
      </Button>
      <Button
        :variant="shelterEditing ? 'default' : 'outline'"
        size="sm"
        class="h-7 text-xs"
        @click="shelterEditing = !shelterEditing"
      >
        {{ shelterEditing ? 'Exit edit mode' : 'Edit mode' }}
      </Button>
      <template v-if="shelterEditing && sheltersDirty">
        <Button size="sm" class="h-7 text-xs" @click="saveEdits">Save edits</Button>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="discardEdits">
          Discard
        </Button>
      </template>
      <div class="flex-1" />
      <Input v-model="search" placeholder="Search items" class="h-8 w-56 text-xs" />
    </div>
    <p class="text-xs text-muted-foreground">
      What your shelters store: the contents of every container and the items lying around. Turn on
      Edit mode to change condition and amount, remove items or add items to a container.
      Furniture placement is edited in the Furniture tab. Close the game before saving.
    </p>

    <p v-if="sheltersError" class="text-sm text-destructive">{{ sheltersError }}</p>
    <p
      v-else-if="!sheltersLoading && shelters.length === 0"
      class="text-sm text-muted-foreground"
    >
      No shelter files found in this save.
    </p>

    <div class="flex-1 min-h-0 overflow-auto space-y-6 pr-1">
      <section v-for="v in views" :key="v.shelter.fileName" class="space-y-2">
        <h3 class="text-base font-semibold">{{ v.shelter.name }}</h3>
        <p class="text-xs text-muted-foreground">
          {{ v.shelter.furniture.length }} furniture pieces · {{ v.allContainers }} containers ·
          {{ v.stored }} items stored · {{ v.shelter.loose.length }} loose items
        </p>
        <p v-if="v.allContainers === 0 && v.shelter.loose.length === 0" class="text-xs text-muted-foreground">
          No containers here.
        </p>

        <details
          v-for="c in v.containers"
          :key="c.key"
          :open="!!q"
          class="rounded-md border border-border bg-card/40"
        >
          <summary class="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
            <span class="font-medium">{{ c.title }}</span>
            <span class="text-xs text-muted-foreground">
              <template v-if="c.size">{{ c.size }} · </template>{{ c.total }} item{{ c.total === 1 ? '' : 's' }}
            </span>
          </summary>
          <ul class="px-3 pb-2 space-y-1">
            <li v-for="it in c.items" :key="it.id" class="flex items-center gap-2 text-xs">
              <ItemIcon :icon-file="iconOf(it.itemData)" class="h-6 w-9" />
              <span>{{ nameOf(it.itemData) }}</span>
              <template v-if="shelterEditing">
                <template v-if="editableFields(it.itemData).condition">
                  <label class="text-muted-foreground">Cond.</label>
                  <Input
                    :model-value="Math.round(it.condition)"
                    type="number"
                    min="0"
                    max="100"
                    class="h-6 w-16 text-xs"
                    @update:model-value="(val) => setNumber(v.shelter.fileName, it, 'condition', val)"
                  />
                </template>
                <template v-if="editableFields(it.itemData).amount">
                  <label class="text-muted-foreground">Qty</label>
                  <Input
                    :model-value="it.amount"
                    type="number"
                    min="0"
                    :max="editableFields(it.itemData).maxAmount"
                    class="h-6 w-16 text-xs"
                    @update:model-value="(val) => setNumber(v.shelter.fileName, it, 'amount', val)"
                  />
                </template>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-red-400 hover:text-red-300"
                  title="Remove"
                  @click="removeShelterItem(v.shelter.fileName, c.key, it.id)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              </template>
              <template v-else>
                <span v-if="it.amount > 1" class="text-green-400">× {{ it.amount }}</span>
                <span v-if="it.condition > 0 && it.condition < 100" class="text-muted-foreground">
                  {{ it.condition }}%
                </span>
              </template>
              <span v-if="it.nested.length > 0" class="text-muted-foreground">
                + {{ it.nested.map(nameOf).join(', ') }}
              </span>
            </li>
            <li v-if="c.items.length === 0" class="text-xs text-muted-foreground">Empty</li>
            <li v-if="shelterEditing" class="pt-1 space-y-1">
              <Input
                v-model="addQuery[c.key]"
                placeholder="Add an item (type 2+ letters)"
                class="h-7 text-xs"
              />
              <div v-if="suggestions(c.key).length" class="flex flex-wrap gap-1">
                <Button
                  v-for="i in suggestions(c.key)"
                  :key="i.resourcePath"
                  variant="outline"
                  size="sm"
                  class="h-6 text-xs"
                  @click="add(v.shelter.fileName, c.key, i.resourcePath)"
                >
                  {{ i.displayName }}
                </Button>
              </div>
              <p v-if="addError[c.key]" class="text-xs text-red-400">{{ addError[c.key] }}</p>
            </li>
          </ul>
        </details>

        <details
          v-if="v.shelter.loose.length > 0 && (!q || v.loose.length > 0)"
          :open="!!q"
          class="rounded-md border border-border bg-card/40"
        >
          <summary class="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
            <span class="font-medium">Loose items</span>
            <span class="text-xs text-muted-foreground">{{ v.shelter.loose.length }} items</span>
          </summary>
          <ul class="px-3 pb-2 space-y-1">
            <li v-for="l in v.loose" :key="l.item.id" class="flex items-center gap-2 text-xs">
              <ItemIcon :icon-file="iconOf(l.item.itemData)" class="h-6 w-9" />
              <span>{{ nameOf(l.item.itemData) }}</span>
              <span v-if="l.item.amount > 1" class="text-green-400">× {{ l.item.amount }}</span>
              <span v-if="l.item.nested.length > 0" class="text-muted-foreground">
                + {{ l.item.nested.map(nameOf).join(', ') }}
              </span>
            </li>
          </ul>
        </details>
      </section>
    </div>
  </div>
</template>
