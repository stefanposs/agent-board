<script setup lang="ts">
import { useBoard } from '../composables/useBoard'

const { workspaceStats, activeWorkspaceFilter, setWorkspaceFilter, agents, activityFeed, openSettings, isExtensionMode, openAgentPanel } = useBoard()

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}
</script>

<template>
  <aside class="app-sidebar">
    <!-- Workspaces -->
    <div class="sidebar-section">
      <div class="sidebar-section-title">
        Workspaces
        <button class="btn-icon-sm" @click="openSettings" title="Manage workspaces">⚙️</button>
      </div>
      <div
        class="sidebar-item"
        :class="{ active: !activeWorkspaceFilter }"
        @click="setWorkspaceFilter(null)"
      >
        <span style="font-size: 14px;">📊</span>
        <span>All Projects</span>
        <span class="sidebar-item-count">{{ workspaceStats.reduce((s, w) => s + w.taskCount, 0) }}</span>
      </div>
      <div
        v-for="ws in workspaceStats"
        :key="ws.id"
        class="sidebar-item"
        :class="{ active: activeWorkspaceFilter === ws.id }"
        @click="setWorkspaceFilter(ws.id)"
      >
        <div class="workspace-dot" :style="{ background: ws.color }"></div>
        <span style="flex: 1;">{{ ws.icon }} {{ ws.name }}</span>
        <span v-if="ws.branch" class="ws-branch-badge" :title="ws.branch">{{ ws.branch }}</span>
        <span class="sidebar-item-count">{{ ws.activeTasks }}</span>
        <span v-if="ws.blockedTasks > 0" class="badge badge-orange" style="font-size: 10px; margin-left: -4px;">
          {{ ws.blockedTasks }}
        </span>
      </div>
    </div>

    <!-- Agents -->
    <div class="sidebar-section">
      <div class="sidebar-section-title">Agents</div>
      <div v-for="agent in agents" :key="agent.id" class="agent-row agent-row-extended agent-row-clickable" @click="openAgentPanel(agent.id)">
        <div class="agent-avatar" :style="{ background: agent.color + '20' }">
          {{ agent.avatar }}
        </div>
        <div class="agent-info">
          <span class="agent-name">{{ agent.name }}</span>
          <span class="agent-model-label">{{ agent.modelConfig.model }}</span>
        </div>
        <div class="agent-status-dot" :class="`agent-status-${agent.status}`" :title="agent.status"></div>
      </div>
    </div>

    <!-- Activity Feed -->
    <div class="sidebar-section" style="flex: 1; overflow-y: auto;">
      <div class="sidebar-section-title">Activity Feed</div>
      <div v-if="activityFeed.length === 0" style="font-size: 12px; color: var(--text-muted); padding: 8px 0;">
        No activity yet. Start the agent simulation!
      </div>
      <div v-for="item in activityFeed.slice(0, 15)" :key="item.id" class="activity-item">
        <span class="activity-time">{{ timeAgo(item.timestamp) }}</span>
        <span v-html="item.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')"></span>
      </div>
    </div>
  </aside>
</template>
