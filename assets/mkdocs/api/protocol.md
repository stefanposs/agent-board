# Protocol Types Reference

Complete type definitions for the postMessage protocol between extension host and webview.

## Source

All types are defined in [`ext/protocol.ts`](https://github.com/stefanposs/agent-board/blob/main/ext/protocol.ts).

## BackendId

```typescript
type BackendId = 'copilot-lm' | 'claude-cli' | 'cline'
```

## BackendInfo

```typescript
interface BackendInfo {
  id: BackendId
  label: string       // Human-readable name
  icon: string        // Emoji icon
  available: boolean  // Whether backend is detected
  detail?: string     // Additional info
}
```

## AgentConfig

```typescript
interface AgentConfig {
  id: string
  name: string
  role: string              // 'planner' | 'developer' | 'reviewer' | 'architect' | 'devops'
  avatar: string            // Emoji
  color: string             // Hex color
  model: string             // LLM model identifier
  temperature: number       // 0.0 - 1.0
  maxContextTokens: number  // Max context window
  systemPrompt: string      // System prompt content
  backend?: BackendId       // Optional backend override
}
```

## SessionMessage

```typescript
interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string  // ISO 8601
  agentId?: string
}
```

## WorkspaceInfo

```typescript
interface WorkspaceInfo {
  id: string
  name: string
  localPath: string
  repo?: string
  branch?: string
  hasChanges?: boolean
}
```

## BoardSettingsDto

```typescript
interface BoardSettingsDto {
  workspacePaths: string[]
  agentConfigPath: string
  agentRepoPaths: string[]
}
```

## InitData

```typescript
interface InitData {
  tasks: Task[]
  agents: AgentConfig[]
  workspaces: WorkspaceInfo[]
  settings: BoardSettingsDto
  backends: BackendInfo[]
  defaultBackend: BackendId
}
```

## WebviewMessage (Webview → Extension)

Union type of all messages the webview can send:

```typescript
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'run-agent'; agentId: string; taskId: string; prompt: string;
      sessionMessages?: SessionMessage[]; workspacePath?: string; branch?: string }
  | { type: 'stop-agent'; agentId: string }
  | { type: 'save-task'; task: any }
  | { type: 'delete-task'; taskId: string }
  | { type: 'load-tasks' }
  | { type: 'load-agents' }
  | { type: 'scan-workspaces' }
  | { type: 'save-settings'; settings: Partial<BoardSettingsDto> }
  | { type: 'set-workspace-paths'; paths: string[] }
  | { type: 'set-agent-repo-paths'; paths: string[] }
  | { type: 'detect-backends' }
  | { type: 'set-default-backend'; backendId: BackendId }
  | { type: 'set-agent-backend'; agentId: string; backendId: BackendId }
  | { type: 'git-create-branch'; workspacePath: string; branchName: string; taskId: string }
```

## ExtensionMessage (Extension → Webview)

Union type of all messages the extension host can send:

```typescript
type ExtensionMessage =
  | { type: 'init'; data: InitData }
  | { type: 'agent-output'; agentId: string; content: string; done: boolean; taskId?: string }
  | { type: 'agent-error'; agentId: string; error: string }
  | { type: 'tasks-loaded'; tasks: any[] }
  | { type: 'agents-loaded'; agents: AgentConfig[] }
  | { type: 'workspaces-updated'; workspaces: WorkspaceInfo[] }
  | { type: 'settings-updated'; settings: BoardSettingsDto }
  | { type: 'backends-detected'; backends: BackendInfo[] }
  | { type: 'cli-agent-started'; agentId: string }
  | { type: 'cli-agent-done'; agentId: string; exitCode: number; commits: string[] }
  | { type: 'branch-created'; taskId: string; branchName: string; success: boolean }
  | { type: 'toast'; message: string; level: 'info' | 'success' | 'error' }
```
