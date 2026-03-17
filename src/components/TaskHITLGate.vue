<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'
import { useHITL } from '../composables/useHITL'
import { debouncedSave } from '../composables/usePersistence'
import type { PendingDecision } from '../domain/types'

const props = defineProps<{
  taskId: string
}>()

const board = useBoard()
const { tasks, getAgent, confirmDecision, rejectDecision } = board
const ext = useExtension()
const { executeConfirmedDecision } = useHITL()

const task = computed(() => tasks.value.find(t => t.id === props.taskId))
const pd = computed(() => task.value?.pendingDecision)
const agent = computed(() => pd.value ? getAgent(pd.value.agentId) : undefined)

const feedbackText = ref('')
const showFeedback = ref(false)

/** Action label for the decision */
const actionLabels: Record<string, string> = {
  'needs-clarification': '🔄 Move Backward (Clarification)',
  'move-to-review': '➡️ Move to Review',
  'implement': '⚙️ Continue Implementing',
  'ready-for-implementation': '➡️ Move to Implementation',
  'approve': '✅ Approve & Merge',
  'request-changes': '🔄 Request Changes',
  'discuss': '💬 Start Agent Discussion',
  'ask-help': '🤝 Ask Another Agent',
  'escalate': '🆘 Needs Human Help',
}

const actionLabel = computed(() =>
  pd.value ? (actionLabels[pd.value.decision.action] || pd.value.decision.action) : ''
)

/** Whether this is an escalation (agent needs human help, not just a decision to confirm) */
const isEscalation = computed(() => pd.value?.decision.action === 'escalate')

/** Confidence color based on value */
const confidenceColor = computed(() => {
  if (!pd.value) return 'var(--text-muted)'
  const c = pd.value.decision.confidence
  if (c >= 0.8) return 'var(--accent-green)'
  if (c >= 0.5) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
})

function handleApprove() {
  if (!task.value || !pd.value) return
  const decisionId = pd.value.id
  const result = confirmDecision(task.value.id, feedbackText.value || undefined)
  if (result) {
    // Log to extension (markdown append + VS Code output)
    ext.post({
      type: 'confirm-decision',
      taskId: task.value.id,
      decisionId,
      approved: true,
      feedback: feedbackText.value || undefined,
    })
    // Execute the confirmed decision via the HITL composable
    if (executeConfirmedDecision.value && result) {
      executeConfirmedDecision.value(result)
    }
  }
  feedbackText.value = ''
  showFeedback.value = false
  debouncedSave()
}

function handleReject() {
  if (!task.value || !pd.value) return
  if (!feedbackText.value.trim() && !showFeedback.value) {
    showFeedback.value = true
    return
  }
  const decisionId = pd.value.id
  // Log to extension (markdown append + VS Code output)
  ext.post({
    type: 'confirm-decision',
    taskId: task.value.id,
    decisionId,
    approved: false,
    feedback: feedbackText.value || undefined,
  })
  rejectDecision(task.value.id, feedbackText.value || undefined)
  feedbackText.value = ''
  showFeedback.value = false
  debouncedSave()
}

/** Parse markdown-like bold and line breaks for rendering */
function renderContext(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
}
</script>

<template>
  <div v-if="pd && pd.status === 'pending'" class="hitl-gate" :class="{ 'hitl-escalation': isEscalation }">
    <div class="hitl-header">
      <div class="hitl-attention-indicator" :class="{ 'hitl-escalation-indicator': isEscalation }">
        <span class="hitl-pulse-ring"></span>
        <span class="hitl-icon">{{ isEscalation ? '🆘' : '🔔' }}</span>
      </div>
      <div class="hitl-title">
        <div class="hitl-label">{{ isEscalation ? 'Agent Needs Your Help' : 'Decision Awaiting Confirmation' }}</div>
        <div class="hitl-sublabel">
          {{ isEscalation ? 'The agent is stuck and waiting for your guidance.' : 'Nothing happens without your approval.' }}
        </div>
      </div>
    </div>

    <!-- Agent Info -->
    <div class="hitl-agent">
      <div class="hitl-agent-avatar" :style="{ background: (agent?.color || '#666') + '20' }">
        {{ agent?.avatar || '🤖' }}
      </div>
      <div class="hitl-agent-info">
        <span class="hitl-agent-name">{{ agent?.name || pd.agentId }}</span>
        <span class="hitl-agent-role">{{ agent?.role || 'agent' }}</span>
      </div>
      <span class="hitl-time">{{ new Date(pd.timestamp).toLocaleTimeString() }}</span>
    </div>

    <!-- Proposed Action Badge -->
    <div class="hitl-action-badge">
      {{ actionLabel }}
    </div>

    <!-- Confidence Meter -->
    <div class="hitl-confidence">
      <span class="hitl-confidence-label">Confidence</span>
      <div class="hitl-confidence-bar">
        <div
          class="hitl-confidence-fill"
          :style="{
            width: Math.round(pd.decision.confidence * 100) + '%',
            background: confidenceColor,
          }"
        ></div>
      </div>
      <span class="hitl-confidence-value" :style="{ color: confidenceColor }">
        {{ Math.round(pd.decision.confidence * 100) }}%
      </span>
    </div>

    <!-- Context / Reasoning -->
    <div class="hitl-context">
      <div class="hitl-context-title">Agent Reasoning</div>
      <div class="hitl-context-body" v-html="renderContext(pd.context)"></div>
    </div>

    <!-- Questions (if any) -->
    <div v-if="pd.decision.questions && pd.decision.questions.length > 0" class="hitl-questions">
      <div class="hitl-questions-title">Questions / Issues</div>
      <ul class="hitl-questions-list">
        <li v-for="(q, idx) in pd.decision.questions" :key="idx">{{ q }}</li>
      </ul>
    </div>

    <!-- Target Stage (if moving) -->
    <div v-if="pd.proposedStage" class="hitl-target">
      <span class="hitl-target-label">Proposed Target:</span>
      <span class="hitl-target-stage">{{ pd.proposedStage }}</span>
    </div>

    <!-- Feedback Input (always shown for escalation, toggle for decisions) -->
    <div v-if="showFeedback || isEscalation" class="hitl-feedback">
      <textarea
        v-model="feedbackText"
        class="hitl-feedback-input"
        :placeholder="isEscalation ? 'Provide your guidance / answers here...' : 'Add feedback or reason for rejection...'"
        :rows="isEscalation ? 4 : 2"
        autofocus
        @keydown.ctrl.enter="handleApprove"
        @keydown.meta.enter="handleApprove"
      />
    </div>

    <!-- Action Buttons -->
    <div class="hitl-actions">
      <button class="hitl-btn hitl-btn-approve" @click="handleApprove">
        {{ isEscalation ? '💡 Send Guidance & Resume' : '✅ Approve & Execute' }}
      </button>
      <button class="hitl-btn hitl-btn-reject" @click="handleReject">
        ❌ {{ showFeedback || isEscalation ? 'Dismiss' : 'Reject' }}
      </button>
      <button
        v-if="!showFeedback && !isEscalation"
        class="hitl-btn hitl-btn-feedback"
        @click="showFeedback = true"
      >
        💬 Add Feedback
      </button>
    </div>
  </div>
</template>

<style scoped>
.hitl-gate {
  background: rgba(245, 158, 11, 0.06);
  border: 2px solid rgba(245, 158, 11, 0.4);
  border-radius: 12px;
  padding: 16px;
  margin: 8px 0;
  animation: hitl-appear 0.3s ease-out;
}

.hitl-gate.hitl-escalation {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.5);
}

.hitl-escalation .hitl-pulse-ring {
  border-color: rgba(239, 68, 68, 0.6);
}

.hitl-escalation-indicator .hitl-icon {
  font-size: 20px;
}

@keyframes hitl-appear {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.hitl-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.hitl-attention-indicator {
  position: relative;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hitl-pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(245, 158, 11, 0.6);
  animation: hitl-pulse 2s ease-in-out infinite;
}

@keyframes hitl-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.3; }
}

.hitl-icon {
  font-size: 18px;
  z-index: 1;
}

.hitl-title {
  flex: 1;
}

.hitl-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent-yellow, #f59e0b);
}

.hitl-sublabel {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.hitl-agent {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  margin-bottom: 12px;
}

.hitl-agent-avatar {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.hitl-agent-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hitl-agent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.hitl-agent-role {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: capitalize;
}

.hitl-time {
  font-size: 11px;
  color: var(--text-muted);
}

.hitl-action-badge {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.12);
  color: var(--accent-blue, #3b82f6);
  margin-bottom: 12px;
}

.hitl-confidence {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.hitl-confidence-label {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 70px;
}

.hitl-confidence-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}

.hitl-confidence-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.hitl-confidence-value {
  font-size: 13px;
  font-weight: 700;
  min-width: 40px;
  text-align: right;
}

.hitl-context {
  margin-bottom: 12px;
}

.hitl-context-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.hitl-context-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  padding: 10px 12px;
  background: var(--bg-primary);
  border-radius: 8px;
  border-left: 3px solid rgba(245, 158, 11, 0.4);
}

.hitl-questions {
  margin-bottom: 12px;
}

.hitl-questions-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.hitl-questions-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.hitl-questions-list li {
  margin-bottom: 4px;
}

.hitl-target {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 12px;
}

.hitl-target-label {
  color: var(--text-muted);
}

.hitl-target-stage {
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(139, 92, 246, 0.12);
  color: var(--accent-purple, #8b5cf6);
  font-weight: 600;
  text-transform: capitalize;
}

.hitl-feedback {
  margin-bottom: 12px;
  animation: hitl-appear 0.2s ease-out;
}

.hitl-feedback-input {
  width: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--border-color, rgba(255,255,255,0.1));
  border-radius: 8px;
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}

.hitl-feedback-input:focus {
  border-color: var(--accent-yellow, #f59e0b);
}

.hitl-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.hitl-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hitl-btn:hover {
  transform: translateY(-1px);
}

.hitl-btn:active {
  transform: translateY(0);
}

.hitl-btn-approve {
  background: var(--accent-green, #22c55e);
  color: white;
  flex: 1;
}

.hitl-btn-approve:hover {
  background: #16a34a;
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
}

.hitl-btn-reject {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red, #ef4444);
}

.hitl-btn-reject:hover {
  background: rgba(239, 68, 68, 0.25);
}

.hitl-btn-feedback {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.hitl-btn-feedback:hover {
  background: var(--bg-card);
}
</style>
