import { describe, it, expect } from 'vitest'

// ─── Inline copies of pure markdown helpers from ext/MarkdownStateManager.ts ──

function toFrontmatter(obj: Record<string, any>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(v => typeof v === 'string' ? `"${v}"` : typeof v === 'object' && v !== null ? JSON.stringify(v) : v).join(', ')}]`)
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else if (typeof value === 'string') {
      lines.push(`${key}: "${value}"`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const meta: Record<string, any> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()

    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        meta[key] = JSON.parse(value)
      } catch {
        meta[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''))
      }
      continue
    }
    if (value.startsWith('{')) {
      try { meta[key] = JSON.parse(value); continue } catch { /* fallthrough */ }
    }
    if (value.startsWith('"') && value.endsWith('"')) {
      meta[key] = value.slice(1, -1)
      continue
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      meta[key] = Number(value)
      continue
    }
    if (value === 'true') { meta[key] = true; continue }
    if (value === 'false') { meta[key] = false; continue }
    meta[key] = value
  }

  return { meta, body: match[2] }
}

function extractSection(body: string, heading: string): string {
  const startIdx = body.search(new RegExp(`^## ${heading}\\s*$`, 'm'))
  if (startIdx === -1) return ''
  const afterHeading = body.indexOf('\n', startIdx)
  if (afterHeading === -1) return ''
  const rest = body.slice(afterHeading + 1)
  const nextHeading = rest.search(/^## /m)
  const content = nextHeading === -1 ? rest : rest.slice(0, nextHeading)
  return content.trim()
}

// ─── Goal serialization (from MarkdownStateManager.ts) ──────────

interface GoalData {
  id: string
  title: string
  description?: string
  owner?: string
  deadline?: number
  taskIds: string[]
  createdAt: number
  updatedAt: number
}

function goalToMarkdown(goal: GoalData): string {
  const sections: string[] = []

  sections.push(toFrontmatter({
    id: goal.id,
    title: goal.title,
    owner: goal.owner,
    deadline: goal.deadline,
    taskIds: goal.taskIds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  }))

  sections.push('')
  sections.push(`# ${goal.title}`)
  sections.push('')

  if (goal.description) {
    sections.push('## Description')
    sections.push('')
    sections.push(goal.description)
    sections.push('')
  }

  if (goal.taskIds.length > 0) {
    sections.push('## Linked Tasks')
    sections.push('')
    for (const tid of goal.taskIds) {
      sections.push(`- ${tid}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

function markdownToGoal(content: string): GoalData {
  const { meta, body } = parseFrontmatter(content)
  const description = extractSection(body, 'Description')

  return {
    id: meta.id || `goal-${Date.now()}`,
    title: meta.title || 'Untitled Goal',
    description: description || undefined,
    owner: meta.owner,
    deadline: meta.deadline,
    taskIds: meta.taskIds || [],
    createdAt: meta.createdAt || Date.now(),
    updatedAt: meta.updatedAt || Date.now(),
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

// ─── toFrontmatter Tests ────────────────────────────────────────

describe('toFrontmatter', () => {
  it('serializes string values with quotes', () => {
    const fm = toFrontmatter({ title: 'My Task' })
    expect(fm).toContain('title: "My Task"')
    expect(fm).toMatch(/^---\n/)
    expect(fm).toMatch(/\n---$/)
  })

  it('serializes numbers without quotes', () => {
    const fm = toFrontmatter({ progress: 50, createdAt: 1700000000 })
    expect(fm).toContain('progress: 50')
    expect(fm).toContain('createdAt: 1700000000')
  })

  it('serializes booleans', () => {
    const fm = toFrontmatter({ manuallyAssigned: true })
    expect(fm).toContain('manuallyAssigned: true')
  })

  it('serializes arrays inline', () => {
    const fm = toFrontmatter({ tags: ['ui', 'backend'] })
    expect(fm).toContain('tags: ["ui", "backend"]')
  })

  it('serializes empty arrays', () => {
    const fm = toFrontmatter({ tags: [] })
    expect(fm).toContain('tags: []')
  })

  it('skips undefined and null', () => {
    const fm = toFrontmatter({ a: undefined, b: null, c: 'keep' })
    expect(fm).not.toContain('a:')
    expect(fm).not.toContain('b:')
    expect(fm).toContain('c: "keep"')
  })

  it('serializes objects as JSON', () => {
    const fm = toFrontmatter({ pullRequest: { number: 42, status: 'open' } })
    expect(fm).toContain('pullRequest:')
  })

  it('serializes goalIds', () => {
    const fm = toFrontmatter({
      goalIds: ['goal-1', 'goal-2'],
    })
    expect(fm).toContain('goalIds: ["goal-1", "goal-2"]')
  })
})

// ─── parseFrontmatter Tests ─────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses simple key-value pairs', () => {
    const content = '---\nid: "task-1"\nstage: "idea"\nprogress: 50\n---\n# Title'
    const { meta, body } = parseFrontmatter(content)
    expect(meta.id).toBe('task-1')
    expect(meta.stage).toBe('idea')
    expect(meta.progress).toBe(50)
    expect(body).toContain('# Title')
  })

  it('parses arrays', () => {
    const content = '---\ntags: ["ui", "api"]\ngoalIds: ["g-1", "g-2"]\n---\nbody'
    const { meta } = parseFrontmatter(content)
    expect(meta.tags).toEqual(['ui', 'api'])
    expect(meta.goalIds).toEqual(['g-1', 'g-2'])
  })

  it('parses booleans', () => {
    const content = '---\nmanuallyAssigned: true\ndone: false\n---\n'
    const { meta } = parseFrontmatter(content)
    expect(meta.manuallyAssigned).toBe(true)
    expect(meta.done).toBe(false)
  })

  it('returns empty meta for missing frontmatter', () => {
    const { meta, body } = parseFrontmatter('Just a plain file')
    expect(meta).toEqual({})
    expect(body).toBe('Just a plain file')
  })

  it('parses goalIds', () => {
    const content = '---\ngoalIds: ["g-1"]\n---\nbody'
    const { meta } = parseFrontmatter(content)
    expect(meta.goalIds).toEqual(['g-1'])
  })
})

// ─── extractSection Tests ───────────────────────────────────────

describe('extractSection', () => {
  const body = `# My Task

## Description

This is the task description.

## Metrics

- Created: 2024-01-01
`

  it('extracts Description section', () => {
    const desc = extractSection(body, 'Description')
    expect(desc).toBe('This is the task description.')
  })

  it('extracts Metrics section', () => {
    const met = extractSection(body, 'Metrics')
    expect(met).toContain('Created: 2024-01-01')
  })

  it('returns empty string for missing section', () => {
    expect(extractSection(body, 'Nonexistent')).toBe('')
  })
})

// ─── goalToMarkdown Tests ───────────────────────────────────────

describe('goalToMarkdown', () => {
  const goal: GoalData = {
    id: 'goal-1',
    title: 'Ship v1.0',
    description: 'Release the first public version.',
    owner: 'alice',
    deadline: 1700000000,
    taskIds: ['task-1', 'task-2'],
    createdAt: 1699000000,
    updatedAt: 1699500000,
  }

  it('generates valid frontmatter', () => {
    const md = goalToMarkdown(goal)
    expect(md).toMatch(/^---\n/)
    expect(md).toContain('id: "goal-1"')
    expect(md).toContain('title: "Ship v1.0"')
    expect(md).toContain('owner: "alice"')
    expect(md).toContain('deadline: 1700000000')
    expect(md).toContain('taskIds: ["task-1", "task-2"]')
  })

  it('includes heading and description section', () => {
    const md = goalToMarkdown(goal)
    expect(md).toContain('# Ship v1.0')
    expect(md).toContain('## Description')
    expect(md).toContain('Release the first public version.')
  })

  it('includes linked tasks section', () => {
    const md = goalToMarkdown(goal)
    expect(md).toContain('## Linked Tasks')
    expect(md).toContain('- task-1')
    expect(md).toContain('- task-2')
  })

  it('omits description section when undefined', () => {
    const noDesc = { ...goal, description: undefined }
    const md = goalToMarkdown(noDesc)
    expect(md).not.toContain('## Description')
  })

  it('omits linked tasks section when empty', () => {
    const noTasks = { ...goal, taskIds: [] }
    const md = goalToMarkdown(noTasks)
    expect(md).not.toContain('## Linked Tasks')
  })
})

// ─── markdownToGoal Tests ───────────────────────────────────────

describe('markdownToGoal', () => {
  it('parses a full goal markdown', () => {
    const md = [
      '---',
      'id: "goal-1"',
      'title: "Ship v1.0"',
      'owner: "alice"',
      'deadline: 1700000000',
      'taskIds: ["task-1", "task-2"]',
      'createdAt: 1699000000',
      'updatedAt: 1699500000',
      '---',
      '',
      '# Ship v1.0',
      '',
      '## Description',
      '',
      'Release the first public version.',
      '',
      '## Linked Tasks',
      '',
      '- task-1',
      '- task-2',
      '',
    ].join('\n')

    const goal = markdownToGoal(md)
    expect(goal.id).toBe('goal-1')
    expect(goal.title).toBe('Ship v1.0')
    expect(goal.description).toBe('Release the first public version.')
    expect(goal.owner).toBe('alice')
    expect(goal.deadline).toBe(1700000000)
    expect(goal.taskIds).toEqual(['task-1', 'task-2'])
    expect(goal.createdAt).toBe(1699000000)
    expect(goal.updatedAt).toBe(1699500000)
  })

  it('provides defaults for missing fields', () => {
    const md = '---\ntitle: "Quick Goal"\n---\n\n# Quick Goal\n'
    const goal = markdownToGoal(md)
    expect(goal.title).toBe('Quick Goal')
    expect(goal.taskIds).toEqual([])
    expect(goal.id).toMatch(/^goal-/)
    expect(goal.createdAt).toBeGreaterThan(0)
  })

  it('handles missing description', () => {
    const md = '---\nid: "g-2"\ntitle: "No Desc"\ntaskIds: []\ncreatedAt: 100\nupdatedAt: 200\n---\n\n# No Desc\n'
    const goal = markdownToGoal(md)
    expect(goal.description).toBeUndefined()
  })
})

// ─── goalToMarkdown ↔ markdownToGoal round-trip ─────────────────

describe('Goal serialization round-trip', () => {
  it('round-trips a full goal', () => {
    const original: GoalData = {
      id: 'goal-rt',
      title: 'Round Trip Test',
      description: 'Testing serialization fidelity.',
      owner: 'bob',
      deadline: 1700000000,
      taskIds: ['t-1', 't-2', 't-3'],
      createdAt: 1699000000,
      updatedAt: 1699500000,
    }

    const md = goalToMarkdown(original)
    const parsed = markdownToGoal(md)

    expect(parsed.id).toBe(original.id)
    expect(parsed.title).toBe(original.title)
    expect(parsed.description).toBe(original.description)
    expect(parsed.owner).toBe(original.owner)
    expect(parsed.deadline).toBe(original.deadline)
    expect(parsed.taskIds).toEqual(original.taskIds)
    expect(parsed.createdAt).toBe(original.createdAt)
    expect(parsed.updatedAt).toBe(original.updatedAt)
  })

  it('round-trips a minimal goal', () => {
    const original: GoalData = {
      id: 'goal-min',
      title: 'Minimal',
      taskIds: [],
      createdAt: 100,
      updatedAt: 200,
    }

    const md = goalToMarkdown(original)
    const parsed = markdownToGoal(md)

    expect(parsed.id).toBe('goal-min')
    expect(parsed.title).toBe('Minimal')
    expect(parsed.description).toBeUndefined()
    expect(parsed.taskIds).toEqual([])
  })
})

// ─── Frontmatter round-trip with goalIds ────────────────────────

describe('Frontmatter round-trip (goalIds)', () => {
  it('round-trips goalIds', () => {
    const original = {
      id: 'task-rt',
      title: 'Test Task',
      goalIds: ['goal-1', 'goal-2'],
    }

    const fm = toFrontmatter(original)
    const { meta } = parseFrontmatter(fm + '\nbody')

    expect(meta.id).toBe('task-rt')
    expect(meta.goalIds).toEqual(['goal-1', 'goal-2'])
  })
})
