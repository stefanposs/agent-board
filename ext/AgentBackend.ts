import * as vscode from 'vscode'
import type { AgentConfig, BackendId, BackendInfo } from './protocol'
import type { BoardSettings } from './BoardSettings'
import { LLMService } from './LLMService'
import { CliAgentService } from './CliAgentService'

// ─── Types ──────────────────────────────────────────────────────

export type { BackendId, BackendInfo }

export interface AgentRunRequest {
  agentId: string
  taskId: string
  prompt: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  workspacePath?: string
  branch?: string
  agentConfig: AgentConfig
  sessionMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}

export interface AgentRunCallbacks {
  onOutput: (chunk: string) => void
  onStatus: (message: string) => void
  onLog: (message: string) => void
}

export interface AgentRunResult {
  content: string
  tokensUsed: number
  exitCode?: number
  commits?: string[]
  taskFilePath?: string
}

// ─── Backend Interface ──────────────────────────────────────────

export interface AgentBackend {
  readonly id: BackendId
  readonly label: string
  readonly icon: string
  isAvailable(): Promise<boolean>
  run(request: AgentRunRequest, callbacks: AgentRunCallbacks, token?: vscode.CancellationToken): Promise<AgentRunResult>
  stop(agentId: string): boolean
}

// ─── Copilot LM Backend ────────────────────────────────────────

export class CopilotBackend implements AgentBackend {
  readonly id: BackendId = 'copilot-lm'
  readonly label = 'GitHub Copilot'
  readonly icon = '🤖'

  constructor(private llm: LLMService) {}

  async isAvailable(): Promise<boolean> {
    try {
      const models = await this.llm.getModels()
      return models.length > 0
    } catch {
      return false
    }
  }

  async run(request: AgentRunRequest, callbacks: AgentRunCallbacks, token?: vscode.CancellationToken): Promise<AgentRunResult> {
    callbacks.onStatus(`Sending to ${request.agentConfig.model}…`)

    const res = await this.llm.sendRequest({
      model: request.agentConfig.model,
      messages: request.messages,
      onChunk: (chunk) => callbacks.onOutput(chunk),
      token,
    })

    return {
      content: res.content,
      tokensUsed: res.tokensUsed,
    }
  }

  stop(_agentId: string): boolean {
    // Cancellation handled via CancellationToken, not here
    return false
  }
}

// ─── Claude CLI Backend ─────────────────────────────────────────

export class ClaudeCliBackend implements AgentBackend {
  readonly id: BackendId = 'claude-cli'
  readonly label = 'Claude CLI'
  readonly icon = '⌨️'

  constructor(private cli: CliAgentService) {}

  async isAvailable(): Promise<boolean> {
    return this.cli.isAvailable()
  }

  async run(request: AgentRunRequest, callbacks: AgentRunCallbacks): Promise<AgentRunResult> {
    const { agentId, taskId, workspacePath, branch, agentConfig, sessionMessages } = request

    if (!workspacePath) {
      throw new Error('Claude CLI requires a workspace path')
    }

    callbacks.onStatus('Writing task file…')

    // Build task context from prompt + session
    const plannerNotes = sessionMessages
      ?.filter(m => m.role === 'assistant')
      .map(m => m.content)
      .join('\n\n') || ''

    const taskFilePath = await CliAgentService.writeTaskFile(
      workspacePath,
      taskId,
      {
        title: `Task ${taskId.slice(0, 8)}`,
        description: request.prompt,
        stage: 'implementation',
        branch,
        tags: [],
        plannerNotes,
        reviewerFeedback: '',
        conversationHistory: sessionMessages
          ?.map(m => `**${m.role}:** ${m.content.slice(0, 500)}`)
          .join('\n\n') || '',
      },
    )

    callbacks.onLog(`Task file written: ${taskFilePath}`)
    callbacks.onStatus(`Running claude CLI…`)

    const result = await this.cli.run(agentId, {
      workspacePath,
      taskFilePath,
      branch,
      onStdout: (chunk) => callbacks.onOutput(chunk),
      onStderr: (chunk) => callbacks.onLog(`[stderr] ${chunk}`),
    })

    // Append results to task file
    await CliAgentService.appendResults(workspacePath, taskFilePath, result)

    return {
      content: result.stdout,
      tokensUsed: 0,
      exitCode: result.exitCode,
      commits: result.commits.map(c => c.slice(0, 7)),
      taskFilePath,
    }
  }

  stop(agentId: string): boolean {
    return this.cli.stop(agentId)
  }
}

// ─── Cline Extension Backend ────────────────────────────────────

export class ClineBackend implements AgentBackend {
  readonly id: BackendId = 'cline'
  readonly label = 'Cline'
  readonly icon = '🔮'

  async isAvailable(): Promise<boolean> {
    // Check for both Cline and Roo Code (common fork)
    return !!(
      vscode.extensions.getExtension('saoudrizwan.claude-dev') ||
      vscode.extensions.getExtension('rooveterinaryinc.roo-cline')
    )
  }

  async run(request: AgentRunRequest, callbacks: AgentRunCallbacks): Promise<AgentRunResult> {
    callbacks.onStatus('Delegating to Cline…')

    // Build a concise prompt for Cline
    const taskPrompt = [
      request.agentConfig.systemPrompt,
      '',
      '---',
      '',
      request.prompt,
    ].join('\n')

    try {
      // Try the standard Cline command API
      await vscode.commands.executeCommand('cline.sendMessage', taskPrompt)
      callbacks.onOutput(`✅ Task delegated to Cline panel.\n\nThe task is now running in Cline's sidebar. Check the Cline panel for progress and output.\n`)
      callbacks.onLog('Task delegated to Cline via cline.sendMessage command')
    } catch {
      // Fallback: try opening Cline with the prompt in a new task
      try {
        await vscode.commands.executeCommand('cline.newTask', taskPrompt)
        callbacks.onOutput(`✅ Task sent to Cline as a new task.\n\nCheck the Cline panel for progress.\n`)
        callbacks.onLog('Task delegated to Cline via cline.newTask command')
      } catch (e) {
        // Last resort: copy prompt to clipboard and notify user
        try {
          await vscode.env.clipboard.writeText(taskPrompt)
          vscode.window.showInformationMessage('Cline command failed. Task prompt copied to clipboard. Open Cline and paste.', 'Open Cline').then(sel => {
            if (sel === 'Open Cline') vscode.commands.executeCommand('workbench.view.extension.cline')
          })
          callbacks.onOutput(`📋 Prompt copied to clipboard. Open Cline and paste to start the task.\n`)
          callbacks.onLog('Copied prompt to clipboard — Cline commands unavailable')
        } catch (e2) {
          throw new Error(`Could not communicate with Cline extension: ${e2}`)
        }
      }
    }

    return {
      content: 'Task delegated to Cline',
      tokensUsed: 0,
    }
  }

  stop(_agentId: string): boolean {
    // Try to abort Cline's current task
    try {
      vscode.commands.executeCommand('cline.abortTask')
      return true
    } catch {
      return false
    }
  }
}

// ─── Backend Registry ───────────────────────────────────────────

export class BackendRegistry {
  private backends = new Map<BackendId, AgentBackend>()

  constructor(llm: LLMService, cli: CliAgentService) {
    this.backends.set('copilot-lm', new CopilotBackend(llm))
    this.backends.set('claude-cli', new ClaudeCliBackend(cli))
    this.backends.set('cline', new ClineBackend())
  }

  get(id: BackendId): AgentBackend | undefined {
    return this.backends.get(id)
  }

  /** Probe all backends and return availability info. */
  async detectAvailable(): Promise<BackendInfo[]> {
    const results: BackendInfo[] = []
    for (const backend of this.backends.values()) {
      const available = await backend.isAvailable()
      results.push({
        id: backend.id,
        label: backend.label,
        icon: backend.icon,
        available,
      })
    }
    return results
  }

  /**
   * Resolve which backend to use for a given agent + settings.
   * Priority: per-agent override → global default → auto-detect.
   */
  async resolve(agentConfig: AgentConfig, settings: BoardSettings): Promise<AgentBackend> {
    // 1. Per-agent explicit backend
    const agentBackendId = (agentConfig as any).backend as BackendId | 'auto' | undefined
    if (agentBackendId && agentBackendId !== 'auto') {
      const backend = this.backends.get(agentBackendId)
      if (backend && await backend.isAvailable()) {
        return backend
      }
      // Requested backend not available — fall through to auto
    }

    // 2. Global default from settings
    const globalDefault = settings.backends?.default as BackendId | 'auto' | undefined
    if (globalDefault && globalDefault !== 'auto') {
      const backend = this.backends.get(globalDefault)
      if (backend && await backend.isAvailable()) {
        return backend
      }
    }

    // 3. Auto-detect: developer role prefers CLI, others prefer Copilot LM
    if (agentConfig.role === 'developer') {
      // Developer: CLI → Copilot LM → Cline
      for (const id of ['claude-cli', 'copilot-lm', 'cline'] as BackendId[]) {
        const backend = this.backends.get(id)
        if (backend && await backend.isAvailable()) return backend
      }
    } else {
      // Non-developer: Copilot LM → CLI → Cline
      for (const id of ['copilot-lm', 'claude-cli', 'cline'] as BackendId[]) {
        const backend = this.backends.get(id)
        if (backend && await backend.isAvailable()) return backend
      }
    }

    // 4. No backend available
    throw new Error(
      'No AI backend available. Install GitHub Copilot Chat, the Claude CLI, or the Cline extension.',
    )
  }
}
