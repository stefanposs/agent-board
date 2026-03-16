<script setup lang="ts">
import { useBoard } from '../composables/useBoard'
import { useNotifications } from '../composables/useNotifications'
import { useExtension } from '../composables/useExtension'
import { toggleSimulation } from '../composables/useSimulation'
import LogoIcon from './LogoIcon.vue'

const { simulationRunning, humanInterventionTasks, selectTask, openReportPanel, agents, updateAgentStatus } = useBoard()
const { unreadCount, toggleNotificationCenter } = useNotifications()
const ext = useExtension()

function stopAllAgents() {
  const working = agents.value.filter(a => a.status === 'working')
  if (working.length === 0) return
  if (!confirm(`Stop all ${working.length} running agent${working.length > 1 ? 's' : ''}? This cannot be undone.`)) return
  for (const agent of working) {
    ext.stopAgent(agent.id)
    updateAgentStatus(agent.id, 'idle', null)
  }
}
</script>

<template>
  <header class="app-header">
    <div class="app-header-left">
      <div class="app-logo">
        <LogoIcon :size="28" />
        <span>Agent Board</span>
      </div>

      <!-- Human Intervention Alert -->
      <div
        v-if="humanInterventionTasks.length > 0"
        class="intervention-alert"
        :class="{ 'escalation-alert': humanInterventionTasks.some(t => t.humanAttentionType === 'escalation') }"
        role="button"
        tabindex="0"
        :aria-label="`${humanInterventionTasks.length} tasks need attention`"
        @click="selectTask(humanInterventionTasks[0].id)"
        @keydown.enter="selectTask(humanInterventionTasks[0].id)"
        @keydown.space.prevent="selectTask(humanInterventionTasks[0].id)"
      >
        <span class="intervention-pulse"></span>
        <span v-if="humanInterventionTasks.some(t => t.humanAttentionType === 'escalation')">
          🆘 {{ humanInterventionTasks.length }} task{{ humanInterventionTasks.length > 1 ? 's' : '' }} need{{ humanInterventionTasks.length === 1 ? 's' : '' }} your help
        </span>
        <span v-else>
          👤 {{ humanInterventionTasks.length }} task{{ humanInterventionTasks.length > 1 ? 's' : '' }} need{{ humanInterventionTasks.length === 1 ? 's' : '' }} your attention
        </span>
      </div>
    </div>
    <div class="app-header-right">
      <!-- Notification Bell -->
      <button
        class="notification-bell"
        :class="{ 'has-unread': unreadCount > 0 }"
        @click="toggleNotificationCenter"
        :title="`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`"
        :aria-label="`${unreadCount} unread notifications`"
      >
        🔔
        <span v-if="unreadCount > 0" class="notification-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
      </button>

      <!-- Report Button -->
      <button class="btn btn-sm" style="font-size: 12px;" @click="openReportPanel" title="Open Report">
        📊 Report
      </button>

      <!-- Stop All Agents (shown only when agents are working) -->
      <button
        v-if="agents.some(a => a.status === 'working')"
        class="btn btn-sm stop-all-btn"
        @click="stopAllAgents"
        title="Stop all running agents"
      >
        ⏹ Stop All
      </button>

      <button
        class="sim-toggle"
        :class="simulationRunning ? 'active' : 'inactive'"
        :aria-pressed="simulationRunning"
        @click="toggleSimulation"
        title="Toggle AI agent automation"
      >
        <div class="sim-dot" :class="simulationRunning ? 'active' : 'inactive'"></div>
        {{ simulationRunning ? 'Active' : 'Start' }}
      </button>
    </div>
  </header>
</template>
