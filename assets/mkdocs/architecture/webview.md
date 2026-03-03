# Webview Frontend

The webview is a Vue 3 application built with Vite and rendered inside VS Code's webview panel. It provides the kanban board UI, task management, agent chat, and settings.

## Technology Stack

- **Vue 3** — Composition API with `<script setup>`
- **Vite** — Build tool, outputs to `dist/webview/`
- **TypeScript** — Full type coverage
- **CSS Custom Properties** — VS Code theme integration

## Component Tree

```
App.vue
├── AppHeader.vue          # Board title, toolbar
├── AppSidebar.vue         # Agent list, workspace switcher
├── BoardView.vue          # 5-column kanban board
│   └── TaskCard.vue       # Individual task cards (×N)
├── TaskDetail.vue         # Task detail overlay
├── AgentPanel.vue         # Agent chat interface
├── SettingsPanel.vue      # Settings & backend selector
├── CreateTaskModal.vue    # New task creation dialog
├── StatsBar.vue           # Board statistics
└── ToastContainer.vue     # Toast notifications
```

## Composables

### `useBoard` — Board State Management

The central state composable managing:

- **Tasks** — CRUD operations, stage transitions
- **Stages** — 5-stage pipeline with transition rules
- **Agents** — Agent configurations and assignments
- **Workspaces** — Linked git repositories
- **Events** — Task activity history
- **Callbacks** — `onTaskMoved(cb)` with unsubscribe support

```typescript
const board = useBoard()
board.addTask({ title: 'Fix login bug', priority: 'high' })
board.moveTask(taskId, 'implementation')
const unsub = board.onTaskMoved((taskId, from, to) => { ... })
```

### `useExtension` — VS Code Bridge

Handles bidirectional communication with the extension host:

```typescript
const ext = useExtension()

// Send messages
ext.runAgent('agent-planner', taskId, prompt)
ext.saveTask(task)
ext.detectBackends()

// Listen for messages
ext.onMessage('agent-output', (msg) => { ... })
ext.onMessage('backends-detected', (msg) => { ... })
```

### `usePersistence` — Save/Load Helpers

Manages localStorage persistence for standalone mode and delegates to extension host in VS Code mode.

## Orchestration (`main.ts`)

The `main.ts` entry point wires together the orchestration logic:

1. **Agent Triggers** — When a task moves to a new stage, the appropriate agent is triggered
2. **Decision Parsing** — Agent output is parsed for structured decisions (approve, request changes, escalate)
3. **Feedback Loops** — Reviewer can send tasks back to implementation with comments

### Decision Protocol

Agents emit structured decisions in their output:

```
DECISION: approve
NEXT_STAGE: merge
COMMENTS: Code looks good, all tests pass.
```

The `parseAgentDecision()` function extracts these and handles them automatically.

## Styling

Styles use VS Code's CSS custom properties for seamless theme integration:

```css
.task-card {
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  border: 1px solid var(--vscode-panel-border);
}
```

The board adapts automatically to light, dark, and high-contrast themes.
