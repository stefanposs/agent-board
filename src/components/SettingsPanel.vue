<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBoard } from '../composables/useBoard'
import { useExtension } from '../composables/useExtension'

const { workspaces, agents, isExtensionMode, removeWorkspace, addWorkspace, closeSettings } = useBoard()
const ext = useExtension()

const newPath = ref('')
const newAgentRepoPath = ref('')
const isScanning = ref(false)
const isScanningAgents = ref(false)
const isDetecting = ref(false)

// Extension mode: configured paths
const configuredPaths = computed(() => ext.settings.value.workspacePaths)
const configuredAgentRepoPaths = computed(() => ext.settings.value.agentRepoPaths)

// Agents: from extension in webview mode, from board in standalone mode
const displayAgents = computed(() => {
  if (ext.isWebview.value && ext.agentConfigs.value.length > 0) {
    return ext.agentConfigs.value
  }
  return agents.value.map((a: any) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    avatar: a.avatar,
    color: a.color,
    model: a.modelConfig?.model || '—',
    backend: a.backend as string | undefined,
  }))
})

async function addPath() {
  const trimmed = newPath.value.trim()
  if (!trimmed) return

  if (ext.isWebview.value) {
    ext.addWorkspacePath(trimmed)
    isScanning.value = true
    setTimeout(() => { isScanning.value = false }, 2000)
  } else {
    // Standalone mode: add a fake workspace for demo
    const id = `ws-${Date.now().toString(36)}`
    const name = trimmed.split('/').pop() || trimmed
    addWorkspace({
      id,
      name: name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      repo: name,
      color: COLORS[workspaces.value.length % COLORS.length],
      icon: ICONS[workspaces.value.length % ICONS.length],
      localPath: trimmed,
    })
  }
  newPath.value = ''
}

function removePath(path: string) {
  if (ext.isWebview.value) {
    ext.removeWorkspacePath(path)
  }
}

function rescan() {
  if (ext.isWebview.value) {
    isScanning.value = true
    ext.scanWorkspaces()
    setTimeout(() => { isScanning.value = false }, 2000)
  }
}

function addAgentRepo() {
  const trimmed = newAgentRepoPath.value.trim()
  if (!trimmed) return
  if (ext.isWebview.value) {
    ext.addAgentRepoPath(trimmed)
    isScanningAgents.value = true
    setTimeout(() => { isScanningAgents.value = false }, 2000)
  }
  newAgentRepoPath.value = ''
}

function removeAgentRepo(path: string) {
  if (ext.isWebview.value) {
    ext.removeAgentRepoPath(path)
  }
}

function rescanAgents() {
  if (ext.isWebview.value) {
    isScanningAgents.value = true
    ext.loadAgents()
    setTimeout(() => { isScanningAgents.value = false }, 2000)
  }
}

function openInVscode(localPath: string | undefined) {
  if (localPath && ext.isWebview.value) {
    ext.openFolder(localPath)
  }
}

function openTerminal(localPath: string | undefined) {
  if (localPath && ext.isWebview.value) {
    ext.openTerminal(localPath)
  }
}

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']
const ICONS = ['📦', '🔌', '🎨', '🏗️', '⚡', '🔧', '📱']

const backendDescriptions: Record<string, string> = {
  'copilot-lm': 'VS Code Language Model API — works with any Copilot model',
  'claude-cli': 'Claude Code CLI — full agentic coding with file access',
  'cline': 'Cline extension — delegates tasks to Cline\'s panel',
}

const backendBadgeMap: Record<string, string> = {
  'auto': '🔄 Auto',
  'copilot-lm': '🤖 Copilot',
  'claude-cli': '⌨️ CLI',
  'cline': '🔮 Cline',
}

function getBackendBadge(backendId: string): string {
  return backendBadgeMap[backendId] || backendId
}

function selectBackend(backendId: string) {
  if (ext.isWebview.value) {
    ext.setDefaultBackend(backendId)
  }
}

function refreshBackends() {
  if (ext.isWebview.value) {
    isDetecting.value = true
    ext.detectBackends()
    setTimeout(() => { isDetecting.value = false }, 1500)
  }
}

onMounted(() => {
  if (ext.isWebview.value) {
    ext.detectBackends()
  }
})
</script>

<template>
  <div class="detail-overlay" @click.self="closeSettings">
    <div class="settings-panel">
      <div class="create-modal-header">
        <h2 class="create-modal-title"><img src="/logo.png" alt="" class="modal-logo" /> Settings</h2>
        <button class="detail-close" @click="closeSettings">✕</button>
      </div>

      <div class="settings-body">
        <!-- Add path input -->
        <div class="form-group">
          <label class="form-label">Add Repos Folder</label>
          <div class="input-with-btn">
            <input
              v-model="newPath"
              class="form-input"
              type="text"
              placeholder="~/Repos or /Users/me/Projects"
              @keydown.enter="addPath"
            />
            <button class="btn btn-primary btn-sm" @click="addPath" :disabled="!newPath.trim()">
              Add
            </button>
          </div>
          <span class="form-hint">
            {{ isExtensionMode ? 'Path will be scanned for Git repositories' : 'Add a workspace path (demo mode)' }}
          </span>
        </div>

        <!-- Configured paths (extension mode) -->
        <div v-if="isExtensionMode && configuredPaths.length > 0" class="form-group">
          <label class="form-label">Configured Paths</label>
          <div v-for="p in configuredPaths" :key="p" class="path-row">
            <span class="path-text">{{ p }}</span>
            <button class="btn-icon-sm" @click="removePath(p)" title="Remove path">✕</button>
          </div>
        </div>

        <!-- Scan button -->
        <div v-if="isExtensionMode" class="form-group">
          <button class="btn btn-primary" @click="rescan" :disabled="isScanning">
            {{ isScanning ? '⏳ Scanning…' : '🔄 Rescan All Paths' }}
          </button>
        </div>

        <!-- Found workspaces -->
        <div class="form-group">
          <label class="form-label">
            Workspaces ({{ workspaces.length }})
          </label>
          <div v-if="workspaces.length === 0" class="empty-state">
            No workspaces found. Add a repos folder above.
          </div>
          <div v-for="ws in workspaces" :key="ws.id" class="ws-row">
            <div class="ws-row-icon" :style="{ background: ws.color + '20', color: ws.color }">
              {{ ws.icon }}
            </div>
            <div class="ws-row-info">
              <span class="ws-row-name">{{ ws.name }}</span>
              <span class="ws-row-repo">{{ ws.repo }}</span>
              <div v-if="ws.localPath" class="ws-row-path">{{ ws.localPath }}</div>
              <div v-if="ws.branch" class="ws-row-meta">
                <span class="ws-branch">🌿 {{ ws.branch }}</span>
                <span v-if="ws.hasChanges" class="ws-dirty">● modified</span>
              </div>
            </div>
            <div class="ws-row-actions">
              <button v-if="ws.localPath && isExtensionMode" class="btn-icon-sm" @click="openInVscode(ws.localPath)" title="Open in VS Code">📂</button>
              <button v-if="ws.localPath && isExtensionMode" class="btn-icon-sm" @click="openTerminal(ws.localPath)" title="Open terminal">💻</button>
              <button class="btn-icon-sm btn-danger-sm" @click="removeWorkspace(ws.id)" title="Remove">✕</button>
            </div>
          </div>
        </div>

        <!-- ─── Agent Backend ───────────────────────────────────── -->
        <hr style="border-color: var(--border-color); margin: 20px 0;" />
        <h3 style="font-size: 14px; margin-bottom: 12px;">🔌 Agent Backend</h3>

        <div class="form-group">
          <label class="form-label">Default Backend</label>
          <div class="backend-cards">
            <button
              class="backend-card"
              :class="{ selected: ext.defaultBackend.value === 'auto' }"
              @click="selectBackend('auto')"
            >
              <span class="backend-icon">🔄</span>
              <span class="backend-name">Auto</span>
              <span class="backend-desc">Best available</span>
            </button>
            <button
              v-for="b in ext.availableBackends.value"
              :key="b.id"
              class="backend-card"
              :class="{ selected: ext.defaultBackend.value === b.id, unavailable: !b.available }"
              @click="selectBackend(b.id)"
            >
              <span class="backend-icon">{{ b.icon }}</span>
              <span class="backend-name">{{ b.label }}</span>
              <span class="backend-status" :class="b.available ? 'status-ok' : 'status-missing'">
                {{ b.available ? '● available' : '○ not found' }}
              </span>
              <span class="backend-desc">{{ backendDescriptions[b.id] || '' }}</span>
            </button>
          </div>
          <span class="form-hint">
            Auto mode picks the best available backend for each agent role.
          </span>
          <button class="btn btn-sm" style="margin-top: 8px;" @click="refreshBackends" :disabled="isDetecting">
            {{ isDetecting ? '⏳ Detecting…' : '🔍 Re-detect' }}
          </button>
        </div>

        <!-- ─── Agent Sources ───────────────────────────────────── -->
        <hr style="border-color: var(--border-color); margin: 20px 0;" />
        <h3 style="font-size: 14px; margin-bottom: 12px;">🤖 Agent Sources</h3>

        <!-- Add agent repo path input -->
        <div class="form-group">
          <label class="form-label">Add Agent Repo</label>
          <div class="input-with-btn">
            <input
              v-model="newAgentRepoPath"
              class="form-input"
              type="text"
              placeholder="~/Repos/ai-agents"
              @keydown.enter="addAgentRepo"
            />
            <button class="btn btn-primary btn-sm" @click="addAgentRepo" :disabled="!newAgentRepoPath.trim()">
              Add
            </button>
          </div>
          <span class="form-hint">
            Scans skills/*/SKILL.md and agents/*.agent.md
          </span>
        </div>

        <!-- Configured agent repo paths -->
        <div v-if="isExtensionMode && configuredAgentRepoPaths.length > 0" class="form-group">
          <label class="form-label">Configured Agent Repos</label>
          <div v-for="p in configuredAgentRepoPaths" :key="p" class="path-row">
            <span class="path-text">{{ p }}</span>
            <button class="btn-icon-sm" @click="removeAgentRepo(p)" title="Remove path">✕</button>
          </div>
        </div>

        <!-- Rescan agents button -->
        <div v-if="isExtensionMode" class="form-group">
          <button class="btn btn-primary" @click="rescanAgents" :disabled="isScanningAgents">
            {{ isScanningAgents ? '⏳ Scanning…' : '🔄 Rescan Agents' }}
          </button>
        </div>

        <!-- Found agents list -->
        <div class="form-group">
          <label class="form-label">
            Agents ({{ displayAgents.length }})
          </label>
          <div v-if="displayAgents.length === 0" class="empty-state">
            No agents loaded. Add an agent repo above.
          </div>
          <div v-for="agent in displayAgents" :key="agent.id" class="ws-row">
            <div class="ws-row-icon" :style="{ background: agent.color + '20', color: agent.color }">
              {{ agent.avatar }}
            </div>
            <div class="ws-row-info">
              <span class="ws-row-name">{{ agent.name }}</span>
              <span class="ws-row-repo">{{ agent.role }} · {{ agent.model || '—' }}</span>
            </div>
            <div class="agent-backend-badge" v-if="ext.availableBackends.value.length > 0">
              <span class="backend-badge" :title="'Backend: ' + (agent.backend || ext.defaultBackend.value)">
                {{ getBackendBadge(agent.backend || ext.defaultBackend.value) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
