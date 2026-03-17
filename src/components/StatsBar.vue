<script setup lang="ts">
import { computed } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useWorkflow } from '../composables/useWorkflow'

const { stats, simulationRunning } = useBoard()
const wf = useWorkflow()

const activeCount = computed(() => {
  const completedCount = wf.finalStages.value.reduce(
    (sum, id) => sum + (stats.value.byStage[id] ?? 0), 0,
  )
  return stats.value.total - completedCount
})
</script>

<template>
  <div class="stats-bar">
    <div class="stat-item">
      📋 Total: <span class="stat-value">{{ stats.total }}</span>
    </div>
    <div class="stat-item">
      ⚡ Active: <span class="stat-value">{{ activeCount }}</span>
    </div>
    <div class="stat-item" v-if="stats.blocked > 0" style="color: var(--accent-orange);">
      ⚠️ Blocked: <span class="stat-value" style="color: var(--accent-orange);">{{ stats.blocked }}</span>
    </div>
    <div class="stat-item">
      🤖 Agents: <span class="stat-value" :style="{ color: simulationRunning ? 'var(--accent-green)' : 'inherit' }">{{ stats.activeAgents }}</span>
    </div>
    <div style="flex: 1;"></div>
    <div class="stat-item" style="color: var(--text-muted);">
      Workflow: {{ wf.pipelineDescription.value }}
    </div>
  </div>
</template>
