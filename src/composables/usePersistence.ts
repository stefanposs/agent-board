import { watch } from 'vue'
import { useExtension } from './useExtension'
import { useBoard } from './useBoard'

// ─── Constants ──────────────────────────────────────────────────

const STORAGE_KEY = 'agent-board-state'

// ─── Debounced State Persistence ────────────────────────────────

let saveTimeout: ReturnType<typeof setTimeout> | null = null

export function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    const ext = useExtension()
    const board = useBoard()
    const tasksJson = JSON.parse(JSON.stringify(board.tasks.value))
    const sessionsJson = JSON.parse(JSON.stringify(board.sessions.value))

    if (ext.isWebview.value) {
      // VS Code extension mode → save via workspaceState
      ext.saveState(tasksJson, sessionsJson)
    } else {
      // Standalone browser mode → save to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: tasksJson, sessions: sessionsJson }))
      } catch (e) {
        console.warn('[AgentBoard] localStorage save failed:', e)
      }
    }
  }, 1000)
}

// ─── Load persisted state from localStorage (standalone mode) ───

export function loadFromLocalStorage(): { tasks: any[]; sessions: any[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data && Array.isArray(data.tasks)) {
      return { tasks: data.tasks, sessions: data.sessions || [] }
    }
  } catch (e) {
    console.warn('[AgentBoard] localStorage load failed:', e)
  }
  return null
}

// ─── Auto-save watcher (standalone mode) ────────────────────────

let watcherInitialized = false

export function initAutoSave() {
  if (watcherInitialized) return
  watcherInitialized = true

  const board = useBoard()

  // Deep-watch tasks and sessions, debounce save
  watch(
    () => [board.tasks.value, board.sessions.value],
    () => debouncedSave(),
    { deep: true },
  )
}
