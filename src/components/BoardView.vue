<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useWorkflow } from '../composables/useWorkflow'
import TaskCard from './TaskCard.vue'
import LogoIcon from './LogoIcon.vue'
const { tasksByStage, moveTask, openCreateModal, tasks } = useBoard()
const wf = useWorkflow()
const { stages } = wf

const dragOverColumn = ref<string | null>(null)
const draggedTaskId = ref<string | null>(null)

const searchQuery = ref('')

/** True when the entire board has zero tasks */
const isBoardEmpty = computed(() => tasks.value.length === 0)

/** True when any filter is active */
const hasActiveFilter = computed(() => searchQuery.value.trim() !== '')

/** Filtered tasks by stage – applies search filter on top of tasksByStage */
const filteredTasksByStage = computed(() => {
  if (!hasActiveFilter.value) return tasksByStage.value
  const q = searchQuery.value.trim().toLowerCase()
  const result: Record<string, typeof tasks.value> = {}
  for (const [stageId, stageTasks] of Object.entries(tasksByStage.value)) {
    result[stageId] = (stageTasks || []).filter(t => {
      if (q) {
        const searchable = `${t.title} ${t.description} ${t.tags.join(' ')} ${t.assignee || ''}`.toLowerCase()
        if (!searchable.includes(q)) return false
      }
      return true
    })
  }
  return result
})

function clearFilters() {
  searchQuery.value = ''
}

function onDragStart(taskId: string) {
  draggedTaskId.value = taskId
}

function onDragEnd() {
  draggedTaskId.value = null
  dragOverColumn.value = null
}

function onDragOver(e: DragEvent, stageId: string) {
  e.preventDefault()
  dragOverColumn.value = stageId
}

function onDragLeave() {
  dragOverColumn.value = null
}

function onDrop(stageId: string) {
  if (draggedTaskId.value) {
    moveTask(draggedTaskId.value, stageId, 'human')
  }
  draggedTaskId.value = null
  dragOverColumn.value = null
}
</script>

<template>
  <div class="board">
    <!-- Search & Filter Bar -->
    <div v-if="!isBoardEmpty" class="board-filter-bar">
      <input
        v-model="searchQuery"
        class="board-search-input"
        type="search"
        placeholder="🔍 Search tasks…"
        aria-label="Search tasks"
      />

      <button v-if="hasActiveFilter" class="btn btn-sm" @click="clearFilters" title="Clear filters">✕ Clear</button>
    </div>

    <!-- Onboarding overlay when board is empty -->
    <div v-if="isBoardEmpty" class="board-onboarding">
      <div class="onboarding-card">
        <LogoIcon :size="64" class="onboarding-logo" />
        <h2 class="onboarding-title">Welcome to Agent Board</h2>
        <p class="onboarding-text">
          Create your first task to get started. AI agents will automatically plan, implement, and review your code.
        </p>
        <div class="onboarding-steps">
          <div class="onboarding-step">
            <span class="step-number">1</span>
            <span>Create a task in <strong>{{ stages[0]?.label ?? 'the first stage' }}</strong></span>
          </div>
          <div class="onboarding-step">
            <span class="step-number">2</span>
            <span>Drag it forward — AI agents automatically pick it up</span>
          </div>
          <div class="onboarding-step">
            <span class="step-number">3</span>
            <span>Agents work through your pipeline: <strong>{{ wf.pipelineDescription.value }}</strong></span>
          </div>
          <div class="onboarding-step">
            <span class="step-number">4</span>
            <span>Approve at gates — automated or human approval</span>
          </div>
        </div>
        <button class="btn btn-primary onboarding-cta" @click="openCreateModal">
          + Create First Task
        </button>
      </div>
    </div>

    <div
      v-for="stage in stages"
      :key="stage.id"
      class="board-column"
      :class="{ 'drag-over': dragOverColumn === stage.id }"
      @dragover="onDragOver($event, stage.id)"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop(stage.id)"
    >
      <div class="column-header">
        <div class="column-header-left">
          <span class="column-icon">{{ stage.icon }}</span>
          <span class="column-title" :style="{ color: stage.color }">{{ stage.label }}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="column-count">{{ filteredTasksByStage[stage.id]?.length || 0 }}</span>
          <button v-if="stage.isFirst" class="btn-add-task" @click.stop="openCreateModal" title="Create new task">
            +
          </button>
        </div>
      </div>
      <div class="column-body">
        <TaskCard
          v-for="task in filteredTasksByStage[stage.id]"
          :key="task.id"
          :task="task"
          :is-dragging="draggedTaskId === task.id"
          @dragstart="onDragStart(task.id)"
          @dragend="onDragEnd"
        />
        <div v-if="!filteredTasksByStage[stage.id]?.length" class="empty-column">
          <div class="empty-column-icon">{{ stage.icon }}</div>
          <span v-if="stage.isFirst">Click + to add a task</span>
          <span v-else>No tasks</span>
        </div>
      </div>
    </div>
  </div>
</template>
