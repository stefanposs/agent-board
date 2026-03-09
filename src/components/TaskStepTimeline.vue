<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBoard } from '../composables/useBoard'
import type { TaskEvent } from '../domain/types'

const props = defineProps<{
  taskId: string
}>()

const board = useBoard()
const { tasks, getAgent } = board

const task = computed(() => tasks.value.find(t => t.id === props.taskId))

/** All events sorted newest first */
const events = computed(() => {
  if (!task.value) return []
  return [...task.value.events].reverse()
})

/** Expanded event IDs */
const expandedEvents = ref<Set<string>>(new Set())

function toggleEvent(id: string) {
  if (expandedEvents.value.has(id)) {
    expandedEvents.value.delete(id)
  } else {
    expandedEvents.value.add(id)
  }
  expandedEvents.value = new Set(expandedEvents.value)
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

/** Color by event type */
function eventColor(evt: TaskEvent): string {
  const map: Record<string, string> = {
    stage_change: '#3b82f6',
    agent_action: '#8b5cf6',
    human_action: '#22c55e',
    approval: '#22c55e',
    comment: '#6b7280',
    decision: '#f59e0b',
    agent_discussion: '#a855f7',
  }
  return map[evt.type] || '#6b7280'
}

/** Icon by event type */
function eventIcon(evt: TaskEvent): string {
  const map: Record<string, string> = {
    stage_change: '🔄',
    agent_action: '🤖',
    human_action: '👤',
    approval: '✅',
    comment: '💬',
    decision: '🔔',
    agent_discussion: '💬',
  }
  return map[evt.type] || '📌'
}

/** Badge label for event type */
function eventBadge(evt: TaskEvent): string {
  const map: Record<string, string> = {
    stage_change: 'Stage Change',
    agent_action: 'Agent Action',
    human_action: 'Human Action',
    approval: 'Approval',
    comment: 'Comment',
    decision: 'Decision',
    agent_discussion: 'Discussion',
  }
  return map[evt.type] || evt.type
}

/** Extract a TL;DR (first meaningful line or up to 80 chars) */
function tldr(message: string): string {
  if (!message) return ''
  const firstLine = message.split('\n')[0]
  if (firstLine.length <= 100) return firstLine
  return firstLine.slice(0, 97) + '...'
}

/** Full message (for expanded view) */
function fullMessage(message: string): string {
  return message || ''
}
</script>

<template>
  <div class="step-timeline">
    <div class="timeline-header">
      <span>📋 Step Timeline</span>
      <span class="timeline-count">{{ events.length }} steps</span>
    </div>

    <div v-if="events.length === 0" class="timeline-empty">
      No activity yet.
    </div>

    <div class="timeline-list">
      <div
        v-for="evt in events"
        :key="evt.id"
        class="step-card"
        :class="{ 'step-expanded': expandedEvents.has(evt.id) }"
        @click="toggleEvent(evt.id)"
      >
        <!-- Step indicator line -->
        <div class="step-indicator">
          <div class="step-dot" :style="{ background: eventColor(evt) }">
            <span class="step-dot-icon">{{ eventIcon(evt) }}</span>
          </div>
          <div class="step-line" :style="{ background: eventColor(evt) + '30' }"></div>
        </div>

        <!-- Step content -->
        <div class="step-content">
          <div class="step-header">
            <span class="step-badge" :style="{ background: eventColor(evt) + '18', color: eventColor(evt) }">
              {{ eventBadge(evt) }}
            </span>
            <span v-if="evt.agentId" class="step-agent" :style="{ color: getAgent(evt.agentId)?.color || '#666' }">
              {{ getAgent(evt.agentId)?.avatar || '🤖' }} {{ getAgent(evt.agentId)?.name || evt.agentId }}
            </span>
            <span class="step-time">{{ timeAgo(evt.timestamp) }}</span>
          </div>

          <!-- TL;DR (always visible) -->
          <div class="step-tldr">{{ tldr(evt.message) }}</div>

          <!-- Expanded full message -->
          <div v-if="expandedEvents.has(evt.id) && evt.message.length > 100" class="step-full">
            {{ fullMessage(evt.message) }}
          </div>

          <!-- Stage change details -->
          <div v-if="evt.fromStage && evt.toStage" class="step-stages">
            <span class="step-stage">{{ evt.fromStage }}</span>
            <span class="step-stage-arrow">→</span>
            <span class="step-stage">{{ evt.toStage }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-timeline {
  margin: 8px 0;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.timeline-count {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-weight: 500;
}

.timeline-empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 12px;
  text-align: center;
}

.timeline-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.step-card {
  display: flex;
  gap: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  padding: 4px 8px;
  border-radius: 8px;
}

.step-card:hover {
  background: rgba(255, 255, 255, 0.03);
}

.step-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 28px;
}

.step-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-dot-icon {
  font-size: 11px;
}

.step-line {
  width: 2px;
  flex: 1;
  min-height: 12px;
}

.step-card:last-child .step-line {
  display: none;
}

.step-content {
  flex: 1;
  padding-bottom: 12px;
  min-width: 0;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.step-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.step-agent {
  font-size: 11px;
  font-weight: 600;
}

.step-time {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.step-tldr {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-expanded .step-tldr {
  white-space: normal;
}

.step-full {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--bg-primary);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  animation: step-expand 0.2s ease-out;
}

@keyframes step-expand {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 500px; }
}

.step-stages {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.step-stage {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  text-transform: capitalize;
}

.step-stage-arrow {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
