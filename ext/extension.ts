import * as vscode from 'vscode'
import { WebviewProvider } from './WebviewProvider'
import { SidebarProvider } from './SidebarProvider'

let provider: WebviewProvider | undefined
let statusBarItem: vscode.StatusBarItem | undefined

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Agent Board')
  log.appendLine(`[Agent Board] Extension activated at ${new Date().toISOString()}`)
  log.appendLine(`[Agent Board] Workspace folders: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') || 'none'}`)

  provider = new WebviewProvider(context)

  // Sidebar webview view
  const sidebarProvider = new SidebarProvider(context, () => provider?.openBoard())
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentBoard.sidebarView', sidebarProvider),
  )

  // Status bar button
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBarItem.text = '$(dashboard) Agent Board'
  statusBarItem.tooltip = 'Open Agent Board'
  statusBarItem.command = 'agentBoard.openBoard'
  statusBarItem.show()
  context.subscriptions.push(statusBarItem)

  context.subscriptions.push(
    // Open the board panel
    vscode.commands.registerCommand('agentBoard.openBoard', () => {
      provider?.openBoard()
    }),

    // Diagnostic command — checks if everything works
    vscode.commands.registerCommand('agentBoard.diagnose', async () => {
      const lines: string[] = []
      lines.push('=== Agent Board Diagnostics ===')
      lines.push(`Time: ${new Date().toISOString()}`)

      // 1. Check workspace folders
      const folders = vscode.workspace.workspaceFolders
      lines.push(`Workspace folders: ${folders?.map(f => f.uri.fsPath).join(', ') || 'NONE'}`)

      // 2. Check config
      const cfg = vscode.workspace.getConfiguration('agentBoard')
      const wsPaths = cfg.get<string[]>('workspacePaths', [])
      lines.push(`Config workspacePaths: ${wsPaths.length > 0 ? wsPaths.join(', ') : 'EMPTY (will use workspace folders as fallback)'}`)

      // 3. Check LM API
      let modelCount = 0
      try {
        const allModels = await vscode.lm.selectChatModels()
        modelCount = allModels.length
        lines.push(`Language Models available: ${modelCount}`)
        for (const m of allModels) {
          lines.push(`  - ${m.id} (${m.name}, vendor: ${m.vendor}, family: ${m.family})`)
        }
      } catch (e: any) {
        lines.push(`Language Models: ERROR — ${e.message}`)
        lines.push('  → Make sure GitHub Copilot Chat is installed and you are signed in')
      }

      // 4. Check Copilot extension
      const copilotChat = vscode.extensions.getExtension('github.copilot-chat')
      lines.push(`Copilot Chat extension: ${copilotChat ? `installed (active: ${copilotChat.isActive})` : 'NOT INSTALLED'}`)

      const copilotBase = vscode.extensions.getExtension('github.copilot')
      lines.push(`Copilot extension: ${copilotBase ? `installed (active: ${copilotBase.isActive})` : 'NOT INSTALLED'}`)

      const msg = lines.join('\n')
      log.appendLine(msg)
      log.show()
      vscode.window.showInformationMessage(
        `Agent Board: ${modelCount} LM models found. See Output → "Agent Board" for full diagnostics.`,
      )
    }),

    // Prompt user to pick a repos folder → add to settings
    vscode.commands.registerCommand('agentBoard.addWorkspacePath', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Repos Folder',
        title: 'Select a folder containing your Git repositories',
      })
      if (!uris?.length) return

      const newPath = uris[0].fsPath
      const cfg = vscode.workspace.getConfiguration('agentBoard')
      const paths = cfg.get<string[]>('workspacePaths', [])
      if (!paths.includes(newPath)) {
        paths.push(newPath)
        await cfg.update('workspacePaths', paths, vscode.ConfigurationTarget.Global)
        vscode.window.showInformationMessage(`Agent Board: Added "${newPath}"`)
      }
    }),

    // Quick-rescan
    vscode.commands.registerCommand('agentBoard.scanWorkspaces', () => {
      provider?.openBoard()
    }),
  )
}

export function deactivate() {
  provider?.dispose()
  provider = undefined
  statusBarItem?.dispose()
  statusBarItem = undefined
}
