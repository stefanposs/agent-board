import * as vscode from 'vscode'
import type { TaskData, SessionData, GoalData } from './protocol'

const TASKS_KEY = 'agentBoard.tasks'
const SESSIONS_KEY = 'agentBoard.sessions'
const GOALS_KEY = 'agentBoard.goals'

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

  // ─── Goals ──────────────────────────────────────────────────

  saveGoals(goals: GoalData[]): void {
    this.ctx.workspaceState.update(GOALS_KEY, goals)
  }

  loadGoals(): GoalData[] {
    return this.ctx.workspaceState.get<GoalData[]>(GOALS_KEY, [])
  }

  // ─── Bulk ───────────────────────────────────────────────────

  saveAll(tasks: TaskData[], sessions: SessionData[], goals?: GoalData[]): void {
    this.saveTasks(tasks)
    this.saveSessions(sessions)
    if (goals) this.saveGoals(goals)
  }

  loadAll(): { tasks: TaskData[]; sessions: SessionData[]; goals: GoalData[] } {
    return {
      tasks: this.loadTasks(),
      sessions: this.loadSessions(),
      goals: this.loadGoals(),
    }
  }

  /** Clear all persisted state. */
  clear(): void {
    this.ctx.workspaceState.update(TASKS_KEY, undefined)
    this.ctx.workspaceState.update(SESSIONS_KEY, undefined)
    this.ctx.workspaceState.update(GOALS_KEY, undefined)
  }
}
