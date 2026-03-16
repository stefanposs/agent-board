import { describe, it, expect } from 'vitest'

// ─── Inline copies of pure functions from useBoard.ts ───────────

/** Sanitize task title to a valid git branch name. */
function slugifyBranchName(title: string, prefix = 'feature'): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  return `${prefix}/${slug}`
}

// ─── Agent Scoring (extracted from useBoard.ts scoreAgents / getBestAgentForTask) ──

interface AgentLike {
  id: string
  role: string
  status: 'idle' | 'working' | 'waiting' | 'blocked'
  currentTaskId: string | null
  skills: string[]
  languages: string[]
}

interface TaskLike {
  requiredSkills?: string[]
  tags: string[]
  assignee?: string | null
}

function scoreAgents(candidates: AgentLike[], neededSkills: string[]): Array<{ agent: AgentLike; score: number }> {
  const scored = candidates.map((agent) => {
    const skillHits = neededSkills.filter((s) =>
      agent.skills.some(sk => sk.toLowerCase() === s.toLowerCase()) ||
      agent.languages.some(l => l.toLowerCase() === s.toLowerCase()),
    ).length
    const skillScore = neededSkills.length > 0 ? skillHits / neededSkills.length : 0
    const idleScore = agent.status === 'idle' ? 1.0 : agent.status === 'waiting' ? 0.5 : 0.0
    const recencyScore = agent.currentTaskId ? 0.0 : 1.0
    const score = skillScore * 0.60 + idleScore * 0.25 + recencyScore * 0.15
    return { agent, score }
  })
  return scored.sort((a, b) => b.score - a.score)
}

function suggestAgents(agents: AgentLike[], task: TaskLike): Array<{ agent: AgentLike; score: number; matchedSkills: string[] }> {
  const needed = [...(task.requiredSkills || []), ...task.tags].map(s => s.toLowerCase())
  if (needed.length === 0) {
    return agents.map(agent => ({ agent, score: agent.status === 'idle' ? 1.0 : 0.5, matchedSkills: [] }))
  }
  return agents.map(agent => {
    const agentSkills = [...agent.skills, ...agent.languages].map(s => s.toLowerCase())
    const matchedSkills = needed.filter(s => agentSkills.includes(s))
    const skillScore = matchedSkills.length / needed.length
    const idleScore = agent.status === 'idle' ? 1.0 : agent.status === 'waiting' ? 0.5 : 0.0
    const score = skillScore * 0.70 + idleScore * 0.30
    return { agent, score, matchedSkills }
  }).sort((a, b) => b.score - a.score)
}

// ─── Helpers ────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentLike> & { id: string }): AgentLike {
  return {
    role: 'developer',
    status: 'idle',
    currentTaskId: null,
    skills: [],
    languages: [],
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('slugifyBranchName', () => {
  it('converts simple title to branch name', () => {
    expect(slugifyBranchName('Add login page')).toBe('feature/add-login-page')
  })

  it('uses custom prefix', () => {
    expect(slugifyBranchName('Fix crash', 'bugfix')).toBe('bugfix/fix-crash')
  })

  it('removes special characters', () => {
    expect(slugifyBranchName('Add OAuth2 (Google)')).toBe('feature/add-oauth2-google')
  })

  it('collapses multiple dashes', () => {
    expect(slugifyBranchName('Fix --- multiple --- dashes')).toBe('feature/fix-multiple-dashes')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugifyBranchName('---leading and trailing---')).toBe('feature/leading-and-trailing')
  })

  it('handles uppercase', () => {
    expect(slugifyBranchName('UPPERCASE TITLE')).toBe('feature/uppercase-title')
  })

  it('truncates to 50 chars', () => {
    const long = 'a'.repeat(100)
    const result = slugifyBranchName(long)
    const slug = result.replace('feature/', '')
    expect(slug.length).toBeLessThanOrEqual(50)
  })

  it('handles empty string', () => {
    expect(slugifyBranchName('')).toBe('feature/')
  })

  it('handles emoji and unicode', () => {
    const result = slugifyBranchName('🚀 Launch feature')
    expect(result).toBe('feature/launch-feature')
  })

  it('handles numbers', () => {
    expect(slugifyBranchName('Issue 42 fix')).toBe('feature/issue-42-fix')
  })
})

describe('scoreAgents', () => {
  const devAgent = makeAgent({ id: 'dev1', skills: ['api-design', 'testing'], languages: ['python', 'typescript'] })
  const frontendAgent = makeAgent({ id: 'fe1', skills: ['ui', 'css'], languages: ['typescript'] })
  const busyAgent = makeAgent({ id: 'busy1', skills: ['api-design', 'testing'], languages: ['python'], status: 'working', currentTaskId: 'task-1' })

  it('ranks agent with more skill matches higher', () => {
    const result = scoreAgents([frontendAgent, devAgent], ['api-design', 'python'])
    expect(result[0].agent.id).toBe('dev1')
  })

  it('ranks idle agent higher than busy agent with same skills', () => {
    const result = scoreAgents([busyAgent, devAgent], ['api-design'])
    expect(result[0].agent.id).toBe('dev1')
  })

  it('case-insensitive skill matching', () => {
    const result = scoreAgents([devAgent], ['API-DESIGN'])
    expect(result[0].score).toBeGreaterThan(0)
  })

  it('returns 0 skill score for agents with no skill matches', () => {
    const result = scoreAgents([frontendAgent], ['database', 'kubernetes'])
    // Only idle + recency scores, no skill score
    expect(result[0].score).toBe(0 * 0.60 + 1.0 * 0.25 + 1.0 * 0.15)
  })

  it('returns all agents sorted by score', () => {
    const result = scoreAgents([frontendAgent, devAgent, busyAgent], ['api-design'])
    expect(result).toHaveLength(3)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score)
    }
  })

  it('handles empty skills list — all agents score on availability only', () => {
    const result = scoreAgents([devAgent, busyAgent], [])
    // skillScore = 0 for both, devAgent idle + no task → higher
    expect(result[0].agent.id).toBe('dev1')
  })
})

describe('suggestAgents', () => {
  const agents: AgentLike[] = [
    makeAgent({ id: 'py-dev', skills: ['api-design'], languages: ['python'] }),
    makeAgent({ id: 'ts-dev', skills: ['ui', 'testing'], languages: ['typescript'] }),
    makeAgent({ id: 'busy', skills: ['api-design', 'testing'], languages: ['python'], status: 'working' }),
  ]

  it('ranks by combined requiredSkills + tags match', () => {
    const task: TaskLike = { requiredSkills: ['api-design'], tags: ['python'] }
    const result = suggestAgents(agents, task)
    expect(result[0].agent.id).toBe('py-dev')
    expect(result[0].matchedSkills).toContain('api-design')
    expect(result[0].matchedSkills).toContain('python')
  })

  it('returns matchedSkills list', () => {
    const task: TaskLike = { requiredSkills: ['ui'], tags: ['typescript'] }
    const result = suggestAgents(agents, task)
    expect(result[0].agent.id).toBe('ts-dev')
    expect(result[0].matchedSkills).toEqual(expect.arrayContaining(['ui', 'typescript']))
  })

  it('returns all agents sorted by availability when no skills needed', () => {
    const task: TaskLike = { tags: [] }
    const result = suggestAgents(agents, task)
    // Idle agents score 1.0, working score 0.5
    expect(result[0].score).toBe(1.0)
    expect(result[result.length - 1].score).toBe(0.5)
  })

  it('prefers idle expert over busy expert', () => {
    const task: TaskLike = { requiredSkills: ['api-design'], tags: [] }
    const result = suggestAgents(agents, task)
    const pyDev = result.find(r => r.agent.id === 'py-dev')!
    const busy = result.find(r => r.agent.id === 'busy')!
    expect(pyDev.score).toBeGreaterThan(busy.score)
  })
})
