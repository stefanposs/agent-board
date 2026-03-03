<script setup lang="ts">
import { useBoard } from '../composables/useBoard'
import { toggleSimulation } from '../composables/useSimulation'

const { simulationRunning, humanInterventionTasks, totalUsageStats, selectTask } = useBoard()

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
</script>

<template>
  <header class="app-header">
    <div class="app-header-left">
      <div class="app-logo">
        <div class="app-logo-icon">⚡</div>
        <span>Agent Board</span>
      </div>
      <span style="font-size: 12px; color: var(--text-muted); border-left: 1px solid var(--border-color); padding-left: 12px;">
        AI Workflow Orchestration
      </span>

      <!-- Human Intervention Alert -->
      <div
        v-if="humanInterventionTasks.length > 0"
        class="intervention-alert"
        @click="selectTask(humanInterventionTasks[0].id)"
      >
        <span class="intervention-pulse"></span>
        <span>👤 {{ humanInterventionTasks.length }} task{{ humanInterventionTasks.length > 1 ? 's' : '' }} need{{ humanInterventionTasks.length === 1 ? 's' : '' }} your attention</span>
      </div>
    </div>
    <div class="app-header-right">
      <!-- Token Usage -->
      <div class="header-usage" :title="`${totalUsageStats.totalRequests} requests, $${totalUsageStats.totalCost.toFixed(2)} estimated cost`">
        <span class="usage-label">🪙</span>
        <span class="usage-value">{{ formatTokens(totalUsageStats.totalTokens) }}</span>
        <span class="usage-cost">${{ totalUsageStats.totalCost.toFixed(2) }}</span>
      </div>

      <div
        class="sim-toggle"
        :class="simulationRunning ? 'active' : 'inactive'"
        @click="toggleSimulation"
      >
        <div class="sim-dot" :class="simulationRunning ? 'active' : 'inactive'"></div>
        {{ simulationRunning ? 'Agents Active' : 'Start Agents' }}
      </div>
    </div>
  </header>
</template>
