<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '../domain'
import { useBoard } from '../composables/useBoard'

const props = defineProps<{
  task: Task
  isDragging: boolean
}>()

const emit = defineEmits<{
  dragstart: []
  dragend: []
}>()

const { selectTask, getAgent, getWorkspace, getTaskSessions } = useBoard()
const sessionCount = computed(() => getTaskSessions(props.task.id).length)
const commentCount = computed(() => props.task.comments?.length || 0)

const workspace = getWorkspace(props.task.workspaceId)

function priorityColor(p: string): string {
  const map: Record<string, string> = {
    low: 'var(--text-muted)',
    medium: 'var(--accent-blue)',
    high: 'var(--accent-orange)',
    critical: 'var(--accent-red)',
  }
  return map[p] || 'var(--text-muted)'
}

function progressColor(progress: number): string {
  if (progress >= 80) return 'var(--accent-green)'
  if (progress >= 50) return 'var(--accent-blue)'
  if (progress >= 25) return 'var(--accent-yellow)'
  return 'var(--text-muted)'
}
</script>

<template>
  <div
    class="task-card"
    :class="{ dragging: isDragging }"
    draggable="true"
    @dragstart="emit('dragstart')"
    @dragend="emit('dragend')"
    @click="selectTask(task.id)"
  >
    <div class="task-card-top">
      <div class="task-card-title">
        <span class="priority-dot" :class="`priority-dot-${task.priority}`" style="display: inline-block; margin-right: 6px; vertical-align: middle;"></span>
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
        <div
          v-for="agentId in task.assignedAgents"
          :key="agentId"
          class="agent-avatar-mini"
          :style="{ background: (getAgent(agentId)?.color || '#666') + '30' }"
          :title="getAgent(agentId)?.name"
        >
          {{ getAgent(agentId)?.avatar }}
        </div>
      </div>
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

    <div v-if="task.approvalStatus === 'pending'" class="blocked-badge">
      ⚠️ Human Approval Required
    </div>
  </div>
</template>
