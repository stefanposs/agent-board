# Configuration

Agent Board uses a YAML configuration file stored at `.tasks/board.yaml` in your project root.

## Configuration File

The file is created automatically on first run. You can edit it manually or through the Settings panel in the UI.

```yaml
# .tasks/board.yaml

workspaces:
  - ~/Repos/my-project
  - ~/Repos/another-project

agents:
  configPath: ""
  repoPaths:
    - ~/Repos/ai-agents

board:
  name: My Board
  maxTasksPerStage: 10

developer:
  cliCommand: claude
  cliArgs:
    - --print

backends:
  default: copilot-lm
```

## Settings Reference

### `workspaces`

List of local paths to git repositories. These are scanned for repository metadata and used as workspace context when agents work on tasks.

```yaml
workspaces:
  - ~/Repos/my-app
  - /absolute/path/to/project
```

### `agents`

Agent configuration:

| Key | Type | Description |
|-----|------|-------------|
| `configPath` | `string` | Path to a custom agent config JSON file |
| `repoPaths` | `string[]` | Paths to agent skills repositories |

```yaml
agents:
  configPath: ~/configs/agents.json
  repoPaths:
    - ~/Repos/ai-agents
```

### `board`

Board display settings:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `name` | `string` | `"Agent Board"` | Board title |
| `maxTasksPerStage` | `number` | `10` | Maximum tasks per stage column |

### `developer`

Claude CLI configuration (only used with `claude-cli` backend):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cliCommand` | `string` | `"claude"` | CLI executable path |
| `cliArgs` | `string[]` | `["--print"]` | Default CLI arguments |

### `backends`

AI backend configuration:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `default` | `BackendId` | `"copilot-lm"` | Default AI backend |

Valid `BackendId` values: `copilot-lm`, `claude-cli`, `cline`

### `workflow`

Configurable state machine defining your task pipeline. If omitted, a default 5-stage dev pipeline is used (Idea → Planning → Implementation → Review → Merged).

| Key | Type | Description |
|-----|------|-------------|
| `stages` | `StageConfig[]` | Ordered list of pipeline stages |
| `transitions` | `Transition[]` | Allowed stage-to-stage transitions |
| `agentStageMappings` | `AgentStageMapping[]` | Which agent roles operate at each stage |

```yaml
workflow:
  stages:
    - id: idea
      label: "Idea"
      icon: "💡"
      color: "#f59e0b"
      isFirst: true
    - id: planning
      label: "Planning"
      icon: "📋"
      color: "#8b5cf6"
    - id: implementation
      label: "Implementation"
      icon: "⚙️"
      color: "#3b82f6"
    - id: review
      label: "Review"
      icon: "🔍"
      color: "#f97316"
    - id: merge
      label: "Merged"
      icon: "✅"
      color: "#10b981"
      isFinal: true

  transitions:
    - from: idea
      to: planning
      trigger: both
      label: "Start Planning"
    - from: review
      to: merge
      trigger: human
      requiresApproval: true
      label: "Approve & Merge"
      effects: [set-approved, mark-complete]

  agentStageMappings:
    - role: planner
      stages: [idea, planning]
    - role: developer
      stages: [planning, implementation]
    - role: reviewer
      stages: [review]
```

For detailed workflow configuration, see [Task Workflow Guide](../guides/workflow.md).

## VS Code Settings

Some settings can also be configured via VS Code's settings JSON:

```json
{
  "agentBoard.workspacePaths": ["~/Repos/my-project"],
  "agentBoard.agentConfigPath": "~/configs/agents.json"
}
```

!!! note
    YAML settings in `board.yaml` take precedence over VS Code settings.

## Task Storage

Tasks are stored as Markdown files in the `.tasks/` directory:

```
.tasks/
├── board.yaml
├── .gitignore
├── TASK-1-setup-ci-pipeline.md
├── TASK-2-add-authentication.md
└── TASK-3-refactor-api.md
```

Each task file uses YAML frontmatter for metadata:

```markdown
---
id: "1"
title: Setup CI Pipeline
stage: implementation
priority: high
tags: [devops, ci]
assignedAgents: [agent-devops-agent]
workspaceId: ws-my-project
createdAt: 2024-01-15T10:30:00Z
---

# Setup CI Pipeline

Configure GitHub Actions for automated testing and deployment.

## Sessions

### Planning Session (2024-01-15)
...
```
