import * as fs from 'fs/promises'
import * as path from 'path'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_WORKFLOW } from './protocol'
import type { WorkflowConfig, StageConfigDto, TransitionDto, AgentStageMapping, TransitionEffect } from './protocol'

// ─── Types ──────────────────────────────────────────────────────

export interface BoardSettings {
  /** Workspace paths to scan for git repos. */
  workspaces: string[]

  /** Agent configuration. */
  agents: {
    /** Path to a JSON file or directory with agent configs. */
    configPath: string
    /** Paths to agent repos containing skills/ or agents/ directories. */
    repoPaths: string[]
    /** Max visible agents in the sidebar (0 = all). */
    maxVisible: number
  }

  /** Board display settings. */
  board: {
    /** Max tasks to display in the board view (0 = unlimited). */
    maxTasks: number
    /** Default priority for new tasks. */
    defaultPriority: 'low' | 'medium' | 'high' | 'critical'
    /** Auto-save state to markdown files. */
    autoSave: boolean
    /** Auto-save interval in milliseconds. */
    autoSaveIntervalMs: number
  }

  /** Developer agent settings. */
  developer: {
    /** Execution mode: 'cli' uses claude/cline, 'llm-api' uses VS Code LM API. */
    executionMode: 'cli' | 'llm-api'
    /** CLI command to use for developer agent. */
    cliCommand: string
    /** Additional CLI arguments. */
    cliArgs: string[]
  }

  /** Backend selection settings. */
  backends: {
    /** Default backend: 'auto' | 'copilot-lm' | 'claude-cli' | 'cline'. */
    default: string
    /** Claude CLI configuration. */
    claudeCli: {
      command: string
      args: string[]
    }
    /** Cline extension configuration. */
    cline: {
      delegateMode: 'panel'
    }
  }

  /** Configurable workflow state machine (optional — defaults to dev pipeline). */
  workflow?: WorkflowConfig
}

// ─── Defaults ───────────────────────────────────────────────────

const DEFAULTS: BoardSettings = {
  workspaces: [],
  agents: {
    configPath: '',
    repoPaths: [],
    maxVisible: 0,
  },
  board: {
    maxTasks: 0,
    defaultPriority: 'medium',
    autoSave: true,
    autoSaveIntervalMs: 30_000,
  },
  developer: {
    executionMode: 'cli',
    cliCommand: 'claude',
    cliArgs: ['--print', '--allowedTools', 'Edit,Write,Bash,Read,MultiEdit'],
  },
  backends: {
    default: 'auto',
    claudeCli: {
      command: 'claude',
      args: ['--print', '--allowedTools', 'Edit,Write,Bash,Read,MultiEdit'],
    },
    cline: {
      delegateMode: 'panel',
    },
  },
}

export { DEFAULT_WORKFLOW }

// ─── YAML serializer (human-readable with comments) ────────────

function toYaml(settings: BoardSettings): string {
  const lines: string[] = [
    '# Agent Board Settings',
    '# This file configures the Agent Board extension.',
    '# Edit this file to customize workspaces, agents, and behavior.',
    '',
    '# Workspace paths to scan for git repositories.',
    '# Each path is scanned for git repos (direct or one level deep).',
    'workspaces:',
  ]

  if (settings.workspaces.length > 0) {
    for (const ws of settings.workspaces) {
      lines.push(`  - ${ws}`)
    }
  } else {
    lines.push('  # - ~/Repos/my-project')
    lines.push('  # - ~/Repos/other-project')
  }

  lines.push('')
  lines.push('# Agent configuration.')
  lines.push('agents:')
  lines.push(`  configPath: ${settings.agents.configPath || '""'}`)
  lines.push('  repoPaths:')
  if (settings.agents.repoPaths.length > 0) {
    for (const rp of settings.agents.repoPaths) {
      lines.push(`    - ${rp}`)
    }
  } else {
    lines.push('    # - ~/Repos/ai-agents')
  }
  lines.push(`  maxVisible: ${settings.agents.maxVisible}    # 0 = show all`)

  lines.push('')
  lines.push('# Board display settings.')
  lines.push('board:')
  lines.push(`  maxTasks: ${settings.board.maxTasks}          # 0 = unlimited`)
  lines.push(`  defaultPriority: ${settings.board.defaultPriority}`)
  lines.push(`  autoSave: ${settings.board.autoSave}`)
  lines.push(`  autoSaveIntervalMs: ${settings.board.autoSaveIntervalMs}`)

  lines.push('')
  lines.push('# Developer agent settings.')
  lines.push('developer:')
  lines.push(`  executionMode: ${settings.developer.executionMode}    # cli or llm-api`)
  lines.push(`  cliCommand: ${settings.developer.cliCommand}`)
  lines.push(`  cliArgs: [${settings.developer.cliArgs.join(', ')}]`)

  lines.push('')
  lines.push('# Backend selection.')
  lines.push('backends:')
  lines.push(`  default: ${settings.backends.default}    # auto, copilot-lm, claude-cli, cline`)
  lines.push('  claudeCli:')
  lines.push(`    command: ${settings.backends.claudeCli.command}`)
  lines.push(`    args: [${settings.backends.claudeCli.args.join(', ')}]`)
  lines.push('  cline:')
  lines.push(`    delegateMode: ${settings.backends.cline.delegateMode}`)

  // Serialize workflow if present (and not the default)
  const wf = settings.workflow
  if (wf && wf.stages.length > 0) {
    lines.push('')
    lines.push('# Workflow state machine configuration.')
    lines.push('# Define custom stages, transitions, agent mappings, and HIL (Human-in-the-Loop) gates.')
    lines.push('workflow:')
    lines.push('  stages:')
    for (const s of wf.stages) {
      lines.push(`    - id: ${s.id}`)
      lines.push(`      label: "${s.label}"`)
      lines.push(`      icon: "${s.icon}"`)
      lines.push(`      color: "${s.color}"`)
      if (s.bgColor) lines.push(`      bgColor: "${s.bgColor}"`)
      if (s.description) lines.push(`      description: "${s.description}"`)
      if (s.isFirst) lines.push(`      isFirst: true`)
      if (s.isFinal) lines.push(`      isFinal: true`)
    }
    lines.push('  transitions:')
    for (const t of wf.transitions) {
      lines.push(`    - from: ${t.from}`)
      lines.push(`      to: ${t.to}`)
      lines.push(`      trigger: ${t.trigger}`)
      if (t.requiresApproval) lines.push(`      requiresApproval: true`)
      lines.push(`      label: "${t.label}"`)
      if (t.effects && t.effects.length > 0) {
        lines.push(`      effects: [${t.effects.join(', ')}]`)
      }
    }
    if (wf.agentStageMappings && wf.agentStageMappings.length > 0) {
      lines.push('  agentStageMappings:')
      for (const m of wf.agentStageMappings) {
        lines.push(`    - role: ${m.role}`)
        lines.push(`      stages: [${m.stages.join(', ')}]`)
        if (m.promptTemplate) lines.push(`      promptTemplate: "${m.promptTemplate}"`)
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ─── Settings Manager ───────────────────────────────────────────

export class BoardSettingsManager {
  private settings: BoardSettings = { ...DEFAULTS }
  private settingsPath: string

  constructor(private basePath: string) {
    this.settingsPath = path.join(basePath, '.tasks', 'board.yaml')
  }

  /** Load settings from .tasks/board.yaml, merging with defaults. */
  async load(): Promise<BoardSettings> {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf-8')
      const parsed = parseYaml(raw) ?? {}
      this.settings = this.merge(parsed)
    } catch {
      // No settings file — use defaults
      this.settings = { ...DEFAULTS }
    }

    // Also read from VS Code settings as fallback
    try {
      const vscodeConfig = await this.readVSCodeFallback()
      if (this.settings.workspaces.length === 0 && vscodeConfig.workspaces.length > 0) {
        this.settings.workspaces = vscodeConfig.workspaces
      }
      if (this.settings.agents.repoPaths.length === 0 && vscodeConfig.agentRepoPaths.length > 0) {
        this.settings.agents.repoPaths = vscodeConfig.agentRepoPaths
      }
      if (!this.settings.agents.configPath && vscodeConfig.agentConfigPath) {
        this.settings.agents.configPath = vscodeConfig.agentConfigPath
      }
    } catch { /* ignore */ }

    return this.settings
  }

  /** Get current settings (must call load() first). */
  get(): BoardSettings {
    return this.settings
  }

  /** Save current settings to .tasks/board.yaml. */
  async save(settings?: BoardSettings): Promise<void> {
    if (settings) this.settings = settings
    const dir = path.dirname(this.settingsPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.settingsPath, toYaml(this.settings), 'utf-8')
  }

  /** Create a default settings file if none exists. */
  async ensureExists(): Promise<boolean> {
    try {
      await fs.access(this.settingsPath)
      return false // already exists
    } catch {
      await this.save(this.settings)
      return true // created new
    }
  }

  /** Merge parsed YAML with defaults. */
  private merge(parsed: Record<string, any>): BoardSettings {
    const s = { ...DEFAULTS }

    // Workspaces
    if (Array.isArray(parsed.workspaces)) {
      s.workspaces = parsed.workspaces.map(String)
    }

    // Agents
    if (parsed.agents && typeof parsed.agents === 'object') {
      s.agents = {
        configPath: parsed.agents.configPath ?? DEFAULTS.agents.configPath,
        repoPaths: Array.isArray(parsed.agents.repoPaths)
          ? parsed.agents.repoPaths.map(String)
          : DEFAULTS.agents.repoPaths,
        maxVisible: typeof parsed.agents.maxVisible === 'number'
          ? parsed.agents.maxVisible
          : DEFAULTS.agents.maxVisible,
      }
    }

    // Board
    if (parsed.board && typeof parsed.board === 'object') {
      s.board = {
        maxTasks: typeof parsed.board.maxTasks === 'number'
          ? parsed.board.maxTasks
          : DEFAULTS.board.maxTasks,
        defaultPriority: parsed.board.defaultPriority ?? DEFAULTS.board.defaultPriority,
        autoSave: typeof parsed.board.autoSave === 'boolean'
          ? parsed.board.autoSave
          : DEFAULTS.board.autoSave,
        autoSaveIntervalMs: typeof parsed.board.autoSaveIntervalMs === 'number'
          ? parsed.board.autoSaveIntervalMs
          : DEFAULTS.board.autoSaveIntervalMs,
      }
    }

    // Developer
    if (parsed.developer && typeof parsed.developer === 'object') {
      s.developer = {
        executionMode: parsed.developer.executionMode === 'llm-api' ? 'llm-api' : 'cli',
        cliCommand: parsed.developer.cliCommand ?? DEFAULTS.developer.cliCommand,
        cliArgs: Array.isArray(parsed.developer.cliArgs)
          ? parsed.developer.cliArgs.map(String)
          : DEFAULTS.developer.cliArgs,
      }
    }

    // Backends
    if (parsed.backends && typeof parsed.backends === 'object') {
      s.backends = {
        default: parsed.backends.default ?? DEFAULTS.backends.default,
        claudeCli: {
          command: parsed.backends.claudeCli?.command ?? parsed.developer?.cliCommand ?? DEFAULTS.backends.claudeCli.command,
          args: Array.isArray(parsed.backends.claudeCli?.args)
            ? parsed.backends.claudeCli.args.map(String)
            : (Array.isArray(parsed.developer?.cliArgs) ? parsed.developer.cliArgs.map(String) : DEFAULTS.backends.claudeCli.args),
        },
        cline: {
          delegateMode: parsed.backends.cline?.delegateMode ?? DEFAULTS.backends.cline.delegateMode,
        },
      }
    } else if (parsed.developer && typeof parsed.developer === 'object') {
      // Backwards compat: migrate old developer section to backends
      s.backends = {
        ...DEFAULTS.backends,
        claudeCli: {
          command: parsed.developer.cliCommand ?? DEFAULTS.backends.claudeCli.command,
          args: Array.isArray(parsed.developer.cliArgs)
            ? parsed.developer.cliArgs.map(String)
            : DEFAULTS.backends.claudeCli.args,
        },
      }
    }

    // Workflow (state machine)
    if (parsed.workflow && typeof parsed.workflow === 'object') {
      const wf = parsed.workflow
      const workflow: WorkflowConfig = { stages: [], transitions: [] }

      // Parse stages
      if (Array.isArray(wf.stages)) {
        workflow.stages = wf.stages
          .filter((s: any) => s && typeof s === 'object' && s.id)
          .map((s: any): StageConfigDto => ({
            id: String(s.id),
            label: String(s.label || s.id),
            icon: String(s.icon || '📌'),
            color: String(s.color || '#6b7280'),
            bgColor: s.bgColor ? String(s.bgColor) : undefined,
            description: s.description ? String(s.description) : undefined,
            isFirst: s.isFirst === true,
            isFinal: s.isFinal === true,
          }))
      }

      // Parse transitions
      if (Array.isArray(wf.transitions)) {
        workflow.transitions = wf.transitions
          .filter((t: any) => t && typeof t === 'object' && t.from && t.to)
          .map((t: any): TransitionDto => ({
            from: String(t.from),
            to: String(t.to),
            trigger: (['agent', 'human', 'both'].includes(t.trigger) ? t.trigger : 'both') as 'agent' | 'human' | 'both',
            requiresApproval: t.requiresApproval === true,
            label: String(t.label || `${t.from} → ${t.to}`),
            effects: Array.isArray(t.effects)
              ? t.effects.map(String).filter((e: string): e is TransitionEffect =>
                  ['set-approval-pending', 'set-approved', 'mark-complete', 'reset-approval', 'reduce-progress'].includes(e)
                )
              : undefined,
          }))
      }

      // Parse agent stage mappings
      if (Array.isArray(wf.agentStageMappings)) {
        workflow.agentStageMappings = wf.agentStageMappings
          .filter((m: any) => m && typeof m === 'object' && m.role)
          .map((m: any): AgentStageMapping => ({
            role: String(m.role),
            stages: Array.isArray(m.stages) ? m.stages.map(String) : [],
            promptTemplate: m.promptTemplate ? String(m.promptTemplate) : undefined,
          }))
      }

      // Validate: at least one stage and one transition
      if (workflow.stages.length > 0 && workflow.transitions.length > 0) {
        // Ensure exactly one isFirst and at least one isFinal
        if (!workflow.stages.some(st => st.isFirst)) {
          workflow.stages[0].isFirst = true
        }
        if (!workflow.stages.some(st => st.isFinal)) {
          workflow.stages[workflow.stages.length - 1].isFinal = true
        }
        // Validate transitions reference valid stage IDs
        const stageIds = new Set(workflow.stages.map(st => st.id))
        workflow.transitions = workflow.transitions.filter(
          t => stageIds.has(t.from) && stageIds.has(t.to),
        )
        s.workflow = workflow
      }
    }

    return s
  }

  /** Read VS Code settings as fallback source. */
  private async readVSCodeFallback(): Promise<{
    workspaces: string[]
    agentRepoPaths: string[]
    agentConfigPath: string
  }> {
    // This is called from the extension host where vscode is available
    // We dynamically import to avoid issues in tests
    try {
      const vscode = require('vscode')
      const cfg = vscode.workspace.getConfiguration('agentBoard')
      return {
        workspaces: (cfg.get('workspacePaths', []) as string[]),
        agentRepoPaths: [
          ...(cfg.get('agentRepoPaths', []) as string[]),
          (cfg.get('agentRepoPath', '') as string),
        ].filter(Boolean),
        agentConfigPath: (cfg.get('agentConfigPath', '') as string),
      }
    } catch {
      return { workspaces: [], agentRepoPaths: [], agentConfigPath: '' }
    }
  }

  /** Get the path to the settings file. */
  getSettingsPath(): string {
    return this.settingsPath
  }
}
