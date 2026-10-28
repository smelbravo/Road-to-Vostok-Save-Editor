<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import {
  storageContainers,
  storedItemCount,
  editableFields,
  moveStoredToInventory,
  moveStoredItem,
  checkStoredMove,
  removeStoredItem,
  rotateStoredItem,
  updateStoredItem,
  type StorageContainer,
  type StorageSection,
  type StoredEntry
} from '../composables/useGearStorage'
import { gseDisabled, gseMod, modScan } from '../composables/useMods'
import { useToast } from '../composables/useToast'
import { ITEMS_BY_PATH } from '../data/items'
import { isBox } from '../data/gse'
import { WEAPON_ATTACHMENT_LAYOUTS } from '../data/weapon-attachments'
import type { SlotItem } from '../lib/types'
import ItemIcon from './ItemIcon.vue'
import CompositeIcon from './CompositeIcon.vue'
import StorageAddDialog from './StorageAddDialog.vue'
import ItemContextMenu from './ItemContextMenu.vue'
import { setWeaponNested } from '../composables/useWeaponAttachments'
import { ATTACHMENT_SUBTYPE } from '../data/attachment-subtypes'
import type { AttachmentRemoveOption } from '../lib/types'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Plus, Trash2, ArrowDownToLine, RotateCw, TriangleAlert } from 'lucide-vue-next'

const CELL_UI = 44

const toast = useToast()
const openWorkbench = inject<(weapon: SlotItem) => void>('openWorkbench')
const openRigArmorWorkbench = inject<(rig: SlotItem) => void>('openRigArmorWorkbench')
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

// A slot grows to hold what is in it: a rifle in a one-cell "gun" slot is drawn at its real size
// and would otherwise spill over the neighbouring slots.
function sectionSize(section: StorageSection): { w: number; h: number } {
  let { w, h } = section.spec
  for (const e of section.entries) {
    w = Math.max(w, e.col + e.w)
    h = Math.max(h, e.row + e.h)
  }
  return { w, h }
}

function gridStyle(section: StorageSection): Record<string, string> {
  const { w, h } = sectionSize(section)
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

// Drag and drop between slots and cells: pointer based like the inventory, so a ghost follows
// the cursor, the drop spot shows green/red and R turns the item while it is held.
interface DragState {
  entry: StoredEntry
  rotated: boolean
  /** Cell of the item the pointer holds */
  grabX: number
  grabY: number
  startX: number
  startY: number
  x: number
  y: number
  started: boolean
  target: {
    key: string
    holderId: string
    section: StorageSection
    col: number
    row: number
    ok: boolean
    w: number
    h: number
  } | null
}

const drag = ref<DragState | null>(null)
let justDragged = false

function dragSize(d: DragState): { w: number; h: number } {
  const turned = d.rotated !== d.entry.item.gridRotated
  return turned ? { w: d.entry.h, h: d.entry.w } : { w: d.entry.w, h: d.entry.h }
}

function onPointerDown(event: PointerEvent, entry: StoredEntry): void {
  if (event.button !== 0) return
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  drag.value = {
    entry,
    rotated: entry.item.gridRotated,
    grabX: Math.max(0, Math.min(entry.w - 1, Math.floor((event.clientX - rect.left) / CELL_UI))),
    grabY: Math.max(0, Math.min(entry.h - 1, Math.floor((event.clientY - rect.top) / CELL_UI))),
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    started: false,
    target: null
  }
}

function targetKey(container: StorageContainer, section: StorageSection): string {
  return `${container.holderId}|${section.spec.key}`
}

function findTarget(d: DragState): DragState['target'] {
  const el = document
    .elementsFromPoint(d.x, d.y)
    .find((e) => (e as HTMLElement).dataset?.storTarget) as HTMLElement | undefined
  const key = el?.dataset.storTarget
  if (!el || !key) return null
  for (const container of storageContainers.value)
    for (const section of container.sections) {
      if (targetKey(container, section) !== key) continue
      const rect = el.getBoundingClientRect()
      const col = Math.floor((d.x - rect.left) / CELL_UI) - d.grabX
      const row = Math.floor((d.y - rect.top) / CELL_UI) - d.grabY
      const size = dragSize(d)
      const check = checkStoredMove(d.entry.id, container.holderId, section, col, row, d.rotated)
      return {
        key,
        holderId: container.holderId,
        section,
        col: isBox(section.spec.kind) ? 0 : col,
        row: isBox(section.spec.kind) ? 0 : row,
        ok: check.ok,
        w: isBox(section.spec.kind) ? section.spec.w : size.w,
        h: isBox(section.spec.kind) ? section.spec.h : size.h
      }
    }
  return null
}

function onPointerMove(event: PointerEvent): void {
  const d = drag.value
  if (!d) return
  d.x = event.clientX
  d.y = event.clientY
  if (!d.started && Math.hypot(d.x - d.startX, d.y - d.startY) > 5) {
    d.started = true
    selectedId.value = d.entry.id
  }
  if (d.started) d.target = findTarget(d)
}

function onPointerUp(): void {
  const d = drag.value
  drag.value = null
  if (!d || !d.started) return
  justDragged = true
  setTimeout(() => (justDragged = false), 0)
  const t = d.target
  if (!t) return
  const result = moveStoredItem(d.entry.id, t.holderId, t.section, t.col, t.row, d.rotated)
  if (!result.ok || result.message) toast.show(result.message, 'error')
}

function onEntryClick(entry: StoredEntry): void {
  if (!justDragged) selectedId.value = entry.id
}

function openAdd(container: StorageContainer, section: StorageSection): void {
  dialogHolder.value = container.holderId
  dialogKey.value = section.spec.key
  dialogOpen.value = true
}

function onStored(message: string): void {
  if (message) toast.show(message, 'error')
}

// Same rules as the inventory: weapons the editor knows attachment options for, and plated rigs.
const canEditLoadout = computed(() => {
  const item = selected.value?.entry.item
  return !!item && item.category === 'Weapons' && WEAPON_ATTACHMENT_LAYOUTS.has(item.itemPath)
})
const canEditArmor = computed(() => !!selected.value?.entry.item.carrier)

const menu = ref<{ x: number; y: number } | null>(null)

function onContextMenu(event: MouseEvent, entry: StoredEntry): void {
  selectedId.value = entry.id
  menu.value = { x: event.clientX, y: event.clientY }
}

const removeOptions = computed<AttachmentRemoveOption[]>(() => {
  const item = selected.value?.entry.item
  if (!item || item.category !== 'Weapons') return []
  return item.nested
    .filter((path) => ATTACHMENT_SUBTYPE.has(path))
    .map((path) => ({
      path,
      label: `Remove ${ITEMS_BY_PATH.get(path)?.displayName ?? path.split('/').pop()?.replace('.tres', '') ?? 'attachment'}`
    }))
})

function removeAttachment(path: string): void {
  const item = selected.value?.entry.item
  if (item)
    setWeaponNested(
      item.subResourceId,
      item.nested.filter((p) => p !== path)
    )
  menu.value = null
}

function menuEdit(): void {
  if (canEditArmor.value) editArmor()
  else editLoadout()
  menu.value = null
}

function menuToInventory(): void {
  toInventory()
  menu.value = null
}

function menuDelete(): void {
  remove()
  menu.value = null
}

function editLoadout(): void {
  if (selected.value && openWorkbench) openWorkbench(selected.value.entry.item)
}

function editArmor(): void {
  if (selected.value && openRigArmorWorkbench) openRigArmorWorkbench(selected.value.entry.item)
}

function toInventory(): void {
  if (!selected.value) return
  const result = moveStoredToInventory(selected.value.entry.id)
  if (!result.ok) toast.show(result.message, 'error')
  else selectedId.value = null
}

function rotate(): void {
  if (!selected.value) return
  const result = rotateStoredItem(selected.value.entry.id, selected.value.section)
  if (!result.ok && result.message) toast.show(result.message, 'error')
}

function onKey(e: KeyboardEvent): void {
  if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target as HTMLElement | null
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  const d = drag.value
  if (d?.started) {
    e.preventDefault()
    const base = d.entry.item.gridRotated ? { w: d.entry.h, h: d.entry.w } : { w: d.entry.w, h: d.entry.h }
    if (base.w === base.h) return
    d.rotated = !d.rotated
    const size = dragSize(d)
    d.grabX = Math.min(d.grabX, size.w - 1)
    d.grabY = Math.min(d.grabY, size.h - 1)
    d.target = findTarget(d)
    return
  }
  if (!selected.value) return
  e.preventDefault()
  rotate()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

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
              :style="{ minWidth: `${sectionSize(section).w * CELL_UI}px` }"
            >
              <span
                class="text-[11px] text-muted-foreground whitespace-nowrap"
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
              :data-stor-target="targetKey(container, section)"
              :style="gridStyle(section)"
            >
              <div
                v-if="drag?.started && drag.target?.key === targetKey(container, section)"
                class="absolute rounded-sm border pointer-events-none z-20"
                :class="
                  drag.target.ok
                    ? 'bg-green-500/30 border-green-500/70'
                    : 'bg-red-500/30 border-red-500/70'
                "
                :style="{
                  left: `${drag.target.col * CELL_UI}px`,
                  top: `${drag.target.row * CELL_UI}px`,
                  width: `${drag.target.w * CELL_UI}px`,
                  height: `${drag.target.h * CELL_UI}px`
                }"
              />
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
                :class="drag?.started && drag.entry.id === entry.id ? 'opacity-40' : ''"
                @pointerdown="onPointerDown($event, entry)"
                :title="`${entry.item.itemName}${entry.problem ? '\n' + entry.problem : ''}`"
                @click="onEntryClick(entry)"
                @contextmenu.prevent="onContextMenu($event, entry)"
              >
                <CompositeIcon
                  v-if="iconOf(entry.item.itemPath)"
                  :icon-file="iconOf(entry.item.itemPath)"
                  :item-path="entry.item.itemPath"
                  :nested="entry.item.nested"
                  :w="entry.w"
                  :h="entry.h"
                  :cell-size="CELL_UI"
                  :rotated="entry.item.gridRotated"
                  class="pointer-events-none"
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
          <Button
            v-if="canEditLoadout"
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            @click="editLoadout"
          >
            Edit loadout
          </Button>
          <Button
            v-if="canEditArmor"
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            @click="editArmor"
          >
            Edit armor
          </Button>
          <Button
            v-if="!isBox(selected.section.spec.kind)"
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            title="Rotate (R)"
            @click="rotate"
          >
            <RotateCw class="h-3.5 w-3.5" />
            Rotate
          </Button>
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

    <ItemContextMenu
      v-if="menu && selected"
      :x="menu.x"
      :y="menu.y"
      :show-edit-loadout="canEditLoadout || canEditArmor"
      :edit-loadout-label="canEditArmor ? 'Edit Armor' : 'Edit Loadout'"
      :remove-attachment-options="removeOptions"
      :show-duplicate="false"
      show-to-inventory
      @edit-loadout="menuEdit"
      @remove-attachment="removeAttachment"
      @to-inventory="menuToInventory"
      @delete="menuDelete"
      @close="menu = null"
    />

    <div
      v-if="drag?.started"
      class="fixed pointer-events-none z-50 opacity-80 rounded-sm border border-primary bg-muted/70 overflow-hidden"
      :style="{
        left: `${drag.x - (drag.grabX + 0.5) * CELL_UI}px`,
        top: `${drag.y - (drag.grabY + 0.5) * CELL_UI}px`,
        width: `${dragSize(drag).w * CELL_UI}px`,
        height: `${dragSize(drag).h * CELL_UI}px`
      }"
    >
      <CompositeIcon
        v-if="iconOf(drag.entry.item.itemPath)"
        :icon-file="iconOf(drag.entry.item.itemPath)"
        :item-path="drag.entry.item.itemPath"
        :nested="drag.entry.item.nested"
        :w="dragSize(drag).w"
        :h="dragSize(drag).h"
        :cell-size="CELL_UI"
        :rotated="drag.rotated"
      />
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
