import { ref, computed, reactive, watch } from 'vue'
import type { Task, Agent, Workspace, TaskEvent, TaskPriority, TaskType, Session, SessionMessage, Comment, PendingDecision, AgentDecision, AgentMessage } from '../domain'
import { useWorkflow } from './useWorkflow'
import { MOCK_TASKS, MOCK_AGENTS, MOCK_WORKSPACES } from '../mock/data'

// ─── Reactive State (singleton) ─────────────────────────────────

// In extension mode, state is loaded from extension host. Mock data only used in standalone mode.
const isInVSCodeWebview = typeof window !== 'undefined' && !!(window as any).acquireVsCodeApi || typeof (globalThis as any).__vscode !== 'undefined'
const tasks = ref<Task[]>(isInVSCodeWebview ? [] : JSON.parse(JSON.stringify(MOCK_TASKS)))
const agents = ref<Agent[]>(isInVSCodeWebview ? [] : JSON.parse(JSON.stringify(MOCK_AGENTS)))
const workspaces = ref<Workspace[]>(isInVSCodeWebview ? [] : [...MOCK_WORKSPACES])
const sessions = ref<Session[]>([])
const selectedTaskId = ref<string | null>(null)
const activeWorkspaceFilter = ref<string | null>(null)
const activityFeed = ref<{ id: string; timestamp: number; message: string; type: string }[]>([])
const simulationRunning = ref(false)
const toasts = ref<{ id: string; message: string; type: 'success' | 'error' | 'info' | 'warning'; timestamp: number }[]>([])
const showCreateModal = ref(false)
const showSettings = ref(false)
const isExtensionMode = ref(false)
const showAgentPanel = ref(false)
const selectedAgentId = ref<string | null>(null)
const agentPanelTaskId = ref<string | null>(null)

// ─── Task Move Callbacks ────────────────────────────────────────
type TaskMoveCallback = (taskId: string, fromStage: string, toStage: string, task: Task) => void
const taskMoveCallbacks: TaskMoveCallback[] = []

// ─── Computed ───────────────────────────────────────────────────

function useBoard() {
  const filteredTasks = computed(() => {
    if (!activeWorkspaceFilter.value) return tasks.value
    return tasks.value.filter((t) => t.workspaceId === activeWorkspaceFilter.value)
  })

  const wf = useWorkflow()

  const tasksByStage = computed(() => {
    const map: Record<string, Task[]> = {}
    for (const stage of wf.stages.value) {
      map[stage.id] = []
    }
    for (const task of filteredTasks.value) {
      if (map[task.stage]) {
        map[task.stage].push(task)
      } else {
        // Task has a stage not in current workflow — put in first stage
        const first = wf.firstStage.value
        if (map[first]) map[first].push(task)
      }
    }
    return map
  })

  const stats = computed(() => {
    const total = tasks.value.length
    const byStage: Record<string, number> = {}
    for (const stage of wf.stages.value) {
      byStage[stage.id] = tasks.value.filter((t) => t.stage === stage.id).length
    }
    const blocked = tasks.value.filter((t) => t.approvalStatus === 'pending').length
    const activeAgents = agents.value.filter((a) => a.status === 'working').length
    return { total, byStage, blocked, activeAgents }
  })

  const workspaceStats = computed(() => {
    return workspaces.value.map((ws) => {
      const wsTasks = tasks.value.filter((t) => t.workspaceId === ws.id)
      return {
        ...ws,
        taskCount: wsTasks.length,
        activeTasks: wsTasks.filter((t) => !wf.isFinalStage(t.stage)).length,
        blockedTasks: wsTasks.filter((t) => t.approvalStatus === 'pending').length,
      }
    })
  })

  // ─── Actions ────────────────────────────────────────────────

  function moveTask(taskId: string, toStage: string, triggeredBy: 'agent' | 'human', agentId?: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return false

    const transition = wf.canTransition(task.stage, toStage)
    if (!transition) return false

    const fromStage = task.stage
    const event: TaskEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'stage_change',
      fromStage,
      toStage,
      agentId,
      message: `${transition.label} (by ${triggeredBy}${agentId ? `: ${getAgent(agentId)?.name}` : ''})`,
    }

    task.stage = toStage
    task.events.push(event)
    task.updatedAt = Date.now()

    // Track stage entry timestamp for KPI metrics
    if (!task.metrics) {
      task.metrics = { createdAt: task.createdAt, stageEnteredAt: {}, feedbackLoops: { devToPlanner: 0, reviewToDev: 0 } }
    }
    task.metrics.stageEnteredAt[toStage] = Date.now()

    // Apply transition effects from workflow config (replaces hardcoded review/merge/impl logic)
    wf.applyTransitionEffects(task, transition.effects)

    // Release manual assignment lock if the assigned agent's role doesn't match the new stage
    if (task.manuallyAssigned && task.assignee) {
      const assignedAgent = getAgent(task.assignee)
      if (assignedAgent) {
        const rolesForNewStage = wf.getAgentRolesForStage(toStage)
        if (rolesForNewStage.length > 0 && !rolesForNewStage.includes(assignedAgent.role)) {
          task.manuallyAssigned = false
          task.assignee = null
        }
      }
    }

    // If entering a stage with approval gates, set approval pending
    if (wf.stageHasApprovalGate(toStage) && !transition.effects?.includes('set-approved')) {
      task.approvalStatus = 'pending'
      task.blockedReason = 'Awaiting human approval'
    }

    const fromIcon = wf.getStageConfig(fromStage)?.icon ?? '📌'
    const toIcon = wf.getStageConfig(toStage)?.icon ?? '📌'
    const toLabel = wf.getStageConfig(toStage)?.label ?? toStage
    addActivity(`${fromIcon} → ${toIcon} **${task.title}** moved to ${toLabel}`, 'stage_change')
    addToast(`${task.title} → ${toLabel}`, wf.isFinalStage(toStage) ? 'success' : 'info')

    // Fire callbacks (branch creation, agent triggering, etc.)
    for (const cb of taskMoveCallbacks) {
      try { cb(taskId, fromStage, toStage, task) } catch (e) {
        console.error('[AgentBoard] onTaskMoved callback error:', e)
      }
    }

    return true
  }

  function approveTask(taskId: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return

    // Find the transition that has requiresApproval from the current stage
    const approvalTransition = wf.getValidTransitions(task.stage)
      .find(t => t.requiresApproval)
    if (!approvalTransition) return

    moveTask(taskId, approvalTransition.to, 'human')
  }

  function rejectTask(taskId: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return

    // Find a non-approval transition from the current stage (rejection path)
    const rejectTransition = wf.getValidTransitions(task.stage)
      .find(t => !t.requiresApproval && !wf.isFinalStage(t.to))
    if (!rejectTransition) return

    task.approvalStatus = 'rejected'
    const targetLabel = wf.getStageConfig(rejectTransition.to)?.label ?? rejectTransition.to
    moveTask(taskId, rejectTransition.to, 'human')
    addActivity(`❌ **${task.title}** rejected — sent back to ${targetLabel}`, 'human_action')
  }

  function selectTask(taskId: string | null) {
    selectedTaskId.value = taskId
  }

  function setWorkspaceFilter(wsId: string | null) {
    activeWorkspaceFilter.value = wsId
  }

  function getAgent(agentId: string): Agent | undefined {
    return agents.value.find((a) => a.id === agentId)
  }

  function getWorkspace(wsId: string): Workspace | undefined {
    return workspaces.value.find((w) => w.id === wsId)
  }

  function updateAgentStatus(agentId: string, status: Agent['status'], taskId: string | null) {
    const agent = agents.value.find((a) => a.id === agentId)
    if (agent) {
      agent.status = status
      agent.currentTaskId = taskId
    }
  }

  function updateTaskProgress(taskId: string, progress: number) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (task) {
      task.progress = Math.min(100, Math.max(0, progress))
      task.updatedAt = Date.now()
    }
  }

  function updateAgentUsage(agentId: string, tokensUsed: number) {
    const agent = agents.value.find((a) => a.id === agentId)
    if (agent) {
      agent.usage.totalTokensUsed += tokensUsed
      agent.usage.contextTokensUsed += Math.floor(tokensUsed * 0.7)
      agent.usage.requestCount += 1
      // Rough cost estimate per 1M tokens
      const costPerMillion: Record<string, number> = {
        'gpt-4o': 5, 'gpt-4o-mini': 0.15, 'claude-sonnet-4': 3, 'claude-opus-4': 15,
        'gemini-2.0-flash': 0.075, 'gemini-2.5-pro': 1.25, 'o3': 10, 'o4-mini': 1.1,
      }
      const rate = costPerMillion[agent.modelConfig.model] || 5
      agent.usage.estimatedCostUsd += (tokensUsed / 1_000_000) * rate
    }
  }

  const totalUsageStats = computed(() => {
    let totalTokens = 0
    let totalCost = 0
    let totalRequests = 0
    for (const agent of agents.value) {
      totalTokens += agent.usage.totalTokensUsed
      totalCost += agent.usage.estimatedCostUsd
      totalRequests += agent.usage.requestCount
    }
    return { totalTokens, totalCost, totalRequests }
  })

  const humanInterventionTasks = computed(() => {
    return tasks.value.filter((t) => t.approvalStatus === 'pending' || t.humanAttentionType === 'escalation')
  })

  function addActivity(message: string, type: string) {
    activityFeed.value.unshift({
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      message,
      type,
    })
    if (activityFeed.value.length > 50) activityFeed.value.pop()
  }

  function addToast(message: string, type: 'success' | 'error' | 'info' | 'warning') {
    const id = `toast-${Date.now()}`
    toasts.value.push({ id, message, type, timestamp: Date.now() })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 8000)
  }

  function createTask(opts: { title: string; description: string; priority: TaskPriority; taskType?: TaskType; workspaceId: string; tags: string[]; requiredSkills?: string[]; assignee?: string }) {
    const now = Date.now()
    const taskType = opts.taskType || 'feature'
    const newTask: Task = {
      id: `task-${now}-${Math.random().toString(36).slice(2, 6)}`,
      title: opts.title,
      description: opts.description,
      stage: wf.firstStage.value,
      priority: opts.priority,
      workspaceId: opts.workspaceId,
      assignee: opts.assignee || null,
      manuallyAssigned: !!opts.assignee,
      assignedAgents: opts.assignee ? [opts.assignee] : [],
      approvalStatus: 'none',
      events: [
        {
          id: `evt-${now}`,
          timestamp: now,
          type: 'human_action',
          toStage: wf.firstStage.value,
          message: 'Task created manually',
        },
      ],
      createdAt: now,
      updatedAt: now,
      tags: opts.tags,
      taskType,
      progress: 0,
      requiredSkills: opts.requiredSkills?.length ? opts.requiredSkills : undefined,
      pendingQuestions: [],
      comments: [],
      metrics: { createdAt: now, stageEnteredAt: { [wf.firstStage.value]: now }, feedbackLoops: { devToPlanner: 0, reviewToDev: 0 } },
    }
    tasks.value.unshift(newTask)
    const firstIcon = wf.getStageConfig(wf.firstStage.value)?.icon ?? '💡'
    const firstLabel = wf.getStageConfig(wf.firstStage.value)?.label ?? wf.firstStage.value
    addActivity(`${firstIcon} **${newTask.title}** created in ${firstLabel}`, 'human_action')
    addToast(`New task: ${newTask.title}`, 'success')
    return newTask
  }

  function openCreateModal() {
    showCreateModal.value = true
  }

  function closeCreateModal() {
    showCreateModal.value = false
  }

  function openSettings() {
    showSettings.value = true
  }

  function closeSettings() {
    showSettings.value = false
  }

  function openAgentPanel(agentId: string, taskId?: string) {
    selectedAgentId.value = agentId
    agentPanelTaskId.value = taskId || null
    showAgentPanel.value = true
  }

  function closeAgentPanel() {
    showAgentPanel.value = false
    selectedAgentId.value = null
    agentPanelTaskId.value = null
  }

  /** Replace mock data with real data from the extension host. */
  function initFromExtension(data: {
    workspaces: Array<{ id: string; name: string; localPath: string; repo: string; branch: string; hasChanges: boolean; icon: string; color: string }>
    agents: Array<{ id: string; name: string; role: string; avatar: string; color: string; model: string; temperature: number; maxContextTokens: number; systemPrompt: string; skills?: string[]; languages?: string[] }>
    persistedTasks?: any[]
    persistedSessions?: any[]
  }) {
    isExtensionMode.value = true

    // Map scanned workspaces → domain Workspace
    workspaces.value = data.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      repo: w.repo,
      color: w.color,
      icon: w.icon,
      localPath: w.localPath,
      branch: w.branch,
      hasChanges: w.hasChanges,
    }))

    // Map agent configs → domain Agent
    agents.value = data.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role as Agent['role'],
      avatar: a.avatar,
      status: 'idle' as const,
      currentTaskId: null,
      color: a.color,
      modelConfig: {
        model: a.model as any,
        maxContextTokens: a.maxContextTokens,
        temperature: a.temperature,
      },
      usage: {
        totalTokensUsed: 0,
        contextTokensUsed: 0,
        maxContextTokens: a.maxContextTokens,
        requestCount: 0,
        estimatedCostUsd: 0,
      },
      skills: a.skills || [],
      languages: a.languages || [],
    }))

    // Restore persisted tasks or start fresh
    if (data.persistedTasks && data.persistedTasks.length > 0) {
      tasks.value = data.persistedTasks as Task[]
      addActivity(`🔌 Connected to VS Code — restored ${data.persistedTasks.length} tasks`, 'human_action')
    } else {
      tasks.value = []
      addActivity('🔌 Connected to VS Code extension', 'human_action')
    }

    // Restore persisted sessions
    if (data.persistedSessions && data.persistedSessions.length > 0) {
      sessions.value = data.persistedSessions as Session[]
    } else {
      sessions.value = []
    }

    activityFeed.value = activityFeed.value.length > 0 ? activityFeed.value : []
  }

  /** Update workspaces from extension host (e.g. after rescan). */
  function updateWorkspacesFromExtension(scannedWorkspaces: Array<{ id: string; name: string; localPath: string; repo: string; branch: string; hasChanges: boolean; icon: string; color: string }>) {
    workspaces.value = scannedWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      repo: w.repo,
      color: w.color,
      icon: w.icon,
      localPath: w.localPath,
      branch: w.branch,
      hasChanges: w.hasChanges,
    }))
    addActivity(`📂 Workspaces updated — ${scannedWorkspaces.length} repos found`, 'human_action')
    addToast(`${scannedWorkspaces.length} workspaces loaded`, 'info')
  }

  /** Update agents from extension host (e.g. after adding agent repo path). */
  function updateAgentsFromExtension(agentConfigs: Array<{ id: string; name: string; role: string; avatar: string; color: string; model: string; temperature: number; maxContextTokens: number; systemPrompt: string; skills?: string[]; languages?: string[] }>) {
    agents.value = agentConfigs.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role as Agent['role'],
      avatar: a.avatar,
      status: 'idle' as const,
      currentTaskId: null,
      color: a.color,
      modelConfig: {
        model: a.model as any,
        maxContextTokens: a.maxContextTokens,
        temperature: a.temperature,
      },
      usage: {
        totalTokensUsed: 0,
        contextTokensUsed: 0,
        maxContextTokens: a.maxContextTokens,
        requestCount: 0,
        estimatedCostUsd: 0,
      },
      skills: a.skills || [],
      languages: a.languages || [],
    }))
    addActivity(`🤖 Agents updated — ${agentConfigs.length} agents loaded`, 'human_action')
  }

  /** Add a workspace manually (standalone mode). */
  function addWorkspace(ws: Workspace) {
    if (!workspaces.value.find((w) => w.id === ws.id)) {
      workspaces.value.push(ws)
      addActivity(`📂 **${ws.name}** workspace added`, 'human_action')
    }
  }

  /** Remove a workspace. */
  function removeWorkspace(wsId: string) {
    const ws = workspaces.value.find((w) => w.id === wsId)
    workspaces.value = workspaces.value.filter((w) => w.id !== wsId)
    if (activeWorkspaceFilter.value === wsId) activeWorkspaceFilter.value = null
    if (ws) addActivity(`📂 **${ws.name}** workspace removed`, 'human_action')
  }
  // ─── Comments ────────────────────────────────────────────────

  /** Add a comment to a task. */
  function addComment(taskId: string, content: string, author = 'user'): Comment | undefined {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return undefined
    if (!task.comments) task.comments = []

    const now = Date.now()
    const comment: Comment = {
      id: `comment-${now}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      content,
      author,
      timestamp: now,
    }
    task.comments.push(comment)
    task.updatedAt = now

    // Also add a TaskEvent for the timeline
    task.events.push({
      id: `evt-${now}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      type: 'comment',
      message: `💬 ${author === 'user' ? 'User' : getAgent(author)?.name || author}: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`,
      agentId: author !== 'user' ? author : undefined,
    })

    addActivity(`💬 Comment on "${task.title}"`, 'comment')
    return comment
  }

  /** Delete a comment from a task. */
  function deleteComment(taskId: string, commentId: string): boolean {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task || !task.comments) return false

    const idx = task.comments.findIndex((c) => c.id === commentId)
    if (idx < 0) return false

    task.comments.splice(idx, 1)
    task.updatedAt = Date.now()
    return true
  }
  // ─── Session Management ─────────────────────────────────────

  /** Get or create a session for a task+agent pair. */
  function getOrCreateSession(taskId: string, agentId: string): Session {
    let session = sessions.value.find((s) => s.taskId === taskId && s.agentId === agentId)
    if (!session) {
      session = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        taskId,
        agentId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
        totalTokensUsed: 0,
      }
      sessions.value.push(session)
    }
    return session
  }

  /** Add a message to a session. */
  function addSessionMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    tokensUsed?: number,
  ): SessionMessage {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const msg: SessionMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
      tokensUsed,
    }
    session.messages.push(msg)
    session.updatedAt = Date.now()
    if (tokensUsed) session.totalTokensUsed += tokensUsed
    return msg
  }

  /** Get all sessions for a task. */
  function getTaskSessions(taskId: string): Session[] {
    return sessions.value.filter((s) => s.taskId === taskId)
  }

  /** Get a specific session by ID. */
  function getSession(sessionId: string): Session | undefined {
    return sessions.value.find((s) => s.id === sessionId)
  }

  /** Set task branch when it's created via git. */
  function setTaskBranch(taskId: string, branchName: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (task) {
      task.branch = branchName
      task.updatedAt = Date.now()
      task.events.push({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type: 'agent_action',
        message: `Branch created: ${branchName}`,
      })
      addActivity(`⎇ Branch **${branchName}** created for "${task.title}"`, 'agent_action')
      addToast(`Branch: ${branchName}`, 'success')
    }
  }

  /** Generate a branch name from task title. */
  function slugifyBranchName(title: string, prefix = 'feature'): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
    return `${prefix}/${slug}`
  }

  /** Task types that should get a feature branch when moved to in-progress. */
  const BRANCH_TASK_TYPES: string[] = ['feature', 'bugfix', 'infra']

  /** Add a question from an agent that needs a human answer. */
  function addAgentQuestion(taskId: string, agentId: string, question: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return
    if (!task.pendingQuestions) task.pendingQuestions = []
    const q: import('../domain').AgentQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      question,
      timestamp: Date.now(),
      status: 'pending',
    }
    task.pendingQuestions.push(q)
    addActivity(`❓ Agent asked: "${question}" on "${task.title}"`, 'agent_action')
    addToast('Agent has a question', 'warning')
  }

  /** Answer an agent's pending question. */
  function answerAgentQuestion(taskId: string, questionId: string, answer: string) {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task || !task.pendingQuestions) return
    const q = task.pendingQuestions.find((qn) => qn.id === questionId)
    if (!q) return
    q.answer = answer
    q.answeredAt = Date.now()
    q.status = 'answered'
    addActivity(`✅ Question answered on "${task.title}"`, 'human_action')
    addToast('Answer submitted', 'success')
  }

  /** Find the best-matching agent for a task based on required skills, languages, and availability. */
  function getBestAgentForTask(agentList: Agent[], targetRoles: string[], task: Task): Agent | null {
    const needed = task.requiredSkills || []
    // Filter to agents matching any of the target roles
    const candidates = agentList.filter((a) => targetRoles.includes(a.role))
    if (candidates.length === 0) {
      // Fallback: try all agents if no role match (skill-first matching)
      if (needed.length > 0) {
        const allScored = scoreAgents(agentList, needed)
        if (allScored.length > 0 && allScored[0].score > 0) return allScored[0].agent
      }
      return null
    }
    if (needed.length === 0) return candidates.find((a) => a.status === 'idle') || candidates[0] || null

    const scored = scoreAgents(candidates, needed)
    return scored[0]?.agent || candidates.find((a) => a.status === 'idle') || candidates[0] || null
  }

  /** Score and rank agents by skill match (60%), idle status (25%), and recency (15%). */
  function scoreAgents(candidates: Agent[], neededSkills: string[]): Array<{ agent: Agent; score: number }> {
    const scored = candidates.map((agent) => {
      // Skill match score (0-1): how many required skills does this agent cover?
      const skillHits = neededSkills.filter((s) =>
        agent.skills.some(sk => sk.toLowerCase() === s.toLowerCase()) ||
        agent.languages.some(l => l.toLowerCase() === s.toLowerCase()),
      ).length
      const skillScore = neededSkills.length > 0 ? skillHits / neededSkills.length : 0

      // Availability score: idle agents preferred
      const idleScore = agent.status === 'idle' ? 1.0 : agent.status === 'waiting' ? 0.5 : 0.0

      // Recency score: prefer agents that haven't been used recently (less busy)
      const recencyScore = agent.currentTaskId ? 0.0 : 1.0

      // Weighted total
      const score = skillScore * 0.60 + idleScore * 0.25 + recencyScore * 0.15

      return { agent, score }
    })

    return scored.sort((a, b) => b.score - a.score)
  }

  /** Assign an agent as the primary responsible (assignee) for a task. */
  function assignAgent(taskId: string, agentId: string) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const agent = getAgent(agentId)
    task.assignee = agentId
    task.manuallyAssigned = true
    if (!task.assignedAgents.includes(agentId)) {
      task.assignedAgents.push(agentId)
    }
    task.updatedAt = Date.now()
    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'human_action',
      message: `👤 Assigned to ${agent?.name || agentId}`,
    })
    addActivity(`👤 **${agent?.name || agentId}** assigned to "${task.title}"`, 'human_action')
    addToast(`Assigned ${agent?.name || agentId} to "${task.title}"`, 'success')
  }

  /** Reassign a task to a different agent. */
  function reassignAgent(taskId: string, newAgentId: string) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const prevAgent = task.assignee ? getAgent(task.assignee) : null
    const newAgent = getAgent(newAgentId)
    task.assignee = newAgentId
    task.manuallyAssigned = true
    if (!task.assignedAgents.includes(newAgentId)) {
      task.assignedAgents.push(newAgentId)
    }
    task.updatedAt = Date.now()
    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'human_action',
      message: `🔄 Reassigned from ${prevAgent?.name || task.assignee || 'unassigned'} to ${newAgent?.name || newAgentId}`,
    })
    addActivity(`🔄 **${newAgent?.name || newAgentId}** now assigned to "${task.title}"`, 'human_action')
    addToast(`Reassigned to ${newAgent?.name || newAgentId}`, 'info')
  }

  /** Suggest agents ranked by skill match for a task (uses requiredSkills + tags). */
  function suggestAgents(task: Task): Array<{ agent: Agent; score: number; matchedSkills: string[] }> {
    const needed = [...(task.requiredSkills || []), ...task.tags].map(s => s.toLowerCase())
    if (needed.length === 0) {
      // No skills to match — return all agents sorted by availability
      return agents.value.map(agent => ({ agent, score: agent.status === 'idle' ? 1.0 : 0.5, matchedSkills: [] }))
    }
    return agents.value.map(agent => {
      const agentSkills = [...agent.skills, ...agent.languages].map(s => s.toLowerCase())
      const matchedSkills = needed.filter(s => agentSkills.includes(s))
      const skillScore = matchedSkills.length / needed.length
      const idleScore = agent.status === 'idle' ? 1.0 : agent.status === 'waiting' ? 0.5 : 0.0
      const score = skillScore * 0.70 + idleScore * 0.30
      return { agent, score, matchedSkills }
    }).sort((a, b) => b.score - a.score)
  }

  // ─── HITL (Human-in-the-Loop) ─────────────────────────────────

  /** Tasks that have a pending decision awaiting human confirmation. */
  const pendingDecisionTasks = computed(() =>
    tasks.value.filter(t => t.pendingDecision && t.pendingDecision.status === 'pending')
  )

  /** Set a pending decision on a task — blocks further progress until human confirms. */
  function setPendingDecision(
    taskId: string,
    decision: AgentDecision,
    agentId: string,
    context: string,
    proposedStage?: string,
  ): PendingDecision | undefined {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return undefined

    const pd: PendingDecision = {
      id: `pd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      decision,
      agentId,
      taskId,
      timestamp: Date.now(),
      context,
      proposedStage,
      status: 'pending',
    }
    task.pendingDecision = pd
    task.humanAttentionType = 'decision-confirmation'
    task.updatedAt = Date.now()

    // Record as event for traceability
    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'decision',
      agentId,
      message: `🔔 Agent proposes: ${decision.action} — "${decision.reason}" (confidence: ${Math.round(decision.confidence * 100)}%)`,
    })

    addActivity(
      `🔔 **${getAgent(agentId)?.name || agentId}** awaits confirmation for "${task.title}": ${decision.action}`,
      'decision',
    )
    addToast(`⏳ Decision pending: ${task.title} — ${decision.action}`, 'warning')

    return pd
  }

  /** Confirm (approve) a pending decision — executes the proposed action. */
  function confirmDecision(taskId: string, feedback?: string): PendingDecision | undefined {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task?.pendingDecision || task.pendingDecision.status !== 'pending') return undefined

    const pd = task.pendingDecision
    pd.status = 'approved'
    pd.humanFeedback = feedback
    task.humanAttentionType = undefined
    task.updatedAt = Date.now()

    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'human_action',
      message: `✅ Human confirmed: ${pd.decision.action}${feedback ? ` — "${feedback}"` : ''}`,
    })

    addActivity(
      `✅ Confirmed **${pd.decision.action}** for "${task.title}"`,
      'human_action',
    )
    addToast(`✅ Decision confirmed: ${task.title}`, 'success')

    // Clear pendingDecision (caller is responsible for executing the decision)
    task.pendingDecision = undefined

    return pd
  }

  /** Reject a pending decision — agent action is NOT executed. */
  function rejectDecision(taskId: string, feedback?: string): PendingDecision | undefined {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task?.pendingDecision || task.pendingDecision.status !== 'pending') return undefined

    const pd = task.pendingDecision
    pd.status = 'rejected'
    pd.humanFeedback = feedback
    task.humanAttentionType = undefined
    task.updatedAt = Date.now()

    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'human_action',
      message: `❌ Human rejected: ${pd.decision.action}${feedback ? ` — "${feedback}"` : ''}`,
    })

    addActivity(
      `❌ Rejected **${pd.decision.action}** for "${task.title}"`,
      'human_action',
    )
    addToast(`❌ Decision rejected: ${task.title}`, 'info')

    task.pendingDecision = undefined

    return pd
  }

  // ─── Inter-Agent Discussion ───────────────────────────────────

  /** Add an inter-agent message (question from one agent to another). */
  function addAgentMessage(
    fromAgentId: string,
    toAgentId: string,
    taskId: string,
    question: string,
  ): AgentMessage | undefined {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return undefined
    if (!task.agentMessages) task.agentMessages = []

    const msg: AgentMessage = {
      id: `amsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromAgentId,
      toAgentId,
      taskId,
      question,
      timestamp: Date.now(),
      status: 'pending',
    }
    task.agentMessages.push(msg)
    task.updatedAt = Date.now()

    const fromAgent = getAgent(fromAgentId)
    const toAgent = getAgent(toAgentId)

    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'agent_discussion',
      agentId: fromAgentId,
      message: `💬 ${fromAgent?.name || fromAgentId} → ${toAgent?.name || toAgentId}: "${question.slice(0, 100)}${question.length > 100 ? '...' : ''}"`,
    })

    addActivity(
      `💬 **${fromAgent?.name || fromAgentId}** asks **${toAgent?.name || toAgentId}**: "${question.slice(0, 60)}..."`,
      'agent_discussion',
    )
    addToast(`💬 Agent discussion on "${task.title}"`, 'info')

    return msg
  }

  /** Answer an inter-agent message. */
  function resolveAgentMessage(taskId: string, messageId: string, answer: string) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task?.agentMessages) return
    const msg = task.agentMessages.find(m => m.id === messageId)
    if (!msg) return

    msg.answer = answer
    msg.answeredAt = Date.now()
    msg.status = 'answered'
    task.updatedAt = Date.now()

    const toAgent = getAgent(msg.toAgentId)
    const fromAgent = getAgent(msg.fromAgentId)

    task.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: 'agent_discussion',
      agentId: msg.toAgentId,
      message: `💬 ${toAgent?.name || msg.toAgentId} replied to ${fromAgent?.name || msg.fromAgentId}: "${answer.slice(0, 100)}${answer.length > 100 ? '...' : ''}"`,
    })

    addActivity(
      `💬 **${toAgent?.name || msg.toAgentId}** replied to **${fromAgent?.name || msg.fromAgentId}**`,
      'agent_discussion',
    )
  }

  return {
    // State
    tasks,
    agents,
    workspaces,
    sessions,
    selectedTaskId,
    activeWorkspaceFilter,
    activityFeed,
    simulationRunning,
    toasts,
    showCreateModal,
    showSettings,
    isExtensionMode,
    showAgentPanel,
    selectedAgentId,
    agentPanelTaskId,
    // Computed
    filteredTasks,
    tasksByStage,
    stats,
    workspaceStats,
    // Actions
    moveTask,
    approveTask,
    rejectTask,
    selectTask,
    setWorkspaceFilter,
    getAgent,
    getWorkspace,
    updateAgentStatus,
    updateTaskProgress,
    updateAgentUsage,
    totalUsageStats,
    humanInterventionTasks,
    addActivity,
    addToast,
    createTask,
    openCreateModal,
    closeCreateModal,
    openSettings,
    closeSettings,
    openAgentPanel,
    closeAgentPanel,
    initFromExtension,
    updateWorkspacesFromExtension,
    updateAgentsFromExtension,
    addWorkspace,
    removeWorkspace,
    // Sessions
    getOrCreateSession,
    addSessionMessage,
    getTaskSessions,
    getSession,
    setTaskBranch,
    slugifyBranchName,
    // Agent Questions
    addAgentQuestion,
    answerAgentQuestion,
    getBestAgentForTask,
    /** Whether a task type requires a git branch */
    needsBranch: (taskType: string) => BRANCH_TASK_TYPES.includes(taskType),
    // Agent assignment
    assignAgent,
    reassignAgent,
    suggestAgents,
    // Comments
    addComment,
    deleteComment,
    // HITL (Human-in-the-Loop)
    pendingDecisionTasks,
    setPendingDecision,
    confirmDecision,
    rejectDecision,
    // Inter-Agent Discussion
    addAgentMessage,
    resolveAgentMessage,
    // Callbacks
    onTaskMoved: (cb: TaskMoveCallback) => {
      taskMoveCallbacks.push(cb)
      return () => {
        const idx = taskMoveCallbacks.indexOf(cb)
        if (idx >= 0) taskMoveCallbacks.splice(idx, 1)
      }
    },
  }
}

export { useBoard }
