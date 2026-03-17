import { ref, readonly } from 'vue'

// ─── Types (mirror ext/protocol.ts) ─────────────────────────────

export interface ScannedWorkspace {
  id: string
  name: string
  localPath: string
  repo: string
  branch: string
  hasChanges: boolean
  icon: string
  color: string
}

export interface AgentConfig {
  id: string
  name: string
  role: string
  avatar: string
  color: string
  model: string
  temperature: number
  maxContextTokens: number
  systemPrompt: string
  backend?: string
}

export interface LLMModelInfo {
  id: string
  name: string
  vendor: string
  family: string
  maxInputTokens: number
}

export interface BackendInfo {
  id: string
  label: string
  icon: string
  available: boolean
  detail?: string
}

interface ExtensionMessage {
  type: string
  [key: string]: any
}

// ─── VS Code API bridge ────────────────────────────────────────

const _isWebview = typeof acquireVsCodeApi === 'function'
let _api: ReturnType<typeof acquireVsCodeApi> | null = null

function api() {
  if (!_api && _isWebview) _api = acquireVsCodeApi()
  return _api
}

// ─── Reactive state ─────────────────────────────────────────────

const isWebview = ref(_isWebview)
const connected = ref(false)
const scannedWorkspaces = ref<ScannedWorkspace[]>([])
const agentConfigs = ref<AgentConfig[]>([])
const availableModels = ref<LLMModelInfo[]>([])
const availableBackends = ref<BackendInfo[]>([])
const defaultBackend = ref<string>('auto')
const settings = ref<{ workspacePaths: string[]; agentConfigPath: string; agentRepoPaths: string[] }>({
  workspacePaths: [],
  agentConfigPath: '',
  agentRepoPaths: [],
})

// ─── Custom event bus ───────────────────────────────────────────

type Handler = (msg: ExtensionMessage) => void
const handlers = new Map<string, Handler[]>()

// ─── Listen for messages from extension host ────────────────────

if (_isWebview) {
  window.addEventListener('message', (event) => {
    const msg = event.data as ExtensionMessage

    switch (msg.type) {
      case 'init':
        scannedWorkspaces.value = msg.data.workspaces
        agentConfigs.value = msg.data.agents
        availableModels.value = msg.data.models
        settings.value = msg.data.settings
        if (msg.data.backends) availableBackends.value = msg.data.backends
        if (msg.data.defaultBackend) defaultBackend.value = msg.data.defaultBackend
        connected.value = true
        break
      case 'workspaces-updated':
        scannedWorkspaces.value = msg.workspaces
        break
      case 'agents-loaded':
        agentConfigs.value = msg.agents
        break
      case 'llm-models':
        availableModels.value = msg.models
        break
      case 'settings-updated':
        settings.value = msg.settings
        break
      case 'backends-detected':
        availableBackends.value = msg.backends
        break
    }

    handlers.get(msg.type)?.forEach((h) => h(msg))
  })
}

// ─── Composable ─────────────────────────────────────────────────

export function useExtension() {
  function post(msg: any) {
    api()?.postMessage(msg)
  }

  function sendReady() {
    post({ type: 'ready' })
  }

  function scanWorkspaces() {
    post({ type: 'scan-workspaces' })
  }

  function addWorkspacePath(path: string) {
    post({ type: 'add-workspace-path', path })
  }

  function removeWorkspacePath(path: string) {
    post({ type: 'remove-workspace-path', path })
  }

  function addAgentRepoPath(path: string) {
    post({ type: 'add-agent-repo-path', path })
  }

  function removeAgentRepoPath(path: string) {
    post({ type: 'remove-agent-repo-path', path })
  }

  function loadAgents() {
    post({ type: 'load-agents' })
  }

  function runAgent(agentId: string, taskId: string, prompt: string, sessionMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, workspacePath?: string, branch?: string) {
    post({ type: 'run-agent', agentId, taskId, prompt, sessionMessages, workspacePath, branch })
  }

  function stopAgent(agentId: string) {
    post({ type: 'stop-agent', agentId })
  }

  function getModels() {
    post({ type: 'get-llm-models' })
  }

  function openFile(filePath: string) {
    post({ type: 'open-file', filePath })
  }

  function openFolder(path: string) {
    post({ type: 'open-folder', path })
  }

  function openTerminal(path: string) {
    post({ type: 'open-terminal', path })
  }

  function createBranch(taskId: string, workspacePath: string, branchName: string) {
    post({ type: 'create-branch', taskId, workspacePath, branchName })
  }

  function saveState(tasks: any[], sessions: any[]) {
    post({ type: 'save-state', tasks, sessions })
  }

  function deleteTask(taskId: string) {
    post({ type: 'delete-task', taskId })
  }

  function saveGoals(goals: any[]) {
    post({ type: 'save-goals', goals })
  }

  function loadState() {
    post({ type: 'load-state' })
  }

  function generateReport(tasks: any[], goals: any[], prompt?: string) {
    post({ type: 'generate-report', tasks, goals, prompt })
  }

  function dismissSplash() {
    post({ type: 'dismiss-splash' })
  }

  function detectBackends() {
    post({ type: 'detect-backends' })
  }

  function setDefaultBackend(backendId: string) {
    defaultBackend.value = backendId
    post({ type: 'set-default-backend', backendId })
  }

  function setAgentBackend(agentId: string, backendId: string) {
    post({ type: 'set-agent-backend', agentId, backendId })
  }

  function setBoardType(boardType: string) {
    post({ type: 'set-board-type', boardType })
  }

  /** Register a handler for a specific message type. Returns unsubscribe fn. */
  function onMessage(type: string, handler: Handler): () => void {
    if (!handlers.has(type)) handlers.set(type, [])
    handlers.get(type)!.push(handler)
    return () => {
      const arr = handlers.get(type)
      if (arr) {
        const idx = arr.indexOf(handler)
        if (idx >= 0) arr.splice(idx, 1)
      }
    }
  }

  return {
    // State
    isWebview: readonly(isWebview),
    connected: readonly(connected),
    scannedWorkspaces: readonly(scannedWorkspaces),
    agentConfigs: readonly(agentConfigs),
    availableModels: readonly(availableModels),
    availableBackends: readonly(availableBackends),
    defaultBackend: readonly(defaultBackend),
    settings: readonly(settings),
    // Actions
    post,
    sendReady,
    scanWorkspaces,
    addWorkspacePath,
    removeWorkspacePath,
    addAgentRepoPath,
    removeAgentRepoPath,
    loadAgents,
    runAgent,
    stopAgent,
    getModels,
    openFile,
    openFolder,
    openTerminal,
    createBranch,
    saveState,
    deleteTask,
    saveGoals,
    loadState,
    generateReport,
    dismissSplash,
    detectBackends,
    setDefaultBackend,
    setAgentBackend,
    setBoardType,
    onMessage,
  }
}
