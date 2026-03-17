<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
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
import SplashScreen from './components/SplashScreen.vue'
import ReportPanel from './components/ReportPanel.vue'
import GoalDetail from './components/GoalDetail.vue'
import NotificationCenter from './components/NotificationCenter.vue'

const { selectedTaskId, selectTask, showCreateModal, showSettings, showAgentPanel, selectedAgentId, agentPanelTaskId, closeAgentPanel, showSplashScreen, showReportPanel, showGoalDetail, selectedGoalId, closeGoalDetail, closeReportPanel, openCreateModal } = useBoard()

function handleGlobalKeydown(e: KeyboardEvent) {
  // Skip when user is typing in an input/textarea/contenteditable
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

  // N → open create modal (only when no overlay is open)
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!showCreateModal.value && !selectedTaskId.value && !showSettings.value && !showAgentPanel.value) {
      e.preventDefault()
      openCreateModal()
    }
  }
  // ? → open settings
  if (e.key === '?' && e.shiftKey) {
    if (!showSettings.value && !showCreateModal.value) {
      e.preventDefault()
      showSettings.value = true
    }
  }
}

onMounted(() => document.addEventListener('keydown', handleGlobalKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleGlobalKeydown))
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
    <SplashScreen v-if="showSplashScreen" />
    <ReportPanel v-if="showReportPanel" @close="closeReportPanel" />
    <GoalDetail
      v-if="showGoalDetail && selectedGoalId"
      :goal-id="selectedGoalId"
      @close="closeGoalDetail"
    />
    <ToastContainer />
    <NotificationCenter />
  </div>
</template>
