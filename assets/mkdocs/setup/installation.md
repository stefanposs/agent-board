# Installation

## Prerequisites

- **VS Code** 1.85 or later
- **Node.js** 18 or later
- **npm** 9 or later

### Optional (for specific backends)

- **GitHub Copilot Chat** extension — for Copilot LM backend
- **Claude CLI** — for Claude CLI backend (`brew install claude` or from Anthropic)
- **Cline extension** — for Cline backend

## Install from Source

```bash
# 1. Clone the repository
git clone https://github.com/stefanposs/agent-board.git
cd agent-board

# 2. Install dependencies
npm install

# 3. Build everything (extension host + webview)
npm run build:all

# 4. Install to VS Code
mkdir -p ~/.vscode/extensions/stefanposs.agent-board-0.1.0/dist
cp dist/extension.cjs ~/.vscode/extensions/stefanposs.agent-board-0.1.0/dist/
cp -r dist/webview/ ~/.vscode/extensions/stefanposs.agent-board-0.1.0/dist/webview/
cp package.json ~/.vscode/extensions/stefanposs.agent-board-0.1.0/

# 5. Restart VS Code
```

## Development Mode

For iterative development with hot reload:

```bash
# Build webview with watch mode
npm run dev

# In another terminal, build extension host
npm run build:ext

# Press F5 in VS Code to launch Extension Development Host
```

## Verify Installation

1. Open VS Code
2. Look for the **Agent Board** icon in the sidebar (Activity Bar)
3. Click it to open the kanban board
4. If no agents appear, check the [Configuration](configuration.md) guide

## Troubleshooting

### Extension not showing

- Ensure the `package.json` is copied to the extension directory
- Check VS Code version compatibility (1.85+)
- Run `Developer: Reload Window` from the command palette

### Build errors

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build:all
```

### No AI backends available

At least one backend must be installed:

- Install **GitHub Copilot Chat** extension (recommended)
- Or install the **Claude CLI**: `brew install claude`
- Or install the **Cline** extension from VS Code marketplace
