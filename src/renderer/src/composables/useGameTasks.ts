import { computed, ref } from 'vue'
import { ITEMS_BY_PATH } from '../data/items'
import { QUESTS, TRADERS, type QuestDef, type QuestItem, type TraderKey } from '../data/quests'

/** Tasks that exist in the game files but not in the built-in quest list (new Build 2 tasks). */
const extraQuests = ref<QuestDef[]>([])

export interface GameTaskStats {
  /** TaskData resources found in the game files */
  found: number
  added: number
  /** Found but no trader could be worked out, so they are not listed */
  unmatched: number
  propertyNames: string[]
}

export const gameTaskStats = ref<GameTaskStats | null>(null)

const TRADER_KEYS = TRADERS.map((t) => t.key as string)

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function traderOf(task: GameTask): TraderKey | null {
  const raw = task.props.trader ?? task.props.giver ?? task.props.npc
  if (typeof raw === 'string') {
    const k = raw.toLowerCase().replace(/^.*[/:]/, '')
    const hit = TRADER_KEYS.find((t) => k.includes(t))
    if (hit) return hit as TraderKey
  }
  const parts = task.path.toLowerCase().split('/')
  const hit = TRADER_KEYS.find((t) => parts.some((p) => p === t || p.startsWith(t + '_')))
  return (hit as TraderKey | undefined) ?? null
}

function difficultyOf(v: unknown): QuestDef['difficulty'] {
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (s.startsWith('easy')) return 'Easy'
    if (s.startsWith('hard')) return 'Hard'
  }
  if (v === 0) return 'Easy'
  if (v === 2) return 'Hard'
  return 'Intermediate'
}

function itemsOf(v: unknown): QuestItem[] {
  if (!Array.isArray(v)) return []
  const counts = new Map<string, number>()
  for (const entry of v) {
    const name = typeof entry === 'string' ? (ITEMS_BY_PATH.get(entry)?.displayName ?? '') : ''
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count }))
}

export function questFromTask(task: GameTask, index: number): QuestDef | null {
  const trader = traderOf(task)
  if (!trader) return null
  const stem = (task.path.split('/').pop() ?? '').replace(/\.tres$/, '').replace(/_/g, ' ')
  const name = str(task.props.name) || str(task.props.title) || stem
  if (!name) return null
  return {
    trader,
    name,
    difficulty: difficultyOf(task.props.difficulty),
    isTutorial: task.props.tutorial === true || task.props.isTutorial === true,
    order: typeof task.props.order === 'number' ? task.props.order : 1000 + index,
    deliver: itemsOf(task.props.deliver),
    receive: itemsOf(task.props.receive),
    rewardKeys: []
  }
}

/** Built-in quests followed by the ones only the game files know, grouped by trader. */
export const questsByTrader = computed(() => {
  const map = new Map<TraderKey, QuestDef[]>()
  const all = [...QUESTS, ...extraQuests.value]
  for (const t of TRADERS) {
    map.set(
      t.key,
      all.filter((q) => q.trader === t.key && !q.isTutorial).sort((a, b) => a.order - b.order)
    )
  }
  return map
})

export async function loadGameTasks(): Promise<void> {
  try {
    const scan = await window.api.scanGameTasks()
    const known = new Set(QUESTS.map((q) => `${q.trader}:${q.name.toLowerCase()}`))
    const extra: QuestDef[] = []
    let unmatched = 0
    scan.tasks.forEach((task, i) => {
      const q = questFromTask(task, i)
      if (!q) {
        unmatched++
        return
      }
      const key = `${q.trader}:${q.name.toLowerCase()}`
      if (known.has(key)) return
      known.add(key)
      extra.push(q)
    })
    extraQuests.value = extra
    gameTaskStats.value = {
      found: scan.tasks.length,
      added: extra.length,
      unmatched,
      propertyNames: scan.propertyNames
    }
  } catch {
    gameTaskStats.value = { found: 0, added: 0, unmatched: 0, propertyNames: [] }
  }
}
