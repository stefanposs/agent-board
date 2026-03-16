import * as fs from 'fs/promises'
import * as path from 'path'
import type { TaskData, SessionData, CommentData, TaskMetricsData, GoalData } from './protocol'

// ─── YAML-like frontmatter helpers (no dependency needed) ───────

function toFrontmatter(obj: Record<string, any>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(v => typeof v === 'string' ? `"${v}"` : typeof v === 'object' && v !== null ? JSON.stringify(v) : v).join(', ')}]`)
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else if (typeof value === 'string') {
      lines.push(`${key}: "${value}"`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const meta: Record<string, any> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()

    // Parse arrays: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        meta[key] = JSON.parse(value)
      } catch {
        meta[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''))
      }
      continue
    }
    // Parse JSON objects
    if (value.startsWith('{')) {
      try { meta[key] = JSON.parse(value); continue } catch { /* fallthrough */ }
    }
    // Parse quoted strings
    if (value.startsWith('"') && value.endsWith('"')) {
      meta[key] = value.slice(1, -1)
      continue
    }
    // Parse numbers
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      meta[key] = Number(value)
      continue
    }
    // Parse booleans
    if (value === 'true') { meta[key] = true; continue }
    if (value === 'false') { meta[key] = false; continue }
    meta[key] = value
  }

  return { meta, body: match[2] }
}

// ─── Markdown section parser / writer ───────────────────────────

function extractSection(body: string, heading: string): string {
  const startIdx = body.search(new RegExp(`^## ${heading}\\s*$`, 'm'))
  if (startIdx === -1) return ''
  const afterHeading = body.indexOf('\n', startIdx)
  if (afterHeading === -1) return ''
  const rest = body.slice(afterHeading + 1)
  const nextHeading = rest.search(/^## /m)
  const content = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  return content.trim()
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
}

function parseTimestamp(str: string): number {
  const d = new Date(str.replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? Date.now() : d.getTime()
}

// ─── Task → Markdown ────────────────────────────────────────────

function taskToMarkdown(task: TaskData, sessions: SessionData[]): string {
  const sections: string[] = []

  // Frontmatter
  sections.push(toFrontmatter({
    id: task.id,
    title: task.title,
    stage: task.stage,
    workspaceId: task.workspaceId,
    assignee: task.assignee,
    manuallyAssigned: task.manuallyAssigned,
    assignedAgents: task.assignedAgents,
    tags: task.tags,
    progress: task.progress,
    approvalStatus: task.approvalStatus,
    branch: task.branch,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    blockedReason: task.blockedReason,
    goalIds: task.goalIds,
    outputPath: task.outputPath,
  }))

  // Title + Description
  sections.push('')
  sections.push(`# ${task.title}`)
  sections.push('')
  sections.push('## Description')
  sections.push('')
  sections.push(task.description || '_(no description)_')
  sections.push('')

  // Metrics
  if (task.metrics) {
    sections.push('## Metrics')
    sections.push('')
    sections.push(`- Created: ${formatTimestamp(task.metrics.createdAt)}`)
    if (task.metrics.stageEnteredAt) {
      for (const [stage, ts] of Object.entries(task.metrics.stageEnteredAt)) {
        sections.push(`- Entered ${stage}: ${formatTimestamp(ts as number)}`)
      }
    }
    if (task.metrics.completedAt) {
      sections.push(`- Completed: ${formatTimestamp(task.metrics.completedAt)}`)
    }
    if (task.metrics.feedbackLoops) {
      sections.push(`- Feedback loops dev→planner: ${task.metrics.feedbackLoops.devToPlanner}`)
      sections.push(`- Feedback loops review→dev: ${task.metrics.feedbackLoops.reviewToDev}`)
    }
    sections.push('')
  }

  // Events
  if (task.events && task.events.length > 0) {
    sections.push('## Events')
    sections.push('')
    for (const e of task.events) {
      const agent = e.agentId ? ` [${e.agentId}]` : ''
      const stages = e.fromStage && e.toStage ? ` (${e.fromStage} → ${e.toStage})` : ''
      sections.push(`- [${formatTimestamp(e.timestamp)}] ${e.type}${agent}${stages}: ${e.message}`)
    }
    sections.push('')
  }

  // Comments
  if (task.comments && task.comments.length > 0) {
    sections.push('## Comments')
    sections.push('')
    for (const c of task.comments) {
      const meta: string[] = []
      if (c.type && c.type !== 'comment') meta.push(`type:${c.type}`)
      if (c.pinned) meta.push('pinned')
      if (c.editedAt) meta.push(`edited:${formatTimestamp(c.editedAt)}`)
      const metaSuffix = meta.length > 0 ? ` [${meta.join(', ')}]` : ''
      sections.push(`### ${c.author} (${formatTimestamp(c.timestamp)})${metaSuffix}`)
      if (c.replyToId) sections.push(`> Reply to: ${c.replyToId}`)
      sections.push('')
      sections.push(c.content)
      sections.push('')
    }
  }

  // Sessions
  const taskSessions = sessions.filter(s => s.taskId === task.id)
  if (taskSessions.length > 0) {
    sections.push('## Sessions')
    sections.push('')
    for (const session of taskSessions) {
      sections.push(`### Session ${session.agentId} (${formatTimestamp(session.createdAt)})`)
      sections.push('')
      sections.push(`Status: ${session.status} | Tokens: ${session.totalTokensUsed}`)
      sections.push('')
      for (const msg of session.messages) {
        const preview = msg.content.length > 2000
          ? msg.content.slice(0, 2000) + '\n…(truncated)'
          : msg.content
        sections.push(`**${msg.role}:**`)
        sections.push(preview)
        sections.push('')
      }
    }
  }

  // Pull Request
  if (task.pullRequest) {
    sections.push('## Pull Request')
    sections.push('')
    sections.push(`- Number: #${task.pullRequest.number}`)
    sections.push(`- Title: ${task.pullRequest.title}`)
    sections.push(`- URL: ${task.pullRequest.url}`)
    sections.push(`- Status: ${task.pullRequest.status}`)
    sections.push(`- Changes: +${task.pullRequest.additions} -${task.pullRequest.deletions} (${task.pullRequest.changedFiles} files)`)
    sections.push('')
  }

  return sections.join('\n')
}

// ─── Markdown → Task ────────────────────────────────────────────

function markdownToTask(content: string): { task: TaskData; sessions: SessionData[] } {
  const { meta, body } = parseFrontmatter(content)

  // Parse description
  const description = extractSection(body, 'Description')

  // Parse events
  const eventsRaw = extractSection(body, 'Events')
  const events: any[] = []
  if (eventsRaw) {
    for (const line of eventsRaw.split('\n')) {
      const m = line.match(/^- \[(.+?)\] (\w+)(?:\s*\[(.+?)\])?(?:\s*\((.+?)\))?: (.+)$/)
      if (m) {
        const [, ts, type, agentId, stages, message] = m
        const event: any = { id: `evt-${events.length}`, timestamp: parseTimestamp(ts), type, message }
        if (agentId) event.agentId = agentId
        if (stages) {
          const [from, to] = stages.split(' → ')
          event.fromStage = from?.trim()
          event.toStage = to?.trim()
        }
        events.push(event)
      }
    }
  }

  // Parse comments
  const commentsRaw = extractSection(body, 'Comments')
  const comments: CommentData[] = []
  if (commentsRaw) {
    const commentBlocks = commentsRaw.split(/^### /m).filter(Boolean)
    for (const block of commentBlocks) {
      const headerMatch = block.match(/^(.+?) \((.+?)\)(?:\s*\[(.+?)\])?\s*\n/)
      if (headerMatch) {
        const replyMatch = block.match(/^> Reply to: (.+)$/m)
        const content = block.slice(headerMatch[0].length)
          .replace(/^> Reply to: .+\n\n?/, '')
          .trim()
        // Parse metadata from brackets: [type:note, pinned, edited:2026-01-01 00:00:00]
        let commentType: string | undefined
        let pinned = false
        let editedAt: number | undefined
        if (headerMatch[3]) {
          const parts = headerMatch[3].split(',').map((s: string) => s.trim())
          for (const part of parts) {
            if (part.startsWith('type:')) commentType = part.slice(5)
            else if (part === 'pinned') pinned = true
            else if (part.startsWith('edited:')) editedAt = parseTimestamp(part.slice(7))
          }
        }
        comments.push({
          id: `cmt-${comments.length}-${Date.now()}`,
          taskId: meta.id || '',
          author: headerMatch[1],
          timestamp: parseTimestamp(headerMatch[2]),
          content,
          replyToId: replyMatch?.[1],
          type: commentType as any,
          pinned: pinned || undefined,
          editedAt,
        })
      }
    }
  }

  // Parse metrics
  let metrics: TaskMetricsData | undefined
  const metricsRaw = extractSection(body, 'Metrics')
  if (metricsRaw) {
    metrics = {
      createdAt: meta.createdAt || Date.now(),
      stageEnteredAt: {},
      feedbackLoops: { devToPlanner: 0, reviewToDev: 0 },
    }
    for (const line of metricsRaw.split('\n')) {
      const enteredMatch = line.match(/^- Entered (\w+): (.+)$/)
      if (enteredMatch) {
        metrics.stageEnteredAt[enteredMatch[1]] = parseTimestamp(enteredMatch[2])
      }
      const completedMatch = line.match(/^- Completed: (.+)$/)
      if (completedMatch) metrics.completedAt = parseTimestamp(completedMatch[1])
      const loopMatch1 = line.match(/dev→planner: (\d+)/)
      if (loopMatch1 && metrics.feedbackLoops) metrics.feedbackLoops.devToPlanner = Number(loopMatch1[1])
      const loopMatch2 = line.match(/review→dev: (\d+)/)
      if (loopMatch2 && metrics.feedbackLoops) metrics.feedbackLoops.reviewToDev = Number(loopMatch2[1])
    }
  }

  // Parse sessions
  const sessions: SessionData[] = []
  const sessionsRaw = extractSection(body, 'Sessions')
  if (sessionsRaw) {
    const sessionBlocks = sessionsRaw.split(/^### Session /m).filter(Boolean)
    for (const block of sessionBlocks) {
      const headerMatch = block.match(/^(.+?) \((.+?)\)\s*\n/)
      if (headerMatch) {
        const agentId = headerMatch[1]
        const createdAt = parseTimestamp(headerMatch[2])
        const statusMatch = block.match(/Status: (\w+) \| Tokens: (\d+)/)
        const messages: any[] = []

        // Parse messages: **role:**\ncontent
        const msgParts = block.split(/\*\*(\w+):\*\*\n/).filter(Boolean)
        for (let i = 0; i < msgParts.length - 1; i += 2) {
          const role = msgParts[i] as 'user' | 'assistant' | 'system'
          if (['user', 'assistant', 'system'].includes(role)) {
            messages.push({
              id: `msg-${messages.length}`,
              role,
              content: msgParts[i + 1].replace(/\n…\(truncated\)$/, '').trim(),
              timestamp: createdAt + messages.length * 1000,
            })
          }
        }

        sessions.push({
          id: `session-${agentId}-${createdAt}`,
          taskId: meta.id || '',
          agentId,
          messages,
          createdAt,
          updatedAt: createdAt,
          status: (statusMatch?.[1] as any) || 'completed',
          totalTokensUsed: Number(statusMatch?.[2]) || 0,
        })
      }
    }
  }

  // Parse pull request
  let pullRequest: any | undefined
  const prRaw = extractSection(body, 'Pull Request')
  if (prRaw) {
    const num = prRaw.match(/Number: #(\d+)/)
    const title = prRaw.match(/Title: (.+)/)
    const url = prRaw.match(/URL: (.+)/)
    const status = prRaw.match(/Status: (\w+)/)
    const changes = prRaw.match(/Changes: \+(\d+) -(\d+) \((\d+) files\)/)
    if (num) {
      pullRequest = {
        number: Number(num[1]),
        title: title?.[1] || '',
        url: url?.[1] || '',
        status: status?.[1] || 'none',
        additions: Number(changes?.[1]) || 0,
        deletions: Number(changes?.[2]) || 0,
        changedFiles: Number(changes?.[3]) || 0,
        checks: { passed: 0, total: 0 },
      }
    }
  }

  const task: TaskData = {
    id: meta.id || `task-${Date.now()}`,
    title: meta.title || 'Untitled',
    description: description || '',
    stage: meta.stage || 'idea',
    workspaceId: meta.workspaceId || '',
    assignee: meta.assignee || null,
    manuallyAssigned: meta.manuallyAssigned || false,
    assignedAgents: meta.assignedAgents || [],
    tags: meta.tags || [],
    progress: meta.progress ?? 0,
    approvalStatus: meta.approvalStatus || 'none',
    events,
    createdAt: meta.createdAt || Date.now(),
    updatedAt: meta.updatedAt || Date.now(),
    branch: meta.branch,
    blockedReason: meta.blockedReason,
    comments,
    metrics,
    pullRequest,
    goalIds: meta.goalIds,
    outputPath: meta.outputPath,
  }

  return { task, sessions }
}

// ─── Goal → Markdown ────────────────────────────────────────────

function goalToMarkdown(goal: GoalData): string {
  const sections: string[] = []

  sections.push(toFrontmatter({
    id: goal.id,
    title: goal.title,
    owner: goal.owner,
    deadline: goal.deadline,
    taskIds: goal.taskIds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  }))

  sections.push('')
  sections.push(`# ${goal.title}`)
  sections.push('')

  if (goal.description) {
    sections.push('## Description')
    sections.push('')
    sections.push(goal.description)
    sections.push('')
  }

  if (goal.taskIds.length > 0) {
    sections.push('## Linked Tasks')
    sections.push('')
    for (const tid of goal.taskIds) {
      sections.push(`- ${tid}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

// ─── Markdown → Goal ────────────────────────────────────────────

function markdownToGoal(content: string): GoalData {
  const { meta, body } = parseFrontmatter(content)
  const description = extractSection(body, 'Description')

  return {
    id: meta.id || `goal-${Date.now()}`,
    title: meta.title || 'Untitled Goal',
    description: description || undefined,
    owner: meta.owner,
    deadline: meta.deadline,
    taskIds: meta.taskIds || [],
    createdAt: meta.createdAt || Date.now(),
    updatedAt: meta.updatedAt || Date.now(),
  }
}

// ─── File-based State Manager ───────────────────────────────────

/**
 * Manages task and session persistence using Markdown files.
 *
 * Storage layout:
 *   .tasks/
 *     TASK-<short-id>-<slug>.md    (one per task, contains frontmatter + all data)
 *     _board.yaml                   (optional board-level settings in future)
 *
 * Each task file contains:
 *   - YAML frontmatter with metadata (id, stage, etc.)
 *   - Markdown body with description, events, comments, sessions
 */
export class MarkdownStateManager {
  private tasksDir: string

  constructor(private basePath: string) {
    this.tasksDir = path.join(basePath, '.tasks')
  }

  /**
   * Ensure .tasks/ directory exists and is in .gitignore.
   */
  async init(): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true })
    await this.ensureGitignore()
  }

  // ─── Save ───────────────────────────────────────────────────

  async saveTasks(tasks: TaskData[], sessions: SessionData[]): Promise<void> {
    await this.init()

    // Write each task as a separate markdown file
    const written = new Set<string>()
    for (const task of tasks) {
      const filename = this.taskFilename(task)
      const content = taskToMarkdown(task, sessions)
      await fs.writeFile(path.join(this.tasksDir, filename), content, 'utf-8')
      written.add(filename)
    }

    // Clean up orphaned task files
    try {
      const existing = await fs.readdir(this.tasksDir)
      for (const file of existing) {
        if (file.startsWith('TASK-') && file.endsWith('.md') && !written.has(file)) {
          await fs.unlink(path.join(this.tasksDir, file))
        }
      }
    } catch { /* dir might not exist yet */ }
  }

  // ─── Load ───────────────────────────────────────────────────

  async loadAll(): Promise<{ tasks: TaskData[]; sessions: SessionData[] }> {
    await this.init()

    const tasks: TaskData[] = []
    const sessions: SessionData[] = []

    try {
      const files = await fs.readdir(this.tasksDir)
      for (const file of files) {
        if (!file.startsWith('TASK-') || !file.endsWith('.md')) continue
        try {
          const content = await fs.readFile(path.join(this.tasksDir, file), 'utf-8')
          const parsed = markdownToTask(content)
          tasks.push(parsed.task)
          sessions.push(...parsed.sessions)
        } catch (e) {
          // Skip unreadable files
          console.error(`[MarkdownState] Failed to parse ${file}:`, e)
        }
      }
    } catch { /* dir doesn't exist — return empty */ }

    // Sort by createdAt
    tasks.sort((a, b) => a.createdAt - b.createdAt)

    return { tasks, sessions }
  }

  // ─── Single task operations ─────────────────────────────────

  async saveTask(task: TaskData, sessions: SessionData[]): Promise<void> {
    await this.init()
    const filename = this.taskFilename(task)
    const content = taskToMarkdown(task, sessions)
    await fs.writeFile(path.join(this.tasksDir, filename), content, 'utf-8')
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      const files = await fs.readdir(this.tasksDir)
      for (const file of files) {
        if (file.startsWith(`TASK-${taskId.slice(0, 8)}`)) {
          await fs.unlink(path.join(this.tasksDir, file))
        }
      }
    } catch { /* ignore */ }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private taskFilename(task: TaskData): string {
    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
      .replace(/-+$/, '')
    return `TASK-${task.id.slice(0, 8)}-${slug || 'untitled'}.md`
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.basePath, '.gitignore')
    const pattern = '.tasks/'
    try {
      const existing = await fs.readFile(gitignorePath, 'utf-8')
      if (!existing.includes(pattern)) {
        await fs.writeFile(gitignorePath, existing.trimEnd() + '\n' + pattern + '\n', 'utf-8')
      }
    } catch {
      // No .gitignore exists — don't create one just for this
    }
  }

  /** Get the path to the tasks directory. */
  getTasksDir(): string {
    return this.tasksDir
  }

  /**
   * Append a single log entry to a task's markdown file.
   * Creates a "## Activity Log" section if it doesn't exist.
   * This enables real-time, lossless logging of every decision,
   * confirmation, rejection, and agent message.
   */
  async appendToTaskLog(taskId: string, entry: string): Promise<void> {
    await this.init()
    const files = await fs.readdir(this.tasksDir)
    const taskFile = files.find(f => f.startsWith(`TASK-${taskId.slice(0, 8)}`))
    if (!taskFile) return

    const filePath = path.join(this.tasksDir, taskFile)
    let content = await fs.readFile(filePath, 'utf-8')

    const logHeader = '## Activity Log'
    if (content.includes(logHeader)) {
      // Append entry after the header
      const idx = content.indexOf(logHeader)
      const afterHeader = idx + logHeader.length
      const nextNewline = content.indexOf('\n', afterHeader)
      if (nextNewline >= 0) {
        content = content.slice(0, nextNewline + 1) + entry + '\n' + content.slice(nextNewline + 1)
      } else {
        content += '\n' + entry + '\n'
      }
    } else {
      // Add section at the end
      content += '\n\n' + logHeader + '\n\n' + entry + '\n'
    }

    await fs.writeFile(filePath, content, 'utf-8')
  }

  // ─── Goal persistence ──────────────────────────────────────

  async saveGoals(goals: GoalData[]): Promise<void> {
    await this.init()

    const written = new Set<string>()
    for (const goal of goals) {
      const filename = this.goalFilename(goal)
      const content = goalToMarkdown(goal)
      await fs.writeFile(path.join(this.tasksDir, filename), content, 'utf-8')
      written.add(filename)
    }

    // Clean up orphaned goal files
    try {
      const existing = await fs.readdir(this.tasksDir)
      for (const file of existing) {
        if (file.startsWith('GOAL-') && file.endsWith('.md') && !written.has(file)) {
          await fs.unlink(path.join(this.tasksDir, file))
        }
      }
    } catch { /* ignore */ }
  }

  async loadGoals(): Promise<GoalData[]> {
    await this.init()
    const goals: GoalData[] = []
    try {
      const files = await fs.readdir(this.tasksDir)
      for (const file of files) {
        if (!file.startsWith('GOAL-') || !file.endsWith('.md')) continue
        try {
          const content = await fs.readFile(path.join(this.tasksDir, file), 'utf-8')
          goals.push(markdownToGoal(content))
        } catch (e) {
          console.error(`[MarkdownState] Failed to parse ${file}:`, e)
        }
      }
    } catch { /* dir doesn't exist */ }
    goals.sort((a, b) => a.createdAt - b.createdAt)
    return goals
  }

  private goalFilename(goal: GoalData): string {
    const slug = goal.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
      .replace(/-+$/, '')
    return `GOAL-${goal.id.slice(0, 12)}-${slug || 'untitled'}.md`
  }
}
