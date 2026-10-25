<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { resolveItemMeta } from '../data/items'
import { allItems } from '../data/mod-items'
import { boxAccepts, isBox } from '../data/gse'
import { storageContainers, storeNewItem } from '../composables/useGearStorage'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import type { GameItem } from '../lib/types'

const props = defineProps<{
  open: boolean
  /** Sub-resource id of the bag the item goes into */
  holderId: string | null
  /** Storage key of the grid or box ("main", "gun1", "med", ...) */
  sectionKey: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  stored: [message: string]
}>()

const search = ref('')
const onlyFitting = ref(true)
const selectedPath = ref<string | null>(null)
const condition = ref(100)
const amount = ref(1)
const error = ref<string | null>(null)

const section = computed(() => {
  const container = storageContainers.value.find((c) => c.holderId === props.holderId)
  return container?.sections.find((s) => s.spec.key === props.sectionKey) ?? null
})

const candidates = computed<GameItem[]>(() => {
  const spec = section.value?.spec
  let list = allItems.value.filter((i) => i.category !== 'Furniture' && i.category !== 'Backpacks')
  if (spec && onlyFitting.value && isBox(spec.kind)) {
    list = list.filter((i) =>
      boxAccepts(spec.kind, { path: i.resourcePath, category: i.category, slots: i.slots ?? [] })
    )
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (i) => i.displayName.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
    )
  }
  return list
})

const selected = computed(
  () => candidates.value.find((i) => i.resourcePath === selectedPath.value) ?? null
)
const meta = computed(() => (selected.value ? resolveItemMeta(selected.value) : null))

watch(selected, (item) => {
  if (!item) return
  const m = resolveItemMeta(item)
  condition.value = m.defaultCondition
  amount.value = m.defaultAmount
  error.value = null
})

watch(
  () => props.open,
  (open) => {
    if (open) return
    search.value = ''
    selectedPath.value = null
    error.value = null
    onlyFitting.value = true
  }
)

function confirm(): void {
  if (!selected.value || !meta.value || !props.holderId || !section.value) return
  const result = storeNewItem(props.holderId, section.value, selected.value.resourcePath, {
    condition: meta.value.showCondition ? condition.value : undefined,
    amount: meta.value.showAmount ? amount.value : undefined
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  emit('stored', result.message)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-lg h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle> Store item in {{ section?.spec.caption ?? 'storage' }} </DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-3 flex-1 min-h-0">
        <Input v-model="search" placeholder="Search items..." class="h-8 text-sm" />

        <label
          v-if="section && isBox(section.spec.kind)"
          class="flex items-center gap-2 text-xs text-muted-foreground select-none"
        >
          <input v-model="onlyFitting" type="checkbox" />
          Only items this slot accepts ({{ section.spec.tip }})
        </label>

        <div class="flex-1 border border-border rounded-md min-h-0 overflow-y-auto p-1">
          <button
            v-for="item in candidates"
            :key="item.resourcePath"
            class="w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left hover:bg-accent"
            :class="{ 'bg-accent': item.resourcePath === selectedPath }"
            @click="selectedPath = item.resourcePath"
          >
            <span class="flex-1 truncate">{{ item.displayName }}</span>
            <Badge v-if="item.modded" variant="outline" class="text-xs shrink-0">mod</Badge>
            <Badge variant="secondary" class="text-xs shrink-0 w-24 justify-center">{{
              item.category
            }}</Badge>
          </button>
          <div v-if="candidates.length === 0" class="p-3 text-sm text-muted-foreground">
            Nothing matches.
          </div>
        </div>

        <div v-if="selected && meta" class="flex gap-3">
          <div v-if="meta.showCondition" class="flex items-center gap-1.5">
            <label class="text-xs text-muted-foreground">Condition</label>
            <Input
              v-model.number="condition"
              type="number"
              min="0"
              max="100"
              class="h-7 w-20 text-xs"
            />
          </div>
          <div v-if="meta.showAmount" class="flex items-center gap-1.5">
            <label class="text-xs text-muted-foreground">Amount</label>
            <Input
              v-model.number="amount"
              type="number"
              min="0"
              :max="meta.maxAmount"
              class="h-7 w-20 text-xs"
            />
          </div>
        </div>

        <div
          v-if="error"
          class="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5"
        >
          {{ error }}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" @click="emit('update:open', false)">Cancel</Button>
        <Button size="sm" :disabled="!selected" @click="confirm">
          Store {{ selected?.displayName ?? 'item' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
