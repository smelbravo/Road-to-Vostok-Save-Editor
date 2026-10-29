<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBackups } from '../composables/useBackups'
import { useToast } from '../composables/useToast'
import { Button } from '../components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../components/ui/table'
import { FolderOpen, RotateCcw, Trash2 } from 'lucide-vue-next'

const { backups, isLoading, loadBackups, restoreBackup, deleteBackups, openBackupsDir } = useBackups()
const toast = useToast()

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

async function handleRestore(folderName: string) {
  try {
    await restoreBackup(folderName)
  } catch (e) {
    toast.show(`Restore failed: ${e instanceof Error ? e.message : e}`)
  }
}

// Delete asks twice: the first click arms the button, the second one deletes
const armed = ref<string | null>(null)

async function handleDelete(folderNames: string[], key: string) {
  if (armed.value !== key) {
    armed.value = key
    setTimeout(() => {
      if (armed.value === key) armed.value = null
    }, 4000)
    return
  }
  armed.value = null
  try {
    await deleteBackups(folderNames)
    toast.show(`Deleted ${folderNames.length} backup${folderNames.length === 1 ? '' : 's'}`)
  } catch (e) {
    toast.show(`Delete failed: ${e instanceof Error ? e.message : e}`)
  }
}

onMounted(() => {
  loadBackups()
})
</script>

<template>
  <div class="space-y-4 p-1">
    <div class="flex items-center gap-3">
      <span class="text-sm text-muted-foreground shrink-0">Backup folder</span>
      <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" @click="openBackupsDir">
        <FolderOpen class="h-4 w-4" />
      </Button>
      <div class="flex-1" />
      <Button
        v-if="backups.length > 0"
        :variant="armed === 'all' ? 'destructive' : 'outline'"
        size="sm"
        class="text-xs gap-1.5"
        @click="
          handleDelete(
            backups.map((b) => b.folderName),
            'all'
          )
        "
      >
        <Trash2 class="h-3.5 w-3.5" />
        {{ armed === 'all' ? 'Click again to delete all' : 'Delete all' }}
      </Button>
    </div>

    <div v-if="isLoading" class="text-sm text-muted-foreground">Loading...</div>

    <p v-else-if="backups.length === 0" class="text-sm text-muted-foreground">
      No backups yet. Backups are created automatically when you save.
    </p>

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Size</TableHead>
          <TableHead class="w-[200px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="backup in backups" :key="backup.folderName">
          <TableCell class="text-sm">{{ formatDate(backup.timestamp) }}</TableCell>
          <TableCell class="text-sm text-muted-foreground">{{ formatSize(backup.size) }}</TableCell>
          <TableCell>
            <Button
              variant="outline"
              size="sm"
              class="text-xs gap-1.5"
              @click="handleRestore(backup.folderName)"
            >
              <RotateCcw class="h-3.5 w-3.5" />
              Restore
            </Button>
            <Button
              :variant="armed === backup.folderName ? 'destructive' : 'ghost'"
              size="sm"
              class="text-xs gap-1.5 ml-2"
              @click="handleDelete([backup.folderName], backup.folderName)"
            >
              <Trash2 class="h-3.5 w-3.5" />
              {{ armed === backup.folderName ? 'Confirm' : 'Delete' }}
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
