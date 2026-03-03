# Backend Selection

Agent Board supports multiple AI backends. Each backend connects to a different AI provider, giving you flexibility in how agents process tasks.

## Available Backends

### Copilot LM (`copilot-lm`)

Uses the **VS Code Language Model API** provided by GitHub Copilot Chat.

| Property | Value |
|----------|-------|
| **Requires** | GitHub Copilot Chat extension |
| **Models** | Whatever models Copilot provides (Claude, GPT-4o, etc.) |
| **Streaming** | Yes |
| **Cost** | Included with Copilot subscription |

!!! tip "Recommended"
    This is the recommended backend for most users as it requires no additional setup beyond the Copilot Chat extension.

### Claude CLI (`claude-cli`)

Uses the **Claude CLI** tool from Anthropic as a subprocess.

| Property | Value |
|----------|-------|
| **Requires** | Claude CLI installed (`brew install claude`) |
| **Models** | Claude models via Anthropic API |
| **Streaming** | Yes (via subprocess stdout) |
| **Cost** | Anthropic API pricing |

Configuration in `board.yaml`:

```yaml
developer:
  cliCommand: claude
  cliArgs:
    - --print
```

### Cline (`cline`)

Delegates to the **Cline VS Code extension** for code generation.

| Property | Value |
|----------|-------|
| **Requires** | Cline extension installed |
| **Models** | Whatever Cline is configured to use |
| **Streaming** | Via extension API |
| **Cost** | Depends on Cline's backend |

## Setting the Default Backend

### Via Settings Panel

1. Open Agent Board sidebar
2. Click the ⚙️ Settings icon
3. In the **Backend** section, click on a backend card
4. The selected backend shows a green "Available" badge

### Via YAML

```yaml
# .tasks/board.yaml
backends:
  default: copilot-lm
```

### Via VS Code Command Palette

1. Open Command Palette (`Cmd+Shift+P`)
2. Search for "Agent Board: Set Default Backend"

## Per-Agent Backend Override

Individual agents can use a different backend than the default:

```json
{
  "id": "agent-developer",
  "name": "Developer",
  "backend": "claude-cli"
}
```

The resolution order is:

1. Agent-specific `backend` field (if set)
2. Board default backend (from `board.yaml`)
3. First available backend (auto-detect)

## Backend Availability Detection

When the board loads, it checks which backends are available:

- **Copilot LM** — Checks if `vscode.lm.selectChatModels()` returns models
- **Claude CLI** — Checks if the CLI command exists on `$PATH`
- **Cline** — Checks if the Cline extension is installed

Unavailable backends are shown with a gray badge in the settings panel.

## Troubleshooting

### "No AI backend available"

This error means none of the three backends could be detected. Install at least one:

```bash
# Option 1: Install Copilot Chat extension
code --install-extension github.copilot-chat

# Option 2: Install Claude CLI
brew install claude

# Option 3: Install Cline
code --install-extension saoudrizwan.claude-dev
```

### Copilot not detecting models

- Ensure you're signed into GitHub with an active Copilot subscription
- Try reloading VS Code: `Developer: Reload Window`
- Check Copilot Chat extension is enabled

### Claude CLI not found

- Verify installation: `which claude`
- Ensure it's on your `$PATH`
- You can set a custom path in `board.yaml`:
  ```yaml
  developer:
    cliCommand: /usr/local/bin/claude
  ```
