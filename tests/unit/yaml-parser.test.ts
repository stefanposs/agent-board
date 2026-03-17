import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'

// ─── YAML Parsing Tests ────────────────────────────────────────
// Tests that the `yaml` npm package correctly parses the board.yaml format,
// including the new workflow section with arrays-of-objects.

describe('YAML parsing: basic values', () => {
  it('should parse strings', () => {
    const r = parse('name: My Board')
    expect(r.name).toBe('My Board')
  })

  it('should parse quoted strings', () => {
    const r = parse('name: "hello world"')
    expect(r.name).toBe('hello world')
  })

  it('should parse booleans', () => {
    const r = parse('autoSave: true\ndebug: false')
    expect(r.autoSave).toBe(true)
    expect(r.debug).toBe(false)
  })

  it('should parse integers', () => {
    const r = parse('count: 42\nneg: -7')
    expect(r.count).toBe(42)
    expect(r.neg).toBe(-7)
  })

  it('should parse floats', () => {
    const r = parse('pi: 3.14')
    expect(r.pi).toBe(3.14)
  })

  it('should parse inline arrays', () => {
    const r = parse('items: [a, b, c]')
    expect(r.items).toEqual(['a', 'b', 'c'])
  })

  it('should handle empty inline array', () => {
    const r = parse('items: []')
    expect(r.items).toEqual([])
  })
})

describe('YAML parsing: structure', () => {
  it('should parse nested key-value pairs', () => {
    const yaml = 'board:\n  maxTasks: 10\n  autoSave: true'
    const r = parse(yaml)
    expect(r.board.maxTasks).toBe(10)
    expect(r.board.autoSave).toBe(true)
  })

  it('should parse list items', () => {
    const yaml = 'workspaces:\n  - ~/Repos/project-a\n  - ~/Repos/project-b'
    const r = parse(yaml)
    expect(r.workspaces).toEqual(['~/Repos/project-a', '~/Repos/project-b'])
  })

  it('should skip comments and empty lines', () => {
    const yaml = '# comment\nname: Test\n\n# another comment\nversion: 2'
    const r = parse(yaml)
    expect(r.name).toBe('Test')
    expect(r.version).toBe(2)
  })

  it('should parse 3-level nesting', () => {
    const yaml = 'backends:\n  claudeCli:\n    command: claude\n    args: --print'
    const r = parse(yaml)
    expect(r.backends.claudeCli.command).toBe('claude')
    expect(r.backends.claudeCli.args).toBe('--print')
  })

  it('should parse nested lists', () => {
    const yaml = 'agents:\n  repoPaths:\n    - ~/Repos/ai-agents\n    - ~/Repos/skills'
    const r = parse(yaml)
    expect(r.agents.repoPaths).toEqual(['~/Repos/ai-agents', '~/Repos/skills'])
  })
})

describe('YAML parsing: workflow section (arrays of objects)', () => {
  it('should parse workflow stages', () => {
    const yaml = [
      'workflow:',
      '  stages:',
      '    - id: idea',
      '      label: "Idea"',
      '      icon: "💡"',
      '      color: "#f59e0b"',
      '      isFirst: true',
      '    - id: done',
      '      label: "Done"',
      '      icon: "✅"',
      '      color: "#10b981"',
      '      isFinal: true',
    ].join('\n')
    const r = parse(yaml)
    expect(r.workflow.stages).toHaveLength(2)
    expect(r.workflow.stages[0].id).toBe('idea')
    expect(r.workflow.stages[0].isFirst).toBe(true)
    expect(r.workflow.stages[1].isFinal).toBe(true)
  })

  it('should parse workflow transitions with effects', () => {
    const yaml = [
      'workflow:',
      '  transitions:',
      '    - from: review',
      '      to: merge',
      '      trigger: human',
      '      requiresApproval: true',
      '      label: "Approve & Merge"',
      '      effects: [set-approved, mark-complete]',
      '    - from: review',
      '      to: implementation',
      '      trigger: both',
      '      label: "Request Changes"',
      '      effects: [reset-approval, reduce-progress]',
    ].join('\n')
    const r = parse(yaml)
    expect(r.workflow.transitions).toHaveLength(2)
    expect(r.workflow.transitions[0].requiresApproval).toBe(true)
    expect(r.workflow.transitions[0].effects).toEqual(['set-approved', 'mark-complete'])
    expect(r.workflow.transitions[1].trigger).toBe('both')
    expect(r.workflow.transitions[1].effects).toEqual(['reset-approval', 'reduce-progress'])
  })

  it('should parse agentStageMappings', () => {
    const yaml = [
      'workflow:',
      '  agentStageMappings:',
      '    - role: planner',
      '      stages: [idea, planning]',
      '    - role: developer',
      '      stages: [planning, implementation]',
      '      promptTemplate: "Implement: {title}"',
    ].join('\n')
    const r = parse(yaml)
    expect(r.workflow.agentStageMappings).toHaveLength(2)
    expect(r.workflow.agentStageMappings[0].role).toBe('planner')
    expect(r.workflow.agentStageMappings[0].stages).toEqual(['idea', 'planning'])
    expect(r.workflow.agentStageMappings[1].promptTemplate).toBe('Implement: {title}')
  })
})

describe('YAML parsing: full board.yaml with workflow', () => {
  it('should parse complete board.yaml', () => {
    const yaml = [
      '# Agent Board Settings',
      '',
      'workspaces:',
      '  - ~/Repos/examples',
      '',
      'agents:',
      '  configPath: ""',
      '  repoPaths:',
      '    - ~/Repos/ai-agents',
      '  maxVisible: 0',
      '',
      'board:',
      '  maxTasks: 0',
      '  autoSave: true',
      '  autoSaveIntervalMs: 30000',
      '',
      'backends:',
      '  default: copilot-lm',
      '  claudeCli:',
      '    command: claude',
      '    args: [--print]',
      '',
      'workflow:',
      '  stages:',
      '    - id: backlog',
      '      label: "Backlog"',
      '      icon: "📥"',
      '      color: "#6b7280"',
      '      isFirst: true',
      '    - id: active',
      '      label: "Active"',
      '      icon: "🚀"',
      '      color: "#3b82f6"',
      '    - id: done',
      '      label: "Done"',
      '      icon: "✅"',
      '      color: "#10b981"',
      '      isFinal: true',
      '  transitions:',
      '    - from: backlog',
      '      to: active',
      '      trigger: both',
      '      label: "Start"',
      '    - from: active',
      '      to: done',
      '      trigger: human',
      '      requiresApproval: true',
      '      label: "Complete"',
      '      effects: [mark-complete]',
    ].join('\n')

    const r = parse(yaml)
    expect(r.workspaces).toEqual(['~/Repos/examples'])
    expect(r.agents.configPath).toBe('')
    expect(r.agents.repoPaths).toEqual(['~/Repos/ai-agents'])
    expect(r.board.autoSave).toBe(true)
    expect(r.backends.default).toBe('copilot-lm')
    expect(r.backends.claudeCli.command).toBe('claude')

    // Workflow section
    expect(r.workflow.stages).toHaveLength(3)
    expect(r.workflow.stages[0].id).toBe('backlog')
    expect(r.workflow.stages[0].isFirst).toBe(true)
    expect(r.workflow.stages[2].isFinal).toBe(true)
    expect(r.workflow.transitions).toHaveLength(2)
    expect(r.workflow.transitions[1].requiresApproval).toBe(true)
    expect(r.workflow.transitions[1].effects).toEqual(['mark-complete'])
  })
})
