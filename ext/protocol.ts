/**
 * Message protocol between Extension Host ↔ Webview.
 * Shared type definitions for type-safe postMessage communication.
 */

// ─── Shared session types (mirrored in domain/types.ts) ────────

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  tokensUsed?: number
}

export interface SessionData {
  id: string
  taskId: string
  agentId: string
  messages: SessionMessage[]
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed' | 'error'
  totalTokensUsed: number
}

export type CommentType = 'comment' | 'note' | 'meeting-note' | 'question' | 'decision'

export interface CommentData {
  id: string
  taskId: string
  content: string
  author: string
  timestamp: number
  replyToId?: string
  type?: CommentType
  editedAt?: number
  pinned?: boolean
}

export interface TaskMetricsData {
  createdAt: number
  stageEnteredAt: Record<string, number>
  completedAt?: number
  feedbackLoops?: {
    devToPlanner: number
    reviewToDev: number
  }
}

export interface TaskEventData {
  id: string
  timestamp: number
  type: 'stage_change' | 'agent_action' | 'human_action' | 'comment' | 'approval' | 'decision' | 'agent_discussion'
  fromStage?: string
  toStage?: string
  agentId?: string
  message: string
}

export interface PullRequestData {
  number: number
  title: string
  url: string
  status: string
  additions: number
  deletions: number
  changedFiles: number
  checks: { passed: number; total: number }
}

export interface AgentQuestionData {
  id: string
  agentId: string
  question: string
  timestamp: number
  answer?: string
  answeredAt?: number
  status: 'pending' | 'answered'
}

export interface PendingDecisionData {
  id: string
  agentId: string
  timestamp: number
  decision: { action: string; reasoning: string; details?: string }
  status: 'pending' | 'approved' | 'rejected'
  humanFeedback?: string
  resolvedAt?: number
}

export interface AgentMessageData {
  id: string
  fromAgentId: string
  toAgentId: string
  content: string
  timestamp: number
  type: 'question' | 'answer' | 'suggestion' | 'handoff'
}

export interface TaskData {
  id: string
  title: string
  description: string
  stage: string
  taskType?: string
  workspaceId: string
  /** Primary responsible agent ID */
  assignee?: string | null
  /** When true, only the assigned agent may pick up this task */
  manuallyAssigned?: boolean
  assignedAgents: string[]
  approvalStatus: string
  events: TaskEventData[]
  createdAt: number
  updatedAt: number
  tags: string[]
  progress: number
  blockedReason?: string
  humanAttentionType?: string
  requiredSkills?: string[]
  pendingQuestions?: AgentQuestionData[]
  pendingDecision?: PendingDecisionData
  agentMessages?: AgentMessageData[]
  branch?: string
  pullRequest?: PullRequestData
  comments?: CommentData[]
  metrics?: TaskMetricsData
  goalIds?: string[]
  outputPath?: string
}

export interface GoalData {
  id: string
  title: string
  description?: string
  owner?: string
  deadline?: number
  taskIds: string[]
  createdAt: number
  updatedAt: number
}

// ─── File-write helpers ─────────────────────────────────────────

export interface FileWrite {
  path: string   // relative to workspace root
  content: string
}

// ─── Webview → Extension Host ───────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'scan-workspaces' }
  | { type: 'add-workspace-path'; path: string }
  | { type: 'remove-workspace-path'; path: string }
  | { type: 'load-agents' }
  | { type: 'run-agent'; agentId: string; taskId: string; prompt: string; sessionMessages?: SessionMessage[]; workspacePath?: string; branch?: string }
  | { type: 'stop-agent'; agentId: string }
  | { type: 'get-llm-models' }
  | { type: 'open-file'; filePath: string }
  | { type: 'open-folder'; path: string }
  | { type: 'open-terminal'; path: string }
  | { type: 'save-settings'; settings: Partial<BoardSettingsDto> }
  | { type: 'add-agent-repo-path'; path: string }
  | { type: 'remove-agent-repo-path'; path: string }
  | { type: 'create-branch'; taskId: string; workspacePath: string; branchName: string }
  | { type: 'save-state'; tasks: TaskData[]; sessions: SessionData[] }
  | { type: 'save-goals'; goals: GoalData[] }
  | { type: 'load-state' }
  | { type: 'generate-report'; tasks: TaskData[]; goals: GoalData[]; prompt?: string }
  | { type: 'dismiss-splash' }
  | { type: 'detect-backends' }
  | { type: 'set-default-backend'; backendId: string }
  | { type: 'set-agent-backend'; agentId: string; backendId: string }
  | { type: 'confirm-decision'; taskId: string; decisionId: string; approved: boolean; feedback?: string }
  | { type: 'show-notification'; title: string; body: string; severity: 'info' | 'warning' | 'error' }
  | { type: 'set-board-type'; boardType: string }
  | { type: 'webview-log'; message: string }
  | { type: 'delete-task'; taskId: string }

export interface BoardSettingsDto {
  workspacePaths: string[]
  agentConfigPath: string
  agentRepoPaths: string[]
  boardType?: string
  workflow?: WorkflowConfig
  showSplashOnStart?: boolean
}

// ─── Configurable Workflow (State Machine) ──────────────────────

/** Side-effects executed when a transition fires. */
export type TransitionEffect =
  | 'set-approval-pending'
  | 'set-approved'
  | 'mark-complete'
  | 'reset-approval'
  | 'reduce-progress'

export interface StageConfigDto {
  id: string
  label: string
  icon: string
  color: string
  bgColor?: string
  description?: string
  /** First stage — new tasks start here, "+" button shown. */
  isFirst?: boolean
  /** Final stage — no outgoing transitions, marks task complete. */
  isFinal?: boolean
}

export interface TransitionDto {
  from: string
  to: string
  trigger: 'agent' | 'human' | 'both'
  requiresApproval?: boolean
  label: string
  effects?: TransitionEffect[]
}

export interface AgentStageMapping {
  role: string
  stages: string[]
  promptTemplate?: string
}

export interface WorkflowConfig {
  stages: StageConfigDto[]
  transitions: TransitionDto[]
  agentStageMappings?: AgentStageMapping[]
}

// ─── Default Workflow (5-stage dev pipeline) ───────────────────

export const DEFAULT_WORKFLOW: WorkflowConfig = {
  stages: [
    { id: 'idea', label: 'Idea', icon: '💡', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.08)', description: 'New ideas and feature requests', isFirst: true },
    { id: 'planning', label: 'Planning', icon: '📋', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.08)', description: 'Architecture & task breakdown' },
    { id: 'implementation', label: 'Implementation', icon: '⚙️', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.08)', description: 'Active development' },
    { id: 'review', label: 'Review', icon: '🔍', color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.08)', description: 'Code review & QA' },
    { id: 'merge', label: 'Merged', icon: '✅', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.08)', description: 'Completed & merged', isFinal: true },
  ],
  transitions: [
    { from: 'idea', to: 'planning', trigger: 'both', label: 'Start Planning' },
    { from: 'planning', to: 'implementation', trigger: 'both', label: 'Begin Implementation' },
    { from: 'implementation', to: 'review', trigger: 'both', label: 'Submit for Review' },
    { from: 'implementation', to: 'planning', trigger: 'both', label: 'Needs Clarification' },
    { from: 'review', to: 'merge', trigger: 'human', requiresApproval: true, label: 'Approve & Merge', effects: ['set-approved', 'mark-complete'] },
    { from: 'review', to: 'implementation', trigger: 'both', label: 'Request Changes', effects: ['reset-approval', 'reduce-progress'] },
    { from: 'planning', to: 'idea', trigger: 'human', label: 'Back to Idea' },
  ],
  agentStageMappings: [
    { role: 'planner', stages: ['idea', 'planning'] },
    { role: 'architect', stages: ['planning'] },
    { role: 'developer', stages: ['planning', 'implementation'] },
    { role: 'reviewer', stages: ['review'] },
    { role: 'devops', stages: ['implementation'] },
  ],
}

// ─── Task Board Workflow (3-stage kanban) ──────────────────────

export const TASK_BOARD_WORKFLOW: WorkflowConfig = {
  stages: [
    { id: 'todo', label: 'To Do', icon: '📝', color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.08)', description: 'Tasks to be done', isFirst: true },
    { id: 'in-progress', label: 'In Progress', icon: '🔧', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.08)', description: 'Currently being worked on' },
    { id: 'done', label: 'Done', icon: '✅', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.08)', description: 'Completed tasks', isFinal: true },
  ],
  transitions: [
    { from: 'todo', to: 'in-progress', trigger: 'both', label: 'Start Work' },
    { from: 'in-progress', to: 'done', trigger: 'both', label: 'Complete', effects: ['mark-complete'] },
    { from: 'in-progress', to: 'todo', trigger: 'both', label: 'Move Back' },
    { from: 'done', to: 'todo', trigger: 'human', label: 'Reopen' },
  ],
  agentStageMappings: [
    { role: 'planner', stages: ['todo', 'in-progress'] },
    { role: 'architect', stages: ['todo', 'in-progress'] },
    { role: 'developer', stages: ['todo', 'in-progress'] },
    { role: 'reviewer', stages: ['in-progress'] },
    { role: 'devops', stages: ['in-progress'] },
  ],
}

// ─── Board Type Presets ────────────────────────────────────────

export interface BoardTypePreset {
  label: string
  description: string
  icon: string
  workflow: WorkflowConfig
}

export const WORKFLOW_PRESETS: Record<string, BoardTypePreset> = {
  'software-engineering': {
    label: 'Software Engineering',
    description: 'Full dev pipeline: Idea → Planning → Implementation → Review → Merged',
    icon: '💻',
    workflow: DEFAULT_WORKFLOW,
  },
  'task-board': {
    label: 'Task Board',
    description: 'Simple kanban: To Do → In Progress → Done',
    icon: '📋',
    workflow: TASK_BOARD_WORKFLOW,
  },
}

// ─── Extension Host → Webview ───────────────────────────────────

export type ExtensionMessage =
  | { type: 'init'; data: InitData }
  | { type: 'workspaces-updated'; workspaces: ScannedWorkspace[] }
  | { type: 'agents-loaded'; agents: AgentConfig[] }
  | { type: 'agent-status'; agentId: string; status: string; taskId?: string; message?: string }
  | { type: 'agent-output'; agentId: string; content: string; tokensUsed?: number; taskId?: string }
  | { type: 'llm-models'; models: LLMModelInfo[] }
  | { type: 'error'; message: string; code?: string }
  | { type: 'notification'; message: string; level: 'info' | 'warning' | 'error' }
  | { type: 'settings-updated'; settings: BoardSettingsDto }
  | { type: 'branch-created'; taskId: string; branchName: string }
  | { type: 'branch-error'; taskId: string; message: string }
  | { type: 'files-written'; taskId: string; agentId: string; files: string[]; commitSha?: string; commitMessage?: string }
  | { type: 'files-write-error'; taskId: string; agentId: string; message: string }
  | { type: 'cli-agent-started'; taskId: string; agentId: string; command: string }
  | { type: 'cli-agent-done'; taskId: string; agentId: string; exitCode: number; commits: string[]; taskFilePath: string }
  | { type: 'state-loaded'; tasks: TaskData[]; sessions: SessionData[]; goals?: GoalData[] }
  | { type: 'goals-loaded'; goals: GoalData[] }
  | { type: 'state-saved' }
  | { type: 'report-generated'; content: string }
  | { type: 'backends-detected'; backends: BackendInfo[] }
  | { type: 'notification-action'; action: string; taskId?: string }

export interface InitData {
  workspaces: ScannedWorkspace[]
  agents: AgentConfig[]
  models: LLMModelInfo[]
  settings: BoardSettingsDto
  persistedTasks: TaskData[]
  persistedSessions: SessionData[]
  persistedGoals: GoalData[]
  backends: BackendInfo[]
  defaultBackend: string
  workflow: WorkflowConfig
  boardType: string
}

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

export type BackendId = 'copilot-lm' | 'claude-cli' | 'cline'

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
  /** Technical skills this agent excels at, e.g. 'api-design', 'testing', 'flutter' */
  skills?: string[]
  /** Programming languages this agent can work with, e.g. 'python', 'golang' */
  languages?: string[]
  executionMode?: 'cli' | 'llm-api'
  backend?: BackendId | 'auto'
}

export interface BackendInfo {
  id: BackendId
  label: string
  icon: string
  available: boolean
  detail?: string
}

export interface LLMModelInfo {
  id: string
  name: string
  vendor: string
  family: string
  maxInputTokens: number
}
