<script setup lang="ts">
import { computed } from 'vue'
import type { Goal } from '../domain'
import { useBoard } from '../composables/useBoard'

const props = defineProps<{ goal: Goal }>()
const { getGoalProgress, openGoalDetail } = useBoard()

const progress = computed(() => getGoalProgress(props.goal.id))

const isOverdue = computed(() => {
  if (!props.goal.deadline) return false
  return Date.now() > props.goal.deadline && progress.value < 100
})

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}
</script>

<template>
  <div class="goal-card" :class="{ 'goal-overdue': isOverdue }" role="button" tabindex="0" :aria-label="`Goal: ${goal.title}`" @click="openGoalDetail(goal.id)" @keydown.enter="openGoalDetail(goal.id)" @keydown.space.prevent="openGoalDetail(goal.id)">
    <div class="goal-card-header">
      <span class="goal-card-title">🎯 {{ goal.title }}</span>
      <span v-if="goal.deadline" class="goal-card-deadline" :class="{ overdue: isOverdue }">
        📅 {{ formatDate(goal.deadline) }}
      </span>
    </div>
    <div v-if="goal.description" class="goal-card-desc">{{ goal.description }}</div>
    <div class="goal-card-progress">
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" :style="{ width: progress + '%', background: progress === 100 ? 'var(--accent-green)' : 'var(--accent-blue)' }"></div>
      </div>
      <span class="goal-progress-label">{{ progress }}%</span>
    </div>
    <div class="goal-card-meta">
      <span>{{ goal.taskIds.length }} task{{ goal.taskIds.length !== 1 ? 's' : '' }}</span>
      <span v-if="goal.owner" style="color: var(--text-muted);">👤 {{ goal.owner }}</span>
    </div>
  </div>
</template>

<style scoped>
.goal-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.goal-card:hover {
  background: rgba(59, 130, 246, 0.06);
  border-color: var(--accent-blue);
}

.goal-card.goal-overdue {
  border-color: rgba(239, 68, 68, 0.3);
}

.goal-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.goal-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-card-deadline {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.goal-card-deadline.overdue {
  color: var(--accent-red, #ef4444);
  font-weight: 600;
}

.goal-card-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-card-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.goal-progress-bar {
  flex: 1;
  height: 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.goal-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.goal-progress-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 32px;
  text-align: right;
}

.goal-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
