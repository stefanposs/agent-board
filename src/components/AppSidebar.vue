<script setup lang="ts">
import { computed } from 'vue'
import { useBoard } from '../composables/useBoard'
import GoalCard from './GoalCard.vue'

const { activityFeed, openSettings, goals, openGoalDetail, createGoal } = useBoard()

const recentActivity = computed(() => activityFeed.value.slice(0, 15))

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

/** Safely split a message on **bold** delimiters into alternating text/bold segments */
function parseMessageParts(msg: string): { text: string; bold: boolean }[] {
  return msg.split(/(\*\*.*?\*\*)/g).map(part => ({
    text: part.replace(/^\*\*|\*\*$/g, ''),
    bold: part.startsWith('**') && part.endsWith('**'),
  }))
}

function handleCreateGoal() {
  const goal = createGoal({ title: 'New Goal' })
  openGoalDetail(goal.id)
}
</script>

<template>
  <aside class="app-sidebar">
    <!-- Goals -->
    <div class="sidebar-section">
      <div class="sidebar-section-title">
        🎯 Goals
        <button class="btn-icon-sm" @click="handleCreateGoal" title="Create goal">+</button>
      </div>
      <div v-if="goals.length === 0" style="font-size: 12px; color: var(--text-muted); padding: 4px 0;">
        No goals yet. Click + to create one.
      </div>
      <GoalCard v-for="g in goals" :key="g.id" :goal="g" />
    </div>

    <!-- Activity Feed -->
    <div class="sidebar-section" style="flex: 1; overflow-y: auto;">
      <div class="sidebar-section-title">Activity Feed</div>
      <div v-if="activityFeed.length === 0" style="font-size: 12px; color: var(--text-muted); padding: 8px 0;">
        No recent activity.
      </div>
      <div v-for="item in recentActivity" :key="item.id" class="activity-item">
        <span class="activity-time">{{ timeAgo(item.timestamp) }}</span>
        <span><template v-for="(part, i) in parseMessageParts(item.message)" :key="i"><strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></span>
      </div>
    </div>

    <!-- Settings -->
    <div class="sidebar-footer">
      <button class="sidebar-settings-btn" aria-label="Open settings" @click="openSettings">
        ⚙️ Settings
      </button>
    </div>
  </aside>
</template>
