import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs/promises'
import type { WebviewMessage, ExtensionMessage, InitData } from './protocol'
import { WorkspaceScanner } from './WorkspaceScanner'
import { AgentConfigManager } from './AgentConfigManager'
import { LLMService } from './LLMService'
import { GitService } from './GitService'
import { CliAgentService } from './CliAgentService'
import { StateManager } from './StateManager'
import { MarkdownStateManager } from './MarkdownStateManager'
import { BoardSettingsManager } from './BoardSettings'
import { DEFAULT_WORKFLOW, WORKFLOW_PRESETS } from './protocol'
import { BackendRegistry } from './AgentBackend'

import * as crypto from 'crypto'

/** Directories to ignore when scanning workspace context. */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__',
  '.venv', 'venv', '.idea', '.vscode', '.DS_Store', 'coverage', '.cache',
  'target', '.dart_tool', '.flutter-plugins', 'Pods', 'temp-init',
])

export class WebviewProvider {
  private panel: vscode.WebviewPanel | undefined
  private scanner = new WorkspaceScanner()
  private agentMgr = new AgentConfigManager()
  private llm = new LLMService()
  private git = new GitService()
  private cli = new CliAgentService()
  private registry: BackendRegistry
  private state: StateManager
  private mdState: MarkdownStateManager | null = null
  private boardSettings: BoardSettingsManager | null = null
  private disposables: vscode.Disposable[] = []
  private runningAgents = new Map<string, vscode.CancellationTokenSource>()
  private cachedAgents: import('./protocol').AgentConfig[] | null = null
  private log: vscode.OutputChannel

  constructor(private ctx: vscode.ExtensionContext) {
    this.state = new StateManager(ctx)
    this.registry = new BackendRegistry(this.llm, this.cli)
    this.log = vscode.window.createOutputChannel('Agent Board')
    ctx.subscriptions.push(this.log)
  }

  private logInfo(msg: string) {
    const ts = new Date().toISOString().slice(11, 23)
    this.log.appendLine(`[${ts}] ${msg}`)
    console.log(`[AgentBoard] ${msg}`)
  }

  private logError(msg: string) {
    const ts = new Date().toISOString().slice(11, 23)
    this.log.appendLine(`[${ts}] ERROR: ${msg}`)
    console.error(`[AgentBoard] ${msg}`)
  }

  // ─── Public ───────────────────────────────────────────────────

  async openBoard() {
    if (this.panel) {
      this.panel.reveal()
      return
    }

    this.panel = vscode.window.createWebviewPanel(
      'agentBoard',
      'Agent Board',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview'),
        ],
      },
    )

    this.panel.webview.html = this.buildHtml(this.panel.webview)

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.onMessage(msg),
      null,
      this.disposables,
    )

    this.panel.onDidDispose(() => {
      this.panel = undefined
      this.disposables.forEach((d) => d.dispose())
      this.disposables = []
    })
  }

  dispose() {
    this.panel?.dispose()
    this.disposables.forEach((d) => d.dispose())
  }

  // ─── Message handler ─────────────────────────────────────────

  private async onMessage(msg: WebviewMessage) {
    this.logInfo(`← Webview msg: ${msg.type}${msg.type === 'run-agent' ? ` agentId=${msg.agentId} taskId=${msg.taskId}` : ''}${msg.type === 'create-branch' ? ` branch=${msg.branchName} path=${msg.workspacePath}` : ''}`)
    switch (msg.type) {
      case 'webview-log':
        this.logInfo(`[Webview] ${msg.message}`)
        // Also show first few logs as notification for debugging
        if (msg.message.includes('toggleSimulation') || msg.message.includes('startAgents') || msg.message.includes('RUNNING')) {
          vscode.window.showInformationMessage(`[Sim] ${msg.message}`)
        }
        return

      case 'ready':
        return this.sendInit()

      case 'scan-workspaces':
        return this.scanWorkspaces()

      case 'add-workspace-path': {
        // Update YAML settings (primary source of truth)
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          if (!settings.workspaces.includes(msg.path)) {
            settings.workspaces.push(msg.path)
            await this.boardSettings.save(settings)
            this.logInfo(`📁 Added workspace path: ${msg.path}`)
          }
        }
        // Re-init to pick up new workspace
        return this.sendInit()
      }

      case 'remove-workspace-path': {
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          settings.workspaces = settings.workspaces.filter((p: string) => p !== msg.path)
          await this.boardSettings.save(settings)
          this.logInfo(`📁 Removed workspace path: ${msg.path}`)
        }
        return this.sendInit()
      }

      case 'load-agents': {
        this.cachedAgents = null // invalidate cache
        const yamlSettings = this.boardSettings ? await this.boardSettings.load() : null
        const agents = await this.agentMgr.loadAgents(yamlSettings?.agents.configPath, yamlSettings?.agents.repoPaths)
        return this.post({ type: 'agents-loaded', agents })
      }

      case 'add-agent-repo-path': {
        // Update YAML settings
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          if (!settings.agents.repoPaths.includes(msg.path)) {
            settings.agents.repoPaths.push(msg.path)
            await this.boardSettings.save(settings)
            this.logInfo(`🤖 Added agent repo path: ${msg.path}`)
          }
        }
        // Reload agents from updated paths
        const yamlSettings2 = this.boardSettings ? await this.boardSettings.load() : null
        const agents = await this.agentMgr.loadAgents(yamlSettings2?.agents.configPath, yamlSettings2?.agents.repoPaths)
        this.logInfo(`📋 Reloaded ${agents.length} agents: [${agents.map(a => `${a.id}(${a.role})`).join(', ')}]`)
        return this.post({ type: 'agents-loaded', agents })
      }

      case 'remove-agent-repo-path': {
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          settings.agents.repoPaths = settings.agents.repoPaths.filter((p: string) => p !== msg.path)
          await this.boardSettings.save(settings)
          this.logInfo(`🤖 Removed agent repo path: ${msg.path}`)
        }
        const yamlSettings3 = this.boardSettings ? await this.boardSettings.load() : null
        const agents = await this.agentMgr.loadAgents(yamlSettings3?.agents.configPath, yamlSettings3?.agents.repoPaths)
        return this.post({ type: 'agents-loaded', agents })
      }

      case 'get-llm-models': {
        const models = await this.llm.getModels()
        return this.post({ type: 'llm-models', models })
      }

      case 'run-agent':
        return this.runAgent(msg.agentId, msg.taskId, msg.prompt, msg.sessionMessages, msg.workspacePath, msg.branch)

      case 'stop-agent':
        return this.stopAgent(msg.agentId)

      case 'create-branch':
        return this.createBranch(msg.taskId, msg.workspacePath, msg.branchName)

      case 'save-state':
        if (this.mdState) {
          await this.mdState.saveTasks(msg.tasks, msg.sessions)
          this.logInfo(`📁 Saved ${msg.tasks.length} tasks to .tasks/ markdown`)
        }
        this.state.saveAll(msg.tasks, msg.sessions) // backup in workspaceState
        return this.post({ type: 'state-saved' })

      case 'delete-task':
        if (this.mdState) {
          await this.mdState.deleteTask(msg.taskId)
          this.logInfo(`🗑️ Deleted task file for ${msg.taskId}`)
        }
        return

      case 'save-goals':
        if (this.mdState) {
          await this.mdState.saveGoals(msg.goals)
          this.logInfo(`📁 Saved ${msg.goals.length} goals to .tasks/ markdown`)
        }
        this.state.saveGoals(msg.goals) // backup in workspaceState
        return

      case 'load-state': {
        let tasks: any[], sessions: any[], goals: any[]
        if (this.mdState) {
          const loaded = await this.mdState.loadAll()
          const loadedGoals = await this.mdState.loadGoals()
          tasks = loaded.tasks
          sessions = loaded.sessions
          goals = loadedGoals
          this.logInfo(`📁 Loaded ${loaded.tasks.length} tasks, ${loadedGoals.length} goals from .tasks/ markdown`)
        } else {
          const loaded = this.state.loadAll()
          tasks = loaded.tasks
          sessions = loaded.sessions
          goals = loaded.goals
        }
        return this.post({ type: 'state-loaded', tasks, sessions, goals })
      }

      case 'generate-report':
        return this.generateReport(msg.tasks, msg.goals, msg.prompt)

      case 'dismiss-splash':
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          settings.board.showSplashOnStart = false
          await this.boardSettings.save(settings)
          this.logInfo('🚫 Splash screen disabled')
        }
        return

      case 'detect-backends': {
        const backends = await this.registry.detectAvailable()
        const defaultBackend = this.boardSettings?.get()?.backends?.default ?? 'auto'
        this.logInfo(`🔌 Backends: ${backends.map(b => `${b.label}=${b.available}`).join(', ')} (default=${defaultBackend})`)
        return this.post({ type: 'backends-detected', backends })
      }

      case 'set-default-backend': {
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          settings.backends.default = msg.backendId
          await this.boardSettings.save(settings)
          this.logInfo(`🔌 Default backend set to: ${msg.backendId}`)
        }
        return
      }

      case 'set-board-type': {
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          settings.boardType = msg.boardType
          // Clear custom workflow when switching to a preset
          delete settings.workflow
          await this.boardSettings.save(settings)
          this.logInfo(`📋 Board type set to: ${msg.boardType}`)
          // Re-send init so the webview picks up the new workflow
          await this.sendInit()
        }
        return
      }

      case 'set-agent-backend': {
        // Persist per-agent backend override in settings
        this.logInfo(`🔌 Agent ${msg.agentId} backend set to: ${msg.backendId}`)
        if (this.boardSettings) {
          const settings = this.boardSettings.get()
          // Store in a per-agent overrides section (future extension)
          // For now, log it — full per-agent persistence requires schema extension
        }
        // Invalidate agent cache so next resolve picks up the change
        this.cachedAgents = null
        return
      }

      case 'confirm-decision': {
        // HITL: Human confirmed/rejected a decision — log it
        this.logInfo(`📋 Decision ${msg.approved ? '✅ approved' : '❌ rejected'} for task ${msg.taskId} (decision: ${msg.decisionId})${msg.feedback ? ` — feedback: "${msg.feedback}"` : ''}`)
        // Markdown logging: append to task log if mdState available
        if (this.mdState) {
          const action = msg.approved ? '✅ Approved' : '❌ Rejected'
          const ts = new Date().toISOString()
          const entry = `- [${ts}] 👤 human: ${action}${msg.feedback ? ` — "${msg.feedback}"` : ''}`
          try {
            await this.mdState.appendToTaskLog(msg.taskId, entry)
          } catch {
            // appendToTaskLog may not exist yet — graceful fallback
          }
        }
        return
      }

      case 'show-notification': {
        // HITL: Show VS Code native notification when agent needs human attention
        const actions = ['Show Task']
        let result: string | undefined
        if (msg.severity === 'error') {
          result = await vscode.window.showErrorMessage(`${msg.title}: ${msg.body}`, ...actions)
        } else if (msg.severity === 'warning') {
          result = await vscode.window.showWarningMessage(`${msg.title}: ${msg.body}`, ...actions)
        } else {
          result = await vscode.window.showInformationMessage(`${msg.title}: ${msg.body}`, ...actions)
        }
        if (result === 'Show Task') {
          this.post({ type: 'notification-action', action: 'show-task' })
        }
        return
      }

      case 'open-file': {
        const fileUri = vscode.Uri.file(msg.filePath)
        return vscode.window.showTextDocument(fileUri)
      }

      case 'open-folder': {
        const uri = vscode.Uri.file(msg.path)
        return vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })
      }

      case 'open-terminal': {
        const t = vscode.window.createTerminal({
          cwd: msg.path,
          name: `Agent Board: ${path.basename(msg.path)}`,
        })
        return t.show()
      }

      case 'save-settings': {
        if (this.boardSettings) {
          const current = this.boardSettings.get()
          if (msg.settings.workspacePaths !== undefined) current.workspaces = msg.settings.workspacePaths
          if (msg.settings.agentConfigPath !== undefined) current.agents.configPath = msg.settings.agentConfigPath
          if (msg.settings.agentRepoPaths !== undefined) current.agents.repoPaths = msg.settings.agentRepoPaths
          await this.boardSettings.save(current)
          this.logInfo(`📁 Settings saved to ${this.boardSettings.getSettingsPath()}`)
        }
        // Also save to VS Code settings as backup
        const vsCfg = vscode.workspace.getConfiguration('agentBoard')
        if (msg.settings.workspacePaths !== undefined)
          await vsCfg.update('workspacePaths', msg.settings.workspacePaths, vscode.ConfigurationTarget.Global)
        if (msg.settings.agentConfigPath !== undefined)
          await vsCfg.update('agentConfigPath', msg.settings.agentConfigPath, vscode.ConfigurationTarget.Global)
        if (msg.settings.agentRepoPaths !== undefined)
          await vsCfg.update('agentRepoPaths', msg.settings.agentRepoPaths, vscode.ConfigurationTarget.Global)
        const s = this.boardSettings?.get()
        return this.post({
          type: 'settings-updated',
          settings: {
            workspacePaths: s?.workspaces ?? msg.settings.workspacePaths ?? [],
            agentConfigPath: s?.agents.configPath ?? '',
            agentRepoPaths: s?.agents.repoPaths ?? [],
            workflow: s?.workflow,
          },
        })
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async sendInit() {
    // Load settings from YAML (.tasks/board.yaml) with VS Code fallback
    const firstWsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!this.boardSettings && firstWsFolder) {
      this.boardSettings = new BoardSettingsManager(firstWsFolder)
      await this.boardSettings.ensureExists()
      this.logInfo(`📁 Board settings at: ${this.boardSettings.getSettingsPath()}`)
    }
    const yamlSettings = this.boardSettings ? await this.boardSettings.load() : null

    let workspacePaths = yamlSettings?.workspaces ?? []
    const agentConfigPath = yamlSettings?.agents.configPath ?? ''
    const agentRepoPaths = yamlSettings?.agents.repoPaths ?? []

    // Fallback: if no workspace paths configured, use VS Code's open workspace folders
    if (workspacePaths.length === 0 && vscode.workspace.workspaceFolders?.length) {
      workspacePaths = vscode.workspace.workspaceFolders.map(f => f.uri.fsPath)
      this.logInfo(`No workspacePaths configured, using VS Code workspace folders: ${workspacePaths.join(', ')}`)
    }

    // Initialize markdown state manager at board settings location (where .tasks/ lives)
    if (!this.mdState) {
      const mdBasePath = firstWsFolder || (workspacePaths.length > 0 ? workspacePaths[0] : null)
      if (mdBasePath) {
        this.mdState = new MarkdownStateManager(mdBasePath)
        await this.mdState.init()
        this.logInfo(`📁 Markdown state initialized at: ${mdBasePath}/.tasks/`)
      }
    }

    const [workspaces, agents, models] = await Promise.all([
      this.scanner.scanPaths(workspacePaths),
      this.agentMgr.loadAgents(agentConfigPath, agentRepoPaths),
      this.llm.getModels(),
    ])
    this.logInfo(`📋 Loaded ${agents.length} agents from ${agentRepoPaths.length} repo path(s): ${agentRepoPaths.join(', ') || '(none)'}`)
    for (const a of agents) {
      this.logInfo(`   • ${a.id} (${a.role}) — ${a.name}`)
    }

    // Apply CLI settings from board.yaml to the CliAgentService
    if (yamlSettings?.backends?.claudeCli) {
      this.cli.cliCommand = yamlSettings.backends.claudeCli.command || 'claude'
      this.cli.cliArgs = yamlSettings.backends.claudeCli.args || this.cli.cliArgs
    } else if (yamlSettings?.developer) {
      this.cli.cliCommand = yamlSettings.developer.cliCommand || 'claude'
      this.cli.cliArgs = yamlSettings.developer.cliArgs || this.cli.cliArgs
    }

    // Detect available backends
    const backends = await this.registry.detectAvailable()
    const defaultBackend = yamlSettings?.backends?.default ?? 'auto'
    this.logInfo(`🔌 Backends: ${backends.map(b => `${b.label}=${b.available}`).join(', ')} (default=${defaultBackend})`)

    // Load persisted state — prefer markdown files, migrate from old state if needed
    let persisted: { tasks: any[]; sessions: any[] }
    if (this.mdState) {
      persisted = await this.mdState.loadAll()
      this.logInfo(`📁 Loaded ${persisted.tasks.length} tasks from .tasks/ markdown files`)
      // Migration: if nothing in markdown but old workspaceState has data, migrate
      if (persisted.tasks.length === 0) {
        const oldState = this.state.loadAll()
        if (oldState.tasks.length > 0) {
          this.logInfo(`📁 Migrating ${oldState.tasks.length} tasks from workspaceState to markdown...`)
          await this.mdState.saveTasks(oldState.tasks, oldState.sessions)
          persisted = oldState
        }
      }
    } else {
      persisted = this.state.loadAll()
    }

    // Load persisted goals
    let persistedGoals: any[] = []
    if (this.mdState) {
      persistedGoals = await this.mdState.loadGoals()
      this.logInfo(`📁 Loaded ${persistedGoals.length} goals from .tasks/ markdown files`)
    }

    // Resolve board type and workflow
    const boardType = yamlSettings?.boardType ?? 'software-engineering'
    const resolvedWorkflow = yamlSettings?.workflow
      ?? WORKFLOW_PRESETS[boardType]?.workflow
      ?? DEFAULT_WORKFLOW

    const data: InitData = {
      workspaces,
      agents,
      models,
      settings: {
        workspacePaths,
        agentConfigPath,
        agentRepoPaths,
        boardType,
        workflow: yamlSettings?.workflow,
        showSplashOnStart: yamlSettings?.board?.showSplashOnStart ?? true,
      },
      persistedTasks: persisted.tasks,
      persistedSessions: persisted.sessions,
      persistedGoals,
      backends,
      defaultBackend,
      workflow: resolvedWorkflow,
      boardType,
    }
    this.logInfo(`Init: ${workspaces.length} workspaces [${workspaces.map(w => `${w.name}(${w.localPath})`).join(', ')}]`)
    this.logInfo(`Init: ${agents.length} agents [${agents.map(a => `${a.name}(${a.role})`).join(', ')}]`)
    this.logInfo(`Init: ${models.length} models, ${persisted.tasks?.length || 0} persisted tasks, ${persisted.sessions?.length || 0} persisted sessions, ${persistedGoals.length} goals`)
    this.post({ type: 'init', data })
  }

  private async scanWorkspaces() {
    // Prefer YAML settings, fall back to VS Code config
    let paths: string[] = []
    if (this.boardSettings) {
      const settings = await this.boardSettings.load()
      paths = settings.workspaces
    }
    if (paths.length === 0) {
      paths = vscode.workspace
        .getConfiguration('agentBoard')
        .get<string[]>('workspacePaths', [])
    }
    const workspaces = await this.scanner.scanPaths(paths)
    this.post({ type: 'workspaces-updated', workspaces })
  }

  private async generateReport(tasks: any[], goals: any[], userPrompt?: string) {
    this.logInfo(`📊 Generating LLM report (${tasks.length} tasks, ${goals.length} goals)`)

    // Build a structured data summary for the prompt
    const now = new Date().toISOString().split('T')[0]
    const dataLines: string[] = []
    dataLines.push(`Date: ${now}`)
    dataLines.push(`Total tasks: ${tasks.length}`)
    dataLines.push(`Total goals: ${goals.length}`)
    dataLines.push('')

    if (goals.length > 0) {
      dataLines.push('## Goals')
      for (const g of goals) {
        const linked = tasks.filter((t: any) => g.taskIds?.includes(t.id))
        const done = linked.filter((t: any) => t.stage === 'done' || t.stage === 'archived').length
        dataLines.push(`- "${g.title}" — ${done}/${linked.length} tasks done${g.deadline ? `, deadline: ${new Date(g.deadline).toISOString().split('T')[0]}` : ''}`)
      }
      dataLines.push('')
    }

    if (tasks.length > 0) {
      dataLines.push('## Tasks')
      for (const t of tasks) {
        dataLines.push(`- "${t.title}" | stage: ${t.stage} | progress: ${t.progress}%`)
      }
      dataLines.push('')
    }

    const systemPrompt = `You are a project status report generator. Given board data (tasks, goals), produce a clear, concise, well-structured Markdown status report. Focus on:
- Overall progress summary
- Goal status and deadlines
- Blocked items (highlight risks)
- Actionable next steps

Keep it professional, scannable, and useful for a team standup or stakeholder update. Use emoji sparingly for visual scanning. Write in the same language as the task titles (if they are German, write in German).`

    const userMessage = userPrompt
      ? `Generate a status report for my board. ${userPrompt}\n\nBoard data:\n${dataLines.join('\n')}`
      : `Generate a status report for my board.\n\nBoard data:\n${dataLines.join('\n')}`

    try {
      const result = await this.llm.sendRequest({
        model: 'copilot-claude-sonnet-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      })
      this.logInfo(`📊 Report generated (${result.tokensUsed} tokens, model: ${result.model})`)
      this.post({ type: 'report-generated', content: result.content })
    } catch (e: any) {
      this.logError(`📊 Report generation failed: ${e.message}`)
      this.post({ type: 'report-generated', content: `**Report generation failed**\n\n${e.message}\n\nMake sure GitHub Copilot is active and signed in.` })
    }
  }

  private async runAgent(agentId: string, taskId: string, prompt: string, sessionMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, workspacePath?: string, branch?: string) {
    // Use cached agents to avoid reloading on every call
    if (!this.cachedAgents) {
      const yamlSettings = this.boardSettings ? await this.boardSettings.load() : null
      this.cachedAgents = await this.agentMgr.loadAgents(yamlSettings?.agents.configPath, yamlSettings?.agents.repoPaths)
    }
    const agentCfg = this.cachedAgents.find((a) => a.id === agentId)
    if (!agentCfg) {
      this.logError(`Agent "${agentId}" not found among ${this.cachedAgents.length} agents: [${this.cachedAgents.map(a => a.id).join(', ')}]`)
      vscode.window.showErrorMessage(`Agent Board: Agent "${agentId}" not found`)
      return this.post({ type: 'error', message: `Agent "${agentId}" not found` })
    }

    // Resolve backend
    const settings = this.boardSettings?.get()
    const backend = settings
      ? await this.registry.resolve(agentCfg, settings)
      : this.registry.get('copilot-lm')!

    this.logInfo(`▶ Running agent "${agentCfg.name}" (${agentCfg.id}) on task ${taskId} via ${backend.label}`)
    this.logInfo(`  Model: ${agentCfg.model}, backend: ${backend.id}, workspace: ${workspacePath || 'none'}, branch: ${branch || 'none'}, history: ${sessionMessages?.length ?? 0} msgs`)
    this.log.show(true)
    vscode.window.showInformationMessage(`Agent Board: ${backend.icon} ${agentCfg.name} is analyzing your task (${backend.label})...`)
    this.post({ type: 'agent-status', agentId, status: 'working', taskId, message: `Running via ${backend.label}…` })

    const tokenSource = new vscode.CancellationTokenSource()
    this.runningAgents.set(agentId, tokenSource)

    try {
      // Build message history
      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
        { role: 'system', content: agentCfg.systemPrompt },
      ]

      // Checkout task branch
      if (branch && workspacePath) {
        try {
          const currentBranch = this.git.getCurrentBranch(workspacePath)
          if (currentBranch === branch) {
            this.logInfo(`  🌿 Already on branch: ${branch}`)
          } else {
            this.logInfo(`  🌿 Switching from ${currentBranch} to branch: ${branch}`)
            this.git.createBranch(workspacePath, branch)
            this.logInfo(`  🌿 Now on branch: ${this.git.getCurrentBranch(workspacePath)}`)
          }
        } catch (e) {
          this.logError(`  ⚠️ Failed to checkout branch "${branch}": ${e}`)
        }
      } else if (!branch && workspacePath) {
        this.logInfo(`  ⚠️ No branch specified — working on current branch: ${this.git.getCurrentBranch(workspacePath)}`)
      }

      // Inject workspace context (for non-CLI backends; CLI reads task file directly)
      if (workspacePath && backend.id !== 'claude-cli') {
        try {
          this.logInfo(`  Scanning workspace context: ${workspacePath}`)
          const wsContext = await this.buildWorkspaceContext(workspacePath)
          if (wsContext) {
            this.logInfo(`  Workspace context: ${wsContext.length} chars`)
            messages.push({ role: 'user', content: `Here is the project context for the workspace at ${workspacePath}:\n\n${wsContext}` })
            messages.push({ role: 'assistant', content: 'Thank you for the project context. I will analyze it and use it for my work.' })
          }
        } catch (e) {
          this.logError(`Failed to scan workspace: ${e}`)
        }
      }

      // Add session history
      if (sessionMessages && sessionMessages.length > 0) {
        for (const m of sessionMessages) {
          if (m.role !== 'system') {
            messages.push({ role: m.role, content: m.content })
          }
        }
      }

      messages.push({ role: 'user', content: prompt })

      // For developer + Copilot LM: inject file-block format instructions
      if (agentCfg.role === 'developer' && workspacePath && backend.id === 'copilot-lm') {
        messages.push({
          role: 'user',
          content: `MANDATORY OUTPUT FORMAT: You MUST output all code changes using file blocks. For EVERY file you create or modify, use EXACTLY this format:

\`\`\`typescript file:relative/path/to/file.ts
// complete file content here
\`\`\`

- Replace "typescript" with the correct language (python, json, css, vue, etc.)
- The path MUST be relative to the workspace root (e.g. src/utils/helpers.ts)
- Output the COMPLETE file contents, NOT partial patches or diffs
- You MUST output at least one file block or the implementation will have no effect
- Without file blocks, NO code will be written to disk

Example:
\`\`\`typescript file:src/example.ts
export function hello() {
  return 'world'
}
\`\`\``,
        })
        messages.push({
          role: 'assistant',
          content: 'Understood. I will output all code changes using ```<lang> file:<path> blocks with complete file contents.',
        })
        messages.push({ role: 'user', content: 'Now implement the task. Remember: output complete files using the file:path format shown above.' })
      }

      this.logInfo(`  📨 Running via ${backend.label} (${messages.length} messages, ~${messages.reduce((n, m) => n + m.content.length, 0)} chars)`)

      // ═══════════════════════════════════════════════════════════════
      // Dispatch to resolved backend
      // ═══════════════════════════════════════════════════════════════

      if (backend.id === 'claude-cli') {
        // CLI backend: post cli-specific messages
        this.post({ type: 'cli-agent-started', taskId, agentId, command: `${this.cli.cliCommand} --print` })
      }

      const result = await backend.run(
        {
          agentId,
          taskId,
          prompt,
          messages,
          workspacePath,
          branch,
          agentConfig: agentCfg,
          sessionMessages,
        },
        {
          onOutput: (chunk) => this.post({ type: 'agent-output', agentId, content: chunk, taskId }),
          onStatus: (msg) => this.logInfo(`  [${backend.label}] ${msg}`),
          onLog: (msg) => this.logInfo(`  [${backend.label}] ${msg}`),
        },
        tokenSource.token,
      )

      // Completion signal
      this.post({ type: 'agent-output', agentId, content: '', tokensUsed: result.tokensUsed, taskId })

      // Backend-specific post-processing
      if (backend.id === 'claude-cli') {
        this.logInfo(`  🖥️ CLI exited with code ${result.exitCode}`)
        this.logInfo(`  🖥️ Commits: ${result.commits?.length ? result.commits.join(', ') : '(none)'}`)
        this.post({
          type: 'cli-agent-done',
          taskId,
          agentId,
          exitCode: result.exitCode ?? 0,
          commits: result.commits ?? [],
          taskFilePath: result.taskFilePath ?? '',
        })
        if (result.commits && result.commits.length > 0) {
          this.post({
            type: 'files-written',
            taskId,
            agentId,
            files: result.commits.map(c => `commit:${c}`),
            commitSha: result.commits[result.commits.length - 1],
          })
        }
        this.post({ type: 'agent-status', agentId, status: 'idle', message: `CLI done — exit ${result.exitCode}, ${result.commits?.length ?? 0} commits` })
        vscode.window.showInformationMessage(`Agent Board: ✔ ${backend.label} finished (${result.commits?.length ?? 0} commit(s))`)

      } else if (backend.id === 'copilot-lm') {
        this.logInfo(`✔ Agent "${agentCfg.name}" done — ${result.tokensUsed} tokens`)

        // Developer + Copilot: parse file blocks → write files → commit
        if (agentCfg.role === 'developer' && workspacePath) {
          this.logInfo(`  🔎 Scanning for file blocks…`)
          const files = this.parseFileBlocks(result.content)
          if (files.length > 0) {
            this.logInfo(`  📝 ${files.length} file block(s): ${files.map(f => f.path).join(', ')}`)
            await this.writeAgentFiles(taskId, agentId, workspacePath, files)
          } else {
            this.logInfo(`  ⚠️ No file blocks found`)
            this.post({ type: 'notification', message: '⚠️ Developer agent produced no file blocks — no code written', level: 'warning' })
          }
        }
        this.post({ type: 'agent-status', agentId, status: 'idle', message: `Done — ${result.tokensUsed} tokens` })
        vscode.window.showInformationMessage(`Agent Board: ✔ ${agentCfg.name} finished (${result.tokensUsed} tokens)`)

      } else {
        // Cline or other backends
        this.post({ type: 'agent-status', agentId, status: 'idle', message: `Done via ${backend.label}` })
        vscode.window.showInformationMessage(`Agent Board: ✔ Task delegated to ${backend.label}`)
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logError(`Agent "${agentCfg.name}" failed: ${msg}`)
      // Signal completion with 0 tokens so the webview can clean up stream buffers
      this.post({ type: 'agent-output', agentId, content: '', tokensUsed: 0, taskId })
      this.post({ type: 'agent-status', agentId, status: 'idle', message: `Error: ${msg}` })
      this.post({ type: 'error', message: `Agent ${agentCfg.name}: ${msg}` })
      vscode.window.showErrorMessage(`Agent Board: ${agentCfg.name} error — ${msg}`)
    } finally {
      const cts = this.runningAgents.get(agentId)
      if (cts) {
        cts.dispose()
        this.runningAgents.delete(agentId)
      }
    }
  }

  /**
   * Parse ```file:path code blocks from LLM output.
   * Supports many formats:
   *   ```typescript file:src/foo.ts
   *   ```ts file:src/foo.ts
   *   ```file:src/foo.ts
   *   ``` file:src/foo.ts
   *   ```typescript file: src/foo.ts  (with space after colon)
   *   <!-- file:src/foo.ts -->  (fallback for markdown)
   */
  private parseFileBlocks(content: string): Array<{ path: string; content: string }> {
    const blocks: Array<{ path: string; content: string }> = []

    // Primary: ```<optional-lang> file:<path>\n<code>\n```
    const regex = /```[\w]*\s*file:\s*([^\n]+)\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const filePath = match[1].trim()
      const fileContent = match[2]
      if (filePath && fileContent) {
        blocks.push({ path: filePath, content: fileContent })
        this.logInfo(`    🔍 Matched file block: "${filePath}" (${fileContent.length} chars)`)
      }
    }

    // Fallback: if no file: blocks found, try to extract code blocks
    // that have a filename-like comment on the first line
    if (blocks.length === 0) {
      const fallbackRegex = /```[\w]*\n\/\/\s*([\w/.-]+\.\w+)\n([\s\S]*?)```/g
      while ((match = fallbackRegex.exec(content)) !== null) {
        const filePath = match[1].trim()
        const fileContent = match[2]
        if (filePath && fileContent && filePath.includes('/')) {
          blocks.push({ path: filePath, content: `// ${filePath}\n${fileContent}` })
          this.logInfo(`    🔍 Fallback matched: "${filePath}" (${fileContent.length} chars)`)
        }
      }
    }

    this.logInfo(`  🔎 parseFileBlocks found ${blocks.length} block(s) in ${content.length} chars`)
    return blocks
  }

  /**
   * Write parsed file blocks to disk, stage, and commit.
   */
  private async writeAgentFiles(
    taskId: string,
    agentId: string,
    workspacePath: string,
    files: Array<{ path: string; content: string }>,
  ) {
    const writtenPaths: string[] = []
    try {
      this.logInfo(`  📂 writeAgentFiles: workspace=${workspacePath}, ${files.length} files`)
      this.logInfo(`  📂 Current branch: ${this.git.getCurrentBranch(workspacePath)}`)

      for (const file of files) {
        const abs = path.resolve(workspacePath, file.path)
        // Security: ensure resolved path is inside workspace (case-insensitive for macOS/Windows)
        const normalizedAbs = abs.toLowerCase()
        const normalizedWs = workspacePath.toLowerCase()
        if (!normalizedAbs.startsWith(normalizedWs + path.sep) && normalizedAbs !== normalizedWs) {
          this.logError(`    ❌ BLOCKED: "${file.path}" resolves outside workspace (${abs})`)
          continue
        }
        this.logInfo(`    📄 Writing: ${abs}`)
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, file.content, 'utf-8')
        writtenPaths.push(file.path)
        this.logInfo(`    ✔ Wrote ${file.path} (${file.content.length} bytes)`)
      }

      // Stage + commit
      this.git.stageFiles(workspacePath, writtenPaths)
      const commitMsg = `agent(${agentId}): update ${writtenPaths.length} file(s)\n\nFiles:\n${writtenPaths.map(f => `- ${f}`).join('\n')}`
      let sha = ''
      if (this.git.hasStagedChanges(workspacePath)) {
        sha = this.git.commit(workspacePath, commitMsg)
        this.logInfo(`    ✔ Committed ${sha}: ${writtenPaths.length} file(s)`)
      } else {
        this.logInfo(`    ℹ️ No staged changes — skipping commit`)
      }

      this.post({
        type: 'files-written',
        taskId,
        agentId,
        files: writtenPaths,
        commitSha: sha || undefined,
        commitMessage: commitMsg,
      })
      vscode.window.showInformationMessage(
        `Agent Board: 📝 ${writtenPaths.length} file(s) written${sha ? ` — commit ${sha}` : ''}`,
      )
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logError(`Failed to write agent files: ${msg}`)
      this.post({ type: 'files-write-error', taskId, agentId, message: msg })
      vscode.window.showErrorMessage(`Agent Board: File write error — ${msg}`)
    }
  }

  private stopAgent(agentId: string) {
    // Cancel LLM API request and dispose the token source
    const tokenSource = this.runningAgents.get(agentId)
    if (tokenSource) {
      tokenSource.cancel()
      tokenSource.dispose()
      this.runningAgents.delete(agentId)
    }
    // Kill CLI subprocess if running
    this.cli.stop(agentId)
    this.post({ type: 'agent-status', agentId, status: 'idle', message: 'Stopped by user' })
  }

  /**
   * Build project context by scanning the workspace directory.
   * Returns a markdown string with file tree + key file contents + source files.
   */
  private async buildWorkspaceContext(workspacePath: string): Promise<string> {
    const sections: string[] = []

    // 1. File tree (max 4 levels deep, skip common noise)
    const tree = await this.buildFileTree(workspacePath, 4)
    if (tree) {
      sections.push(`## Project Structure\n\n\`\`\`\n${tree}\`\`\``)
    }

    // 2. Read key files for context
    const keyFiles = [
      'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
      'Cargo.toml', 'go.mod', 'pyproject.toml', 'pubspec.yaml',
      'README.md', 'Makefile', 'justfile', 'Dockerfile',
    ]
    for (const name of keyFiles) {
      try {
        const content = await fs.readFile(path.join(workspacePath, name), 'utf-8')
        const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n…(truncated)' : content
        sections.push(`## ${name}\n\n\`\`\`\n${truncated}\n\`\`\``)
      } catch { /* file doesn't exist */ }
    }

    // 3. Read ALL source files (the developer agent needs to see actual code)
    const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.go', '.dart', '.rs', '.css', '.scss', '.html', '.json', '.yaml', '.yml', '.toml', '.md'])
    const sourceFiles: Array<{ rel: string; content: string }> = []
    let totalChars = 0
    const MAX_TOTAL_CHARS = 200_000 // ~50k tokens budget for source code context

    const collectSources = async (dir: string, relDir: string) => {
      if (totalChars >= MAX_TOTAL_CHARS) return
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        // Sort: directories first, then files
        const sorted = entries
          .filter((e: any) => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
          .sort((a: any, b: any) => {
            if (a.isDirectory() && !b.isDirectory()) return -1
            if (!a.isDirectory() && b.isDirectory()) return 1
            return a.name.localeCompare(b.name)
          })

        for (const entry of sorted) {
          if (totalChars >= MAX_TOTAL_CHARS) break
          const fullPath = path.join(dir, entry.name)
          const relPath = relDir ? `${relDir}/${entry.name}` : entry.name

          if (entry.isDirectory()) {
            await collectSources(fullPath, relPath)
          } else if (sourceExts.has(path.extname(entry.name))) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8')
              if (content.length > 10_000) {
                // Truncate very large files
                sourceFiles.push({ rel: relPath, content: content.slice(0, 10_000) + '\n…(truncated)' })
                totalChars += 10_000
              } else {
                sourceFiles.push({ rel: relPath, content })
                totalChars += content.length
              }
            } catch { /* skip unreadable */ }
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    await collectSources(workspacePath, '')
    this.logInfo(`  📁 Collected ${sourceFiles.length} source files (${Math.round(totalChars / 1024)}KB)`)

    for (const sf of sourceFiles) {
      const ext = path.extname(sf.rel).replace('.', '')
      sections.push(`## ${sf.rel}\n\n\`\`\`${ext}\n${sf.content}\n\`\`\``)
    }

    return sections.join('\n\n')
  }

  /** Build a file tree string for a directory, up to maxDepth levels. */
  private async buildFileTree(dir: string, maxDepth: number, prefix = '', depth = 0): Promise<string> {
    if (depth >= maxDepth) return ''

    let result = ''
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const sorted = entries
        .filter((e: any) => !e.name.startsWith('.') || e.name === '.env.example')
        .filter((e: any) => !IGNORE_DIRS.has(e.name))
        .sort((a: any, b: any) => {
          // Folders first, then files
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })

      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i]
        const isLast = i === sorted.length - 1
        const connector = isLast ? '└── ' : '├── '
        const childPrefix = isLast ? '    ' : '│   '

        if (entry.isDirectory()) {
          result += `${prefix}${connector}${entry.name}/\n`
          result += await this.buildFileTree(
            path.join(dir, entry.name), maxDepth, prefix + childPrefix, depth + 1,
          )
        } else {
          result += `${prefix}${connector}${entry.name}\n`
        }
      }
    } catch { /* permission error or similar */ }
    return result
  }

  private async createBranch(taskId: string, workspacePath: string, branchName: string) {
    this.logInfo(`Creating branch "${branchName}" in ${workspacePath}`)
    try {
      const created = this.git.createBranch(workspacePath, branchName)
      this.logInfo(`✔ Branch "${created}" created`)
      this.post({ type: 'branch-created', taskId, branchName: created })
      this.post({ type: 'notification', message: `Branch "${created}" created`, level: 'info' })
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logError(`Branch creation failed: ${msg}`)
      this.post({ type: 'branch-error', taskId, message: msg })
      this.post({ type: 'error', message: `Git: ${msg}` })
    }
  }

  private post(msg: ExtensionMessage) {
    this.panel?.webview.postMessage(msg)
  }

  // ─── Webview HTML ─────────────────────────────────────────────

  private buildHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview')
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.css'))
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'logo.png'))
    const nonce = getNonce()

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} https: data:;
  ">
  <link rel="stylesheet" href="${styleUri}">
  <title>Agent Board</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.__LOGO_URI__ = "${logoUri}";</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}
