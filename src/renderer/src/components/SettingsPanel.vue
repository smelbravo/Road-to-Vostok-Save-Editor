<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useItemIcons } from '../composables/useItemIcons'
import { installedMods, modScan, modScanError, loadMods, gameCatalog } from '../composables/useMods'
import { sourceInfo, hasSlots, chooseSource, slotLabel } from '../composables/useSaveSource'
import { init } from '../composables/useTresFileLoader'
import { isDirty } from '../composables/saveEditorState'
import { modItems } from '../data/mod-items'
import { Button } from '../components/ui/button'
import { LoaderCircle, FolderOpen } from 'lucide-vue-next'

const { status, progress, total, error, reload } = useItemIcons()

const saveDir = ref('')

const openSaveDir = () => window.api.openSaveDir()

const refreshDir = async () => {
  saveDir.value = await window.api.getSaveDir()
}

const sourceValue = computed(() => {
  const src = sourceInfo.value?.source
  return src?.kind === 'slot' ? String(src.slot) : 'live'
})

// Switching slot reloads every save file from the new folder
const onSourceChange = async (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  if (isDirty.value && !window.confirm('You have unsaved changes. Switch save and discard them?')) {
    ;(event.target as HTMLSelectElement).value = sourceValue.value
    return
  }
  await chooseSource(value === 'live' ? { kind: 'live' } : { kind: 'slot', slot: Number(value) })
  await init()
  await refreshDir()
}

onMounted(refreshDir)
</script>

<template>
  <div class="space-y-4 p-1">
    <!-- Save Location -->
    <div class="flex items-center gap-3">
      <span class="text-sm text-muted-foreground shrink-0">Save location</span>
      <span class="text-sm truncate select-text" :title="saveDir">{{ saveDir }}</span>
      <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" @click="openSaveDir">
        <FolderOpen class="h-4 w-4" />
      </Button>
    </div>

    <!-- Item Icons -->
    <div class="flex items-center gap-3">
      <span class="text-sm text-muted-foreground shrink-0">Item icons</span>

      <span v-if="status === 'done'" class="text-sm text-green-400">Loaded</span>
      <span
        v-else-if="status === 'extracting'"
        class="text-sm text-yellow-400 flex items-center gap-1.5"
      >
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
        Extracting{{ total > 0 ? ` (${progress}/${total})` : '...' }}
      </span>
      <span v-else-if="status === 'error'" class="text-sm text-destructive">{{ error }}</span>
      <span v-else-if="status === 'not-found'" class="text-sm text-muted-foreground">
        Game not found
      </span>
      <span v-else class="text-sm text-muted-foreground">Idle</span>

      <Button
        variant="outline"
        size="sm"
        class="text-xs shrink-0"
        :disabled="status === 'extracting'"
        @click="reload"
      >
        Reload
      </Button>
    </div>

    <!-- Extraction progress bar -->
    <div v-if="status === 'extracting'" class="h-1.5 rounded-full bg-secondary overflow-hidden">
      <div
        class="h-full rounded-full bg-primary"
        :style="{ width: total > 0 ? `${(progress / total) * 100}%` : '0%' }"
      />
    </div>

    <!-- Not found explanation -->
    <p v-if="status === 'not-found'" class="text-xs text-muted-foreground">
      Icons are extracted from the game's PCK file and require the game to be installed via Steam.
    </p>

    <!-- Save slots (Save Slots / Multi Save Slots Reborn) -->
    <div v-if="hasSlots" class="space-y-1">
      <div class="flex items-center gap-3">
        <span class="text-sm text-muted-foreground shrink-0">Save slot</span>
        <select
          class="h-8 rounded-md border border-border bg-background px-2 text-sm"
          :value="sourceValue"
          @change="onSourceChange"
        >
          <option value="live">Current game save (what the game loads now)</option>
          <option v-for="s in sourceInfo?.slots ?? []" :key="s.slot" :value="String(s.slot)">
            {{ slotLabel(s) }}
          </option>
        </select>
      </div>
      <p class="text-xs text-muted-foreground">
        Edits to the slot that is active in the game also update its stored copy. Other slots are
        edited in their own folder and are picked up the next time you load them in the game.
        Backups are kept separately per slot.
      </p>
    </div>

    <!-- Installed mods -->
    <div class="space-y-2 pt-2 border-t border-border">
      <div class="flex items-center gap-3">
        <span class="text-sm text-muted-foreground shrink-0">Installed mods</span>
        <span v-if="modScanError" class="text-sm text-destructive">{{ modScanError }}</span>
        <span v-else-if="!modScan?.modsDir" class="text-sm text-muted-foreground">
          Mods folder not found
        </span>
        <span v-else class="text-sm">
          {{ installedMods.length }} found, {{ modItems.length }} modded item{{
            modItems.length === 1 ? '' : 's'
          }}
          added to the catalog
        </span>
        <Button variant="outline" size="sm" class="text-xs shrink-0" @click="loadMods">
          Rescan
        </Button>
      </div>
      <p
        v-if="modScan?.modsDir"
        class="text-xs text-muted-foreground select-text truncate"
        :title="modScan.modsDir"
      >
        {{ modScan.modsDir }}
      </p>
      <p v-if="modScan?.activeProfile" class="text-xs text-muted-foreground">
        Active mod profile: {{ modScan.activeProfile }}
        <template v-if="modScan.profiles.length > 1">
          ({{ modScan.profiles.length }} profiles found)
        </template>
      </p>
      <p v-if="gameCatalog" class="text-xs text-muted-foreground">
        <template v-if="!gameCatalog.found"
          >Game files not found: using the built-in item list.</template
        >
        <template v-else>
          Game files: {{ gameCatalog.scanned }} item resources read, {{ gameCatalog.added }} not in
          the built-in list added, {{ gameCatalog.iconsFixed }} icon names updated.
          <template v-if="gameCatalog.scanned === 0">
            (the game archive has {{ gameCatalog.totalFiles }} files; example paths:
            {{ gameCatalog.samplePaths.join(', ') }})
          </template>
          <template v-if="gameCatalog.checked > 0">
            Reader check: {{ gameCatalog.matched }}/{{ gameCatalog.checked }} known items matched{{
              gameCatalog.trusted ? '' : ' (below threshold, only names from file paths are used)'
            }}.
          </template>
        </template>
      </p>
      <p v-for="w in gameCatalog?.warnings ?? []" :key="w" class="text-xs text-yellow-400">
        {{ w }}
      </p>
      <ul v-if="installedMods.length > 0" class="text-xs space-y-0.5">
        <li v-for="mod in installedMods" :key="mod.file" class="flex gap-2">
          <span class="font-medium">{{ mod.name }}</span>
          <span class="text-muted-foreground"
            >{{ mod.id }}{{ mod.version ? ` · v${mod.version}` : ''
            }}{{ mod.location === 'library' ? ' · Mod Manager library' : '' }}</span
          >
          <span v-if="mod.enabled === false" class="text-yellow-400">disabled in profile</span>
        </li>
      </ul>
      <p v-for="w in modScan?.warnings ?? []" :key="w" class="text-xs text-yellow-400">{{ w }}</p>
      <p class="text-xs text-muted-foreground">
        Items added by mods get their name, size and category from the mod itself. Anything the
        editor does not recognise is kept untouched when you save.
      </p>
    </div>
  </div>
</template>
