<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'

const board = useBoard()
const { agents, tasks, workspaces, isExtensionMode, addActivity, addToast, updateAgentUsage, updateAgentStatus, getOrCreateSession, addSessionMessage, getTaskSessions } = board
const ext = useExtension()

const props = defineProps<{
  agentId: string
  taskId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const agent = computed(() => agents.value.find((a) => a.id === props.agentId))
const currentTask = computed(() => props.taskId ? tasks.value.find((t) => t.id === props.taskId) : null)

const prompt = ref('')
const streamingOutput = ref('')
const isRunning = ref(false)
const activeTab = ref<'session' | 'config' | 'usage'>('session')
const chatContainer = ref<HTMLElement | null>(null)

// Get or create session for this task+agent pair
const currentSession = computed(() => {
  if (!props.taskId || !props.agentId) return null
  return getOrCreateSession(props.taskId, props.agentId)
})

// All sessions for this task
const taskSessionsList = computed(() => {
  if (!props.taskId) return []
  return getTaskSessions(props.taskId)
})

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

// Pre-fill prompt based on agent role and task (only if session is empty)
onMounted(() => {
  if (currentTask.value && agent.value && currentSession.value && currentSession.value.messages.length === 0) {
    const t = currentTask.value
    const role = agent.value.role
    const promptMap: Record<string, string> = {
      planner: `Plan the implementation for: "${t.title}"\n\nDescription: ${t.description}\nTags: ${t.tags.join(', ')}\n\nBreak this down into clear implementation steps.`,
      developer: `Implement the following task: "${t.title}"\n\nDescription: ${t.description}\nTags: ${t.tags.join(', ')}\n\nWrite clean, production-ready code.`,
      reviewer: `Review the code for task: "${t.title}"\n\nDescription: ${t.description}\n\nCheck for correctness, security, performance, and best practices.`,
      architect: `Design the architecture for: "${t.title}"\n\nDescription: ${t.description}\nTags: ${t.tags.join(', ')}\n\nEvaluate trade-offs and propose a clear design.`,
      devops: `Set up infrastructure for: "${t.title}"\n\nDescription: ${t.description}\n\nDefine CI/CD, deployment, and infrastructure needs.`,
    }
    prompt.value = promptMap[role] || `Work on: "${t.title}"\n\n${t.description}`
  }

  // Listen for agent output chunks (streaming)
  _unsubOutput = ext.onMessage('agent-output', (msg) => {
    if (msg.agentId === props.agentId) {
      if (msg.tokensUsed !== undefined && msg.tokensUsed !== null) {
        // Final output — session storage is handled in main.ts
        streamingOutput.value = ''
        isRunning.value = false
        scrollToBottom()
      } else if (msg.content) {
        streamingOutput.value += msg.content
        scrollToBottom()
      }
    }
  })

  _unsubStatus = ext.onMessage('agent-status', (msg) => {
    if (msg.agentId === props.agentId && msg.status === 'idle') {
      isRunning.value = false
    }
  })

  scrollToBottom()
})

let _unsubOutput: (() => void) | undefined
let _unsubStatus: (() => void) | undefined
onUnmounted(() => {
  _unsubOutput?.()
  _unsubStatus?.()
})

function runAgent() {
  if (!prompt.value.trim() || !agent.value) return
  streamingOutput.value = ''
  isRunning.value = true

  // Collect session history BEFORE adding the new user message,
  // otherwise the prompt would be sent twice to the LLM.
  const sessionMessages = currentSession.value
    ? currentSession.value.messages.map((m) => ({ role: m.role, content: m.content }))
    : []

  // Now add user message to session for local display
  if (currentSession.value) {
    addSessionMessage(currentSession.value.id, 'user', prompt.value.trim())
  }

  if (ext.isWebview.value) {
    // Resolve workspace path for this task's workspace
    const ws = currentTask.value ? workspaces.value.find((w) => w.id === currentTask.value!.workspaceId) : null
    ext.runAgent(agent.value.id, props.taskId || '', prompt.value, sessionMessages, ws?.localPath)
  } else {
    // Standalone: simulate a response
    simulateResponse()
  }

  addActivity(`🤖 **${agent.value.name}** started on "${currentTask.value?.title || 'prompt'}"`, 'agent_action')
  prompt.value = ''
  scrollToBottom()
}

function simulateResponse() {
  const responses = [
    `## Analysis\n\nI've analyzed the request and here's my approach:\n\n1. **Parse requirements** — Extract key specifications\n2. **Design interface** — Define the API surface\n3. **Implement core logic** — Write the main functionality\n4. **Add tests** — Cover edge cases\n5. **Document** — Add JSDoc and README\n\n### Key Decisions\n- Use TypeScript for type safety\n- Follow existing patterns in the codebase\n- Keep changes minimal and focused\n\n*Estimated effort: 2-4 hours*`,
    `## Implementation Plan\n\n### Step 1: Create types\n\`\`\`typescript\ninterface Config {\n  enabled: boolean\n  maxRetries: number\n  timeout: number\n}\n\`\`\`\n\n### Step 2: Add service\n- Create service class with dependency injection\n- Add error handling with retries\n- Include logging\n\n### Step 3: Wire up\n- Register in DI container\n- Add configuration\n- Update tests\n\n✅ Ready to implement.`,
    `## Code Review Summary\n\n### ✅ Looks Good\n- Clean separation of concerns\n- Good error handling\n- Tests cover main paths\n\n### ⚠️ Suggestions\n- Consider adding rate limiting\n- Add input validation for edge cases\n- The timeout value should be configurable\n\n### 🔴 Issues\n- Missing null check on line 42\n- Potential race condition in async handler\n\n**Verdict: Approve with minor changes**`,
  ]

  const response = responses[Math.floor(Math.random() * responses.length)]
  let i = 0
  const interval = setInterval(() => {
    const chunk = response.slice(i, i + 3)
    streamingOutput.value += chunk
    i += 3
    scrollToBottom()
    if (i >= response.length) {
      clearInterval(interval)
      isRunning.value = false
      const tokens = Math.floor(response.length / 4)
      if (agent.value) {
        updateAgentUsage(agent.value.id, tokens)
        updateAgentStatus(agent.value.id, 'idle', null)
        addToast(`${agent.value.name}: Done (${tokens} tokens)`, 'success')
      }
      if (currentSession.value) {
        addSessionMessage(currentSession.value.id, 'assistant', response, tokens)
      }
      streamingOutput.value = ''
    }
  }, 15)

  if (agent.value) {
    updateAgentStatus(agent.value.id, 'working', props.taskId || null)
  }
}

function stopAgent() {
  if (agent.value && ext.isWebview.value) {
    ext.stopAgent(agent.value.id)
  }
  isRunning.value = false
  // If there was streaming content, save it as partial response
  if (currentSession.value && streamingOutput.value) {
    addSessionMessage(currentSession.value.id, 'assistant', streamingOutput.value + '\n\n*[stopped by user]*')
    streamingOutput.value = ''
  }
  if (agent.value) {
    updateAgentStatus(agent.value.id, 'idle', null)
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    runAgent()
  }
}
</script>

<template>
  <div class="detail-overlay" @click.self="emit('close')">
    <div class="agent-panel" v-if="agent">
      <div class="create-modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="agent-panel-avatar" :style="{ background: agent.color + '20' }">
            {{ agent.avatar }}
          </div>
          <div>
            <h2 class="create-modal-title">{{ agent.name }}</h2>
            <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; margin-top: 2px;">
              <span>{{ agent.role }}</span>
              <span>·</span>
              <span>{{ agent.modelConfig.model }}</span>
              <span>·</span>
              <span v-if="currentSession">💬 {{ currentSession.messages.length }} msgs</span>
              <span v-if="currentSession && currentSession.totalTokensUsed > 0">· 🪙 {{ formatTokens(currentSession.totalTokensUsed) }}</span>
            </div>
          </div>
        </div>
        <button class="detail-close" @click="emit('close')">✕</button>
      </div>

      <!-- Tabs -->
      <div class="agent-tabs">
        <button
          class="agent-tab"
          :class="{ active: activeTab === 'session' }"
          @click="activeTab = 'session'"
        >
          💬 Session
        </button>
        <button
          class="agent-tab"
          :class="{ active: activeTab === 'config' }"
          @click="activeTab = 'config'"
        >
          ⚙️ Config
        </button>
        <button
          class="agent-tab"
          :class="{ active: activeTab === 'usage' }"
          @click="activeTab = 'usage'"
        >
          📊 Usage
        </button>
      </div>

      <!-- Session Tab -->
      <div v-if="activeTab === 'session'" class="agent-panel-body" style="display: flex; flex-direction: column; height: 100%; overflow: hidden;">
        <div v-if="currentTask" class="agent-task-context">
          <span class="form-label">Task Context</span>
          <div class="agent-task-badge">
            <span class="task-title-sm">{{ currentTask.title }}</span>
            <span class="tag">{{ currentTask.stage }}</span>
            <span v-if="currentTask.branch" class="tag" style="background: rgba(139, 92, 246, 0.15); color: #a78bfa;">⎇ {{ currentTask.branch }}</span>
          </div>
        </div>

        <!-- Chat History -->
        <div ref="chatContainer" class="session-chat" style="flex: 1; overflow-y: auto; padding: 12px 0; display: flex; flex-direction: column; gap: 12px;">
          <div v-if="!currentSession || currentSession.messages.length === 0" style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 32px 16px;">
            <div style="font-size: 28px; margin-bottom: 8px;">💬</div>
            <div>No messages yet. Send a prompt to start.</div>
            <div v-if="isExtensionMode" style="margin-top: 4px; font-size: 11px;">Powered by GitHub Copilot LLM</div>
          </div>

          <template v-if="currentSession">
            <div
              v-for="msg in currentSession.messages"
              :key="msg.id"
              class="chat-message"
              :class="'chat-' + msg.role"
            >
              <div class="chat-message-header">
                <span class="chat-role">{{ msg.role === 'user' ? '👤 You' : msg.role === 'assistant' ? agent.avatar + ' ' + agent.name : '⚙️ System' }}</span>
                <span class="chat-time">{{ timeAgo(msg.timestamp) }}</span>
                <span v-if="msg.tokensUsed" class="chat-tokens">🪙 {{ msg.tokensUsed }}</span>
              </div>
              <div class="chat-message-body" v-html="formatOutput(msg.content)"></div>
            </div>
          </template>

          <!-- Streaming output -->
          <div v-if="streamingOutput" class="chat-message chat-assistant">
            <div class="chat-message-header">
              <span class="chat-role">{{ agent.avatar }} {{ agent.name }}</span>
              <span class="agent-streaming">● streaming</span>
            </div>
            <div class="chat-message-body" v-html="formatOutput(streamingOutput)"></div>
          </div>
        </div>

        <!-- Input Area -->
        <div class="session-input-area">
          <textarea
            v-model="prompt"
            class="form-textarea agent-prompt"
            rows="3"
            placeholder="Send a message… (⌘+Enter to send)"
            :disabled="isRunning"
            @keydown="handleKeydown"
          ></textarea>
          <div class="session-input-actions">
            <button v-if="isRunning" class="btn btn-danger btn-sm" @click="stopAgent">
              ⏹ Stop
            </button>
            <button
              v-else
              class="btn btn-primary btn-sm"
              @click="runAgent"
              :disabled="!prompt.trim()"
            >
              ▶ Send
            </button>
          </div>
        </div>
      </div>

      <!-- Config Tab -->
      <div v-if="activeTab === 'config'" class="agent-panel-body">
        <div class="config-grid">
          <div class="config-row">
            <span class="config-label">Model</span>
            <span class="config-value">{{ agent.modelConfig.model }}</span>
          </div>
          <div class="config-row">
            <span class="config-label">Temperature</span>
            <span class="config-value">{{ agent.modelConfig.temperature }}</span>
          </div>
          <div class="config-row">
            <span class="config-label">Max Context</span>
            <span class="config-value">{{ formatTokens(agent.modelConfig.maxContextTokens) }} tokens</span>
          </div>
          <div class="config-row">
            <span class="config-label">Role</span>
            <span class="config-value">{{ agent.role }}</span>
          </div>
          <div class="config-row">
            <span class="config-label">Status</span>
            <span class="config-value">
              <span class="agent-status-dot" :class="`agent-status-${agent.status}`" style="position: relative; top: -1px;"></span>
              {{ agent.status }}
            </span>
          </div>
          <div v-if="agent?.currentTaskId" class="config-row">
            <span class="config-label">Current Task</span>
            <span class="config-value">{{ tasks.find(t => t.id === agent?.currentTaskId)?.title || agent?.currentTaskId }}</span>
          </div>
        </div>
        <div v-if="!isExtensionMode" style="font-size: 12px; color: var(--text-muted); margin-top: 16px; padding: 12px; background: var(--bg-tertiary); border-radius: var(--radius-sm);">
          💡 In VS Code extension mode, agent configs are loaded from your config directory (JSON files) and can be edited there.
        </div>
      </div>

      <!-- Usage Tab -->
      <div v-if="activeTab === 'usage'" class="agent-panel-body">
        <div class="config-grid">
          <div class="config-row">
            <span class="config-label">Total Tokens</span>
            <span class="config-value">{{ formatTokens(agent.usage.totalTokensUsed) }}</span>
          </div>
          <div class="config-row">
            <span class="config-label">Context Tokens</span>
            <span class="config-value">{{ formatTokens(agent.usage.contextTokensUsed) }}</span>
          </div>
          <div class="config-row">
            <span class="config-label">Requests</span>
            <span class="config-value">{{ agent.usage.requestCount }}</span>
          </div>
          <div class="config-row">
            <span class="config-label">Est. Cost</span>
            <span class="config-value">${{ agent.usage.estimatedCostUsd.toFixed(2) }}</span>
          </div>
        </div>
        <!-- Session stats -->
        <div v-if="taskSessionsList.length > 0" style="margin-top: 16px;">
          <label class="form-label">Task Sessions</label>
          <div v-for="s in taskSessionsList" :key="s.id" class="config-row" style="padding: 8px; background: var(--bg-tertiary); border-radius: var(--radius-sm); margin-bottom: 6px;">
            <span class="config-label">{{ agents.find(a => a.id === s.agentId)?.avatar }} {{ agents.find(a => a.id === s.agentId)?.name }}</span>
            <span class="config-value" style="font-size: 11px;">{{ s.messages.length }} msgs · 🪙 {{ formatTokens(s.totalTokensUsed) }}</span>
          </div>
        </div>
        <!-- Usage bar -->
        <div class="usage-bar-section">
          <label class="form-label">Context Usage</label>
          <div class="usage-bar-track">
            <div
              class="usage-bar-fill"
              :style="{
                width: Math.min(100, (agent.usage.contextTokensUsed / agent.usage.maxContextTokens) * 100) + '%',
                background: (agent.usage.contextTokensUsed / agent.usage.maxContextTokens) > 0.8 ? 'var(--accent-red)' : 'var(--accent-blue)'
              }"
            ></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
            <span>{{ formatTokens(agent.usage.contextTokensUsed) }}</span>
            <span>{{ formatTokens(agent.usage.maxContextTokens) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
function formatOutput(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="output-code"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="output-inline">$1</code>')
    .replace(/^## (.+)$/gm, '<h3 class="output-h2">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="output-h3">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<div class="output-li">• $1</div>')
    .replace(/^\d+\. (.+)$/gm, '<div class="output-li">$1</div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
}
</script>

<style scoped>
.session-chat {
  min-height: 200px;
  max-height: 400px;
}

.chat-message {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}

.chat-user {
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.15);
  margin-left: 24px;
}

.chat-assistant {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  margin-right: 24px;
}

.chat-system {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.15);
  font-size: 12px;
  color: var(--text-muted);
}

.chat-message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
}

.chat-role {
  font-weight: 600;
  color: var(--text-primary);
}

.chat-time {
  color: var(--text-muted);
}

.chat-tokens {
  color: var(--text-muted);
  font-size: 10px;
}

.chat-message-body {
  color: var(--text-secondary);
}

.chat-message-body :deep(pre) {
  background: var(--bg-primary);
  border-radius: 6px;
  padding: 10px;
  margin: 8px 0;
  overflow-x: auto;
  font-size: 12px;
}

.chat-message-body :deep(code) {
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.session-input-area {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  margin-top: 8px;
}

.session-input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
