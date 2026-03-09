<script setup lang="ts">
import { computed } from 'vue'
import { useBoard } from '../composables/useBoard'

const props = defineProps<{
  taskId: string
}>()

const board = useBoard()
const { tasks, getAgent } = board

const task = computed(() => tasks.value.find(t => t.id === props.taskId))

const agentMessages = computed(() => {
  if (!task.value?.agentMessages) return []
  return [...task.value.agentMessages].sort((a, b) => a.timestamp - b.timestamp)
})

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Color by agent role */
function agentColor(agentId: string): string {
  const agent = getAgent(agentId)
  return agent?.color || '#666'
}
</script>

<template>
  <div v-if="agentMessages.length > 0" class="agent-discussion">
    <div class="discussion-header">
      <span class="discussion-icon">💬</span>
      <span class="discussion-title">Agent Discussion</span>
      <span class="discussion-count">{{ agentMessages.length }}</span>
    </div>

    <div class="discussion-thread">
      <div
        v-for="msg in agentMessages"
        :key="msg.id"
        class="discussion-message"
      >
        <!-- Question bubble -->
        <div class="discussion-bubble discussion-question">
          <div class="bubble-header">
            <span class="bubble-avatar" :style="{ color: agentColor(msg.fromAgentId) }">
              {{ getAgent(msg.fromAgentId)?.avatar || '🤖' }}
            </span>
            <span class="bubble-name" :style="{ color: agentColor(msg.fromAgentId) }">
              {{ getAgent(msg.fromAgentId)?.name || msg.fromAgentId }}
            </span>
            <span class="bubble-arrow">→</span>
            <span class="bubble-avatar" :style="{ color: agentColor(msg.toAgentId) }">
              {{ getAgent(msg.toAgentId)?.avatar || '🤖' }}
            </span>
            <span class="bubble-name" :style="{ color: agentColor(msg.toAgentId) }">
              {{ getAgent(msg.toAgentId)?.name || msg.toAgentId }}
            </span>
            <span class="bubble-time">{{ timeAgo(msg.timestamp) }}</span>
          </div>
          <div class="bubble-body">{{ msg.question }}</div>
        </div>

        <!-- Answer bubble (if answered) -->
        <div v-if="msg.status === 'answered' && msg.answer" class="discussion-bubble discussion-answer">
          <div class="bubble-header">
            <span class="bubble-avatar" :style="{ color: agentColor(msg.toAgentId) }">
              {{ getAgent(msg.toAgentId)?.avatar || '🤖' }}
            </span>
            <span class="bubble-name" :style="{ color: agentColor(msg.toAgentId) }">
              {{ getAgent(msg.toAgentId)?.name || msg.toAgentId }}
            </span>
            <span class="bubble-status-answered">✅ Answered</span>
            <span class="bubble-time">{{ msg.answeredAt ? timeAgo(msg.answeredAt) : '' }}</span>
          </div>
          <div class="bubble-body">{{ msg.answer }}</div>
        </div>

        <!-- Pending indicator -->
        <div v-else-if="msg.status === 'pending'" class="discussion-pending">
          <span class="pending-pulse">●</span>
          <span>Awaiting response from {{ getAgent(msg.toAgentId)?.name || msg.toAgentId }}...</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-discussion {
  background: rgba(139, 92, 246, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 10px;
  padding: 14px;
  margin: 8px 0;
}

.discussion-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.discussion-icon {
  font-size: 14px;
}

.discussion-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.discussion-count {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(139, 92, 246, 0.15);
  color: var(--accent-purple, #8b5cf6);
  font-weight: 600;
}

.discussion-thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.discussion-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.discussion-bubble {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
}

.discussion-question {
  background: var(--bg-tertiary);
  border-left: 3px solid var(--accent-purple, #8b5cf6);
}

.discussion-answer {
  background: rgba(34, 197, 94, 0.06);
  border-left: 3px solid var(--accent-green, #22c55e);
  margin-left: 20px;
}

.bubble-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}

.bubble-avatar {
  font-size: 14px;
}

.bubble-name {
  font-weight: 600;
  font-size: 12px;
}

.bubble-arrow {
  color: var(--text-muted);
  font-size: 11px;
}

.bubble-time {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.bubble-status-answered {
  font-size: 10px;
  color: var(--accent-green, #22c55e);
  font-weight: 600;
}

.bubble-body {
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.discussion-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 12px;
  margin-left: 20px;
}

.pending-pulse {
  color: var(--accent-yellow, #f59e0b);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
