<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '../domain'
import { MAX_FEEDBACK_LOOPS } from '../domain'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'

const props = defineProps<{
  task: Task
  isDragging: boolean
}>()

const emit = defineEmits<{
  dragstart: []
  dragend: []
}>()

const { selectTask, getAgent, getWorkspace, getTaskSessions, agents, openAgentPanel, updateAgentStatus } = useBoard()
const ext = useExtension()
const sessionCount = computed(() => getTaskSessions(props.task.id).length)
const commentCount = computed(() => props.task.comments?.length || 0)

/** True when any agent is actively working on this task */
const isAgentWorking = computed(() =>
  agents.value.some(a => a.status === 'working' && a.currentTaskId === props.task.id)
)

/** True when the task needs human attention (approval, feedback, clarification) */
const needsAttention = computed(() =>
  props.task.approvalStatus === 'pending' || !!props.task.humanAttentionType
)

/** True when the task has a pending HITL decision */
const hasPendingDecision = computed(() =>
  props.task.pendingDecision && props.task.pendingDecision.status === 'pending'
)

/** Number of pending agent questions */
const pendingQuestionCount = computed(() =>
  props.task.pendingQuestions?.filter(q => q.status === 'pending').length || 0
)

const workspace = computed(() => getWorkspace(props.task.workspaceId))

/** Cached assignee agent to avoid repeated lookups */
const assigneeAgent = computed(() => props.task.assignee ? getAgent(props.task.assignee) : null)

/** Total feedback loops across all paths */
const totalLoops = computed(() => {
  const fl = props.task.metrics?.feedbackLoops
  if (!fl) return 0
  return (fl.devToPlanner || 0) + (fl.reviewToDev || 0)
})

/** Working agent on this task */
const workingAgent = computed(() =>
  agents.value.find(a => a.status === 'working' && a.currentTaskId === props.task.id)
)

function progressColor(progress: number): string {
  if (progress >= 80) return 'var(--accent-green)'
  if (progress >= 50) return 'var(--accent-blue)'
  if (progress >= 25) return 'var(--accent-yellow)'
  return 'var(--text-muted)'
}

/** Quick action: open agent panel for this task */
function onRunAgent(e: Event) {
  e.stopPropagation()
  if (props.task.assignee) {
    openAgentPanel(props.task.assignee, props.task.id)
  } else if (agents.value.length > 0) {
    openAgentPanel(agents.value[0].id, props.task.id)
  }
}

/** Quick action: stop the working agent */
function onStopAgent(e: Event) {
  e.stopPropagation()
  if (workingAgent.value) {
    ext.stopAgent(workingAgent.value.id)
    updateAgentStatus(workingAgent.value.id, 'idle', null)
  }
}

/** Quick action: open task detail for giving input */
function onGiveInput(e: Event) {
  e.stopPropagation()
  selectTask(props.task.id)
}
</script>

<template>
  <div
    class="task-card"
    :class="{ dragging: isDragging, 'agent-working': isAgentWorking, 'needs-attention': needsAttention, 'needs-decision': hasPendingDecision }"
    role="button"
    tabindex="0"
    :aria-label="`Task: ${task.title}`"
    draggable="true"
    @dragstart="emit('dragstart')"
    @dragend="emit('dragend')"
    @click="selectTask(task.id)"
    @keydown.enter="selectTask(task.id)"
    @keydown.space.prevent="selectTask(task.id)"
  >
    <!-- HITL Decision Banner (top priority) -->
    <div v-if="hasPendingDecision && task.humanAttentionType === 'escalation'" class="card-escalation-badge">
      🆘 Agent needs your help
    </div>
    <div v-else-if="hasPendingDecision" class="card-decision-badge">
      🔔 Decision pending: {{ task.pendingDecision!.decision.action }}
    </div>
    <!-- Attention Banner (top of card) -->
    <div v-else-if="needsAttention" class="card-attention-badge">
      <template v-if="task.humanAttentionType === 'clarification'">❓ Agent needs clarification ({{ pendingQuestionCount }})</template>
      <template v-else-if="task.humanAttentionType === 'feedback'">💬 Feedback requested</template>
      <template v-else-if="task.humanAttentionType === 'review'">👁️ Review requested</template>
      <template v-else>⚠️ Approval required</template>
    </div>
    <!-- Agent Working Indicator -->
    <div v-if="isAgentWorking" class="card-working-badge">
      <span class="working-pulse"></span> Agent working…
    </div>
    <div class="task-card-top">
      <div class="task-card-title">
        {{ task.title }}
      </div>
      <div
        v-if="workspace"
        class="task-card-workspace"
        :style="{ background: workspace.color + '18', color: workspace.color, border: '1px solid ' + workspace.color + '30' }"
      >
        {{ workspace.icon }} {{ workspace.name }}
      </div>
    </div>

    <div class="task-card-desc">{{ task.description }}</div>

    <div class="task-card-meta">
      <div class="task-card-tags">
        <span v-for="tag in task.tags.slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <div class="task-card-agents" v-if="task.assignedAgents.length">
        <!-- Assignee (primary) shown first with highlight -->
        <div
          v-if="assigneeAgent"
          class="agent-avatar-mini agent-assignee"
          :style="{ background: (assigneeAgent.color || '#666') + '40', border: '2px solid ' + (assigneeAgent.color || '#666') }"
          :title="(assigneeAgent.displayName || assigneeAgent.name) + ' (assignee)'"
        >
          {{ assigneeAgent.avatar }}
          <span v-if="assigneeAgent.status === 'working' && assigneeAgent.currentTaskId === task.id" class="agent-working-dot"></span>
        </div>
        <!-- Other contributing agents -->
        <div
          v-for="agentId in task.assignedAgents.filter(id => id !== task.assignee)"
          :key="agentId"
          class="agent-avatar-mini"
          :class="{ 'agent-active': getAgent(agentId)?.status === 'working' && getAgent(agentId)?.currentTaskId === task.id }"
          :style="{ background: (getAgent(agentId)?.color || '#666') + '30' }"
          :title="getAgent(agentId)?.name"
        >
          {{ getAgent(agentId)?.avatar }}
          <span v-if="getAgent(agentId)?.status === 'working' && getAgent(agentId)?.currentTaskId === task.id" class="agent-working-dot"></span>
        </div>
      </div>
    </div>

    <!-- Feedback Loop Counter -->
    <div v-if="totalLoops > 0" class="task-card-loops">
      <span class="loop-badge" :class="{ 'loop-warning': totalLoops >= MAX_FEEDBACK_LOOPS }">
        ♻️ {{ totalLoops }}/{{ MAX_FEEDBACK_LOOPS }} loops
      </span>
      <span v-if="task.metrics?.feedbackLoops?.devToPlanner" class="loop-detail">Dev→Plan: {{ task.metrics.feedbackLoops.devToPlanner }}</span>
      <span v-if="task.metrics?.feedbackLoops?.reviewToDev" class="loop-detail">Review→Dev: {{ task.metrics.feedbackLoops.reviewToDev }}</span>
    </div>

    <!-- Sessions & Comments Badges -->
    <div v-if="sessionCount > 0 || commentCount > 0" class="task-card-sessions">
      <span v-if="sessionCount > 0" class="session-badge">💬 {{ sessionCount }} session{{ sessionCount > 1 ? 's' : '' }}</span>
      <span v-if="commentCount > 0" class="session-badge comment-badge">📝 {{ commentCount }}</span>
    </div>

    <!-- Branch & PR -->
    <div v-if="task.branch" class="task-card-git">
      <span class="git-branch" :title="task.branch">
        <span class="git-icon">⎇</span> {{ task.branch.length > 28 ? task.branch.slice(0, 28) + '…' : task.branch }}
      </span>
      <span v-if="task.pullRequest" class="git-pr" :class="'pr-' + task.pullRequest.status">
        <span class="pr-icon">{{ task.pullRequest.status === 'merged' ? '🟣' : task.pullRequest.status === 'open' ? '🟢' : task.pullRequest.status === 'draft' ? '⚪' : '🔴' }}</span>
        #{{ task.pullRequest.number }}
        <span class="pr-diff">
          <span class="pr-add">+{{ task.pullRequest.additions }}</span>
          <span class="pr-del">-{{ task.pullRequest.deletions }}</span>
        </span>
      </span>
    </div>

    <div v-if="task.progress > 0 && task.progress < 100" class="progress-bar">
      <div class="progress-fill" :style="{ width: task.progress + '%', background: progressColor(task.progress) }"></div>
    </div>

    <!-- Quick Actions Bar -->
    <div class="task-card-actions">
      <button
        v-if="!isAgentWorking"
        class="card-action-btn action-run"
        title="Run agent on this task"
        aria-label="Run agent on this task"
        @click="onRunAgent"
      >
        ▶
      </button>
      <button
        v-if="isAgentWorking"
        class="card-action-btn action-stop"
        title="Stop agent"
        aria-label="Stop agent"
        @click="onStopAgent"
      >
        ⏹
      </button>
      <button
        class="card-action-btn action-input"
        title="Give input / comment"
        aria-label="Give input or comment"
        @click="onGiveInput"
      >
        💬
      </button>
    </div>

  </div>
</template>

<style scoped>
/* Decision pending shake + glow */
.task-card.needs-decision {
  animation: card-shake 0.5s ease-in-out 1, card-decision-glow 2s ease-in-out infinite;
  border-color: rgba(245, 158, 11, 0.5) !important;
}

/* Escalation: more urgent glow */
.task-card:has(.card-escalation-badge) {
  animation: card-shake 0.5s ease-in-out 1, card-escalation-glow 1.5s ease-in-out infinite;
  border-color: rgba(239, 68, 68, 0.5) !important;
}

@keyframes card-escalation-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  50% { box-shadow: 0 0 16px 3px rgba(239, 68, 68, 0.3); }
}

@keyframes card-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-3px); }
  40% { transform: translateX(3px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@keyframes card-decision-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
  50% { box-shadow: 0 0 12px 2px rgba(245, 158, 11, 0.25); }
}

.card-decision-badge {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.12);
  color: var(--accent-yellow, #f59e0b);
  border-radius: 6px 6px 0 0;
  margin: -10px -10px 8px -10px;
  text-align: center;
  animation: decision-badge-pulse 1.5s ease-in-out infinite;
}

.card-escalation-badge {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red, #ef4444);
  border-radius: 6px 6px 0 0;
  margin: -10px -10px 8px -10px;
  text-align: center;
  animation: decision-badge-pulse 1.2s ease-in-out infinite;
}

.agent-assignee {
  position: relative;
  z-index: 1;
}

/* ─── Quick Actions Bar ─── */
.task-card-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
  opacity: 0;
  transition: opacity 0.15s;
}

.task-card:hover .task-card-actions,
.task-card:focus-within .task-card-actions {
  opacity: 1;
}

.card-action-btn {
  flex: 1;
  padding: 3px 0;
  background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s;
  text-align: center;
}

.card-action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
}

.action-run:hover {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.3);
}

.action-stop:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
}

.action-input:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
}

/* ─── Feedback Loop Counter ─── */
.task-card-loops {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 4px;
  flex-wrap: wrap;
}

.loop-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(249, 115, 22, 0.1);
  color: var(--accent-orange, #f97316);
}

.loop-badge.loop-warning {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red, #ef4444);
  animation: decision-badge-pulse 1.5s ease-in-out infinite;
}

.loop-detail {
  font-size: 9px;
  color: var(--text-muted, #666);
}

/* ─── Personal Kanban Indicators ─── */
@keyframes decision-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>