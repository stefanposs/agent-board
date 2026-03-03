# Agent Kanban Control Center — Implementation Plan

> **Goal**: Build a compelling visual POC/demo that proves the concept of a state-machine-based Kanban board where AI agents and humans collaborate on development tasks across multiple VS Code workspaces.

---

## Overall Status: ⬜ Not Started

## Decision Record

```
Decision: POC Tech Stack
Date: 2026-03-01
Context: Need a fast, interactive demo that's easy to share and visually impressive
Options:
  1. Single HTML file (simplest deployment, hardest to maintain)
  2. Vite + Vue 3 + TypeScript + Tailwind CSS (modern, type-safe, fast HMR)
  3. Vite + React + TypeScript (larger ecosystem, but Vue is lighter for POC)
Choice: Vite + Vue 3 + TypeScript + Tailwind CSS
Reasoning:
  - Vue 3 Composition API is concise for POC-level components
  - TypeScript enforces the domain model at compile time
  - Tailwind CSS enables rapid, consistent styling without CSS files
  - Vite provides instant HMR for fast iteration
  - Single `npm run dev` to demo, `npm run build` for static deploy
Consequences:
  - Requires Node.js 18+ to run
  - More files than single-HTML approach, but far more maintainable
  - Enables clean separation of domain model, state machine, and UI
```

---

## 1. Domain Model (TypeScript Interfaces)

### Bounded Contexts

| Context | Responsibility | Key Aggregates |
|---------|---------------|----------------|
| **Workspace** | Multi-repo project organization | Organization, Project, Workspace |
| **Board** | Kanban visualization and task flow | Board, Column, Task |
| **Agent** | AI agent lifecycle and capabilities | Agent, AgentAction, AgentCapability |
| **Workflow** | State machine, policies, transitions | TaskState, Transition, Policy |

### Core Entities

```typescript
// === Workspace Context ===

interface Organization {
  id: string
  name: string
  avatarUrl: string
  projects: Project[]
}

interface Project {
  id: string
  name: string
  description: string
  repoUrl: string
  workspaces: Workspace[]
}

interface Workspace {
  id: string
  name: string               // e.g., "frontend", "backend", "infra"
  path: string               // local path or repo reference
  projectId: string
  color: string              // visual identifier for multi-workspace view
  icon: string               // emoji or icon identifier
  status: 'active' | 'archived'
}

// === Board Context ===

interface Board {
  id: string
  name: string
  organizationId: string
  columns: Column[]
  tasks: Task[]
}

interface Column {
  id: string
  name: string
  state: TaskState           // maps to state machine state
  order: number
  wipLimit?: number          // optional WIP limit
  color: string
}

interface Task {
  id: string
  title: string
  description: string
  workspaceId: string        // which workspace this belongs to
  state: TaskState
  priority: Priority
  labels: Label[]
  assignedAgents: AgentAssignment[]
  humanAssignee?: string
  createdAt: string
  updatedAt: string
  stateHistory: StateTransitionRecord[]
  subtasks: Subtask[]
  linkedPRs: PullRequestRef[]
  estimatedEffort: TShirtSize
  blockedBy?: string[]       // task IDs
  approvalRequired: boolean
  approvalStatus?: ApprovalStatus
}

interface Subtask {
  id: string
  title: string
  completed: boolean
}

interface Label {
  name: string
  color: string
}

interface PullRequestRef {
  number: number
  url: string
  status: 'open' | 'merged' | 'closed'
  title: string
}

interface StateTransitionRecord {
  from: TaskState
  to: TaskState
  triggeredBy: string        // agent ID or 'human'
  timestamp: string
  reason?: string
}

// === Agent Context ===

interface Agent {
  id: string
  name: string               // e.g., "Architect Agent", "Code Review Agent"
  type: AgentType
  avatar: string             // emoji or image URL
  color: string
  capabilities: AgentCapability[]
  status: AgentStatus
  currentTaskId?: string
  metadata: Record<string, string>
}

interface AgentAssignment {
  agentId: string
  role: AgentRole            // what the agent does on this task
  assignedAt: string
  status: 'idle' | 'working' | 'completed' | 'failed'
}

interface AgentAction {
  id: string
  agentId: string
  taskId: string
  type: AgentActionType
  description: string
  timestamp: string
  durationMs?: number
  result?: 'success' | 'failure'
  details?: string
}

// === Enums & Value Objects ===

type TaskState = 
  | 'idea'
  | 'planning'
  | 'ready'
  | 'implementation'
  | 'review'
  | 'approved'
  | 'merge'
  | 'done'
  | 'blocked'

type Priority = 'critical' | 'high' | 'medium' | 'low'

type TShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL'

type AgentType =
  | 'architect'
  | 'implementer'
  | 'reviewer'
  | 'tester'
  | 'orchestrator'
  | 'deployer'

type AgentRole =
  | 'planning'
  | 'coding'
  | 'reviewing'
  | 'testing'
  | 'deploying'
  | 'orchestrating'

type AgentStatus = 'idle' | 'busy' | 'offline' | 'error'

type AgentCapability =
  | 'code-generation'
  | 'code-review'
  | 'architecture-design'
  | 'test-generation'
  | 'deployment'
  | 'refactoring'
  | 'documentation'

type AgentActionType =
  | 'state-transition'
  | 'code-generated'
  | 'pr-created'
  | 'review-submitted'
  | 'test-run'
  | 'approval-requested'
  | 'conflict-detected'

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes-requested'
```

---

## 2. State Machine Definition

### State Diagram

```
                    ┌─────────────┐
                    │    IDEA      │
                    └──────┬──────┘
                           │ promote (human/orchestrator)
                    ┌──────▼──────┐
            ┌───────│  PLANNING    │
            │       └──────┬──────┘
            │              │ plan-complete (architect agent)
            │       ┌──────▼──────┐
            │       │    READY     │
            │       └──────┬──────┘
            │              │ start-work (implementer agent)
            │       ┌──────▼──────┐
     ┌──────┼───────│IMPLEMENTATION│◄──────────────────┐
     │      │       └──────┬──────┘                    │
     │      │              │ submit-for-review          │
     │      │       ┌──────▼──────┐                    │
     │      │       │   REVIEW     │───────────────────┘
     │      │       └──────┬──────┘  review-failed (feedback loop)
     │      │              │ review-passed
     │      │       ┌──────▼──────┐
     │      │       │  APPROVED    │
     │      │       └──────┬──────┘
     │      │              │ merge (human approval gate)
     │      │       ┌──────▼──────┐
     │      │       │    MERGE     │
     │      │       └──────┬──────┘
     │      │              │ deploy-complete
     │      │       ┌──────▼──────┐
     │      │       │    DONE      │
     │      │       └─────────────┘
     │      │
     │      │       ┌─────────────┐
     └──────┴──────►│  BLOCKED     │──── unblock ────► (previous state)
                    └─────────────┘
```

### Transition Table

| From | To | Trigger | Guard (Policy) | Actor |
|------|----|---------|-----------------|-------|
| `idea` | `planning` | `promote` | — | Human / Orchestrator |
| `planning` | `ready` | `plan-complete` | Has description + subtasks | Architect Agent |
| `ready` | `implementation` | `start-work` | Agent available | Implementer Agent |
| `implementation` | `review` | `submit-for-review` | Has linked PR | Implementer Agent |
| `review` | `approved` | `review-passed` | All checks pass | Reviewer Agent |
| `review` | `implementation` | `review-failed` | — | Reviewer Agent (**feedback loop**) |
| `approved` | `merge` | `merge` | Human approval ✓ | Human (**approval gate**) |
| `merge` | `done` | `deploy-complete` | CI/CD passed | Deployer Agent |
| `*` | `blocked` | `block` | — | Any |
| `blocked` | `(previous)` | `unblock` | Blocker resolved | Human |

### Policies

| Policy | Description |
|--------|-------------|
| **WIP Limit** | Max tasks in Implementation/Review columns |
| **Approval Gate** | `approved` → `merge` requires human click |
| **Feedback Loop** | Failed reviews return to Implementation with comments |
| **Auto-Assignment** | Agents auto-assigned when task enters their stage |
| **Blocked Escalation** | Tasks blocked > 24h trigger notification |

---

## 3. Component Breakdown

### Layout Components

| Component | Description | Props |
|-----------|-------------|-------|
| `AppShell` | Top-level layout: sidebar + header + main | — |
| `Sidebar` | Workspace selector, org/project tree, filters | `workspaces`, `activeWorkspaceId` |
| `Header` | Board title, agent status strip, global actions | `boardName`, `agents` |
| `MainContent` | Board area with columns | `board` |

### Board Components

| Component | Description | Props |
|-----------|-------------|-------|
| `KanbanBoard` | Container for all columns, manages drag-drop | `columns`, `tasks` |
| `KanbanColumn` | Single column with header, task list, WIP indicator | `column`, `tasks`, `onDrop` |
| `ColumnHeader` | Column name, task count, WIP limit badge | `name`, `count`, `wipLimit` |
| `TaskCard` | Individual task card with workspace badge | `task`, `onDragStart` |
| `TaskCardCompact` | Minimized view for dense boards | `task` |

### Task Detail Components

| Component | Description | Props |
|-----------|-------------|-------|
| `TaskDetailPanel` | Slide-out panel with full task details | `task`, `onClose` |
| `TaskStateTimeline` | Visual history of state transitions | `stateHistory` |
| `SubtaskChecklist` | Subtask progress checklist | `subtasks`, `onToggle` |
| `ApprovalGate` | Human approval button with status | `approvalStatus`, `onApprove`, `onReject` |
| `LinkedPRList` | List of associated pull requests | `pullRequests` |

### Agent Components

| Component | Description | Props |
|-----------|-------------|-------|
| `AgentStatusBar` | Horizontal bar showing all agent statuses | `agents` |
| `AgentAvatar` | Agent icon with status indicator dot | `agent` |
| `AgentActivityFeed` | Live feed of agent actions | `actions` |
| `AgentActionToast` | Toast notification for agent actions | `action` |

### Workspace Components

| Component | Description | Props |
|-----------|-------------|-------|
| `WorkspaceTree` | Hierarchical org → project → workspace tree | `organization` |
| `WorkspaceBadge` | Small colored badge on task cards | `workspace` |
| `WorkspaceFilter` | Toggle workspace visibility on board | `workspaces`, `activeIds` |

### Overlay/Modal Components

| Component | Description | Props |
|-----------|-------------|-------|
| `CreateTaskModal` | Form to create a new task (Idea) | `workspaces`, `onSubmit` |
| `AgentDetailModal` | Full agent details and action history | `agent`, `actions` |
| `SimulationControls` | POC-only: controls to trigger simulated agent actions | `onSimulate` |

---

## 4. File Structure

```
agent-board/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── public/
│   └── favicon.svg
├── src/
│   ├── main.ts                          # App entry point
│   ├── App.vue                          # Root component (AppShell)
│   │
│   ├── domain/                          # 🏗 Domain Model (pure TypeScript)
│   │   ├── types.ts                     # All interfaces & type aliases
│   │   ├── state-machine.ts             # Task state machine transitions
│   │   ├── policies.ts                  # WIP limits, approval gates, etc.
│   │   └── events.ts                    # Domain events (Commands/Events)
│   │
│   ├── mock/                            # 📋 Mock Data for POC
│   │   ├── workspaces.ts               # Organizations, projects, workspaces
│   │   ├── tasks.ts                     # Sample tasks in various states
│   │   ├── agents.ts                    # Agent definitions
│   │   └── simulation.ts               # Timer-based agent action simulator
│   │
│   ├── composables/                     # 🔧 Vue Composables (state/logic)
│   │   ├── useBoard.ts                  # Board state management
│   │   ├── useStateMachine.ts           # State machine transitions
│   │   ├── useAgentSimulation.ts        # Simulated agent activity
│   │   ├── useDragDrop.ts              # Drag-and-drop logic
│   │   └── useTaskDetail.ts            # Task detail panel state
│   │
│   ├── components/                      # 🎨 UI Components
│   │   ├── layout/
│   │   │   ├── AppShell.vue
│   │   │   ├── Sidebar.vue
│   │   │   └── Header.vue
│   │   ├── board/
│   │   │   ├── KanbanBoard.vue
│   │   │   ├── KanbanColumn.vue
│   │   │   ├── ColumnHeader.vue
│   │   │   └── TaskCard.vue
│   │   ├── task/
│   │   │   ├── TaskDetailPanel.vue
│   │   │   ├── TaskStateTimeline.vue
│   │   │   ├── SubtaskChecklist.vue
│   │   │   ├── ApprovalGate.vue
│   │   │   └── LinkedPRList.vue
│   │   ├── agent/
│   │   │   ├── AgentStatusBar.vue
│   │   │   ├── AgentAvatar.vue
│   │   │   ├── AgentActivityFeed.vue
│   │   │   └── AgentActionToast.vue
│   │   ├── workspace/
│   │   │   ├── WorkspaceTree.vue
│   │   │   ├── WorkspaceBadge.vue
│   │   │   └── WorkspaceFilter.vue
│   │   └── simulation/
│   │       └── SimulationControls.vue
│   │
│   └── styles/
│       └── main.css                     # Tailwind imports + custom styles
│
└── README.md
```

---

## 5. Mock Data Structure

### Workspaces (3 repos, 1 org)

```typescript
const mockOrganization: Organization = {
  id: 'org-1',
  name: 'Acme Corp',
  avatarUrl: '/acme.svg',
  projects: [
    {
      id: 'proj-1',
      name: 'Customer Portal',
      description: 'Next-gen customer-facing portal',
      repoUrl: 'https://github.com/acme/customer-portal',
      workspaces: [
        { id: 'ws-1', name: 'Frontend', color: '#3B82F6', icon: '🎨', ... },
        { id: 'ws-2', name: 'Backend API', color: '#10B981', icon: '⚙️', ... },
      ]
    },
    {
      id: 'proj-2',
      name: 'Platform Infrastructure',
      description: 'Shared infra and tooling',
      repoUrl: 'https://github.com/acme/platform-infra',
      workspaces: [
        { id: 'ws-3', name: 'Terraform', color: '#8B5CF6', icon: '☁️', ... },
      ]
    }
  ]
}
```

### Tasks (12-15 spread across states)

| Task | Workspace | State | Agent | Notes |
|------|-----------|-------|-------|-------|
| "Add SSO login" | Frontend | `implementation` | Implementer | Has subtasks, linked PR |
| "Design API v2 schema" | Backend API | `planning` | Architect | Agent currently working |
| "Migrate to Postgres 16" | Backend API | `review` | Reviewer | Review in progress |
| "Update Terraform modules" | Terraform | `approved` | — | **Awaiting human merge approval** |
| "Fix checkout bug" | Frontend | `idea` | — | Just created |
| "Add rate limiting" | Backend API | `implementation` | Implementer | 60% subtasks done |
| "SSL cert rotation" | Terraform | `done` | — | Completed example |
| "Refactor auth middleware" | Backend API | `blocked` | — | Blocked by "Add SSO login" |
| "Dashboard redesign" | Frontend | `ready` | — | Ready to pick up |
| "Add health checks" | Backend API | `review` | Reviewer | **Review failed → feedback loop** |
| "Create staging env" | Terraform | `merge` | Deployer | Merging in progress |
| "Implement search" | Frontend | `planning` | Architect | Early planning |

### Agents (5 named agents)

| Agent | Type | Status | Current Task |
|-------|------|--------|--------------|
| 🏛️ Ada (Architect) | `architect` | `busy` | "Design API v2 schema" |
| 💻 Max (Implementer) | `implementer` | `busy` | "Add SSO login" |
| 🔍 Lex (Reviewer) | `reviewer` | `busy` | "Migrate to Postgres 16" |
| 🧪 Tess (Tester) | `tester` | `idle` | — |
| 🚀 Rio (Deployer) | `deployer` | `busy` | "Create staging env" |

---

## 6. Interaction Flows

### Flow 1: View the Board
1. User opens the app → sees full Kanban board with 8 columns
2. Tasks are color-coded by workspace (blue=Frontend, green=Backend, purple=Infra)
3. Agent status bar at top shows 5 agents with live status dots
4. Sidebar shows workspace tree with toggle filters

### Flow 2: Drag a Task Between Columns
1. User drags "Dashboard redesign" from **Ready** to **Implementation**
2. State machine validates the transition (✓ `ready` → `implementation`)
3. Task card updates with new state
4. After 2s, an agent auto-assigns (simulated) → toast appears: "💻 Max picked up 'Dashboard redesign'"
5. Agent avatar appears on the task card

### Flow 3: Agent Autonomously Moves a Task
1. Every 8-15s (random), the simulation engine triggers an agent action
2. Example: "🏛️ Ada completed planning for 'Design API v2 schema'"
3. Task slides from **Planning** → **Ready** with animation
4. Activity feed in sidebar updates with the action
5. Toast notification appears briefly

### Flow 4: Human Approval Gate
1. "Update Terraform modules" is in **Approved** column
2. Task card shows prominent "✅ Approve Merge" button
3. User clicks → confirmation dialog: "Approve merge for 'Update Terraform modules'?"
4. On confirm → task moves to **Merge** column
5. After 3s, deployer agent starts merge (simulated)

### Flow 5: Review Failure (Feedback Loop)
1. "Add health checks" is in **Review** column
2. Simulated: Reviewer finds issues → toast: "🔍 Lex requested changes on 'Add health checks'"
3. Task slides back from **Review** → **Implementation** with a visual "bounce-back" animation
4. Task card shows "Changes Requested" badge
5. State history in detail panel shows the round-trip

### Flow 6: Open Task Detail
1. User clicks any task card → detail panel slides in from the right
2. Shows: title, description, workspace badge, current state
3. State timeline visualization (dot timeline of all transitions)
4. Subtask checklist (toggleable)
5. Linked PRs with status
6. Agent assignment and action history
7. Approval controls (if in `approved` state)

### Flow 7: Filter by Workspace
1. User clicks workspace toggle in sidebar
2. Unchecks "Terraform" → all Terraform tasks fade out / hide
3. Board shows only Frontend + Backend tasks
4. Re-checking shows them again with fade-in

### Flow 8: Create New Task
1. User clicks "+ New Task" button in header
2. Modal appears: title, description, workspace selector, priority, labels
3. On submit → task appears in **Idea** column with entrance animation

---

## 7. Visual Design Guidelines

### Color Palette

| Role | Color | Hex |
|------|-------|-----|
| Primary / Accent | Indigo | `#6366F1` |
| Frontend workspace | Blue | `#3B82F6` |
| Backend workspace | Emerald | `#10B981` |
| Infra workspace | Violet | `#8B5CF6` |
| Success / Approved | Green | `#22C55E` |
| Warning / Blocked | Amber | `#F59E0B` |
| Error / Failed | Red | `#EF4444` |
| Background | Slate 50 | `#F8FAFC` |
| Card background | White | `#FFFFFF` |
| Column background | Slate 100 | `#F1F5F9` |
| Text primary | Slate 900 | `#0F172A` |
| Text secondary | Slate 500 | `#64748B` |

### Typography
- Headers: **Inter** or system font, semibold
- Body: system font stack, regular
- Monospace: **JetBrains Mono** for task IDs

### Card Design
- Rounded corners (`rounded-lg`)
- Subtle shadow (`shadow-sm`)
- Left border color = workspace color (4px)
- Hover: lift effect (`shadow-md`, slight translateY)
- Agent avatar(s) in bottom-right
- Priority dot in top-right

### Animations
- Task movement between columns: 300ms ease-out slide
- Agent action toast: slide-in from right, auto-dismiss 4s
- Approval button: pulse animation when actionable
- Feedback loop (review → implementation): red flash + slide-back
- Drag ghost: 0.8 opacity, slight rotation

---

## 8. Implementation Phases

### Phase 1: Foundation (Tasks 1.1–1.5)

| # | Task | Agent | Depends On | Status | Size |
|---|------|-------|------------|--------|------|
| 1.1 | Initialize Vite + Vue 3 + TS project | Developer | — | ⬜ | XS |
| 1.2 | Add Tailwind CSS + configure theme | Developer | 1.1 | ⬜ | XS |
| 1.3 | Create domain types (`types.ts`) | Developer | 1.1 | ⬜ | S |
| 1.4 | Implement state machine (`state-machine.ts`) | Developer | 1.3 | ⬜ | S |
| 1.5 | Create mock data (workspaces, tasks, agents) | Developer | 1.3 | ⬜ | S |

### Phase 2: Layout & Board (Tasks 2.1–2.5)

| # | Task | Agent | Depends On | Status | Size |
|---|------|-------|------------|--------|------|
| 2.1 | Build `AppShell` + `Header` + `Sidebar` layout | Developer | 1.2 | ⬜ | M |
| 2.2 | Build `KanbanBoard` + `KanbanColumn` | Developer | 2.1, 1.5 | ⬜ | M |
| 2.3 | Build `TaskCard` with workspace badge | Developer | 2.2 | ⬜ | M |
| 2.4 | Implement `useBoard` composable (state mgmt) | Developer | 1.4, 1.5 | ⬜ | M |
| 2.5 | Wire board → columns → cards data flow | Developer | 2.2, 2.3, 2.4 | ⬜ | S |

### Phase 3: Interactions (Tasks 3.1–3.5)

| # | Task | Agent | Depends On | Status | Size |
|---|------|-------|------------|--------|------|
| 3.1 | Implement drag-and-drop (`useDragDrop`) | Developer | 2.5 | ⬜ | M |
| 3.2 | Build `TaskDetailPanel` (slide-out) | Developer | 2.5 | ⬜ | M |
| 3.3 | Build `ApprovalGate` + approval flow | Developer | 3.2, 1.4 | ⬜ | S |
| 3.4 | Build `WorkspaceFilter` toggle | Developer | 2.1 | ⬜ | S |
| 3.5 | Build `CreateTaskModal` | Developer | 2.4 | ⬜ | S |

### Phase 4: Agent Simulation (Tasks 4.1–4.4)

| # | Task | Agent | Depends On | Status | Size |
|---|------|-------|------------|--------|------|
| 4.1 | Build agent simulation engine (`simulation.ts`) | Developer | 1.4, 1.5 | ⬜ | M |
| 4.2 | Build `AgentStatusBar` + `AgentAvatar` | Developer | 2.1 | ⬜ | S |
| 4.3 | Build `AgentActivityFeed` + `AgentActionToast` | Developer | 4.1 | ⬜ | M |
| 4.4 | Build `SimulationControls` (speed, trigger) | Developer | 4.1 | ⬜ | S |

### Phase 5: Polish (Tasks 5.1–5.4)

| # | Task | Agent | Depends On | Status | Size |
|---|------|-------|------------|--------|------|
| 5.1 | Add CSS animations (transitions, toasts, feedback loop) | Developer | 3.1, 4.3 | ⬜ | M |
| 5.2 | Build `TaskStateTimeline` visualization | Developer | 3.2 | ⬜ | S |
| 5.3 | Responsive adjustments + dark mode toggle | Developer | 5.1 | ⬜ | S |
| 5.4 | Final QA, fix visual bugs, optimize | Developer | 5.1, 5.2, 5.3 | ⬜ | S |

### Critical Path

```
1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 2.4 → 2.2 → 2.3 → 2.5 → 3.1 → 5.1
                                          ↘ 2.1 → 4.2 → 4.3
```

### Estimation Summary

| Phase | Tasks | Total Effort | Parallel? |
|-------|-------|-------------|-----------|
| Foundation | 5 | ~4h | Partially (1.3–1.5 after 1.1) |
| Layout & Board | 5 | ~8h | 2.1 parallel with 2.4 |
| Interactions | 5 | ~6h | 3.2 parallel with 3.4, 3.5 |
| Agent Simulation | 4 | ~5h | 4.1 parallel with 4.2 |
| Polish | 4 | ~4h | Sequential |
| **Total** | **23** | **~27h** | |

---

## 9. Key Technical Decisions

### State Machine Implementation

Use a pure-function transition table — no library needed for POC:

```typescript
type TransitionResult = 
  | { valid: true; newState: TaskState; sideEffects: SideEffect[] }
  | { valid: false; reason: string }

function transition(
  task: Task, 
  trigger: Trigger, 
  context: TransitionContext
): TransitionResult
```

### Drag-and-Drop

Native HTML5 Drag and Drop API (no library dependency):
- `draggable="true"` on TaskCard
- `dragstart` → set task ID in dataTransfer
- `dragover` → highlight target column
- `drop` → call `transition()` to validate, then update state

### Agent Simulation Engine

```typescript
// Simulation loop (runs every 8-15s with jitter)
function simulateAgentAction(board: Board, agents: Agent[]): AgentAction | null {
  // 1. Find tasks in states that agents can act on
  // 2. Pick a random eligible task
  // 3. Execute the transition
  // 4. Return the action for UI notification
}
```

### Reactivity

Vue 3 `reactive()` / `ref()` for all board state — no Vuex/Pinia needed for POC complexity level. Single `useBoard()` composable acts as the store.

---

## 10. Success Criteria for POC Demo

| Criteria | Measurement |
|----------|-------------|
| ✅ Board renders with 8 columns and 12+ tasks | Visual |
| ✅ Tasks color-coded by workspace (3 colors visible) | Visual |
| ✅ Drag-and-drop moves tasks between valid states | Manual test |
| ✅ Invalid transitions are rejected (e.g., idea → merge) | Manual test |
| ✅ Agent simulation moves tasks autonomously every ~10s | Time observation |
| ✅ Toast notifications appear for agent actions | Visual |
| ✅ Human approval gate works (click → task advances) | Manual test |
| ✅ Review failure sends task back to Implementation | Simulation |
| ✅ Task detail panel shows state history timeline | Click test |
| ✅ Workspace filter hides/shows tasks per workspace | Toggle test |
| ✅ New task creation works | Form test |
| ✅ UI is professional and demo-ready | Stakeholder impression |

---

## Appendix A: Future Extensions (Post-POC)

| Feature | Description | Complexity |
|---------|-------------|------------|
| GitHub Integration | Real Issues/Labels/PRs as persistence | L |
| VS Code Extension | Side panel with embedded webview | XL |
| Real Agent Integration | Connect to Copilot / Claude agents | XL |
| WebSocket Live Updates | Multi-user real-time board | M |
| Metrics Dashboard | Lead time, cycle time, throughput | M |
| Custom Workflows | User-defined state machines per project | L |
| Notifications | Slack/Teams integration for approvals | S |
| Role-Based Access | Different views for PM, Dev, Architect | M |
