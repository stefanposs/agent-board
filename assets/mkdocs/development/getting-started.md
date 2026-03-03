# Getting Started (Development)

This guide covers setting up the development environment for contributing to Agent Board.

## Prerequisites

- **Node.js** 18+
- **npm** 9+
- **VS Code** 1.85+

## Project Structure

```
agent-board/
├── ext/                    # Extension host (Node.js, esbuild)
│   ├── extension.ts        # Entry point
│   ├── WebviewProvider.ts   # Main coordinator
│   ├── AgentBackend.ts      # Backend strategy pattern
│   ├── BoardSettings.ts     # YAML settings
│   ├── protocol.ts          # Message types
│   └── ...
├── src/                    # Webview (Vue 3, Vite)
│   ├── main.ts             # App bootstrap + orchestration
│   ├── App.vue             # Root component
│   ├── components/         # Vue components
│   ├── composables/        # State management
│   └── domain/             # Types and constants
├── dist/                   # Build output
│   ├── extension.cjs       # Bundled extension
│   └── webview/            # Bundled webview assets
├── docs/                   # MkDocs documentation
├── tests/                  # Test files
├── .tasks/                 # Task persistence
└── package.json            # Extension manifest
```

## Build System

The project uses two build tools:

| Component | Tool | Config | Output |
|-----------|------|--------|--------|
| Extension Host | esbuild | `esbuild.ext.mjs` | `dist/extension.cjs` |
| Webview | Vite | `vite.config.ts` | `dist/webview/*` |

### Build Commands

```bash
# Build everything
npm run build:all

# Build extension host only
npm run build:ext

# Build webview only
npm run build:web

# Development mode with hot reload (webview)
npm run dev
```

## Development Workflow

### 1. Clone and Install

```bash
git clone https://github.com/stefanposs/agent-board.git
cd agent-board
npm install
```

### 2. Start Development

```bash
# Terminal 1: Watch webview
npm run dev

# Terminal 2: Build extension once
npm run build:ext
```

### 3. Test in VS Code

Press `F5` to launch the Extension Development Host, or deploy manually:

```bash
npm run build:all
cp dist/extension.cjs ~/.vscode/extensions/stefanposs.agent-board-0.1.0/dist/extension.cjs
cp -r dist/webview/* ~/.vscode/extensions/stefanposs.agent-board-0.1.0/dist/webview/
```

Then reload VS Code (`Developer: Reload Window`).

### 4. Debug

- **Extension Host**: Set breakpoints in `ext/` files, press F5
- **Webview**: Open VS Code DevTools (`Developer: Toggle Developer Tools`)
- **Output Channel**: Check "Agent Board" in VS Code's Output panel

## Key Patterns

### Adding a New Message Type

1. Add the type to `WebviewMessage` or `ExtensionMessage` in `ext/protocol.ts`
2. Handle it in `WebviewProvider.onMessage()` for webview→ext messages
3. Handle it in `useExtension.ts` for ext→webview messages

### Adding a New Backend

1. Implement the `AgentBackend` interface in `ext/AgentBackend.ts`
2. Register it in `BackendRegistry.constructor()`
3. Add the `BackendId` to the union type in `ext/protocol.ts`
4. Update `detectAvailable()` in `BackendRegistry`
5. Add UI card in `SettingsPanel.vue`

### Adding a New Stage

1. Add the stage to `STAGES` in `src/domain/types.ts`
2. Define transitions in `TRANSITIONS`
3. Update `BoardView.vue` column rendering
4. Add agent trigger logic in `src/main.ts`

## Code Style

- **TypeScript** throughout (strict mode)
- **Vue 3 Composition API** with `<script setup>`
- **No `any` types** — use proper types or `unknown`
- **`execFileSync`** instead of `execSync` for subprocess safety
- **Functional composables** for state management
