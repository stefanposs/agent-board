<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'
import { useWorkflow } from '../composables/useWorkflow'
import { useFocusTrap } from '../composables/useFocusTrap'
import type { Agent, CommentType } from '../domain'
import { debouncedSave } from '../composables/usePersistence'
import TaskHITLGate from './TaskHITLGate.vue'
import TaskStepTimeline from './TaskStepTimeline.vue'

const props = defineProps<{
  taskId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const board = useBoard()
const { tasks, getAgent, getWorkspace, approveTask, rejectTask, moveTask, selectTask, agents, openAgentPanel, getTaskSessions, slugifyBranchName, isExtensionMode, workspaces, addComment, askAgentViaComment, editComment, togglePinComment, deleteComment, addAgentQuestion, answerAgentQuestion, getBestAgentForTask, assignAgent, reassignAgent, suggestAgents, goals, linkTaskToGoal, unlinkTaskFromGoal, openGoalDetail, deleteTask } = board
const ext = useExtension()
const wf = useWorkflow()
const overlayRef = ref<HTMLElement | null>(null)
useFocusTrap(overlayRef)

// ─── Inline Editing ─────────────────────────────────────────────
const editingTitle = ref(false)
const editingDesc = ref(false)
const titleInputRef = ref<HTMLInputElement | null>(null)
const descInputRef = ref<HTMLTextAreaElement | null>(null)

function startEditTitle() {
  editingTitle.value = true
  nextTick(() => titleInputRef.value?.focus())
}
function startEditDesc() {
  editingDesc.value = true
  nextTick(() => descInputRef.value?.focus())
}
function commitTitle(e: Event) {
  const val = (e.target as HTMLInputElement).value.trim()
  if (val && task.value && val !== task.value.title) {
    task.value.title = val
    task.value.updatedAt = Date.now()
    debouncedSave()
  }
  editingTitle.value = false
}
function commitDesc(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value.trim()
  if (task.value && val !== task.value.description) {
    task.value.description = val
    task.value.updatedAt = Date.now()
    debouncedSave()
  }
  editingDesc.value = false
}

// ─── Live Agent Activity ────────────────────────────────────────
const liveStreams = ref<Map<string, string>>(new Map())
const liveContainer = ref<HTMLElement | null>(null)

/** Which agents are currently working on THIS task */
const activeAgentsOnTask = computed(() =>
  agents.value.filter(a => a.status === 'working' && a.currentTaskId === props.taskId)
)

/** True while any agent is streaming for this task */
const hasLiveActivity = computed(() =>
  activeAgentsOnTask.value.length > 0 || liveStreams.value.size > 0
)

/** Latest session messages across all sessions for this task (most recent first, max 20) */
const recentMessages = computed(() => {
  const sessions = getTaskSessions(props.taskId)
  const msgs = sessions.flatMap(s => {
    const agent = getAgent(s.agentId)
    return s.messages.map(m => ({
      ...m,
      agentName: agent?.name || s.agentId,
      agentAvatar: agent?.avatar || '🤖',
      agentColor: agent?.color || '#666',
      sessionId: s.id,
      agentId: s.agentId,
    }))
  })
  return msgs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20).reverse()
})

// ─── Agent Questions ────────────────────────────────────────────
const questionAnswers = reactive<Record<string, string>>({})

function submitAnswer(questionId: string) {
  const answer = questionAnswers[questionId]?.trim()
  if (!answer || !task.value) return
  answerAgentQuestion(task.value.id, questionId, answer)
  delete questionAnswers[questionId]
}

function scrollLiveToBottom() {
  nextTick(() => {
    if (liveContainer.value) {
      liveContainer.value.scrollTop = liveContainer.value.scrollHeight
    }
  })
}

let _unsubOutput: (() => void) | undefined
let _unsubStatus: (() => void) | undefined

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('keydown', handleEscape)
  _unsubOutput = ext.onMessage('agent-output', (msg) => {
    // Only track agents that are working on THIS task
    const agent = agents.value.find(a => a.id === msg.agentId)
    if (!agent || agent.currentTaskId !== props.taskId) return

    if (msg.tokensUsed !== undefined && msg.tokensUsed !== null) {
      // Done — clear stream
      liveStreams.value.delete(msg.agentId)
      liveStreams.value = new Map(liveStreams.value)
      scrollLiveToBottom()
    } else if (msg.content) {
      const prev = liveStreams.value.get(msg.agentId) || ''
      liveStreams.value.set(msg.agentId, prev + msg.content)
      liveStreams.value = new Map(liveStreams.value)  // trigger reactivity
      scrollLiveToBottom()
    }
  })

  _unsubStatus = ext.onMessage('agent-status', (msg) => {
    const agent = agents.value.find(a => a.id === msg.agentId)
    if (!agent) return
    if (msg.status === 'working' && msg.taskId === props.taskId) {
      liveStreams.value.set(msg.agentId, '')
      liveStreams.value = new Map(liveStreams.value)
    }
    if (msg.status === 'idle') {
      liveStreams.value.delete(msg.agentId)
      liveStreams.value = new Map(liveStreams.value)
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape)
  _unsubOutput?.()
  _unsubStatus?.()
})

const task = computed(() => tasks.value.find((t) => t.id === props.taskId))
const workspace = computed(() => task.value ? getWorkspace(task.value.workspaceId) : undefined)
const stageConfig = computed(() => task.value ? wf.getStageConfig(task.value.stage) : undefined)
const transitions = computed(() => task.value ? wf.getValidTransitions(task.value.stage).filter(t => t.trigger !== 'agent') : [])
const taskSessions = computed(() => getTaskSessions(props.taskId))

/** Dynamic: which agent roles can run at the current task stage */
const eligibleRoles = computed(() => task.value ? wf.getAgentRolesForStage(task.value.stage) : [])

/** Is the current stage a final (completed) stage? */
const isAtFinalStage = computed(() => task.value ? wf.isFinalStage(task.value.stage) : false)

/** Does the current stage have any outgoing approval-gated transition? */
const hasApprovalGate = computed(() => task.value ? wf.stageHasApprovalGate(task.value.stage) : false)

/** Label for the approve button (from workflow transition config). */
const approveButtonLabel = computed(() => {
  if (!task.value) return 'Approve'
  const t = wf.getValidTransitions(task.value.stage).find(t => t.requiresApproval)
  return t?.label ?? 'Approve'
})

// ─── Comments ───────────────────────────────────────────────────
const newCommentText = ref('')
const commentType = ref<CommentType>('comment')
const replyToId = ref<string | null>(null)
const editingCommentId = ref<string | null>(null)
const editingCommentText = ref('')
const mentionDropdownVisible = ref(false)
const mentionFilter = ref('')
const mentionCursorPos = ref(0)
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null)
const collapsedThreads = ref<Set<string>>(new Set())

/** Threaded comments: top-level sorted by timestamp, replies nested under parent */
const threadedComments = computed(() => {
  if (!task.value?.comments) return []
  const comments = [...task.value.comments]
  const topLevel = comments.filter(c => !c.replyToId).sort((a, b) => a.timestamp - b.timestamp)
  const replyMap = new Map<string, typeof comments>()
  for (const c of comments.filter(c => c.replyToId)) {
    const arr = replyMap.get(c.replyToId!) || []
    arr.push(c)
    replyMap.set(c.replyToId!, arr)
  }
  return topLevel.map(c => ({
    ...c,
    replies: (replyMap.get(c.id) || []).sort((a, b) => a.timestamp - b.timestamp),
  }))
})

/** Pinned comments shown at top */
const pinnedComments = computed(() => {
  if (!task.value?.comments) return []
  return task.value.comments.filter(c => c.pinned).sort((a, b) => a.timestamp - b.timestamp)
})

const taskComments = computed(() => {
  if (!task.value?.comments) return []
  return [...task.value.comments].sort((a, b) => a.timestamp - b.timestamp)
})

/** Agents filtered for @mention autocomplete */
const mentionAgents = computed(() => {
  const filter = mentionFilter.value.toLowerCase()
  return agents.value.filter(a =>
    a.name.toLowerCase().includes(filter) || a.id.toLowerCase().includes(filter) || a.role.toLowerCase().includes(filter)
  ).slice(0, 8)
})

const commentTypeConfig: Record<CommentType, { icon: string; label: string; color: string }> = {
  'comment': { icon: '💬', label: 'Comment', color: 'var(--text-muted)' },
  'note': { icon: '📝', label: 'Note', color: 'var(--accent-blue, #3b82f6)' },
  'meeting-note': { icon: '📋', label: 'Meeting Note', color: 'var(--accent-purple, #8b5cf6)' },
  'question': { icon: '❓', label: 'Question', color: 'var(--accent-yellow, #f59e0b)' },
  'decision': { icon: '✅', label: 'Decision', color: 'var(--accent-green, #22c55e)' },
}

// ─── Unified Discussion Thread ──────────────────────────────

type ThreadItem =
  | { kind: 'comment'; data: typeof threadedComments.value[0]; timestamp: number }
  | { kind: 'agent-message'; data: NonNullable<typeof task.value>['agentMessages'] extends (infer U)[] | undefined ? U : never; timestamp: number }
  | { kind: 'event'; data: { id: string; timestamp: number; type: string; message: string; fromStage?: string; toStage?: string; agentId?: string }; timestamp: number }

/** Merge comments (threaded), agent messages, and key events into one chronological stream */
const unifiedThread = computed((): ThreadItem[] => {
  if (!task.value) return []
  const items: ThreadItem[] = []

  // Add threaded comments (top-level only — replies are nested inside)
  for (const thread of threadedComments.value) {
    items.push({ kind: 'comment', data: thread, timestamp: thread.timestamp })
  }

  // Add agent-to-agent discussion messages
  if (task.value.agentMessages) {
    for (const msg of task.value.agentMessages) {
      items.push({ kind: 'agent-message', data: msg, timestamp: msg.timestamp })
    }
  }

  // Add key events as lightweight dividers (stage changes, approvals, decisions)
  for (const event of task.value.events) {
    if (['stage_change', 'approval', 'decision', 'agent_discussion'].includes(event.type)) {
      items.push({ kind: 'event', data: event, timestamp: event.timestamp })
    }
  }

  return items.sort((a, b) => a.timestamp - b.timestamp)
})

/** Total tokens used across all sessions for this task */
const totalTaskTokens = computed(() => {
  return taskSessions.value.reduce((sum, s) => sum + s.totalTokensUsed, 0)
})

/** Total estimated cost for this task's sessions */
const totalTaskCost = computed(() => {
  let cost = 0
  for (const session of taskSessions.value) {
    const agent = getAgent(session.agentId)
    if (!agent) continue
    const costPerMillion: Record<string, number> = {
      'gpt-4o': 5, 'gpt-4o-mini': 0.15, 'claude-sonnet-4': 3, 'claude-opus-4': 15,
      'gemini-2.0-flash': 0.075, 'gemini-2.5-pro': 1.25, 'o3': 10, 'o4-mini': 1.1,
    }
    const rate = costPerMillion[agent.modelConfig.model] || 5
    cost += (session.totalTokensUsed / 1_000_000) * rate
  }
  return cost
})

// ─── Expanded Sessions (toggle message history) ─────────────
const expandedSessions = ref<Set<string>>(new Set())

function toggleSession(sessionId: string) {
  if (expandedSessions.value.has(sessionId)) {
    expandedSessions.value.delete(sessionId)
  } else {
    expandedSessions.value.add(sessionId)
  }
  expandedSessions.value = new Set(expandedSessions.value) // trigger reactivity
}

function submitComment() {
  const text = newCommentText.value.trim()
  if (!text || !task.value) return

  // Detect @agent mentions and auto-set question type
  const mentionMatch = text.match(/@(\S+)/)
  let effectiveType = commentType.value
  let mentionedAgent: ReturnType<typeof getAgent> = undefined
  if (mentionMatch) {
    mentionedAgent = agents.value.find(a =>
      a.id === mentionMatch[1] || a.name.toLowerCase().replace(/\s/g, '-') === mentionMatch[1].toLowerCase()
    )
    if (mentionedAgent && effectiveType === 'comment') effectiveType = 'question'
  }

  // If an agent is mentioned with a question, use askAgentViaComment to also create an AgentQuestion
  if (mentionedAgent && (effectiveType === 'question') && !replyToId.value) {
    askAgentViaComment(task.value.id, mentionedAgent.id, text)
  } else {
    addComment(task.value.id, text, 'user', {
      type: effectiveType,
      replyToId: replyToId.value || undefined,
    })
  }
  newCommentText.value = ''
  commentType.value = 'comment'
  replyToId.value = null
  mentionDropdownVisible.value = false
  debouncedSave()
}

function handleDeleteComment(commentId: string) {
  if (!task.value) return
  deleteComment(task.value.id, commentId)
  debouncedSave()
}

function handleEditComment(commentId: string, content: string) {
  editingCommentId.value = commentId
  editingCommentText.value = content
}

function saveEditComment() {
  if (!task.value || !editingCommentId.value) return
  editComment(task.value.id, editingCommentId.value, editingCommentText.value)
  editingCommentId.value = null
  editingCommentText.value = ''
  debouncedSave()
}

function cancelEditComment() {
  editingCommentId.value = null
  editingCommentText.value = ''
}

function handlePinComment(commentId: string) {
  if (!task.value) return
  togglePinComment(task.value.id, commentId)
  debouncedSave()
}

function startReply(commentId: string) {
  replyToId.value = commentId
  nextTick(() => commentTextareaRef.value?.focus())
}

function cancelReply() {
  replyToId.value = null
}

function toggleThread(commentId: string) {
  const s = new Set(collapsedThreads.value)
  if (s.has(commentId)) s.delete(commentId)
  else s.add(commentId)
  collapsedThreads.value = s
}

function handleCommentInput(e: Event) {
  const textarea = e.target as HTMLTextAreaElement
  const val = textarea.value
  const cursorPos = textarea.selectionStart || 0

  // Find if we're inside an @mention
  const beforeCursor = val.slice(0, cursorPos)
  const atMatch = beforeCursor.match(/@(\w*)$/)
  if (atMatch) {
    mentionDropdownVisible.value = true
    mentionFilter.value = atMatch[1]
    mentionCursorPos.value = cursorPos
  } else {
    mentionDropdownVisible.value = false
    mentionFilter.value = ''
  }
}

function insertMention(agent: { id: string; name: string }) {
  const val = newCommentText.value
  const beforeCursor = val.slice(0, mentionCursorPos.value)
  const atIdx = beforeCursor.lastIndexOf('@')
  if (atIdx === -1) return
  const after = val.slice(mentionCursorPos.value)
  const mention = `@${agent.name.replace(/\s/g, '-')}`
  newCommentText.value = val.slice(0, atIdx) + mention + ' ' + after
  mentionDropdownVisible.value = false
  mentionFilter.value = ''
  nextTick(() => commentTextareaRef.value?.focus())
}

/** Render markdown-like formatting to HTML */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="comment-code-block"><code>$2</code></pre>')
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="comment-inline-code">$1</code>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // @mentions — highlight
  html = html.replace(/@([\w-]+)/g, (match, name) => {
    const agent = agents.value.find(a =>
      a.name.toLowerCase().replace(/\s/g, '-') === name.toLowerCase() || a.id === name
    )
    if (agent) {
      const safeColor = /^#[0-9a-fA-F]{3,8}$|^var\(--[\w-]+\)$/.test(agent.color ?? '') ? agent.color : '#888'
      const safeName = (agent.name || '').replace(/[<>"&]/g, '')
      const safeAvatar = (agent.avatar || '').replace(/[<>"&]/g, '')
      return `<span class="mention-highlight" style="color: ${safeColor}">${safeAvatar} @${safeName}</span>`
    }
    return `<span class="mention-highlight">@${name}</span>`
  })
  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="comment-blockquote">$1</blockquote>')
  // List items
  html = html.replace(/^- (.+)$/gm, '<li class="comment-list-item">$1</li>')
  // Line breaks
  html = html.replace(/\n/g, '<br>')
  return html
}

/** Compute the markdown file path for the current task (matches MarkdownStateManager.taskFilename) */
const taskFilePath = computed(() => {
  if (!task.value) return ''
  const slug = task.value.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `.tasks/TASK-${task.value.id.slice(0, 8)}-${slug || 'untitled'}.md`
})

function openTaskFile() {
  if (!task.value || !taskFilePath.value) return
  if (isExtensionMode.value) {
    ext.openFile(taskFilePath.value)
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function eventColor(type: string): string {
  const map: Record<string, string> = {
    stage_change: 'var(--accent-blue)',
    agent_action: 'var(--accent-purple)',
    human_action: 'var(--accent-green)',
    approval: 'var(--accent-green)',
    comment: 'var(--text-muted)',
  }
  return map[type] || 'var(--text-muted)'
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

const taskGoals = computed(() => {
  if (!task.value?.goalIds?.length) return []
  return goals.value.filter(g => task.value!.goalIds!.includes(g.id))
})

const agentSuggestions = computed(() => task.value ? suggestAgents(task.value) : [])

function close() {
  emit('close')
}

// ─── Tabs ───────────────────────────────────────────────────────
const activeTab = ref<'overview' | 'activity' | 'details'>('overview')

/** Map task type to display label with icon */
const taskTypeLabels: Record<string, string> = {
  feature: '🚀 Feature',
  bugfix: '🐛 Bugfix',
  docs: '📄 Docs',
  infra: '🔧 Infra',
  research: '🔍 Research',
  design: '🎨 Design',
  ops: '⚙️ Ops',
  other: '📌 Other',
}

const taskTypeLabel = computed(() => task.value ? (taskTypeLabels[task.value.taskType] || task.value.taskType) : '')

/** Whether to show the Git section (only for dev-related task types or if branch exists) */
const showGitSection = computed(() => {
  if (!task.value) return false
  if (task.value.branch) return true
  return ['feature', 'bugfix', 'infra'].includes(task.value.taskType)
})

function askAgent() {
  if (!task.value) return
  const agentId = task.value.assignedAgents[0] || agents.value[0]?.id
  if (agentId) {
    close()
    openAgentPanel(agentId, task.value.id)
  }
}

function openSession(agentId: string) {
  if (!task.value) return
  close()
  openAgentPanel(agentId, task.value.id)
}

function handleMoveTask(toStage: string) {
  if (!task.value) return
  // Branch creation + agent auto-start handled globally by onTaskMoved callback in main.ts
  moveTask(task.value.id, toStage as any, 'human')
  debouncedSave()
  close()
}

function createBranchManually() {
  if (!task.value || !workspace.value?.localPath) return
  const branchName = slugifyBranchName(task.value.title)
  ext.createBranch(task.value.id, workspace.value.localPath, branchName)
}

/** Get a short label for the active backend */
const backendBadgeMap: Record<string, string> = {
  'auto': '', 'copilot-lm': 'Copilot', 'claude-cli': 'CLI', 'cline': 'Cline',
}
function backendSuffix(): string {
  const b = ext.defaultBackend.value
  const label = backendBadgeMap[b] || ''
  return label ? ` (${label})` : ''
}

/** Manually trigger an agent by role for this task. Replaces individual run functions. */
function runAgentByRole(targetRoles: string[], label: string, buildPrompt: (t: any, ws: any, context: string) => string) {
  if (!task.value) return
  const t = task.value
  const allAgents = agents.value

  // Use skill-based matching when available, fallback to simple role matching
  let agent: Agent | null = getBestAgentForTask(allAgents, targetRoles, t)
  if (!agent) {
    // Fallback: simple role scan
    for (const role of targetRoles) {
      agent = allAgents.find(a => a.role === role && a.status === 'idle') || allAgents.find(a => a.role === role) || null
      if (agent) break
    }
  }

  if (!agent) {
    board.addToast(`❌ No ${label} Agent found (${allAgents.length} agents, roles: ${allAgents.map(a => a.role).join(', ')})`, 'error')
    return
  }

  const ws = workspace.value
  const matchedSkills = [...agent.skills, ...agent.languages].filter(s =>
    [...(t.requiredSkills || []), ...t.tags].some(ts => ts.toLowerCase() === s.toLowerCase())
  )
  board.addToast(`🤖 Starting ${agent.name}${matchedSkills.length ? ` (matched: ${matchedSkills.join(', ')})` : ''}...`, 'info')

  // Gather context from previous sessions
  const prevSessions = board.sessions.value.filter(
    s => s.taskId === t.id && s.messages.some(m => m.role === 'assistant'),
  )
  const prevContext = prevSessions
    .flatMap(s => s.messages.filter(m => m.role === 'assistant').map(m => m.content))
    .join('\n\n')

  const session = board.getOrCreateSession(t.id, agent.id)
  const prompt = buildPrompt(t, ws, prevContext)
  board.addSessionMessage(session.id, 'user', prompt)

  if (ext.isWebview.value) {
    ext.runAgent(agent.id, t.id, prompt, [], ws?.localPath, t.branch)
    board.addToast(`✅ Agent request sent (${agent.id})`, 'success')
  } else {
    board.addToast(`⚠️ Not in webview mode — agent cannot start`, 'warning')
  }

  if (!t.assignedAgents.includes(agent.id)) {
    t.assignedAgents.push(agent.id)
  }
  debouncedSave()
}

function runPlannerManually() {
  runAgentByRole(['planner', 'architect'], 'Planner', (t, ws) => {
    return `Analyze and plan the implementation for this task:\n\nTask: "${t.title}"\nDescription: ${t.description || '(no description)'}\nTags: ${t.tags.length > 0 ? t.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\nPlease:\n1. Identify relevant files/components\n2. Assess feasibility and complexity\n3. Provide a step-by-step implementation plan\n4. List dependencies and potential risks\n5. Suggest existing patterns/conventions to follow`
  })
}

function runDeveloperManually() {
  runAgentByRole(['developer', 'devops'], 'Developer', (t, ws, ctx) => {
    return `Implement the following task:\n\nTask: "${t.title}"\nDescription: ${t.description || '(no description)'}\nTags: ${t.tags.length > 0 ? t.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\n${ctx ? `--- Planning Context ---\n${ctx}\n\n` : ''}Please:\n1. Implement the changes described in the planning phase\n2. Follow existing code patterns and conventions\n3. Write clean, well-tested code\n4. Commit your changes with meaningful messages`
  })
}

function runReviewerManually() {
  runAgentByRole(['reviewer'], 'Reviewer', (t, ws, ctx) => {
    return `Review the implementation for this task:\n\nTask: "${t.title}"\nDescription: ${t.description || '(no description)'}\nTags: ${t.tags.length > 0 ? t.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\n${ctx ? `--- Implementation Context ---\n${ctx}\n\n` : ''}Please:\n1. Review the code changes for correctness and quality\n2. Check for potential bugs, security issues, and performance concerns\n3. Verify adherence to project conventions and patterns\n4. Provide actionable feedback or approve the changes`
  })
}

/** Simple markdown-ish rendering for agent output */
function formatOutput(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="live-code"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="live-inline-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s+(.+)/gm, '<div class="live-list-item">• $1</div>')
    .replace(/^\s*(\d+)\.\s+(.+)/gm, '<div class="live-list-item">$1. $2</div>')
    .replace(/\n/g, '<br />')
}

const showDeleteConfirm = ref(false)

function handleDeleteTask() {
  if (!task.value) return
  showDeleteConfirm.value = true
}

function confirmDeleteTask() {
  if (!task.value) return
  const taskId = task.value.id
  deleteTask(taskId)
  if (ext.isWebview.value) {
    ext.deleteTask(taskId)
  }
  debouncedSave()
  showDeleteConfirm.value = false
  emit('close')
}

function handleStopAgent(agentId: string) {
  ext.stopAgent(agentId)
  board.updateAgentStatus(agentId, 'idle', null)
  board.addToast(`⏹ Agent stopped`, 'warning')
}
</script>

<template>
  <div v-if="task" class="detail-overlay" ref="overlayRef" @click.self="close" role="dialog" aria-modal="true" aria-label="Task details">
    <div class="detail-panel">
      <div class="detail-header" style="position: relative;">
        <div class="detail-header-actions">
          <button class="btn btn-sm btn-danger" @click="handleDeleteTask" title="Delete task" style="font-size: 12px;">🗑</button>
          <button class="detail-close-btn" @click="close" aria-label="Close">✕</button>
        </div>
        <!-- Delete confirmation inline -->
        <div v-if="showDeleteConfirm" class="delete-confirm-bar">
          <span>Delete "{{ task.title }}"?</span>
          <button class="btn btn-sm btn-danger" @click="confirmDeleteTask">Yes, delete</button>
          <button class="btn btn-sm" @click="showDeleteConfirm = false">Cancel</button>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span v-if="stageConfig" :style="{ color: stageConfig.color, fontWeight: 600, fontSize: '13px' }">
            {{ stageConfig.icon }} {{ stageConfig.label }}
          </span>
          <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">
            {{ taskTypeLabel }}
          </span>
        </div>
        <input
          v-if="editingTitle"
          ref="titleInputRef"
          class="detail-title detail-title-input"
          :value="task.title"
          @blur="commitTitle"
          @keydown.enter="commitTitle"
          @keydown.escape.stop="editingTitle = false"
        />
        <div v-else class="detail-title detail-title-editable" @click="startEditTitle" title="Click to edit">{{ task.title }}</div>
        <textarea
          v-if="editingDesc"
          ref="descInputRef"
          class="detail-desc detail-desc-input"
          :value="task.description"
          rows="3"
          @blur="commitDesc"
          @keydown.escape.stop="editingDesc = false"
        ></textarea>
        <div v-else class="detail-desc detail-desc-editable" @click="startEditDesc" title="Click to edit">{{ task.description || 'Click to add description...' }}</div>

        <!-- File link to task markdown -->
        <div class="task-file-link" v-if="taskFilePath">
          <span class="file-link-clickable" @click="openTaskFile" role="link" tabindex="0" @keydown.enter="openTaskFile" title="Open markdown file in editor">
            📄 {{ taskFilePath }}
          </span>
        </div>
      </div>

      <!-- ─── Status Banner: Agent Working ─── -->
      <div v-if="activeAgentsOnTask.length > 0" class="status-banner status-working">
        <span class="status-icon"><span class="working-pulse" style="width: 8px; height: 8px;"></span></span>
        <div class="status-text">
          <div class="status-label">Agent{{ activeAgentsOnTask.length > 1 ? 's' : '' }} working</div>
          <div class="status-detail">
            {{ activeAgentsOnTask.map(a => `${a.avatar} ${a.name}`).join(', ') }}
          </div>
        </div>
        <div class="status-actions">
          <button v-for="a in activeAgentsOnTask" :key="a.id" class="btn btn-sm" @click="openSession(a.id)">
            💬 {{ a.name }}
          </button>
          <button v-for="a in activeAgentsOnTask" :key="'stop-'+a.id" class="btn btn-sm btn-danger" @click="handleStopAgent(a.id)" title="Stop agent">
            ⏹
          </button>
        </div>
      </div>

      <!-- ─── HITL Gate: Agent Decision Awaiting Confirmation ─── -->
      <TaskHITLGate :taskId="props.taskId" />

      <!-- ─── Status Banner: Human Attention Required ─── -->
      <div v-if="hasApprovalGate && task.approvalStatus === 'pending' && !task.pendingDecision" class="status-banner status-attention">
        <span class="status-icon">⚠️</span>
        <div class="status-text">
          <div class="status-label">
            {{ task.humanAttentionType === 'clarification' ? 'Agent needs clarification' : task.humanAttentionType === 'feedback' ? 'Feedback requested' : task.humanAttentionType === 'review' ? 'Review requested' : 'Human Approval Required' }}
          </div>
          <div class="status-detail">{{ task.blockedReason || 'Review complete. Awaiting human decision.' }}</div>
        </div>
        <div class="status-actions">
          <button class="btn btn-sm btn-success" @click="approveTask(task.id); close()">✅ {{ approveButtonLabel }}</button>
          <button class="btn btn-sm btn-danger" @click="rejectTask(task.id); close()">❌ Reject</button>
          <button class="btn btn-sm" @click="askAgent">💬 Ask</button>
        </div>
      </div>

      <!-- ─── Tabs ─── -->
      <div class="detail-tabs">
        <div class="detail-tab" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">
          Overview
        </div>
        <div class="detail-tab" :class="{ active: activeTab === 'activity' }" @click="activeTab = 'activity'">
          Activity
          <span v-if="activeAgentsOnTask.length > 0 || taskSessions.length > 0" class="tab-count">{{ taskSessions.length || '●' }}</span>
        </div>
        <div class="detail-tab" :class="{ active: activeTab === 'details' }" @click="activeTab = 'details'">
          Details
          <span v-if="unifiedThread.length > 0" class="tab-count">{{ unifiedThread.length }}</span>
        </div>
      </div>

      <!-- ═══════════════ OVERVIEW TAB ═══════════════ -->
      <template v-if="activeTab === 'overview'">
        <!-- Actions (only when task is not completed) -->
        <div v-if="!isAtFinalStage" class="detail-section" style="background: rgba(59, 130, 246, 0.04); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: 8px; padding: 12px;">
          <div class="detail-section-title">⚡ Actions</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button
              v-if="eligibleRoles.includes('planner') || eligibleRoles.includes('architect')"
              class="btn btn-sm"
              style="background: var(--accent-purple); color: white;"
              @click="runPlannerManually"
            >
              🤖 Run Planner{{ backendSuffix() }}
            </button>
            <button
              v-if="eligibleRoles.includes('developer') || eligibleRoles.includes('devops')"
              class="btn btn-sm"
              style="background: var(--accent-blue, #3b82f6); color: white;"
              @click="runDeveloperManually"
            >
              👨‍💻 Run Developer{{ backendSuffix() }}
            </button>
            <button
              v-if="eligibleRoles.includes('reviewer')"
              class="btn btn-sm"
              style="background: var(--accent-orange, #f97316); color: white;"
              @click="runReviewerManually"
            >
              🔍 Run Reviewer{{ backendSuffix() }}
            </button>
            <button
              v-for="tr in transitions"
              :key="`${tr.from}-${tr.to}`"
              class="btn btn-sm"
              :class="{ 'btn-primary': !wf.isFinalStage(tr.to) && tr.from !== tr.to }"
              @click="handleMoveTask(tr.to)"
            >
              {{ tr.label }}
            </button>
          </div>
        </div>

        <!-- Compact Status Strip -->
        <div class="detail-section detail-status-strip">
          <div class="status-strip-item">
            <span class="status-strip-label">Assignee</span>
            <span v-if="task.assignee && getAgent(task.assignee)" class="status-strip-value">
              {{ getAgent(task.assignee!)?.avatar }} {{ getAgent(task.assignee!)?.displayName || getAgent(task.assignee!)?.name }}
            </span>
            <span v-else class="status-strip-value status-strip-muted">Unassigned</span>
          </div>
          <div class="status-strip-divider"></div>
          <div class="status-strip-item">
            <span class="status-strip-label">Progress</span>
            <span class="status-strip-value">
              {{ task.progress }}%
              <span v-if="task.progress > 0 && task.progress < 100" class="status-strip-bar">
                <span :style="{ width: task.progress + '%', background: task.progress >= 80 ? 'var(--accent-green)' : 'var(--accent-blue)' }"></span>
              </span>
            </span>
          </div>
        </div>

        <!-- Pipeline Progress (compact) -->
        <div class="detail-section" style="padding: 10px 20px;">
          <div style="display: flex; gap: 4px; align-items: center;">
            <template v-for="(stage, idx) in wf.stages.value" :key="stage.id">
              <div
                :style="{
                  flex: 1,
                  height: '5px',
                  borderRadius: '3px',
                  background: wf.stages.value.findIndex(s => s.id === task?.stage) >= idx
                    ? (stageConfig?.color || 'var(--accent-blue)')
                    : 'var(--bg-tertiary)',
                  transition: 'background 0.3s ease',
                }"
                :title="stage.label"
              ></div>
            </template>
          </div>
        </div>

        <!-- Agent Questions (only when present — actionable) -->
        <div v-if="task.pendingQuestions && task.pendingQuestions.length > 0" class="detail-section">
          <div class="detail-section-title" style="display: flex; align-items: center; gap: 8px;">
            <span>❓ Agent Questions</span>
            <span v-if="task.pendingQuestions.filter(q => q.status === 'pending').length > 0" class="tab-count" style="background: rgba(249,115,22,0.15); color: var(--accent-orange);">
              {{ task.pendingQuestions.filter(q => q.status === 'pending').length }} pending
            </span>
          </div>
          <div v-for="q in task.pendingQuestions" :key="q.id" class="question-item" :class="q.status">
            <div class="question-header">
              <span class="question-agent-avatar" :style="{ color: getAgent(q.agentId)?.color || '#666' }">
                {{ getAgent(q.agentId)?.avatar || '🤖' }}
              </span>
              <span style="font-weight: 600; font-size: 12px;">{{ getAgent(q.agentId)?.name || q.agentId }}</span>
              <span style="font-size: 11px; color: var(--text-muted); margin-left: auto;">{{ timeAgo(q.timestamp) }}</span>
            </div>
            <div class="question-text">{{ q.question }}</div>
            <div v-if="q.status === 'pending'" class="question-answer-form">
              <input
                v-model="questionAnswers[q.id]"
                class="question-answer-input"
                placeholder="Type your answer..."
                @keydown.enter="submitAnswer(q.id)"
              />
              <button class="btn btn-sm btn-primary" :disabled="!questionAnswers[q.id]?.trim()" @click="submitAnswer(q.id)">
                Reply
              </button>
            </div>
            <div v-else class="question-answer-display">
              <span style="font-size: 11px; color: var(--accent-green); font-weight: 600;">✅ Answered</span>
              <div style="font-size: 13px; margin-top: 4px;">{{ q.answer }}</div>
            </div>
          </div>
        </div>

        <!-- Linked Goals (only when present, compact) -->
        <div v-if="taskGoals.length > 0" class="detail-section">
          <div class="detail-section-title">🎯 Goals</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <span v-for="g in taskGoals" :key="g.id" class="tag" style="cursor: pointer;" @click="openGoalDetail(g.id)">{{ g.title }}</span>
          </div>
        </div>
      </template>

      <!-- ═══════════════ ACTIVITY TAB ═══════════════ -->
      <template v-if="activeTab === 'activity'">
        <!-- Step Timeline -->
        <div class="detail-section">
          <TaskStepTimeline :taskId="props.taskId" />
        </div>

        <!-- Live Agent Activity -->
        <div v-if="hasLiveActivity || recentMessages.length > 0" class="detail-section live-activity-section">
          <div class="detail-section-title" style="display: flex; align-items: center; gap: 8px;">
            <span>🤖 Agent Activity</span>
            <span v-if="activeAgentsOnTask.length > 0" class="live-pulse">● live</span>
          </div>

          <div ref="liveContainer" class="live-activity-container">
            <div
              v-for="msg in recentMessages"
              :key="msg.id"
              class="live-msg"
              :class="'live-msg-' + msg.role"
            >
              <div class="live-msg-header">
                <span class="live-msg-avatar" :style="{ color: msg.agentColor }">
                  {{ msg.role === 'user' ? '👤' : msg.agentAvatar }}
                </span>
                <span class="live-msg-name">{{ msg.role === 'user' ? 'You' : msg.agentName }}</span>
                <span class="live-msg-time">{{ timeAgo(msg.timestamp) }}</span>
                <span v-if="msg.tokensUsed" class="live-msg-tokens">🪙 {{ msg.tokensUsed }}</span>
              </div>
              <div class="live-msg-body" v-html="formatOutput(msg.content)"></div>
            </div>

            <div
              v-for="[agentId, content] in liveStreams"
              :key="'stream-' + agentId"
              class="live-msg live-msg-assistant live-msg-streaming"
            >
              <div class="live-msg-header">
                <span class="live-msg-avatar" :style="{ color: getAgent(agentId)?.color || '#666' }">
                  {{ getAgent(agentId)?.avatar || '🤖' }}
                </span>
                <span class="live-msg-name">{{ getAgent(agentId)?.name || agentId }}</span>
                <span class="live-streaming-badge">● streaming</span>
              </div>
              <div v-if="content" class="live-msg-body" v-html="formatOutput(content)"></div>
              <div v-else class="live-msg-body live-waiting">Thinking…</div>
            </div>

            <div v-if="recentMessages.length === 0 && liveStreams.size === 0" class="live-empty">
              Waiting for agent activity…
            </div>
          </div>

          <div v-if="activeAgentsOnTask.length > 0" class="live-agents-bar">
            <span style="font-size: 11px; color: var(--text-muted);">Active:</span>
            <button
              v-for="a in activeAgentsOnTask"
              :key="a.id"
              class="live-agent-chip"
              @click="openSession(a.id)"
            >
              {{ a.avatar }} {{ a.name }}
            </button>
          </div>
        </div>

        <!-- Sessions -->
        <div class="detail-section">
          <div class="detail-section-title" style="display: flex; align-items: center; gap: 8px;">
            <span>Sessions ({{ taskSessions.length }})</span>
            <span v-if="totalTaskTokens > 0" class="session-meta-badge">
              🪙 {{ formatTokens(totalTaskTokens) }} tokens
            </span>
            <span v-if="totalTaskCost > 0" class="session-meta-badge">
              💰 ${{ totalTaskCost.toFixed(3) }}
            </span>
            <button v-if="taskSessions.length > 0" class="btn btn-sm" style="font-size: 11px; padding: 2px 8px; margin-left: auto;" @click="askAgent">+ Open Chat</button>
          </div>
          <div v-if="taskSessions.length === 0" style="font-size: 13px; color: var(--text-muted);">
            No sessions yet. Move task to Planning or open an agent to start.
          </div>
          <div
            v-for="session in taskSessions"
            :key="session.id"
            class="session-row-expandable"
          >
            <div class="session-row-header" @click="toggleSession(session.id)">
              <div class="agent-avatar" :style="{ background: (getAgent(session.agentId)?.color || '#666') + '20' }">
                {{ getAgent(session.agentId)?.avatar || '🤖' }}
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="agent-name">{{ getAgent(session.agentId)?.name || session.agentId }}</span>
                  <span class="session-status-dot" :class="'session-' + session.status"></span>
                  <span style="font-size: 10px; color: var(--text-muted);">{{ getAgent(session.agentId)?.modelConfig.model }}</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; margin-top: 2px;">
                  <span>💬 {{ session.messages.length }} messages</span>
                  <span v-if="session.totalTokensUsed > 0">🪙 {{ formatTokens(session.totalTokensUsed) }}</span>
                  <span>{{ timeAgo(session.updatedAt) }}</span>
                </div>
              </div>
              <span class="session-expand-icon" :class="{ 'expanded': expandedSessions.has(session.id) }">
                ▸
              </span>
            </div>
            <div v-if="expandedSessions.has(session.id)" class="session-messages">
              <div
                v-for="msg in session.messages"
                :key="msg.id"
                class="session-msg"
                :class="'session-msg-' + msg.role"
              >
                <div class="session-msg-header">
                  <span>{{ msg.role === 'user' ? '👤 You' : msg.role === 'system' ? '⚙️ System' : (getAgent(session.agentId)?.avatar || '🤖') + ' ' + (getAgent(session.agentId)?.name || session.agentId) }}</span>
                  <span class="session-msg-time">{{ timeAgo(msg.timestamp) }}</span>
                  <span v-if="msg.tokensUsed" class="session-msg-tokens">🪙 {{ msg.tokensUsed }}</span>
                </div>
                <div class="session-msg-content">{{ msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content }}</div>
              </div>
              <button class="btn btn-sm" style="margin-top: 6px;" @click="openSession(session.agentId)">
                💬 Open Full Chat
              </button>
            </div>
          </div>
        </div>

        <!-- Timeline -->
        <div class="detail-section">
          <div class="detail-section-title">Timeline</div>
          <div class="timeline">
            <div v-for="event in [...task.events].reverse()" :key="event.id" class="timeline-item">
              <div class="timeline-dot" :style="{ background: eventColor(event.type) }"></div>
              <div class="timeline-content">
                <div class="timeline-message">{{ event.message }}</div>
                <div class="timeline-time">{{ timeAgo(event.timestamp) }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ═══════════════ DETAILS TAB ═══════════════ -->
      <template v-if="activeTab === 'details'">
        <!-- Unified Discussion Thread -->
        <div class="detail-section discussion-section">
          <div class="detail-section-title" style="display: flex; align-items: center; gap: 8px;">
            <span>💬 Discussion ({{ unifiedThread.length }})</span>
          </div>

          <!-- Pinned Items -->
          <div v-if="pinnedComments.length > 0" class="pinned-section">
            <div class="pinned-header">📌 Pinned</div>
            <div
              v-for="comment in pinnedComments"
              :key="'pin-' + comment.id"
              class="comment-item comment-pinned"
              :class="[comment.type ? `comment-type-${comment.type}` : '']"
            >
              <div class="comment-header">
                <span class="comment-type-badge" v-if="comment.type && comment.type !== 'comment'" :style="{ color: commentTypeConfig[comment.type || 'comment'].color }">
                  {{ commentTypeConfig[comment.type || 'comment'].icon }}
                </span>
                <span class="comment-author">
                  {{ comment.author === 'user' ? '👤 User' : (getAgent(comment.author)?.avatar || '🤖') + ' ' + (getAgent(comment.author)?.name || comment.author) }}
                </span>
                <span class="comment-time">{{ timeAgo(comment.timestamp) }}</span>
                <span v-if="comment.editedAt" class="comment-edited">(edited)</span>
                <button class="comment-action-btn" @click="handlePinComment(comment.id)" title="Unpin">📌</button>
              </div>
              <div class="comment-body" v-html="renderMarkdown(comment.content)"></div>
            </div>
          </div>

          <!-- Comment Input Area -->
          <div class="comment-input-area">
            <!-- Reply indicator -->
            <div v-if="replyToId" class="reply-indicator">
              <span>↩️ Replying to {{ (() => { const c = taskComments.find(c => c.id === replyToId); return c ? (c.author === 'user' ? 'User' : getAgent(c.author)?.name || c.author) : '...' })() }}</span>
              <button class="reply-cancel" @click="cancelReply">✕</button>
            </div>

            <!-- Type selector pills -->
            <div class="comment-type-selector">
              <button
                v-for="(cfg, key) in commentTypeConfig"
                :key="key"
                class="type-pill"
                :class="{ active: commentType === key }"
                :style="commentType === key ? { borderColor: cfg.color, color: cfg.color } : {}"
                @click="commentType = key as CommentType"
              >
                {{ cfg.icon }} {{ cfg.label }}
              </button>
            </div>

            <div class="comment-input-wrapper">
              <textarea
                ref="commentTextareaRef"
                v-model="newCommentText"
                class="comment-textarea"
                :placeholder="commentType === 'question' ? 'Ask a question... use @agent to mention' : commentType === 'meeting-note' ? 'Add meeting notes...' : commentType === 'decision' ? 'Record a decision...' : 'Add a comment... use @agent to mention'"
                rows="3"
                @input="handleCommentInput"
                @keydown.ctrl.enter="submitComment"
                @keydown.meta.enter="submitComment"
                @keydown.escape="mentionDropdownVisible = false"
              />

              <!-- @Mention Autocomplete Dropdown -->
              <div v-if="mentionDropdownVisible && mentionAgents.length > 0" class="mention-dropdown">
                <div
                  v-for="agent in mentionAgents"
                  :key="agent.id"
                  class="mention-option"
                  @mousedown.prevent="insertMention(agent)"
                >
                  <span class="mention-avatar">{{ agent.avatar }}</span>
                  <span class="mention-name">{{ agent.name }}</span>
                  <span class="mention-role">{{ agent.role }}</span>
                </div>
              </div>
            </div>

            <div class="comment-input-actions">
              <span class="comment-hint">⌘+Enter to send</span>
              <button
                class="btn btn-sm btn-primary"
                :disabled="!newCommentText.trim()"
                @click="submitComment"
              >
                {{ commentTypeConfig[commentType].icon }} Send {{ commentType !== 'comment' ? commentTypeConfig[commentType].label : '' }}
              </button>
            </div>
          </div>

          <!-- Unified Thread: comments + agent messages + events -->
          <div v-if="unifiedThread.length === 0 && pinnedComments.length === 0" style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">
            No activity yet. Start the discussion!
          </div>
          <div v-else class="comments-list unified-thread">
            <template v-for="item in unifiedThread" :key="item.kind + '-' + (item.kind === 'comment' ? item.data.id : item.kind === 'agent-message' ? item.data.id : item.data.id)">

              <!-- ── Event Divider ── -->
              <div v-if="item.kind === 'event'" class="thread-event-divider">
                <span class="event-divider-line"></span>
                <span class="event-divider-content">
                  <span class="event-divider-dot" :style="{ background: eventColor(item.data.type) }"></span>
                  {{ item.data.message }}
                  <span class="event-divider-time">{{ timeAgo(item.timestamp) }}</span>
                </span>
                <span class="event-divider-line"></span>
              </div>

              <!-- ── Agent-to-Agent Message ── -->
              <div v-else-if="item.kind === 'agent-message'" class="thread-agent-message">
                <div class="agent-msg-bubble">
                  <div class="agent-msg-header">
                    <span class="agent-msg-avatar" :style="{ color: getAgent(item.data.fromAgentId)?.color || '#666' }">
                      {{ getAgent(item.data.fromAgentId)?.avatar || '🤖' }}
                    </span>
                    <span class="agent-msg-name" :style="{ color: getAgent(item.data.fromAgentId)?.color || '#666' }">
                      {{ getAgent(item.data.fromAgentId)?.name || item.data.fromAgentId }}
                    </span>
                    <span class="agent-msg-arrow">→</span>
                    <span class="agent-msg-avatar" :style="{ color: getAgent(item.data.toAgentId)?.color || '#666' }">
                      {{ getAgent(item.data.toAgentId)?.avatar || '🤖' }}
                    </span>
                    <span class="agent-msg-name" :style="{ color: getAgent(item.data.toAgentId)?.color || '#666' }">
                      {{ getAgent(item.data.toAgentId)?.name || item.data.toAgentId }}
                    </span>
                    <span class="comment-time">{{ timeAgo(item.timestamp) }}</span>
                  </div>
                  <div class="agent-msg-body" v-html="renderMarkdown(item.data.question)"></div>
                </div>
                <!-- Agent answer -->
                <div v-if="item.data.status === 'answered' && item.data.answer" class="agent-msg-bubble agent-msg-answer">
                  <div class="agent-msg-header">
                    <span class="agent-msg-avatar" :style="{ color: getAgent(item.data.toAgentId)?.color || '#666' }">
                      {{ getAgent(item.data.toAgentId)?.avatar || '🤖' }}
                    </span>
                    <span class="agent-msg-name" :style="{ color: getAgent(item.data.toAgentId)?.color || '#666' }">
                      {{ getAgent(item.data.toAgentId)?.name || item.data.toAgentId }}
                    </span>
                    <span class="agent-msg-status-answered">✅ Answered</span>
                    <span class="comment-time">{{ item.data.answeredAt ? timeAgo(item.data.answeredAt) : '' }}</span>
                  </div>
                  <div class="agent-msg-body" v-html="renderMarkdown(item.data.answer)"></div>
                </div>
                <!-- Pending indicator -->
                <div v-else-if="item.data.status === 'pending'" class="agent-msg-pending">
                  <span class="pending-dot">●</span>
                  Awaiting response from {{ getAgent(item.data.toAgentId)?.name || item.data.toAgentId }}...
                </div>
              </div>

              <!-- ── User/Agent Comment (threaded) ── -->
              <div
                v-else
                class="comment-item"
                :class="[
                  item.data.type ? `comment-type-${item.data.type}` : '',
                  item.data.pinned ? 'comment-pinned-indicator' : '',
                  item.data.author !== 'user' && getAgent(item.data.author) ? 'comment-from-agent' : ''
                ]"
              >
                <!-- Editing mode -->
                <template v-if="editingCommentId === item.data.id">
                  <textarea
                    v-model="editingCommentText"
                    class="comment-textarea comment-edit-textarea"
                    rows="3"
                    @keydown.escape.stop="cancelEditComment"
                    @keydown.ctrl.enter="saveEditComment"
                    @keydown.meta.enter="saveEditComment"
                  />
                  <div class="comment-edit-actions">
                    <button class="btn btn-sm btn-primary" @click="saveEditComment">Save</button>
                    <button class="btn btn-sm" @click="cancelEditComment">Cancel</button>
                  </div>
                </template>

                <!-- Display mode -->
                <template v-else>
                  <div class="comment-header">
                    <span class="comment-type-badge" v-if="item.data.type && item.data.type !== 'comment'" :style="{ color: commentTypeConfig[item.data.type || 'comment'].color }">
                      {{ commentTypeConfig[item.data.type || 'comment'].icon }} {{ commentTypeConfig[item.data.type || 'comment'].label }}
                    </span>
                    <span class="comment-author">
                      {{ item.data.author === 'user' ? '👤 User' : (getAgent(item.data.author)?.avatar || '🤖') + ' ' + (getAgent(item.data.author)?.name || item.data.author) }}
                    </span>
                    <span class="comment-time">{{ timeAgo(item.data.timestamp) }}</span>
                    <span v-if="item.data.editedAt" class="comment-edited">(edited)</span>
                    <div class="comment-actions">
                      <button class="comment-action-btn" @click="startReply(item.data.id)" title="Reply">↩️</button>
                      <button class="comment-action-btn" @click="handlePinComment(item.data.id)" :title="item.data.pinned ? 'Unpin' : 'Pin'">{{ item.data.pinned ? '📌' : '📍' }}</button>
                      <button class="comment-action-btn" @click="handleEditComment(item.data.id, item.data.content)" title="Edit">✏️</button>
                      <button class="comment-action-btn comment-delete" @click="handleDeleteComment(item.data.id)" title="Delete">✕</button>
                    </div>
                  </div>
                  <div class="comment-body" v-html="renderMarkdown(item.data.content)"></div>
                </template>

                <!-- Replies -->
                <div v-if="item.data.replies.length > 0" class="thread-replies">
                  <button
                    v-if="item.data.replies.length > 2"
                    class="thread-toggle"
                    @click="toggleThread(item.data.id)"
                  >
                    {{ collapsedThreads.has(item.data.id) ? `▶ Show ${item.data.replies.length} replies` : `▼ ${item.data.replies.length} replies` }}
                  </button>
                  <template v-if="!collapsedThreads.has(item.data.id)">
                    <div
                      v-for="reply in item.data.replies"
                      :key="reply.id"
                      class="comment-item comment-reply"
                      :class="[
                        reply.type ? `comment-type-${reply.type}` : '',
                        reply.author !== 'user' && getAgent(reply.author) ? 'comment-from-agent' : ''
                      ]"
                    >
                      <template v-if="editingCommentId === reply.id">
                        <textarea
                          v-model="editingCommentText"
                          class="comment-textarea comment-edit-textarea"
                          rows="2"
                          @keydown.escape.stop="cancelEditComment"
                          @keydown.ctrl.enter="saveEditComment"
                          @keydown.meta.enter="saveEditComment"
                        />
                        <div class="comment-edit-actions">
                          <button class="btn btn-sm btn-primary" @click="saveEditComment">Save</button>
                          <button class="btn btn-sm" @click="cancelEditComment">Cancel</button>
                        </div>
                      </template>
                      <template v-else>
                        <div class="comment-header">
                          <span class="comment-author">
                            {{ reply.author === 'user' ? '👤 User' : (getAgent(reply.author)?.avatar || '🤖') + ' ' + (getAgent(reply.author)?.name || reply.author) }}
                          </span>
                          <span class="comment-time">{{ timeAgo(reply.timestamp) }}</span>
                          <span v-if="reply.editedAt" class="comment-edited">(edited)</span>
                          <div class="comment-actions">
                            <button class="comment-action-btn" @click="handleEditComment(reply.id, reply.content)" title="Edit">✏️</button>
                            <button class="comment-action-btn comment-delete" @click="handleDeleteComment(reply.id)" title="Delete">✕</button>
                          </div>
                        </div>
                        <div class="comment-body" v-html="renderMarkdown(reply.content)"></div>
                      </template>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Tags & Skills -->
        <div v-if="task.tags.length || (task.requiredSkills && task.requiredSkills.length)" class="detail-section">
          <div v-if="task.tags.length" style="margin-bottom: 8px;">
            <div class="detail-section-title">Tags</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span v-for="tag in task.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
          <div v-if="task.requiredSkills && task.requiredSkills.length">
            <div class="detail-section-title">Required Skills</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span v-for="skill in task.requiredSkills" :key="skill" class="skill-tag">{{ skill }}</span>
            </div>
          </div>
        </div>

        <!-- Assignee & Agent Assignment -->
        <div class="detail-section">
          <div class="detail-section-title">👤 Assignee</div>
          <div v-if="task.assignee && getAgent(task.assignee)" class="agent-row" style="margin-bottom: 8px;">
            <div class="agent-avatar" :style="{ background: (getAgent(task.assignee!)?.color || '#666') + '20' }">
              {{ getAgent(task.assignee!)?.avatar }}
            </div>
            <div style="flex: 1;">
              <span class="agent-name">{{ getAgent(task.assignee!)?.displayName || getAgent(task.assignee!)?.name }}</span>
              <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">{{ getAgent(task.assignee!)?.role }}</span>
            </div>
            <div class="agent-status-dot" :class="`agent-status-${getAgent(task.assignee!)?.status || 'idle'}`"></div>
          </div>
          <select
            class="form-select"
            style="width: 100%; font-size: 12px; padding: 4px 8px;"
            :value="task.assignee || ''"
            @change="(e) => {
              const val = (e.target as HTMLSelectElement).value
              if (val) {
                if (task!.assignee) reassignAgent(task!.id, val)
                else assignAgent(task!.id, val)
                debouncedSave()
              }
            }"
          >
            <option value="">— Select / Change Agent —</option>
            <option v-for="suggestion in agentSuggestions" :key="suggestion.agent.id" :value="suggestion.agent.id">
              {{ suggestion.agent.avatar }} {{ suggestion.agent.displayName || suggestion.agent.name }}
              <template v-if="suggestion.matchedSkills.length"> ({{ suggestion.matchedSkills.join(', ') }})</template>
            </option>
          </select>
        </div>

        <!-- Info Grid (Workspace, Type, Updated) -->
        <div class="detail-section">
          <div class="detail-section-title">Info</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
            <div>
              <span style="color: var(--text-muted);">Workspace</span><br />
              <span v-if="workspace" :style="{ color: workspace.color }">{{ workspace.icon }} {{ workspace.name }}</span>
            </div>
            <div>
              <span style="color: var(--text-muted);">Type</span><br />
              <span>{{ taskTypeLabel }}</span>
            </div>
            <div>
              <span style="color: var(--text-muted);">Updated</span><br />
              <span>{{ timeAgo(task.updatedAt) }}</span>
            </div>
            <div>
              <span style="color: var(--text-muted);">Created</span><br />
              <span>{{ timeAgo(task.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Git (conditional on task type) -->
        <div v-if="showGitSection" class="detail-section">
          <div class="detail-section-title">Git</div>
          <div v-if="task.branch" class="detail-git-info">
            <div class="detail-branch">
              <span class="git-icon-lg">⎇</span>
              <code class="branch-name">{{ task.branch }}</code>
            </div>
            <div v-if="task.pullRequest" class="detail-pr">
              <div class="detail-pr-header">
                <span class="pr-status-badge" :class="'pr-status-' + task.pullRequest.status">
                  {{ task.pullRequest.status === 'merged' ? '🟣 Merged' : task.pullRequest.status === 'open' ? '🟢 Open' : task.pullRequest.status === 'draft' ? '⚪ Draft' : task.pullRequest.status === 'approved' ? '✅ Approved' : task.pullRequest.status === 'changes_requested' ? '🔴 Changes Requested' : task.pullRequest.status }}
                </span>
                <span class="pr-number">#{{ task.pullRequest.number }}</span>
              </div>
              <div class="detail-pr-title">{{ task.pullRequest.title }}</div>
              <div class="detail-pr-stats">
                <span class="pr-stat pr-stat-add">+{{ task.pullRequest.additions }}</span>
                <span class="pr-stat pr-stat-del">-{{ task.pullRequest.deletions }}</span>
                <span class="pr-stat pr-stat-files">📄 {{ task.pullRequest.changedFiles }} files</span>
                <span class="pr-stat pr-stat-checks" :class="{ 'checks-pass': task.pullRequest.checks.passed === task.pullRequest.checks.total }">
                  {{ task.pullRequest.checks.passed === task.pullRequest.checks.total ? '✅' : '⏳' }} {{ task.pullRequest.checks.passed }}/{{ task.pullRequest.checks.total }} checks
                </span>
              </div>
              <a class="pr-link" :href="task.pullRequest.url" target="_blank" @click.stop>View on GitHub →</a>
            </div>
          </div>
          <div v-else>
            <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
              No branch created yet.
            </div>
            <button
              v-if="isExtensionMode && workspace?.localPath"
              class="btn btn-sm"
              @click="createBranchManually"
            >
              ⎇ Create {{ task.taskType === 'bugfix' ? 'Bugfix' : 'Feature' }} Branch
            </button>
            <div v-else-if="!isExtensionMode" style="font-size: 12px; color: var(--text-muted);">
              Branch auto-created when task moves to planning (in VS Code extension mode).
            </div>
          </div>
        </div>

        <!-- Assigned Agents (full info) -->
        <div v-if="task.assignedAgents.length" class="detail-section">
          <div class="detail-section-title">All Agents</div>
          <div v-for="agentId in task.assignedAgents" :key="agentId" class="agent-row" style="margin-bottom: 6px;">
            <div class="agent-avatar" :style="{ background: (getAgent(agentId)?.color || '#666') + '20' }">
              {{ getAgent(agentId)?.avatar }}
            </div>
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="agent-name">{{ getAgent(agentId)?.name || agentId }}</span>
                <span style="font-size: 11px; color: var(--text-muted);">{{ getAgent(agentId)?.role }}</span>
              </div>
              <div v-if="getAgent(agentId)" style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; margin-top: 2px;">
                <span>🤖 {{ getAgent(agentId)?.modelConfig.model }}</span>
              </div>
            </div>
            <div class="agent-status-dot" :class="`agent-status-${getAgent(agentId)?.status || 'idle'}`"></div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Live Agent Activity Panel */
.live-activity-section {
  border: 1px solid var(--accent-purple, #8b5cf6);
  border-radius: 8px;
  padding: 12px;
  background: rgba(139, 92, 246, 0.03);
}

.live-pulse {
  font-size: 11px;
  color: var(--accent-green, #22c55e);
  animation: pulse-glow 1.5s ease-in-out infinite;
  font-weight: 600;
}
@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.live-activity-container {
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
  scroll-behavior: smooth;
}

.live-msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.live-msg-user {
  background: rgba(59, 130, 246, 0.08);
  border-left: 3px solid var(--accent-blue, #3b82f6);
}

.live-msg-assistant {
  background: rgba(139, 92, 246, 0.06);
  border-left: 3px solid var(--accent-purple, #8b5cf6);
}

.live-msg-streaming {
  border-color: var(--accent-green, #22c55e);
  background: rgba(34, 197, 94, 0.06);
}

.live-msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
}

.live-msg-avatar {
  font-size: 14px;
}

.live-msg-name {
  font-weight: 600;
  color: var(--text-primary);
}

.live-msg-time {
  color: var(--text-muted);
  margin-left: auto;
  font-size: 11px;
}

.live-msg-tokens {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-tertiary, rgba(255,255,255,0.05));
  padding: 1px 5px;
  border-radius: 4px;
}

.live-msg-body {
  color: var(--text-secondary);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.live-waiting {
  color: var(--text-muted);
  font-style: italic;
  animation: pulse-glow 1.5s ease-in-out infinite;
}

.live-streaming-badge {
  font-size: 10px;
  color: var(--accent-green, #22c55e);
  font-weight: 600;
  animation: pulse-glow 1.5s ease-in-out infinite;
}

.live-empty {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  padding: 20px;
}

.live-agents-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.live-agent-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-purple, #8b5cf6);
  color: #fff;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.live-agent-chip:hover {
  opacity: 0.8;
}

/* Code formatting inside live messages */
:deep(.live-code) {
  background: rgba(0,0,0,0.2);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}
:deep(.live-code code) {
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
}
:deep(.live-inline-code) {
  background: rgba(0,0,0,0.15);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
:deep(.live-list-item) {
  padding-left: 8px;
}

/* ─── Task File Link ───────────────────────────────────────── */

.task-file-link {
  margin-top: 8px;
  font-size: 11px;
}

.file-link-clickable {
  color: var(--accent-blue, #3b82f6);
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.15s;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.file-link-clickable:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.file-link-muted {
  color: var(--text-muted, #6b7280);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

/* ─── Comments / Discussion ────────────────────────────────── */

.discussion-section {
  position: relative;
}

.pinned-section {
  margin-bottom: 12px;
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 8px;
  padding: 8px;
  background: rgba(245, 158, 11, 0.03);
}

.pinned-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-yellow, #f59e0b);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.comment-input-area {
  margin-bottom: 16px;
}

.reply-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  margin-bottom: 6px;
  background: rgba(59, 130, 246, 0.06);
  border-left: 3px solid var(--accent-blue, #3b82f6);
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  color: var(--accent-blue, #3b82f6);
}

.reply-cancel {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}

.comment-type-selector {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.type-pill {
  padding: 3px 8px;
  border-radius: 12px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  background: transparent;
  color: var(--text-muted, #6b7280);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.type-pill:hover {
  background: rgba(255, 255, 255, 0.04);
}

.type-pill.active {
  background: rgba(255, 255, 255, 0.06);
  font-weight: 600;
}

.comment-input-wrapper {
  position: relative;
}

.comment-textarea {
  width: 100%;
  background: var(--bg-secondary, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  color: var(--text-primary, #e5e7eb);
  font-size: 13px;
  line-height: 1.5;
  padding: 10px 12px;
  resize: vertical;
  min-height: 48px;
  font-family: inherit;
  transition: border-color 0.15s;
}

.comment-textarea:focus {
  outline: none;
  border-color: var(--accent-blue, #3b82f6);
}

.comment-textarea::placeholder {
  color: var(--text-muted, #6b7280);
}

.comment-edit-textarea {
  margin-bottom: 6px;
}

.comment-edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.comment-input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
}

.comment-hint {
  font-size: 11px;
  color: var(--text-muted, #6b7280);
}

/* Mention Dropdown */
.mention-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--bg-primary, #1e1e2e);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 4px;
}

.mention-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 13px;
}

.mention-option:hover {
  background: rgba(59, 130, 246, 0.1);
}

.mention-avatar {
  font-size: 16px;
}

.mention-name {
  font-weight: 600;
  color: var(--text-primary, #e5e7eb);
}

.mention-role {
  font-size: 11px;
  color: var(--text-muted, #6b7280);
  margin-left: auto;
  text-transform: capitalize;
}

/* Comments List */
.comments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.comment-item {
  background: var(--bg-secondary, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
  padding: 10px 12px;
  transition: border-color 0.15s;
}

/* Comment type styles */
.comment-type-note {
  border-left: 3px solid var(--accent-blue, #3b82f6);
  background: rgba(59, 130, 246, 0.03);
}

.comment-type-meeting-note {
  border-left: 3px solid var(--accent-purple, #8b5cf6);
  background: rgba(139, 92, 246, 0.03);
}

.comment-type-question {
  border-left: 3px solid var(--accent-yellow, #f59e0b);
  background: rgba(245, 158, 11, 0.03);
}

.comment-type-decision {
  border-left: 3px solid var(--accent-green, #22c55e);
  background: rgba(34, 197, 94, 0.03);
}

.comment-pinned {
  border-color: rgba(245, 158, 11, 0.2);
}

.comment-pinned-indicator::after {
  content: '📌';
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 10px;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  flex-wrap: wrap;
}

.comment-type-badge {
  font-size: 11px;
  font-weight: 600;
}

.comment-author {
  font-weight: 600;
  color: var(--text-primary, #e5e7eb);
}

.comment-time {
  color: var(--text-muted, #6b7280);
  font-size: 11px;
}

.comment-edited {
  font-size: 10px;
  color: var(--text-muted, #6b7280);
  font-style: italic;
}

.comment-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.comment-item:hover .comment-actions {
  opacity: 1;
}

.comment-action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
  color: var(--text-muted, #6b7280);
}

.comment-action-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.comment-delete:hover {
  color: var(--accent-red, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}

.comment-body {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  line-height: 1.6;
  word-break: break-word;
}

.comment-body :deep(strong) {
  color: var(--text-primary, #e5e7eb);
  font-weight: 600;
}

.comment-body :deep(em) {
  font-style: italic;
}

.comment-body :deep(.comment-inline-code) {
  background: rgba(0, 0, 0, 0.2);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
}

.comment-body :deep(.comment-code-block) {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.comment-body :deep(.comment-blockquote) {
  border-left: 3px solid var(--text-muted, #6b7280);
  padding-left: 10px;
  margin: 4px 0;
  color: var(--text-muted, #6b7280);
  font-style: italic;
}

.comment-body :deep(.comment-list-item) {
  padding-left: 8px;
  list-style: disc inside;
}

.comment-body :deep(.mention-highlight) {
  font-weight: 600;
  padding: 1px 3px;
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.1);
}

/* Thread replies */
.thread-replies {
  margin-top: 8px;
  padding-left: 16px;
  border-left: 2px solid var(--border, rgba(255, 255, 255, 0.08));
}

.thread-toggle {
  background: none;
  border: none;
  color: var(--accent-blue, #3b82f6);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 4px;
}

.thread-toggle:hover {
  text-decoration: underline;
}

.comment-reply {
  margin-top: 6px;
  margin-left: 0;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 10px;
}

/* ─── Agent comments (from non-user authors) ───────────────── */
.comment-from-agent {
  background: rgba(139, 92, 246, 0.04);
  border-left: 3px solid rgba(139, 92, 246, 0.3);
}

/* ─── Unified Discussion Thread ─────────────────────────────── */
.unified-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Event divider — centered, subdued */
.thread-event-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0;
  font-size: 11px;
  color: var(--text-muted, #6b7280);
}

.event-divider-line {
  flex: 1;
  height: 1px;
  background: var(--border, rgba(255, 255, 255, 0.08));
}

.event-divider-content {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  padding: 3px 10px;
  background: var(--bg-secondary, rgba(255, 255, 255, 0.03));
  border-radius: 12px;
  font-weight: 500;
}

.event-divider-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.event-divider-time {
  color: var(--text-muted, #6b7280);
  font-size: 10px;
  opacity: 0.8;
}

/* Agent-to-Agent messages in the thread */
.thread-agent-message {
  margin: 2px 0;
}

.agent-msg-bubble {
  background: rgba(139, 92, 246, 0.06);
  border: 1px solid rgba(139, 92, 246, 0.15);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 4px;
}

.agent-msg-answer {
  background: rgba(34, 197, 94, 0.04);
  border-color: rgba(34, 197, 94, 0.15);
  margin-left: 16px;
}

.agent-msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  flex-wrap: wrap;
}

.agent-msg-avatar {
  font-size: 14px;
}

.agent-msg-name {
  font-weight: 600;
  font-size: 12px;
}

.agent-msg-arrow {
  color: var(--text-muted, #6b7280);
  font-size: 11px;
}

.agent-msg-status-answered {
  font-size: 11px;
  color: var(--accent-green, #22c55e);
  font-weight: 600;
}

.agent-msg-body {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  line-height: 1.5;
  word-break: break-word;
}

.agent-msg-pending {
  font-size: 12px;
  color: var(--text-muted, #6b7280);
  padding: 6px 12px 6px 28px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.pending-dot {
  color: var(--accent-yellow, #f59e0b);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

/* ─── Expandable Sessions ──────────────────────────────────── */

.session-row-expandable {
  border: 1px solid var(--border, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
  margin-bottom: 6px;
  overflow: hidden;
}

.session-row-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.session-row-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.session-expand-icon {
  font-size: 14px;
  color: var(--text-muted, #6b7280);
  transition: transform 0.2s;
}

.session-expand-icon.expanded {
  transform: rotate(90deg);
}

.session-meta-badge {
  font-size: 11px;
  color: var(--text-muted, #6b7280);
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
  padding: 2px 6px;
  border-radius: 4px;
}

.session-messages {
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
  padding: 8px 10px;
  max-height: 300px;
  overflow-y: auto;
}

.session-msg {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
}

.session-msg-user {
  background: rgba(59, 130, 246, 0.06);
  border-left: 2px solid var(--accent-blue, #3b82f6);
}

.session-msg-assistant {
  background: rgba(139, 92, 246, 0.04);
  border-left: 2px solid var(--accent-purple, #8b5cf6);
}

.session-msg-system {
  background: rgba(107, 114, 128, 0.06);
  border-left: 2px solid var(--text-muted, #6b7280);
}

.session-msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary, #e5e7eb);
  margin-bottom: 3px;
}

.session-msg-time {
  color: var(--text-muted, #6b7280);
  font-weight: 400;
  margin-left: auto;
}

.session-msg-tokens {
  font-size: 10px;
  color: var(--text-muted, #6b7280);
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 400;
}

.session-msg-content {
  color: var(--text-secondary, #9ca3af);
  word-break: break-word;
  white-space: pre-wrap;
}

/* ─── Goal & Link rows ─── */
.goal-link-row {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.15s;
}

.goal-link-row:hover {
  background: rgba(59, 130, 246, 0.1);
}

</style>
