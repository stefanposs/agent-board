<script setup lang="ts">
import { ref } from 'vue'
import { useBoard } from '../composables/useBoard'
import type { TaskPriority } from '../domain'

const { workspaces, createTask, closeCreateModal } = useBoard()

const title = ref('')
const description = ref('')
const priority = ref<TaskPriority>('medium')
const workspaceId = ref(workspaces.value[0]?.id || '')
const tagsInput = ref('')

function onSubmit() {
  if (!title.value.trim()) return

  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  createTask({
    title: title.value.trim(),
    description: description.value.trim(),
    priority: priority.value,
    workspaceId: workspaceId.value,
    tags,
  })

  closeCreateModal()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCreateModal()
}
</script>

<template>
  <div class="detail-overlay" @click.self="closeCreateModal" @keydown="onKeydown">
    <div class="create-modal">
      <div class="create-modal-header">
        <h2 class="create-modal-title">💡 New Task</h2>
        <button class="detail-close" @click="closeCreateModal">✕</button>
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
            <label class="form-label">Priority</label>
            <select v-model="priority" class="form-select">
              <option value="low">🟢 Low</option>
              <option value="medium">🔵 Medium</option>
              <option value="high">🟠 High</option>
              <option value="critical">🔴 Critical</option>
            </select>
          </div>

          <div class="form-group" style="flex: 1;">
            <label class="form-label">Workspace</label>
            <select v-model="workspaceId" class="form-select">
              <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
                {{ ws.icon }} {{ ws.name }}
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
