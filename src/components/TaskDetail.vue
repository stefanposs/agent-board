<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'
import { useWorkflow } from '../composables/useWorkflow'
import type { Agent } from '../domain'
import { debouncedSave } from '../composables/usePersistence'

const props = defineProps<{
  taskId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const board = useBoard()
const { tasks, getAgent, getWorkspace, approveTask, rejectTask, moveTask, selectTask, agents, openAgentPanel, getTaskSessions, slugifyBranchName, isExtensionMode, workspaces, addComment, deleteComment, addAgentQuestion, answerAgentQuestion, getBestAgentForTask } = board
const ext = useExtension()
const wf = useWorkflow()

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

onMounted(() => {
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
const taskComments = computed(() => {
  if (!task.value?.comments) return []
  return [...task.value.comments].sort((a, b) => a.timestamp - b.timestamp)
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
  addComment(task.value.id, text, 'user')
  newCommentText.value = ''
  debouncedSave()
}

function handleDeleteComment(commentId: string) {
  if (!task.value) return
  deleteComment(task.value.id, commentId)
  debouncedSave()
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
    return `Analyze and plan the implementation for this task:\n\nTask: "${t.title}"\nDescription: ${t.description || '(no description)'}\nPriority: ${t.priority}\nTags: ${t.tags.length > 0 ? t.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\nPlease:\n1. Identify relevant files/components\n2. Assess feasibility and complexity\n3. Provide a step-by-step implementation plan\n4. List dependencies and potential risks\n5. Suggest existing patterns/conventions to follow`
  })
}

function runDeveloperManually() {
  runAgentByRole(['developer', 'devops'], 'Developer', (t, ws, ctx) => {
    return `Implement the following task:\n\nTask: "${t.title}"\nDescription: ${t.description || '(no description)'}\nPriority: ${t.priority}\nTags: ${t.tags.length > 0 ? t.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\n${ctx ? `--- Planning Context ---\n${ctx}\n\n` : ''}Please:\n1. Implement the changes described in the planning phase\n2. Follow existing code patterns and conventions\n3. Write clean, well-tested code\n4. Commit your changes with meaningful messages`
  })
}

function runReviewerManually() {
  runAgentByRole(['reviewer'], 'Reviewer', (t, ws, ctx) => {
    return `Review the implementation for this task:\n\nTask: "${t.title}"\nDescription: ${t.description || '(no description)'}\nPriority: ${t.priority}\nTags: ${t.tags.length > 0 ? t.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\n${ctx ? `--- Implementation Context ---\n${ctx}\n\n` : ''}Please:\n1. Review the code changes for correctness and quality\n2. Check for potential bugs, security issues, and performance concerns\n3. Verify adherence to project conventions and patterns\n4. Provide actionable feedback or approve the changes`
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
</script>

<template>
  <div v-if="task" class="detail-overlay" @click.self="close">
    <div class="detail-panel">
      <div class="detail-header" style="position: relative;">
        <button class="detail-close" @click="close">✕</button>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span v-if="stageConfig" :style="{ color: stageConfig.color, fontWeight: 600, fontSize: '13px' }">
            {{ stageConfig.icon }} {{ stageConfig.label }}
          </span>
          <span :class="`priority-${task.priority}`" style="font-size: 12px; font-weight: 600;">
            ● {{ task.priority.toUpperCase() }}
          </span>
          <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">
            {{ taskTypeLabel }}
          </span>
        </div>
        <div class="detail-title">{{ task.title }}</div>
        <div class="detail-desc">{{ task.description }}</div>
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
        </div>
      </div>

      <!-- ─── Status Banner: Human Attention Required ─── -->
      <div v-if="hasApprovalGate && task.approvalStatus === 'pending'" class="status-banner status-attention">
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
          <span v-if="taskComments.length > 0" class="tab-count">{{ taskComments.length }}</span>
        </div>
      </div>

      <!-- ═══════════════ OVERVIEW TAB ═══════════════ -->
      <template v-if="activeTab === 'overview'">
        <!-- Actions -->
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

        <!-- Details Grid -->
        <div class="detail-section">
          <div class="detail-section-title">Details</div>
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
              <span style="color: var(--text-muted);">Progress</span><br />
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>{{ task.progress }}%</span>
                <div v-if="task.progress > 0" style="flex: 1; height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden;">
                  <div :style="{ width: task.progress + '%', height: '100%', background: task.progress >= 80 ? 'var(--accent-green)' : task.progress >= 50 ? 'var(--accent-blue)' : 'var(--accent-yellow)', borderRadius: '2px', transition: 'width 0.5s ease' }"></div>
                </div>
              </div>
            </div>
            <div>
              <span style="color: var(--text-muted);">Updated</span><br />
              <span>{{ timeAgo(task.updatedAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Pipeline Progress -->
        <div class="detail-section">
          <div class="detail-section-title">Pipeline Progress</div>
          <div style="display: flex; gap: 4px; align-items: center;">
            <template v-for="(stage, idx) in wf.stages.value" :key="stage.id">
              <div
                :style="{
                  flex: 1,
                  height: '6px',
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
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); margin-top: 4px;">
            <span>{{ wf.stages.value[0]?.label }}</span>
            <span>{{ wf.stages.value[wf.stages.value.length - 1]?.label }}</span>
          </div>
        </div>

        <!-- Agent Questions (Rückfragen) -->
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
            <!-- Answer form for pending -->
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
            <!-- Answered state -->
            <div v-else class="question-answer-display">
              <span style="font-size: 11px; color: var(--accent-green); font-weight: 600;">✅ Answered</span>
              <div style="font-size: 13px; margin-top: 4px;">{{ q.answer }}</div>
              <span v-if="q.answeredAt" style="font-size: 11px; color: var(--text-muted);">{{ timeAgo(q.answeredAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Required Skills -->
        <div v-if="task.requiredSkills && task.requiredSkills.length > 0" class="detail-section">
          <div class="detail-section-title">Required Skills</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <span v-for="skill in task.requiredSkills" :key="skill" class="skill-tag">{{ skill }}</span>
          </div>
        </div>

        <!-- Assigned Agents (compact) -->
        <div v-if="task.assignedAgents.length" class="detail-section">
          <div class="detail-section-title">Assigned Agents</div>
          <div v-for="agentId in task.assignedAgents" :key="agentId" class="agent-row" style="margin-bottom: 6px;">
            <div class="agent-avatar" :style="{ background: (getAgent(agentId)?.color || '#666') + '20' }">
              {{ getAgent(agentId)?.avatar }}
            </div>
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="agent-name">{{ getAgent(agentId)?.name || agentId }}</span>
                <span style="font-size: 11px; color: var(--text-muted);">{{ getAgent(agentId)?.role }}</span>
              </div>
            </div>
            <div class="agent-status-dot" :class="`agent-status-${getAgent(agentId)?.status || 'idle'}`"></div>
          </div>
        </div>
      </template>

      <!-- ═══════════════ ACTIVITY TAB ═══════════════ -->
      <template v-if="activeTab === 'activity'">
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

        <!-- Comments -->
        <div class="detail-section">
          <div class="detail-section-title" style="display: flex; align-items: center; gap: 8px;">
            <span>💬 Comments ({{ taskComments.length }})</span>
          </div>

          <div class="comment-input-area">
            <textarea
              v-model="newCommentText"
              class="comment-textarea"
              placeholder="Add a note, question, or remark..."
              rows="2"
              @keydown.ctrl.enter="submitComment"
              @keydown.meta.enter="submitComment"
            />
            <div class="comment-input-actions">
              <span class="comment-hint">⌘+Enter to send</span>
              <button
                class="btn btn-sm btn-primary"
                :disabled="!newCommentText.trim()"
                @click="submitComment"
              >
                Send comment
              </button>
            </div>
          </div>

          <div v-if="taskComments.length === 0" style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">
            No comments yet. Add notes, questions, or remarks.
          </div>
          <div v-else class="comments-list">
            <div
              v-for="comment in taskComments"
              :key="comment.id"
              class="comment-item"
            >
              <div class="comment-header">
                <span class="comment-author">
                  {{ comment.author === 'user' ? '👤 User' : (getAgent(comment.author)?.avatar || '🤖') + ' ' + (getAgent(comment.author)?.name || comment.author) }}
                </span>
                <span class="comment-time">{{ timeAgo(comment.timestamp) }}</span>
                <button class="comment-delete" @click="handleDeleteComment(comment.id)" title="Delete">
                  ✕
                </button>
              </div>
              <div class="comment-body">{{ comment.content }}</div>
            </div>
          </div>
        </div>

        <!-- Tags -->
        <div class="detail-section">
          <div class="detail-section-title">Tags</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <span v-for="tag in task.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>

        <!-- Assigned Agents (full info) -->
        <div v-if="task.assignedAgents.length" class="detail-section">
          <div class="detail-section-title">Assigned Agents</div>
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
                <span>🌡 {{ getAgent(agentId)?.modelConfig.temperature }}</span>
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

/* ─── Comments ─────────────────────────────────────────────── */

.comment-input-area {
  margin-bottom: 12px;
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
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}

.comment-author {
  font-weight: 600;
  color: var(--text-primary, #e5e7eb);
}

.comment-time {
  color: var(--text-muted, #6b7280);
  font-size: 11px;
}

.comment-delete {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted, #6b7280);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.comment-item:hover .comment-delete {
  opacity: 1;
}

.comment-delete:hover {
  color: var(--accent-red, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}

.comment-body {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
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
</style>
