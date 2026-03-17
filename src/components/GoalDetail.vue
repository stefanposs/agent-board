<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useBoard } from '../composables/useBoard'
import { debouncedSave } from '../composables/usePersistence'
import { useFocusTrap } from '../composables/useFocusTrap'

const props = defineProps<{ goalId: string }>()
const emit = defineEmits<{ close: [] }>()

const { goals, tasks, updateGoal, deleteGoal, unlinkTaskFromGoal, getGoalProgress, selectTask, closeGoalDetail } = useBoard()
const overlayRef = ref<HTMLElement | null>(null)
useFocusTrap(overlayRef)

function handleEscape(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => document.addEventListener('keydown', handleEscape))
onUnmounted(() => document.removeEventListener('keydown', handleEscape))

const goal = computed(() => goals.value.find(g => g.id === props.goalId))
const progress = computed(() => getGoalProgress(props.goalId))

const linkedTasks = computed(() => {
  if (!goal.value) return []
  return tasks.value.filter(t => goal.value!.taskIds.includes(t.id))
})

const isOverdue = computed(() => {
  if (!goal.value?.deadline) return false
  return Date.now() > goal.value.deadline && progress.value < 100
})

const editMode = ref(false)
const editTitle = ref('')
const editDescription = ref('')
const editOwner = ref('')
const editDeadline = ref('')

function startEdit() {
  if (!goal.value) return
  editTitle.value = goal.value.title
  editDescription.value = goal.value.description || ''
  editOwner.value = goal.value.owner || ''
  editDeadline.value = goal.value.deadline ? new Date(goal.value.deadline).toISOString().slice(0, 10) : ''
  editMode.value = true
}

function saveEdit() {
  if (!goal.value || !editTitle.value.trim()) return
  updateGoal(goal.value.id, {
    title: editTitle.value.trim(),
    description: editDescription.value.trim() || undefined,
    owner: editOwner.value.trim() || undefined,
    deadline: editDeadline.value ? new Date(editDeadline.value).getTime() : undefined,
  })
  editMode.value = false
  debouncedSave()
}

function handleDelete() {
  if (!goal.value) return
  if (!confirm(`Delete goal "${goal.value.title}"? This will unlink all associated tasks.`)) return
  deleteGoal(goal.value.id)
  debouncedSave()
  emit('close')
}

function handleUnlinkTask(taskId: string) {
  if (!goal.value) return
  unlinkTaskFromGoal(taskId, goal.value.id)
  debouncedSave()
}

function openTask(taskId: string) {
  selectTask(taskId)
  emit('close')
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="goal" class="detail-overlay" ref="overlayRef" @click.self="close" role="dialog" aria-modal="true" aria-label="Goal details">
    <div class="goal-detail-panel">
      <div class="goal-detail-header">
        <button class="detail-close" @click="close" aria-label="Close">✕</button>

        <!-- View Mode -->
        <template v-if="!editMode">
          <div class="goal-detail-title">🎯 {{ goal.title }}</div>
          <div v-if="goal.description" class="goal-detail-desc">{{ goal.description }}</div>
          <div class="goal-detail-meta">
            <span v-if="goal.owner">👤 {{ goal.owner }}</span>
            <span v-if="goal.deadline" :class="{ 'text-overdue': isOverdue }">📅 {{ formatDate(goal.deadline) }}</span>
            <span v-if="isOverdue" class="overdue-badge">OVERDUE</span>
          </div>
          <div class="goal-detail-actions">
            <button class="btn btn-sm" @click="startEdit">✏️ Edit</button>
            <button class="btn btn-sm btn-danger" @click="handleDelete">🗑 Delete</button>
          </div>
        </template>

        <!-- Edit Mode -->
        <template v-else>
          <div class="goal-edit-form">
            <div class="form-group">
              <label class="form-label">Title</label>
              <input v-model="editTitle" class="form-input" type="text" />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <textarea v-model="editDescription" class="form-textarea" rows="2"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Owner</label>
                <input v-model="editOwner" class="form-input" type="text" placeholder="e.g. Stefan" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Deadline</label>
                <input v-model="editDeadline" class="form-input" type="date" />
              </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button class="btn btn-sm" @click="editMode = false">Cancel</button>
              <button class="btn btn-sm btn-primary" :disabled="!editTitle.trim()" @click="saveEdit">Save</button>
            </div>
          </div>
        </template>
      </div>

      <!-- Progress -->
      <div class="goal-detail-section">
        <div class="goal-detail-section-title">Progress</div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <div style="flex: 1; height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
            <div :style="{ width: progress + '%', height: '100%', background: progress === 100 ? 'var(--accent-green)' : 'var(--accent-blue)', borderRadius: '3px', transition: 'width 0.3s ease' }"></div>
          </div>
          <span style="font-size: 13px; font-weight: 600; min-width: 40px; text-align: right;">{{ progress }}%</span>
        </div>
      </div>

      <!-- Linked Tasks -->
      <div class="goal-detail-section">
        <div class="goal-detail-section-title">Linked Tasks ({{ linkedTasks.length }})</div>
        <div v-if="linkedTasks.length === 0" style="font-size: 13px; color: var(--text-muted);">
          No tasks linked. Link tasks via the task detail or "Create Task" dialog.
        </div>
        <div v-for="t in linkedTasks" :key="t.id" class="goal-task-row">
          <span class="goal-task-title" @click="openTask(t.id)">{{ t.title }}</span>
          <span class="goal-task-stage">{{ t.stage }}</span>
          <span class="goal-task-progress">{{ t.progress }}%</span>
          <button class="unlink-btn" @click.stop="handleUnlinkTask(t.id)" title="Unlink">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.goal-detail-panel {
  width: 560px;
  max-width: 95%;
  max-height: 85vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.3));
  margin: auto;
  animation: modalIn 0.2s ease;
  padding: 24px;
  overflow-y: auto;
}

.goal-detail-header {
  position: relative;
  margin-bottom: 16px;
}

.goal-detail-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.goal-detail-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.goal-detail-meta {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.text-overdue {
  color: var(--accent-red, #ef4444) !important;
  font-weight: 600;
}

.overdue-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-red);
  background: rgba(239, 68, 68, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
}

.goal-detail-actions {
  display: flex;
  gap: 8px;
}

.goal-edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.goal-detail-section {
  margin-bottom: 16px;
}

.goal-detail-section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.goal-task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.15s;
  font-size: 13px;
}

.goal-task-row:hover {
  background: var(--bg-tertiary);
}

.goal-task-title {
  flex: 1;
  cursor: pointer;
  color: var(--accent-blue);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-task-title:hover {
  text-decoration: underline;
}

.goal-task-stage {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 4px;
}

.goal-task-progress {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  min-width: 32px;
  text-align: right;
}

.unlink-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.15s;
}

.goal-task-row:hover .unlink-btn {
  opacity: 1;
}
</style>
