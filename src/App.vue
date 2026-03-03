<script setup lang="ts">
import { useBoard } from './composables/useBoard'
import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'
import BoardView from './components/BoardView.vue'
import StatsBar from './components/StatsBar.vue'
import TaskDetail from './components/TaskDetail.vue'
import ToastContainer from './components/ToastContainer.vue'
import CreateTaskModal from './components/CreateTaskModal.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import AgentPanel from './components/AgentPanel.vue'

const { selectedTaskId, selectTask, showCreateModal, showSettings, showAgentPanel, selectedAgentId, agentPanelTaskId, closeAgentPanel } = useBoard()
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <AppSidebar />
    <div class="app-main">
      <StatsBar />
      <BoardView />
    </div>
    <TaskDetail
      v-if="selectedTaskId"
      :task-id="selectedTaskId"
      @close="selectTask(null)"
    />
    <CreateTaskModal v-if="showCreateModal" />
    <SettingsPanel v-if="showSettings" />
    <AgentPanel
      v-if="showAgentPanel && selectedAgentId"
      :agent-id="selectedAgentId"
      :task-id="agentPanelTaskId ?? undefined"
      @close="closeAgentPanel"
    />
    <ToastContainer />
  </div>
</template>
