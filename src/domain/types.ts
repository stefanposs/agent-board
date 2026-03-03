// ─── Domain Model ───────────────────────────────────────────────

/** Stage ID — configurable via board.yaml workflow section. */
export type TaskStage = string

export type AgentRole = 'planner' | 'developer' | 'reviewer' | 'devops' | 'architect'

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'blocked'

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

export type TaskType = 'feature' | 'bugfix' | 'docs' | 'infra' | 'research' | 'design' | 'ops' | 'other'

export type HumanAttentionType = 'approval' | 'feedback' | 'clarification' | 'review'

export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected'

export type PRStatus = 'none' | 'draft' | 'open' | 'changes_requested' | 'approved' | 'merged' | 'closed'

export interface PullRequest {
  number: number
  title: string
  url: string
  status: PRStatus
  additions: number
  deletions: number
  changedFiles: number
  checks: { passed: number; total: number }
}

export type LLMModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'claude-sonnet-4'
  | 'claude-opus-4'
  | 'gemini-2.0-flash'
  | 'gemini-2.5-pro'
  | 'o3'
  | 'o4-mini'

export interface AgentModelConfig {
  model: LLMModel
  maxContextTokens: number
  temperature: number
}

export interface AgentUsageStats {
  totalTokensUsed: number
  contextTokensUsed: number
  maxContextTokens: number
  requestCount: number
  estimatedCostUsd: number
}

export interface Agent {
  id: string
  name: string
  role: AgentRole
  avatar: string
  status: AgentStatus
  currentTaskId: string | null
  color: string
  modelConfig: AgentModelConfig
  usage: AgentUsageStats
  /** Technical skills this agent excels at, e.g. 'api-design', 'testing', 'database' */
  skills: string[]
  /** Programming languages this agent can work with, e.g. 'python', 'golang' */
  languages: string[]
}

export interface TaskEvent {
  id: string
  timestamp: number
  type: 'stage_change' | 'agent_action' | 'human_action' | 'comment' | 'approval'
  fromStage?: string
  toStage?: string
  agentId?: string
  message: string
}

export interface AgentQuestion {
  id: string
  agentId: string
  question: string
  timestamp: number
  answer?: string
  answeredAt?: number
  status: 'pending' | 'answered'
}

export interface Task {
  id: string
  title: string
  description: string
  stage: TaskStage
  priority: TaskPriority
  workspaceId: string
  assignedAgents: string[]
  approvalStatus: ApprovalStatus
  events: TaskEvent[]
  createdAt: number
  updatedAt: number
  tags: string[]
  taskType: TaskType
  progress: number // 0-100
  blockedReason?: string
  humanAttentionType?: HumanAttentionType
  /** Skills needed for this task, used for agent matching */
  requiredSkills?: string[]
  /** Questions agents have asked that need human answers */
  pendingQuestions?: AgentQuestion[]
  branch?: string
  pullRequest?: PullRequest
  comments: Comment[]
  metrics?: TaskMetrics
}

export interface Workspace {
  id: string
  name: string
  repo: string
  color: string
  icon: string
  localPath?: string
  branch?: string
  hasChanges?: boolean
}

export interface Organization {
  id: string
  name: string
  workspaces: Workspace[]
  agents: Agent[]
  tasks: Task[]
}

// ─── Comments ───────────────────────────────────────────────────

export interface Comment {
  id: string
  taskId: string
  content: string
  author: string          // 'user' or agentId
  timestamp: number
  replyToId?: string      // for threaded replies (future)
}

// ─── Task Metrics (KPI preparation) ─────────────────────────────

export interface TaskMetrics {
  createdAt: number
  stageEnteredAt: Record<string, number>
  completedAt?: number
  feedbackLoops: {
    devToPlanner: number
    reviewToDev: number
  }
}

// ─── Agent Decision (structured output from LLM) ───────────────

export type AgentDecisionAction =
  | 'implement'            // developer: proceed with implementation
  | 'needs-clarification'  // developer: send back to planner
  | 'move-to-review'       // developer: done, submit for review
  | 'approve'              // reviewer: approve and merge
  | 'request-changes'      // reviewer: send back to implementation
  | 'ready-for-implementation' // planner: planning done, move to implementation

export interface AgentDecision {
  action: AgentDecisionAction
  reason: string
  questions?: string[]     // for needs-clarification
  confidence: number       // 0-1
}

export const MAX_FEEDBACK_LOOPS = 3

// ─── Sessions ───────────────────────────────────────────────────

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  tokensUsed?: number
}

export interface Session {
  id: string
  taskId: string
  agentId: string
  messages: SessionMessage[]
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed' | 'error'
  totalTokensUsed: number
}

// ─── Stage Configuration ────────────────────────────────────────
// Stage config, transitions, and helpers are now in src/composables/useWorkflow.ts
// and are runtime-configurable via board.yaml workflow section.
// The types remain here for backward compatibility.

export interface StageConfig {
  id: string
  label: string
  icon: string
  color: string
  bgColor: string
  description: string
}

export interface Transition {
  from: string
  to: string
  trigger: 'agent' | 'human' | 'both'
  requiresApproval: boolean
  label: string
}
