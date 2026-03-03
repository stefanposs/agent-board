import * as vscode from 'vscode'
import type { TaskData, SessionData } from './protocol'

const TASKS_KEY = 'agentBoard.tasks'
const SESSIONS_KEY = 'agentBoard.sessions'

export class StateManager {
  constructor(private ctx: vscode.ExtensionContext) {}

  // ─── Tasks ──────────────────────────────────────────────────

  saveTasks(tasks: TaskData[]): void {
    this.ctx.workspaceState.update(TASKS_KEY, tasks)
  }

  loadTasks(): TaskData[] {
    return this.ctx.workspaceState.get<TaskData[]>(TASKS_KEY, [])
  }

  // ─── Sessions ───────────────────────────────────────────────

  saveSessions(sessions: SessionData[]): void {
    this.ctx.workspaceState.update(SESSIONS_KEY, sessions)
  }

  loadSessions(): SessionData[] {
    return this.ctx.workspaceState.get<SessionData[]>(SESSIONS_KEY, [])
  }

  // ─── Bulk ───────────────────────────────────────────────────

  saveAll(tasks: TaskData[], sessions: SessionData[]): void {
    this.saveTasks(tasks)
    this.saveSessions(sessions)
  }

  loadAll(): { tasks: TaskData[]; sessions: SessionData[] } {
    return {
      tasks: this.loadTasks(),
      sessions: this.loadSessions(),
    }
  }

  /** Clear all persisted state. */
  clear(): void {
    this.ctx.workspaceState.update(TASKS_KEY, undefined)
    this.ctx.workspaceState.update(SESSIONS_KEY, undefined)
  }
}
