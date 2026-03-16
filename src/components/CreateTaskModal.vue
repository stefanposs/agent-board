<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useFocusTrap } from '../composables/useFocusTrap'
import type { TaskType, Task } from '../domain'
import LogoIcon from './LogoIcon.vue'
const { workspaces, agents, createTask, closeCreateModal, suggestAgents, goals } = useBoard()
const overlayRef = ref<HTMLElement | null>(null)
useFocusTrap(overlayRef)

const showAdvanced = ref(false)

const title = ref('')
const description = ref('')
const taskType = ref<TaskType>('feature')
const codeTaskTypes: TaskType[] = ['feature', 'bugfix', 'infra']
const workspaceId = ref(workspaces.value[0]?.id || '')
const tagsInput = ref('')
const skillsInput = ref('')
const assigneeId = ref('')
const selectedGoalIds = ref<string[]>([])
const outputPath = ref('')

/** Compute agent suggestions based on current skill input */
const agentSuggestions = computed(() => {
  const skills = skillsInput.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const tags = tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  // Build a partial task object for scoring
  const partial = { requiredSkills: skills, tags } as Task
  return suggestAgents(partial)
})

function onSubmit() {
  if (!title.value.trim()) return

  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  const requiredSkills = skillsInput.value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const sanitizedOutputPath = outputPath.value.trim()
  if (sanitizedOutputPath && (/^[/\\]/.test(sanitizedOutputPath) || sanitizedOutputPath.includes('..'))) {
    return // reject absolute paths and traversals
  }

  createTask({
    title: title.value.trim(),
    description: description.value.trim(),
    taskType: taskType.value,
    workspaceId: workspaceId.value || undefined,
    tags,
    requiredSkills: requiredSkills.length > 0 ? requiredSkills : undefined,
    assignee: assigneeId.value || undefined,
    goalIds: selectedGoalIds.value.length > 0 ? selectedGoalIds.value : undefined,
    outputPath: sanitizedOutputPath || undefined,
  })

  closeCreateModal()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCreateModal()
}
</script>

<template>
  <div class="detail-overlay" ref="overlayRef" @click.self="closeCreateModal" @keydown="onKeydown" role="dialog" aria-modal="true" aria-label="Create new task">
    <div class="create-modal">
      <div class="create-modal-header">
        <h2 class="create-modal-title"><LogoIcon :size="20" class="modal-logo" /> New Task</h2>
        <button class="detail-close" @click="closeCreateModal" aria-label="Close">✕</button>
      </div>

      <form class="create-modal-form" @submit.prevent="onSubmit">
        <div class="form-group">
          <label class="form-label">Title *</label>
          <input
            v-model="title"
            class="form-input"
            type="text"
            placeholder="e.g. Add rate limiting to API"
            autofocus
          />
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea
            v-model="description"
            class="form-textarea"
            rows="3"
            placeholder="Describe the task..."
          ></textarea>
        </div>

        <div class="form-row">
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Type</label>
            <select v-model="taskType" class="form-select">
              <option value="feature">🚀 Feature</option>
              <option value="bugfix">🐛 Bugfix</option>
              <option value="docs">📄 Documentation</option>
              <option value="infra">🔧 Infrastructure</option>
              <option value="research">🔍 Research</option>
              <option value="design">🎨 Design</option>
              <option value="ops">⚙️ Operations</option>
              <option value="other">📌 Other</option>
            </select>
          </div>
        </div>

        <button type="button" class="btn btn-sm advanced-toggle" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '▾ Less options' : '▸ More options' }}
        </button>

        <div v-show="showAdvanced" class="advanced-options">
        <div class="form-row">
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Workspace <span style="color: var(--text-muted); font-weight: 400;">(optional)</span></label>
            <select v-model="workspaceId" class="form-select">
              <option value="">— No workspace —</option>
              <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
                {{ ws.icon }} {{ ws.name }}
              </option>
            </select>
          </div>

          <div class="form-group" style="flex: 1;">
            <label class="form-label">Assign Agent <span style="color: var(--text-muted); font-weight: 400;">(optional)</span></label>
            <select v-model="assigneeId" class="form-select">
              <option value="">— Auto-select —</option>
              <option v-for="suggestion in agentSuggestions" :key="suggestion.agent.id" :value="suggestion.agent.id">
                {{ suggestion.agent.avatar }} {{ suggestion.agent.displayName || suggestion.agent.name }}
                <template v-if="suggestion.matchedSkills.length > 0"> ({{ Math.round(suggestion.score * 100) }}% match)</template>
              </option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Tags <span style="color: var(--text-muted); font-weight: 400;">(comma-separated)</span></label>
          <input
            v-model="tagsInput"
            class="form-input"
            type="text"
            placeholder="e.g. feature, api, security"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Required Skills <span style="color: var(--text-muted); font-weight: 400;">(comma-separated, for agent matching)</span></label>
          <input
            v-model="skillsInput"
            class="form-input"
            type="text"
            placeholder="e.g. python, golang, database, testing"
          />
        </div>

        <!-- Goal Selector -->
        <div v-if="goals.length > 0" class="form-group">
          <label class="form-label">Goals <span style="color: var(--text-muted); font-weight: 400;">(link to goals)</span></label>
          <div class="goal-select-list">
            <label v-for="g in goals" :key="g.id" class="goal-checkbox-label">
              <input type="checkbox" :value="g.id" v-model="selectedGoalIds" />
              <span>{{ g.title }}</span>
            </label>
          </div>
        </div>

        <!-- Output Path (for non-code tasks like concepts, presentations) -->
        <div class="form-group">
          <label class="form-label">Output Path <span style="color: var(--text-muted); font-weight: 400;">(optional — where to save result)</span></label>
          <input
            v-model="outputPath"
            class="form-input"
            type="text"
            placeholder="e.g. docs/concept.md, presentations/kickoff.md"
          />
          <div class="form-hint">Relative path only (no <code>..</code> or absolute paths). If empty, the agent will ask.</div>
        </div>
        </div>

        <div class="create-modal-actions">
          <button type="button" class="btn" @click="closeCreateModal">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="!title.trim()">
            ✨ Create Task
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
