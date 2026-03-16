// ─── Domain Model ───────────────────────────────────────────────

/** Stage ID — configurable via board.yaml workflow section. */
export type TaskStage = string

/** Agent role — standard roles plus any custom role loaded from agent repos. */
export type AgentRole = string

/** Well-known agent roles used for stage mappings and fallback routing. */
export const KNOWN_ROLES = ['planner', 'developer', 'reviewer', 'devops', 'architect'] as const
export type KnownRole = typeof KNOWN_ROLES[number]

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'blocked'

export type TaskType = 'feature' | 'bugfix' | 'docs' | 'infra' | 'research' | 'design' | 'ops' | 'other'

export type HumanAttentionType = 'approval' | 'feedback' | 'clarification' | 'review' | 'decision-confirmation' | 'escalation'

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
  /** Display name override for personality mode (e.g. 'Ada' instead of 'Architect') */
  displayName?: string
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
  type: 'stage_change' | 'agent_action' | 'human_action' | 'comment' | 'approval' | 'decision' | 'agent_discussion'
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

// ─── Goals ──────────────────────────────────────────────────────

export interface Goal {
  id: string
  title: string
  description?: string
  owner?: string
  deadline?: number
  taskIds: string[]
  createdAt: number
  updatedAt: number
}

export interface Task {
  id: string
  title: string
  description: string
  stage: TaskStage
  workspaceId: string
  /** Primary responsible agent — the agent currently owning this task */
  assignee?: string | null
  /** Historical list of all agents that have worked on this task */
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
  /** When true, only the assigned agent may pick up this task (manual assignment lock) */
  manuallyAssigned?: boolean
  /** Agent decision awaiting human confirmation (HITL gate) */
  pendingDecision?: PendingDecision
  /** Inter-agent discussion messages */
  agentMessages?: AgentMessage[]
  /** IDs of linked goals */
  goalIds?: string[]
  /** Where the agent should place output files (e.g. docs/concept.md). If empty, agent asks. */
  outputPath?: string
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

export type CommentType = 'comment' | 'note' | 'meeting-note' | 'question' | 'decision'

export interface Comment {
  id: string
  taskId: string
  content: string
  author: string          // 'user' or agentId
  timestamp: number
  replyToId?: string      // for threaded replies
  type?: CommentType      // default 'comment'
  editedAt?: number       // timestamp of last edit
  pinned?: boolean        // pinned to top
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
  | 'discuss'              // agent wants to discuss with another agent
  | 'ask-help'             // agent asks another agent for help (stays responsible)
  | 'escalate'             // agent needs human help (pauses work, HITL gate)

export interface AgentDecision {
  action: AgentDecisionAction
  reason: string
  questions?: string[]     // for needs-clarification
  confidence: number       // 0-1
  targetAgent?: string     // for 'discuss' action — which agent role to ask
}

export const MAX_FEEDBACK_LOOPS = 3

// ─── Human-in-the-Loop (HITL) ───────────────────────────────────

/** A pending agent decision awaiting human confirmation before execution. */
export interface PendingDecision {
  id: string
  decision: AgentDecision
  agentId: string
  taskId: string
  timestamp: number
  /** Summary context of what the agent did / proposes */
  context: string
  /** Proposed target stage (if decision would move the task) */
  proposedStage?: string
  /** Human response */
  status: 'pending' | 'approved' | 'rejected' | 'modified'
  humanFeedback?: string
}

// ─── Inter-Agent Discussion ─────────────────────────────────────

/** A message between two agents, visible to the human for oversight. */
export interface AgentMessage {
  id: string
  fromAgentId: string
  toAgentId: string
  taskId: string
  question: string
  answer?: string
  timestamp: number
  answeredAt?: number
  status: 'pending' | 'answered'
}

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
