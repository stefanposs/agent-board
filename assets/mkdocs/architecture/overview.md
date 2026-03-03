# Architecture Overview

Agent Board follows a **split-process architecture** typical of VS Code extensions: a Node.js Extension Host manages backend logic while a Vue 3 Webview renders the UI. Communication between them uses VS Code's type-safe `postMessage` protocol.

## High-Level Architecture

```mermaid
graph TB
    subgraph "VS Code Extension Host (Node.js)"
        WP[WebviewProvider]
        BR[BackendRegistry]
        ACM[AgentConfigManager]
        BS[BoardSettings]
        MDS[MarkdownStateManager]
        GS[GitService]
        WS[WorkspaceScanner]
        LLM[LLMService]
        CLI[CliAgentService]
        
        WP --> BR
        WP --> ACM
        WP --> BS
        WP --> MDS
        WP --> GS
        WP --> WS
        BR --> LLM
        BR --> CLI
    end
    
    subgraph "Webview (Vue 3 + Vite)"
        App[App.vue]
        BV[BoardView]
        TD[TaskDetail]
        SP[SettingsPanel]
        AP[AgentPanel]
        
        UB[useBoard]
        UE[useExtension]
        UP[usePersistence]
        
        App --> BV
        App --> TD
        App --> SP
        App --> AP
        App --> UB
        App --> UE
        App --> UP
    end
    
    WP <-->|"postMessage (typed)"| UE
```

## Component Responsibilities

### Extension Host (`ext/`)

| Component | File | Responsibility |
|-----------|------|----------------|
| **WebviewProvider** | `WebviewProvider.ts` | Main coordinator — message routing, agent execution, file I/O |
| **BackendRegistry** | `AgentBackend.ts` | Strategy pattern for AI backends (Copilot, CLI, Cline) |
| **AgentConfigManager** | `AgentConfigManager.ts` | Loads agent configs from skills repos, agent.md files |
| **BoardSettings** | `BoardSettings.ts` | YAML-based settings persistence (`board.yaml`) |
| **MarkdownStateManager** | `MarkdownStateManager.ts` | Task persistence as `.md` files with YAML frontmatter |
| **GitService** | `GitService.ts` | Git operations via `execFileSync` with input validation |
| **WorkspaceScanner** | `WorkspaceScanner.ts` | Discovers git repositories in configured paths |
| **LLMService** | `LLMService.ts` | VS Code Language Model API wrapper |
| **CliAgentService** | `CliAgentService.ts` | Claude CLI subprocess management |

### Webview (`src/`)

| Component | File | Responsibility |
|-----------|------|----------------|
| **useBoard** | `composables/useBoard.ts` | Board state management (tasks, stages, transitions) |
| **useExtension** | `composables/useExtension.ts` | postMessage bridge to extension host |
| **usePersistence** | `composables/usePersistence.ts` | Save/load helpers |
| **BoardView** | `components/BoardView.vue` | Kanban board with 5 stage columns |
| **TaskDetail** | `components/TaskDetail.vue` | Task detail overlay with actions |
| **SettingsPanel** | `components/SettingsPanel.vue` | Settings with backend selector |
| **AgentPanel** | `components/AgentPanel.vue` | Per-agent chat interface |

## Data Flow

### Task Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idea: User creates task
    Idea --> Planning: Auto or manual
    Planning --> Implementation: Planner agent decides
    Implementation --> Review: Developer agent decides
    Review --> Implementation: Reviewer requests changes
    Review --> Merge: Reviewer approves
    Merge --> [*]: Task completed
```

### Agent Execution Flow

```mermaid
sequenceDiagram
    participant W as Webview
    participant WP as WebviewProvider
    participant BR as BackendRegistry
    participant BE as Backend (Copilot/CLI/Cline)
    
    W->>WP: run-agent {agentId, taskId, prompt}
    WP->>BR: resolve(agentId, agentConfig)
    BR->>BE: run({prompt, agentConfig, ...})
    BE-->>WP: streaming chunks
    WP-->>W: agent-output {agentId, content, done}
    W->>W: parseAgentDecision(content)
    W->>WP: move-task / save-task
```

## Security Model

- **Shell Injection Prevention** — All subprocess calls use `execFileSync` (never `execSync`)
- **Path Traversal Protection** — Resolved paths checked against workspace boundaries (case-insensitive)
- **CSP Nonces** — Cryptographically random nonces for webview Content Security Policy
- **Input Validation** — Git branch names and refs validated before use
- **No eval** — No dynamic code execution
