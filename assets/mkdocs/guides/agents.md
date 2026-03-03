# Agent Configuration

Agent Board loads AI agent configurations from multiple sources and merges them into a unified agent list.

## Agent Sources

Agents are loaded in this priority order (later sources can override earlier ones):

1. **Skills Repository** — `SKILL.md` files in `skills/*/` directories
2. **Agent Definitions** — `*.agent.md` files in `agents/` directories
3. **Custom Config** — JSON file specified in `agents.configPath`
4. **Built-in Defaults** — Fallback agents (planner, developer, reviewer)

## Skills Repository Structure

Point `agents.repoPaths` to a directory containing skills:

```
ai-agents/
├── skills/
│   ├── architecture/
│   │   └── SKILL.md
│   ├── frontend-patterns/
│   │   └── SKILL.md
│   ├── testing/
│   │   └── SKILL.md
│   └── golang-patterns/
│       └── SKILL.md
└── agents/
    ├── code-reviewer.agent.md
    ├── lead-architect.agent.md
    └── python-expert.agent.md
```

### SKILL.md Format

Each skill folder contains a `SKILL.md` with optional frontmatter:

```markdown
---
name: Architecture Reviewer
description: Reviews architecture decisions and patterns
---

# Architecture Review Skill

You are an expert architecture reviewer...
```

The entire file content becomes the agent's `systemPrompt`.

### Agent.md Format

Agent definition files use Markdown with a heading:

```markdown
# Lead Architect

You are a lead architect responsible for...
```

## Role Mapping

Agents are automatically assigned roles based on their folder/file name:

| Names | Role |
|-------|------|
| `architecture`, `system-design`, `lead-architect` | `architect` |
| `testing`, `test-strategist` | `reviewer` |
| `project-management`, `task-orchestrator` | `planner` |
| `devops-agent`, `gcp-patterns` | `devops` |
| `code-reviewer`, `anti-patterns` | `reviewer` |
| Everything else | `developer` |

## Custom Agent Config (JSON)

Create a JSON file for custom agent definitions:

```json
[
  {
    "id": "agent-custom-reviewer",
    "name": "Custom Reviewer",
    "role": "reviewer",
    "avatar": "🔍",
    "color": "#e74c3c",
    "model": "copilot-claude-sonnet-4",
    "temperature": 0.3,
    "maxContextTokens": 128000,
    "systemPrompt": "You are a code reviewer specializing in..."
  }
]
```

Then reference it in `board.yaml`:

```yaml
agents:
  configPath: ~/configs/my-agents.json
```

## Per-Agent Backend

Each agent can use a different AI backend:

```json
{
  "id": "agent-developer",
  "backend": "claude-cli",
  "...": "..."
}
```

If no `backend` is specified, the agent uses the board's default backend.

## AgentConfig Type

```typescript
interface AgentConfig {
  id: string           // Unique identifier (e.g., "agent-architecture")
  name: string         // Display name
  role: string         // planner | developer | reviewer | architect | devops
  avatar: string       // Emoji avatar
  color: string        // Hex color for UI
  model: string        // LLM model identifier
  temperature: number  // 0.0 - 1.0
  maxContextTokens: number
  systemPrompt: string // Full system prompt text
  backend?: BackendId  // Optional backend override
}
```
