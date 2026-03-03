import { describe, it, expect } from 'vitest'

// ─── Workflow Config Tests ──────────────────────────────────────
// Tests the configurable workflow state machine with the default dev pipeline
// and custom workflow configurations.

interface StageConfig {
  id: string; label: string; icon: string; color: string
  isFirst?: boolean; isFinal?: boolean
}

interface TransitionConfig {
  from: string; to: string; trigger: 'agent' | 'human' | 'both'
  requiresApproval?: boolean; label: string; effects?: string[]
}

interface AgentStageMapping {
  role: string; stages: string[]
}

// Mirror of DEFAULT_WORKFLOW
const DEFAULT_STAGES: StageConfig[] = [
  { id: 'idea', label: 'Idea', icon: '💡', color: '#f59e0b', isFirst: true },
  { id: 'planning', label: 'Planning', icon: '📋', color: '#8b5cf6' },
  { id: 'implementation', label: 'Implementation', icon: '⚙️', color: '#3b82f6' },
  { id: 'review', label: 'Review', icon: '🔍', color: '#f97316' },
  { id: 'merge', label: 'Merged', icon: '✅', color: '#10b981', isFinal: true },
]

const DEFAULT_TRANSITIONS: TransitionConfig[] = [
  { from: 'idea', to: 'planning', trigger: 'both', label: 'Start Planning' },
  { from: 'planning', to: 'implementation', trigger: 'both', label: 'Begin Implementation' },
  { from: 'implementation', to: 'review', trigger: 'both', label: 'Submit for Review' },
  { from: 'implementation', to: 'planning', trigger: 'both', label: 'Needs Clarification' },
  { from: 'review', to: 'merge', trigger: 'human', requiresApproval: true, label: 'Approve & Merge', effects: ['set-approved', 'mark-complete'] },
  { from: 'review', to: 'implementation', trigger: 'both', label: 'Request Changes', effects: ['reset-approval', 'reduce-progress'] },
  { from: 'planning', to: 'idea', trigger: 'human', label: 'Back to Idea' },
]

const DEFAULT_AGENT_MAPPINGS: AgentStageMapping[] = [
  { role: 'planner', stages: ['idea', 'planning'] },
  { role: 'architect', stages: ['planning'] },
  { role: 'developer', stages: ['planning', 'implementation'] },
  { role: 'reviewer', stages: ['review'] },
  { role: 'devops', stages: ['implementation'] },
]

// Helpers
function canTransition(from: string, to: string, transitions = DEFAULT_TRANSITIONS) {
  return transitions.find(t => t.from === from && t.to === to)
}
function getValidTransitions(stageId: string, transitions = DEFAULT_TRANSITIONS) {
  return transitions.filter(t => t.from === stageId)
}
function isFinalStage(stageId: string, stages = DEFAULT_STAGES) {
  return stages.some(s => s.id === stageId && s.isFinal)
}
function getFirstStage(stages = DEFAULT_STAGES) {
  return stages.find(s => s.isFirst)?.id ?? stages[0]?.id
}
function stageHasApprovalGate(stageId: string, transitions = DEFAULT_TRANSITIONS) {
  return transitions.some(t => t.from === stageId && t.requiresApproval)
}
function getAgentRolesForStage(stageId: string, mappings = DEFAULT_AGENT_MAPPINGS) {
  return mappings.filter(m => m.stages.includes(stageId)).map(m => m.role)
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Default Workflow: Stage Transitions', () => {
  describe('valid transitions', () => {
    it('idea → planning', () => expect(canTransition('idea', 'planning')).toBeDefined())
    it('planning → implementation', () => expect(canTransition('planning', 'implementation')).toBeDefined())
    it('implementation → review', () => expect(canTransition('implementation', 'review')).toBeDefined())
    it('review → implementation (feedback)', () => expect(canTransition('review', 'implementation')).toBeDefined())
    it('review → merge', () => expect(canTransition('review', 'merge')).toBeDefined())
    it('implementation → planning (clarification)', () => expect(canTransition('implementation', 'planning')).toBeDefined())
    it('planning → idea (backwards)', () => expect(canTransition('planning', 'idea')).toBeDefined())
  })

  describe('invalid transitions', () => {
    it('idea → implementation (skip)', () => expect(canTransition('idea', 'implementation')).toBeUndefined())
    it('idea → merge (skip)', () => expect(canTransition('idea', 'merge')).toBeUndefined())
    it('planning → review (skip)', () => expect(canTransition('planning', 'review')).toBeUndefined())
    it('merge → idea (no backward)', () => expect(canTransition('merge', 'idea')).toBeUndefined())
    it('merge has no outgoing transitions', () => expect(getValidTransitions('merge')).toHaveLength(0))
  })

  describe('transition properties', () => {
    it('review → merge requires human approval', () => {
      const t = canTransition('review', 'merge')
      expect(t?.trigger).toBe('human')
      expect(t?.requiresApproval).toBe(true)
    })
    it('review → merge has set-approved + mark-complete effects', () => {
      const t = canTransition('review', 'merge')
      expect(t?.effects).toContain('set-approved')
      expect(t?.effects).toContain('mark-complete')
    })
    it('review → impl has reset-approval + reduce-progress effects', () => {
      const t = canTransition('review', 'implementation')
      expect(t?.effects).toContain('reset-approval')
      expect(t?.effects).toContain('reduce-progress')
    })
    it('idea → planning triggered by both', () => {
      expect(canTransition('idea', 'planning')?.trigger).toBe('both')
    })
  })
})

describe('Default Workflow: Stage Properties', () => {
  it('idea is the first stage', () => expect(getFirstStage()).toBe('idea'))
  it('merge is the only final stage', () => {
    expect(isFinalStage('merge')).toBe(true)
    expect(isFinalStage('idea')).toBe(false)
    expect(isFinalStage('review')).toBe(false)
  })
  it('has 5 stages', () => expect(DEFAULT_STAGES).toHaveLength(5))
  it('review has an approval gate', () => expect(stageHasApprovalGate('review')).toBe(true))
  it('planning has no approval gate', () => expect(stageHasApprovalGate('planning')).toBe(false))
})

describe('Default Workflow: Agent Stage Mappings', () => {
  it('planner works on idea and planning', () => expect(getAgentRolesForStage('idea')).toContain('planner'))
  it('developer works on planning and implementation', () => {
    expect(getAgentRolesForStage('planning')).toContain('developer')
    expect(getAgentRolesForStage('implementation')).toContain('developer')
  })
  it('reviewer only on review', () => {
    expect(getAgentRolesForStage('review')).toContain('reviewer')
    expect(getAgentRolesForStage('implementation')).not.toContain('reviewer')
  })
  it('no agents on merge', () => expect(getAgentRolesForStage('merge')).toHaveLength(0))
})

describe('Custom Workflow: Project Management', () => {
  const stages: StageConfig[] = [
    { id: 'backlog', label: 'Backlog', icon: '📥', color: '#666', isFirst: true },
    { id: 'analysis', label: 'Analysis', icon: '🔬', color: '#8b5cf6' },
    { id: 'execution', label: 'Execution', icon: '🚀', color: '#3b82f6' },
    { id: 'qa', label: 'QA', icon: '✅', color: '#f97316' },
    { id: 'done', label: 'Done', icon: '🏁', color: '#10b981', isFinal: true },
  ]
  const transitions: TransitionConfig[] = [
    { from: 'backlog', to: 'analysis', trigger: 'both', label: 'Analyze' },
    { from: 'analysis', to: 'execution', trigger: 'both', label: 'Execute' },
    { from: 'execution', to: 'qa', trigger: 'both', label: 'QA' },
    { from: 'qa', to: 'done', trigger: 'human', requiresApproval: true, label: 'Ship It', effects: ['mark-complete'] },
    { from: 'qa', to: 'execution', trigger: 'both', label: 'Fix Issues', effects: ['reset-approval'] },
  ]

  it('backlog → analysis is valid', () => expect(canTransition('backlog', 'analysis', transitions)).toBeDefined())
  it('qa → done requires approval', () => expect(canTransition('qa', 'done', transitions)?.requiresApproval).toBe(true))
  it('done is final', () => expect(isFinalStage('done', stages)).toBe(true))
  it('backlog is first', () => expect(getFirstStage(stages)).toBe('backlog'))
  it('done has no outgoing transitions', () => expect(getValidTransitions('done', transitions)).toHaveLength(0))
})
