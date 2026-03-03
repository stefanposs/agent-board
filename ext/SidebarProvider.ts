import * as vscode from 'vscode'

/**
 * Sidebar webview view — lightweight panel in the activity bar
 * that shows quick status and an "Open Board" button.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView

  constructor(
    private ctx: vscode.ExtensionContext,
    private openBoard: () => void,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView

    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this.getHtml()

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'open-board') this.openBoard()
      if (msg.type === 'add-path') {
        vscode.commands.executeCommand('agentBoard.addWorkspacePath')
      }
      if (msg.type === 'scan') {
        vscode.commands.executeCommand('agentBoard.scanWorkspaces')
      }
    })
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
      margin: 0;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      font-weight: 600;
      font-size: 14px;
    }
    .logo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 8px 12px;
      margin-bottom: 8px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      transition: background 0.15s;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 12px;
      line-height: 1.5;
    }
    .shortcut {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="logo">
    <div class="logo-icon">⚡</div>
    Agent Board
  </div>

  <button class="btn btn-primary" onclick="post('open-board')">
    📋 Open Full Board
  </button>
  <button class="btn btn-secondary" onclick="post('add-path')">
    📂 Add Workspace Path
  </button>
  <button class="btn btn-secondary" onclick="post('scan')">
    🔄 Rescan Workspaces
  </button>

  <div class="hint">
    Open the full Kanban board to manage tasks, run agents, and orchestrate your AI workflow.
    <br><br>
    <span class="shortcut">Cmd+Shift+P</span> → "Open Agent Board"
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function post(type) { vscode.postMessage({ type }); }
  </script>
</body>
</html>`
  }
}
