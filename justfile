# Agent Board — Development Commands

# Default: show available recipes
default:
    @just --list

# ─── Development ────────────────────────────────────────────────

# Start development server (standalone, with mock data)
dev:
    npm run dev

# Start with host exposure (for mobile/network testing)
dev-host:
    npx vite --host

# Watch extension host changes (auto-rebuild on save)
dev-ext:
    node esbuild.ext.mjs --watch

# Type-check the Vue webview
typecheck:
    npx vue-tsc --noEmit

# Type-check the extension host
typecheck-ext:
    cd ext && npx tsc --noEmit

# ─── Build ──────────────────────────────────────────────────────

# Build extension host (→ dist/extension.cjs)
build-ext:
    node esbuild.ext.mjs

# Build webview (→ dist/webview/)
build-webview:
    npx vite build

# Build everything
build: build-ext build-webview

# Build for production (minified)
build-prod:
    node esbuild.ext.mjs --production
    npx vite build

# Preview production build (standalone)
preview:
    npm run preview

# ─── Quality ────────────────────────────────────────────────────

# Run unit tests
test:
    npx vitest run

# Type-check everything (webview + extension host)
typecheck-all: typecheck typecheck-ext

# Run all QA checks (typecheck, lint, test, format-check)
qa: typecheck-all test

# ─── VS Code Extension ─────────────────────────────────────────

# Package as VS Code extension (VSIX)
package-extension: build-prod
    npx @vscode/vsce package --no-dependencies

# Install extension locally
install-extension:
    code --install-extension agent-board-*.vsix

# ─── Documentation ──────────────────────────────────────────────

# Build MkDocs documentation (assets/mkdocs/ → docs/)
docs:
    mkdocs build --config-file mkdocs.yml --strict

# Serve documentation locally with live-reload
docs-serve:
    mkdocs serve --config-file mkdocs.yml

# ─── Utilities ──────────────────────────────────────────────────

# Clean build artifacts
clean:
    rm -rf dist node_modules/.vite *.vsix

# Install dependencies
install:
    npm install

# Full reset
reset: clean install
