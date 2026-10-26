<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  storageContainers,
  storedItemCount,
  editableFields,
  moveStoredToInventory,
  removeStoredItem,
  updateStoredItem,
  type StorageContainer,
  type StorageSection,
  type StoredEntry
} from '../composables/useGearStorage'
import { gseDisabled, gseMod, modScan } from '../composables/useMods'
import { useToast } from '../composables/useToast'
import { ITEMS_BY_PATH } from '../data/items'
import { isBox } from '../data/gse'
import ItemIcon from './ItemIcon.vue'
import StorageAddDialog from './StorageAddDialog.vue'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Plus, Trash2, ArrowDownToLine, TriangleAlert } from 'lucide-vue-next'

const CELL_UI = 44

const toast = useToast()
const selectedId = ref<string | null>(null)
const dialogOpen = ref(false)
const dialogHolder = ref<string | null>(null)
const dialogKey = ref<string | null>(null)

const selected = computed<{
  entry: StoredEntry
  container: StorageContainer
  section: StorageSection
} | null>(() => {
  if (!selectedId.value) return null
  for (const container of storageContainers.value)
    for (const section of container.sections) {
      const entry = section.entries.find((e) => e.id === selectedId.value)
      if (entry) return { entry, container, section }
    }
  return null
})

const selectedFields = computed(() =>
  selected.value ? editableFields(selected.value.entry.item.itemPath) : null
)

function gridStyle(section: StorageSection): Record<string, string> {
  const { w, h } = section.spec
  return {
    width: `${w * CELL_UI}px`,
    height: `${h * CELL_UI}px`,
    backgroundSize: `${CELL_UI}px ${CELL_UI}px`
  }
}

function entryStyle(entry: StoredEntry): Record<string, string> {
  return {
    left: `${entry.col * CELL_UI}px`,
    top: `${entry.row * CELL_UI}px`,
    width: `${entry.w * CELL_UI}px`,
    height: `${entry.h * CELL_UI}px`
  }
}

function iconOf(path: string): string {
  return ITEMS_BY_PATH.get(path)?.iconFile ?? ''
}

function openAdd(container: StorageContainer, section: StorageSection): void {
  dialogHolder.value = container.holderId
  dialogKey.value = section.spec.key
  dialogOpen.value = true
}

function onStored(message: string): void {
  if (message) toast.show(message, 'error')
}

function toInventory(): void {
  if (!selected.value) return
  const result = moveStoredToInventory(selected.value.entry.id)
  if (!result.ok) toast.show(result.message, 'error')
  else selectedId.value = null
}

function remove(): void {
  if (!selected.value) return
  removeStoredItem(selected.value.entry.id)
  selectedId.value = null
}

function setCondition(value: string | number): void {
  if (!selected.value) return
  const n = Math.min(100, Math.max(0, Number(value)))
  if (Number.isFinite(n)) updateStoredItem(selected.value.entry.id, { condition: Math.round(n) })
}

function setAmount(value: string | number): void {
  if (!selected.value) return
  const max = selectedFields.value?.maxAmount
  let n = Math.max(0, Math.round(Number(value)))
  if (max !== undefined && n > max) n = max
  if (Number.isFinite(n)) updateStoredItem(selected.value.entry.id, { amount: n })
}

const statusLine = computed(() => {
  if (gseMod.value) {
    const v = gseMod.value.version ? ` v${gseMod.value.version}` : ''
    if (gseDisabled.value) {
      const profile = modScan.value?.activeProfile
      return {
        ok: false,
        text: `Gear Storage Expansion${v} is installed but disabled in the ${profile ? `"${profile}" ` : ''}profile, so the game will not use it`
      }
    }
    return { ok: true, text: `Gear Storage Expansion${v} found in your mods folder` }
  }
  if (storedItemCount.value > 0) {
    return {
      ok: false,
      text: 'Gear Storage Expansion was not found in the mods folder, but this save has items stored in gear'
    }
  }
  return {
    ok: false,
    text: modScan.value?.modsDir
      ? 'Gear Storage Expansion is not installed. Items stored in gear still show up here when a save has them.'
      : 'Game mods folder not found. Items stored in gear still show up here when a save has them.'
  }
})
</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold">Gear Storage ({{ storedItemCount }})</h2>
      <span
        class="text-xs rounded-full px-2 py-0.5 border"
        :class="
          statusLine.ok
            ? 'border-green-500/40 text-green-400'
            : 'border-border text-muted-foreground'
        "
      >
        {{ statusLine.text }}
      </span>
    </div>

    <p class="text-xs text-muted-foreground">
      Items kept inside backpacks, rigs and clothing. Gear Storage Expansion saves them inside each
      piece of gear, so they are edited here and stay in the same slots the mod shows in game. Close
      the game before saving.
    </p>

    <div
      v-if="storageContainers.length === 0"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground text-center"
    >
      No gear with storage was found in this save.
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto space-y-3 pr-1">
      <div
        v-for="container in storageContainers"
        :key="container.holderId"
        class="rounded-md border border-border bg-card/40 p-3"
      >
        <div class="flex items-center gap-2 mb-2">
          <ItemIcon :icon-file="iconOf(container.holder.itemPath)" class="h-8 w-12" />
          <span class="text-sm font-medium">{{ container.holder.itemName }}</span>
          <Badge variant="secondary" class="text-xs">
            {{ container.where }}{{ container.equipSlot ? ` · ${container.equipSlot}` : '' }}
          </Badge>
          <span class="text-xs text-muted-foreground">
            {{ container.totalItems }} item{{ container.totalItems === 1 ? '' : 's' }}
          </span>
        </div>

        <div class="flex flex-wrap gap-4 items-start">
          <div v-for="section in container.sections" :key="section.spec.key" class="space-y-1">
            <div
              class="flex items-center justify-between gap-2"
              :style="{ minWidth: `${CELL_UI}px` }"
            >
              <span
                class="text-[11px] text-muted-foreground truncate"
                :title="`${section.spec.caption} (${section.spec.key}) — ${section.spec.tip}`"
              >
                {{ section.spec.caption }}
              </span>
              <button
                v-if="!isBox(section.spec.kind) || section.entries.length === 0"
                class="text-muted-foreground hover:text-foreground"
                :title="`Store an item in ${section.spec.caption}`"
                @click="openAdd(container, section)"
              >
                <Plus class="h-3.5 w-3.5" />
              </button>
            </div>

            <div
              class="relative rounded-sm border border-border/70 bg-background/60 stor-grid"
              :style="gridStyle(section)"
            >
              <button
                v-for="entry in section.entries"
                :key="entry.id"
                class="absolute rounded-sm border bg-muted/50 hover:bg-primary/15 flex items-center justify-center overflow-hidden"
                :class="
                  entry.id === selectedId
                    ? 'border-primary ring-1 ring-primary'
                    : entry.problem
                      ? 'border-yellow-500/70'
                      : 'border-border/60'
                "
                :style="entryStyle(entry)"
                :title="`${entry.item.itemName}${entry.problem ? '\n' + entry.problem : ''}`"
                @click="selectedId = entry.id"
              >
                <ItemIcon
                  v-if="iconOf(entry.item.itemPath)"
                  :icon-file="iconOf(entry.item.itemPath)"
                  class="max-h-full max-w-full"
                />
                <span v-else class="text-[10px] leading-tight text-center px-0.5 break-words">
                  {{ entry.item.nameInventory }}
                </span>
                <span
                  v-if="entry.item.showAmount && entry.item.amount > 0"
                  class="absolute bottom-0 right-0 text-[10px] leading-none text-green-400 px-0.5"
                >
                  {{ entry.item.amount }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Details of the selected item -->
      <div
        v-if="selected"
        class="sticky bottom-0 rounded-md border border-border bg-background/95 backdrop-blur p-3 space-y-2"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">{{ selected.entry.item.itemName }}</span>
          <Badge variant="secondary" class="text-xs">
            {{ selected.container.holder.itemName }} · {{ selected.section.spec.caption }}
          </Badge>
          <Badge
            v-if="ITEMS_BY_PATH.get(selected.entry.item.itemPath)?.modded"
            variant="outline"
            class="text-xs"
          >
            mod
          </Badge>
        </div>
        <p v-if="selected.entry.problem" class="text-xs text-yellow-400 flex items-start gap-1.5">
          <TriangleAlert class="h-3.5 w-3.5 shrink-0 mt-px" />
          {{ selected.entry.problem }}
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <div v-if="selectedFields?.condition" class="flex items-center gap-1.5">
            <label class="text-xs text-muted-foreground">Condition</label>
            <Input
              :model-value="Math.round(selected.entry.item.condition)"
              type="number"
              min="0"
              max="100"
              class="h-7 w-20 text-xs"
              @update:model-value="setCondition"
            />
          </div>
          <div v-if="selectedFields?.amount" class="flex items-center gap-1.5">
            <label class="text-xs text-muted-foreground">Amount</label>
            <Input
              :model-value="selected.entry.item.amount"
              type="number"
              min="0"
              :max="selectedFields.maxAmount"
              class="h-7 w-20 text-xs"
              @update:model-value="setAmount"
            />
          </div>
          <div class="flex-1" />
          <Button variant="outline" size="sm" class="h-7 text-xs" @click="toInventory">
            <ArrowDownToLine class="h-3.5 w-3.5" />
            To inventory
          </Button>
          <Button variant="destructive" size="sm" class="h-7 text-xs" @click="remove">
            <Trash2 class="h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      </div>
    </div>

    <StorageAddDialog
      v-model:open="dialogOpen"
      :holder-id="dialogHolder"
      :section-key="dialogKey"
      @stored="onStored"
    />
  </div>
</template>

<style scoped>
.stor-grid {
  background-image:
    linear-gradient(to right, rgb(128 128 128 / 0.18) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(128 128 128 / 0.18) 1px, transparent 1px);
}
</style>
