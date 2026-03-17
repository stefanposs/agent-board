import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'

// ─── Inline copy of BoardSettingsManager.merge (pure function) ──
// Source: ext/BoardSettings.ts

type TransitionEffect =
  | 'set-approval-pending'
  | 'set-approved'
  | 'mark-complete'
  | 'reset-approval'
  | 'reduce-progress'

interface StageConfigDto {
  id: string; label: string; icon: string; color: string
  bgColor?: string; description?: string; isFirst?: boolean; isFinal?: boolean
}

interface TransitionDto {
  from: string; to: string; trigger: 'agent' | 'human' | 'both'
  requiresApproval?: boolean; label: string; effects?: TransitionEffect[]
}

interface AgentStageMapping {
  role: string; stages: string[]; promptTemplate?: string
}

interface WorkflowConfig {
  stages: StageConfigDto[]; transitions: TransitionDto[]; agentStageMappings?: AgentStageMapping[]
}

interface BoardSettings {
  workspaces: string[]
  agents: { configPath: string; repoPaths: string[]; maxVisible: number }
  board: { maxTasks: number; autoSave: boolean; autoSaveIntervalMs: number; showSplashOnStart: boolean }
  developer: { executionMode: 'cli' | 'llm-api'; cliCommand: string; cliArgs: string[] }
  backends: { default: string; claudeCli: { command: string; args: string[] }; cline: { delegateMode: string } }
  workflow?: WorkflowConfig
}

const DEFAULTS: BoardSettings = {
  workspaces: [],
  agents: { configPath: '', repoPaths: [], maxVisible: 0 },
  board: { maxTasks: 0, autoSave: true, autoSaveIntervalMs: 30_000, showSplashOnStart: true },
  developer: { executionMode: 'cli', cliCommand: 'claude', cliArgs: ['--print', '--allowedTools', 'Edit,Write,Bash,Read,MultiEdit'] },
  backends: { default: 'auto', claudeCli: { command: 'claude', args: ['--print', '--allowedTools', 'Edit,Write,Bash,Read,MultiEdit'] }, cline: { delegateMode: 'panel' } },
}

// Extracted merge logic from BoardSettingsManager
function mergeSettings(parsed: Record<string, any>): BoardSettings {
  const s: BoardSettings = JSON.parse(JSON.stringify(DEFAULTS))

  if (Array.isArray(parsed.workspaces)) {
    s.workspaces = parsed.workspaces.map(String)
  }
  if (parsed.agents && typeof parsed.agents === 'object') {
    s.agents = {
      configPath: parsed.agents.configPath ?? DEFAULTS.agents.configPath,
      repoPaths: Array.isArray(parsed.agents.repoPaths) ? parsed.agents.repoPaths.map(String) : DEFAULTS.agents.repoPaths,
      maxVisible: typeof parsed.agents.maxVisible === 'number' ? parsed.agents.maxVisible : DEFAULTS.agents.maxVisible,
    }
  }
  if (parsed.board && typeof parsed.board === 'object') {
    s.board = {
      maxTasks: typeof parsed.board.maxTasks === 'number' ? parsed.board.maxTasks : DEFAULTS.board.maxTasks,
      autoSave: typeof parsed.board.autoSave === 'boolean' ? parsed.board.autoSave : DEFAULTS.board.autoSave,
      autoSaveIntervalMs: typeof parsed.board.autoSaveIntervalMs === 'number' ? parsed.board.autoSaveIntervalMs : DEFAULTS.board.autoSaveIntervalMs,
      showSplashOnStart: typeof parsed.board.showSplashOnStart === 'boolean' ? parsed.board.showSplashOnStart : DEFAULTS.board.showSplashOnStart,
    }
  }
  if (parsed.developer && typeof parsed.developer === 'object') {
    s.developer = {
      executionMode: parsed.developer.executionMode === 'llm-api' ? 'llm-api' : 'cli',
      cliCommand: parsed.developer.cliCommand ?? DEFAULTS.developer.cliCommand,
      cliArgs: Array.isArray(parsed.developer.cliArgs) ? parsed.developer.cliArgs.map(String) : DEFAULTS.developer.cliArgs,
    }
  }
  if (parsed.backends && typeof parsed.backends === 'object') {
    s.backends = {
      default: parsed.backends.default ?? DEFAULTS.backends.default,
      claudeCli: {
        command: parsed.backends.claudeCli?.command ?? parsed.developer?.cliCommand ?? DEFAULTS.backends.claudeCli.command,
        args: Array.isArray(parsed.backends.claudeCli?.args)
          ? parsed.backends.claudeCli.args.map(String)
          : (Array.isArray(parsed.developer?.cliArgs) ? parsed.developer.cliArgs.map(String) : DEFAULTS.backends.claudeCli.args),
      },
      cline: { delegateMode: parsed.backends.cline?.delegateMode ?? DEFAULTS.backends.cline.delegateMode },
    }
  } else if (parsed.developer && typeof parsed.developer === 'object') {
    s.backends = {
      ...DEFAULTS.backends,
      claudeCli: {
        command: parsed.developer.cliCommand ?? DEFAULTS.backends.claudeCli.command,
        args: Array.isArray(parsed.developer.cliArgs) ? parsed.developer.cliArgs.map(String) : DEFAULTS.backends.claudeCli.args,
      },
    }
  }

  // Workflow parsing
  if (parsed.workflow && typeof parsed.workflow === 'object') {
    const wf = parsed.workflow
    const workflow: WorkflowConfig = { stages: [], transitions: [] }
    if (Array.isArray(wf.stages)) {
      workflow.stages = wf.stages
        .filter((st: any) => st && typeof st === 'object' && st.id)
        .map((st: any): StageConfigDto => ({
          id: String(st.id), label: String(st.label || st.id), icon: String(st.icon || '📌'),
          color: String(st.color || '#6b7280'), bgColor: st.bgColor ? String(st.bgColor) : undefined,
          description: st.description ? String(st.description) : undefined,
          isFirst: st.isFirst === true, isFinal: st.isFinal === true,
        }))
    }
    if (Array.isArray(wf.transitions)) {
      workflow.transitions = wf.transitions
        .filter((t: any) => t && typeof t === 'object' && t.from && t.to)
        .map((t: any): TransitionDto => ({
          from: String(t.from), to: String(t.to),
          trigger: (['agent', 'human', 'both'].includes(t.trigger) ? t.trigger : 'both') as 'agent' | 'human' | 'both',
          requiresApproval: t.requiresApproval === true,
          label: String(t.label || `${t.from} → ${t.to}`),
          effects: Array.isArray(t.effects)
            ? t.effects.map(String).filter((e: string): e is TransitionEffect =>
                ['set-approval-pending', 'set-approved', 'mark-complete', 'reset-approval', 'reduce-progress'].includes(e))
            : undefined,
        }))
    }
    if (Array.isArray(wf.agentStageMappings)) {
      workflow.agentStageMappings = wf.agentStageMappings
        .filter((m: any) => m && typeof m === 'object' && m.role)
        .map((m: any): AgentStageMapping => ({
          role: String(m.role), stages: Array.isArray(m.stages) ? m.stages.map(String) : [],
          promptTemplate: m.promptTemplate ? String(m.promptTemplate) : undefined,
        }))
    }
    if (workflow.stages.length > 0 && workflow.transitions.length > 0) {
      if (!workflow.stages.some(st => st.isFirst)) workflow.stages[0].isFirst = true
      if (!workflow.stages.some(st => st.isFinal)) workflow.stages[workflow.stages.length - 1].isFinal = true
      s.workflow = workflow
    }
  }

  return s
}

// ─── Tests ──────────────────────────────────────────────────────

describe('BoardSettings merge', () => {
  describe('empty input returns defaults', () => {
    it('returns all defaults for empty object', () => {
      const result = mergeSettings({})
      expect(result.workspaces).toEqual([])
      expect(result.board.autoSave).toBe(true)
      expect(result.backends.default).toBe('auto')
      expect(result.developer.executionMode).toBe('cli')
      expect(result.workflow).toBeUndefined()
    })
  })

  describe('partial overrides merge with defaults', () => {
    it('overrides workspaces, keeps other defaults', () => {
      const result = mergeSettings({ workspaces: ['~/Repos/foo'] })
      expect(result.workspaces).toEqual(['~/Repos/foo'])
      expect(result.board.maxTasks).toBe(0)
    })

    it('overrides board.autoSave, keeps board.maxTasks', () => {
      const result = mergeSettings({ board: { autoSave: false } })
      expect(result.board.autoSave).toBe(false)
      expect(result.board.maxTasks).toBe(0)
    })

    it('overrides agents.maxVisible', () => {
      const result = mergeSettings({ agents: { maxVisible: 5 } })
      expect(result.agents.maxVisible).toBe(5)
      expect(result.agents.configPath).toBe('')
    })
  })

  describe('backwards compatibility: developer → backends migration', () => {
    it('migrates developer.cliCommand to backends.claudeCli.command when backends is absent', () => {
      const result = mergeSettings({
        developer: { cliCommand: '/usr/local/bin/claude', cliArgs: ['--verbose'] },
      })
      expect(result.backends.claudeCli.command).toBe('/usr/local/bin/claude')
      expect(result.backends.claudeCli.args).toEqual(['--verbose'])
    })

    it('uses backends section when both developer and backends are present', () => {
      const result = mergeSettings({
        developer: { cliCommand: 'old-claude' },
        backends: { default: 'claude-cli', claudeCli: { command: 'new-claude', args: ['--new'] } },
      })
      expect(result.backends.claudeCli.command).toBe('new-claude')
      expect(result.backends.claudeCli.args).toEqual(['--new'])
      expect(result.backends.default).toBe('claude-cli')
    })
  })

  describe('workflow parsing', () => {
    it('parses a minimal valid workflow', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'todo', label: 'To Do', icon: '📌', color: '#ccc', isFirst: true },
            { id: 'done', label: 'Done', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [
            { from: 'todo', to: 'done', trigger: 'both', label: 'Complete' },
          ],
        },
      })
      expect(result.workflow).toBeDefined()
      expect(result.workflow!.stages).toHaveLength(2)
      expect(result.workflow!.transitions).toHaveLength(1)
      expect(result.workflow!.stages[0].isFirst).toBe(true)
      expect(result.workflow!.stages[1].isFinal).toBe(true)
    })

    it('auto-adds isFirst to first stage when missing', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc' },
            { id: 'b', label: 'B', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [{ from: 'a', to: 'b', trigger: 'both', label: 'Go' }],
        },
      })
      expect(result.workflow!.stages[0].isFirst).toBe(true)
    })

    it('auto-adds isFinal to last stage when missing', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc', isFirst: true },
            { id: 'b', label: 'B', icon: '✅', color: '#0f0' },
          ],
          transitions: [{ from: 'a', to: 'b', trigger: 'both', label: 'Go' }],
        },
      })
      expect(result.workflow!.stages[1].isFinal).toBe(true)
    })

    it('rejects workflow with stages but no transitions', () => {
      const result = mergeSettings({
        workflow: {
          stages: [{ id: 'todo', label: 'Todo', icon: '📌', color: '#ccc' }],
          transitions: [],
        },
      })
      expect(result.workflow).toBeUndefined()
    })

    it('rejects workflow with transitions but no stages', () => {
      const result = mergeSettings({
        workflow: {
          stages: [],
          transitions: [{ from: 'a', to: 'b', trigger: 'both', label: 'Go' }],
        },
      })
      expect(result.workflow).toBeUndefined()
    })

    it('filters out stages without id', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc', isFirst: true },
            { label: 'NoId', icon: '?', color: '#ccc' }, // Missing id
            { id: 'b', label: 'B', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [{ from: 'a', to: 'b', trigger: 'both', label: 'Go' }],
        },
      })
      expect(result.workflow!.stages).toHaveLength(2)
    })

    it('filters out transitions without from/to', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc', isFirst: true },
            { id: 'b', label: 'B', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [
            { from: 'a', to: 'b', trigger: 'both', label: 'Go' },
            { from: 'a', label: 'Bad' }, // Missing 'to'
          ],
        },
      })
      expect(result.workflow!.transitions).toHaveLength(1)
    })

    it('defaults invalid trigger to "both"', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc', isFirst: true },
            { id: 'b', label: 'B', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [{ from: 'a', to: 'b', trigger: 'invalid', label: 'Go' }],
        },
      })
      expect(result.workflow!.transitions[0].trigger).toBe('both')
    })

    it('filters out invalid transition effects', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc', isFirst: true },
            { id: 'b', label: 'B', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [{ from: 'a', to: 'b', trigger: 'both', label: 'Go', effects: ['mark-complete', 'bogus-effect'] }],
        },
      })
      expect(result.workflow!.transitions[0].effects).toEqual(['mark-complete'])
    })

    it('parses agentStageMappings with promptTemplate', () => {
      const result = mergeSettings({
        workflow: {
          stages: [
            { id: 'a', label: 'A', icon: '📌', color: '#ccc', isFirst: true },
            { id: 'b', label: 'B', icon: '✅', color: '#0f0', isFinal: true },
          ],
          transitions: [{ from: 'a', to: 'b', trigger: 'both', label: 'Go' }],
          agentStageMappings: [
            { role: 'dev', stages: ['a', 'b'], promptTemplate: 'Build {title}' },
          ],
        },
      })
      expect(result.workflow!.agentStageMappings).toHaveLength(1)
      expect(result.workflow!.agentStageMappings![0].promptTemplate).toBe('Build {title}')
    })
  })

  describe('full YAML round-trip via yaml parser', () => {
    it('parses a realistic board.yaml correctly', () => {
      const yaml = `
workspaces:
  - ~/Repos/my-app

agents:
  configPath: ""
  repoPaths:
    - ~/Repos/ai-agents
  maxVisible: 3

board:
  maxTasks: 50
  autoSave: false
  autoSaveIntervalMs: 60000

backends:
  default: claude-cli
  claudeCli:
    command: /opt/bin/claude
    args: [--print, --verbose]
  cline:
    delegateMode: panel

workflow:
  stages:
    - id: backlog
      label: "Backlog"
      icon: "📥"
      color: "#666"
      isFirst: true
    - id: active
      label: "Active"
      icon: "🚀"
      color: "#3b82f6"
    - id: done
      label: "Done"
      icon: "✅"
      color: "#10b981"
      isFinal: true
  transitions:
    - from: backlog
      to: active
      trigger: both
      label: "Start"
    - from: active
      to: done
      trigger: human
      requiresApproval: true
      label: "Complete"
      effects: [set-approved, mark-complete]
  agentStageMappings:
    - role: developer
      stages: [backlog, active]
`
      const parsed = parseYaml(yaml)
      const result = mergeSettings(parsed)

      expect(result.workspaces).toEqual(['~/Repos/my-app'])
      expect(result.agents.repoPaths).toEqual(['~/Repos/ai-agents'])
      expect(result.agents.maxVisible).toBe(3)
      expect(result.board.maxTasks).toBe(50)
      expect(result.board.autoSave).toBe(false)
      expect(result.backends.default).toBe('claude-cli')
      expect(result.backends.claudeCli.command).toBe('/opt/bin/claude')
      expect(result.workflow).toBeDefined()
      expect(result.workflow!.stages).toHaveLength(3)
      expect(result.workflow!.transitions).toHaveLength(2)
      expect(result.workflow!.transitions[1].effects).toEqual(['set-approved', 'mark-complete'])
      expect(result.workflow!.agentStageMappings).toHaveLength(1)
    })
  })
})
