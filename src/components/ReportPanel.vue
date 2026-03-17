<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'
import { useFocusTrap } from '../composables/useFocusTrap'

const emit = defineEmits<{ close: [] }>()

const { requestReport, setReportContent, reportContent, reportLoading, isExtensionMode } = useBoard()
const ext = useExtension()

const copied = ref(false)
const promptInput = ref('')
const overlayRef = ref<HTMLElement | null>(null)
useFocusTrap(overlayRef)

function generate() {
  const data = requestReport(promptInput.value.trim() || undefined)
  if (isExtensionMode.value) {
    ext.generateReport(data.tasks, data.goals, data.prompt)
  } else {
    // Standalone/mock mode fallback
    setTimeout(() => {
      setReportContent('Report generation requires VS Code extension mode with GitHub Copilot.')
    }, 500)
  }
}

function copyReport() {
  navigator.clipboard.writeText(reportContent.value).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  })
}

function close() {
  emit('close')
}

function handleEscape(e: KeyboardEvent) { if (e.key === 'Escape') close() }

let unsub: (() => void) | null = null
onMounted(() => {
  document.addEventListener('keydown', handleEscape)
  unsub = ext.onMessage('report-generated', (msg: any) => {
    setReportContent(msg.content)
  })
  // Auto-generate on open
  generate()
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape)
  unsub?.()
})
</script>

<template>
  <div class="detail-overlay" ref="overlayRef" @click.self="close" role="dialog" aria-modal="true" aria-label="Board report">
    <div class="report-panel">
      <div class="report-header">
        <h2 class="report-title">📊 Board Report</h2>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-sm" :disabled="!reportContent || reportLoading" @click="copyReport">
            {{ copied ? '✅ Copied!' : '📋 Copy' }}
          </button>
          <button class="detail-close" @click="close" aria-label="Close">✕</button>
        </div>
      </div>

      <!-- Prompt input -->
      <div class="report-prompt">
        <input
          v-model="promptInput"
          class="form-input"
          type="text"
          placeholder="Optional: focus on a specific topic, e.g. 'overdue items' or 'progress this week'..."
          @keydown.enter="generate"
        />
        <button class="btn btn-sm btn-primary" :disabled="reportLoading" @click="generate">
          {{ reportLoading ? '⏳ Generating...' : '🔄 Generate' }}
        </button>
      </div>

      <!-- Loading state -->
      <div v-if="reportLoading" class="report-loading">
        <div class="report-loading-spinner"></div>
        <span>Generating report via AI...</span>
      </div>

      <!-- Report content -->
      <div v-else-if="reportContent" class="report-section">
        <pre class="report-markdown">{{ reportContent }}</pre>
      </div>

      <div v-else class="report-empty">
        <span style="font-size: 13px; color: var(--text-muted);">Click Generate to create a report.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.report-panel {
  width: 700px;
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

.report-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.report-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.report-prompt {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.report-prompt .form-input {
  flex: 1;
}

.report-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.report-loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.report-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
}

.report-section {
  margin-bottom: 16px;
}

.report-markdown {
  background: var(--bg-primary, #0d1117);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
  font-size: 12px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow-y: auto;
}
</style>
