# Domain Types Reference

Core domain types for the kanban board, tasks, and agent workflow.

## Source

All types are defined in [`src/domain/types.ts`](https://github.com/stefanposs/agent-board/blob/main/src/domain/types.ts).

## Stage

```typescript
type Stage = 'idea' | 'planning' | 'implementation' | 'review' | 'merge'
```

## Task

```typescript
interface Task {
  id: string
  title: string
  description?: string
  stage: Stage
  priority: 'low' | 'medium' | 'high' | 'critical'
  tags: string[]
  assignedAgents: string[]     // Agent IDs
  workspaceId: string          // Linked workspace
  branch?: string              // Git branch name
  createdAt: string            // ISO 8601
  updatedAt: string            // ISO 8601
  events: TaskEvent[]          // Activity history
  sessions: ChatSession[]      // Agent chat sessions
  comments: TaskComment[]      // Human comments
}
```

## TaskEvent

```typescript
interface TaskEvent {
  id: string
  type: 'stage_change' | 'agent_action' | 'comment' | 'assignment' | 'created'
  message: string
  timestamp: string
  agentId?: string
}
```

## ChatSession

```typescript
interface ChatSession {
  id: string
  agentId: string
  messages: SessionMessage[]
  startedAt: string
  endedAt?: string
}
```

## AgentDecision

```typescript
interface AgentDecision {
  decision: 'approve' | 'request_changes' | 'escalate'
  nextStage?: Stage
  comments: string
}
```

## StageTransition

```typescript
interface StageTransition {
  from: Stage
  to: Stage
  trigger: 'auto' | 'agent' | 'human'
  requiresApproval: boolean
}
```

## Transitions Table

```typescript
const TRANSITIONS: StageTransition[] = [
  { from: 'idea',           to: 'planning',        trigger: 'auto',  requiresApproval: false },
  { from: 'planning',       to: 'implementation',   trigger: 'agent', requiresApproval: false },
  { from: 'implementation', to: 'review',           trigger: 'agent', requiresApproval: false },
  { from: 'review',         to: 'implementation',   trigger: 'agent', requiresApproval: false },
  { from: 'review',         to: 'merge',            trigger: 'human', requiresApproval: true  },
]
```

## AgentRole

```typescript
type AgentRole = 'planner' | 'developer' | 'reviewer' | 'architect' | 'devops'
```

Roles determine which agent is triggered at each stage:

| Stage | Agent Role |
|-------|-----------|
| Planning | `planner` |
| Implementation | `developer` |
| Review | `reviewer` |
