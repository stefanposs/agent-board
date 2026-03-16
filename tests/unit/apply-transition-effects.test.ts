import { describe, it, expect } from 'vitest'

// ─── Inline copy of applyTransitionEffects (pure function) ──────
// Source: src/composables/useWorkflow.ts

type TransitionEffect =
  | 'set-approval-pending'
  | 'set-approved'
  | 'mark-complete'
  | 'reset-approval'
  | 'reduce-progress'

interface TaskLike {
  approvalStatus: string
  blockedReason?: string
  progress: number
  metrics?: { createdAt: number; stageEnteredAt: Record<string, number>; completedAt?: number }
}

function applyTransitionEffects(task: TaskLike, effects: TransitionEffect[] | undefined): boolean {
  if (!effects || effects.length === 0) return false
  for (const effect of effects) {
    switch (effect) {
      case 'set-approval-pending':
        task.approvalStatus = 'pending'
        task.blockedReason = 'Awaiting human approval'
        break
      case 'set-approved':
        task.approvalStatus = 'approved'
        task.blockedReason = undefined
        break
      case 'mark-complete':
        task.progress = 100
        if (task.metrics) task.metrics.completedAt = Date.now()
        break
      case 'reset-approval':
        task.approvalStatus = 'none'
        task.blockedReason = undefined
        break
      case 'reduce-progress':
        task.progress = Math.max(task.progress - 20, 30)
        break
    }
  }
  return true
}

// ─── Helpers ────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskLike> = {}): TaskLike {
  return {
    approvalStatus: 'none',
    progress: 50,
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('applyTransitionEffects', () => {
  describe('returns false for no-op', () => {
    it('returns false when effects is undefined', () => {
      const task = makeTask()
      expect(applyTransitionEffects(task, undefined)).toBe(false)
    })

    it('returns false when effects is empty array', () => {
      const task = makeTask()
      expect(applyTransitionEffects(task, [])).toBe(false)
    })

    it('does not mutate task when effects is empty', () => {
      const task = makeTask({ progress: 60, approvalStatus: 'pending' })
      applyTransitionEffects(task, [])
      expect(task.progress).toBe(60)
      expect(task.approvalStatus).toBe('pending')
    })
  })

  describe('set-approval-pending', () => {
    it('sets approvalStatus to pending', () => {
      const task = makeTask()
      applyTransitionEffects(task, ['set-approval-pending'])
      expect(task.approvalStatus).toBe('pending')
    })

    it('sets blockedReason', () => {
      const task = makeTask()
      applyTransitionEffects(task, ['set-approval-pending'])
      expect(task.blockedReason).toBe('Awaiting human approval')
    })
  })

  describe('set-approved', () => {
    it('sets approvalStatus to approved', () => {
      const task = makeTask({ approvalStatus: 'pending' })
      applyTransitionEffects(task, ['set-approved'])
      expect(task.approvalStatus).toBe('approved')
    })

    it('clears blockedReason', () => {
      const task = makeTask({ blockedReason: 'Awaiting human approval' })
      applyTransitionEffects(task, ['set-approved'])
      expect(task.blockedReason).toBeUndefined()
    })
  })

  describe('mark-complete', () => {
    it('sets progress to 100', () => {
      const task = makeTask({ progress: 70 })
      applyTransitionEffects(task, ['mark-complete'])
      expect(task.progress).toBe(100)
    })

    it('sets completedAt on metrics when metrics exist', () => {
      const task = makeTask({
        metrics: { createdAt: 1000, stageEnteredAt: {} },
      })
      applyTransitionEffects(task, ['mark-complete'])
      expect(task.metrics!.completedAt).toBeGreaterThan(0)
    })

    it('does not crash when metrics is undefined', () => {
      const task = makeTask({ progress: 40 })
      applyTransitionEffects(task, ['mark-complete'])
      expect(task.progress).toBe(100)
    })
  })

  describe('reset-approval', () => {
    it('resets approvalStatus to none', () => {
      const task = makeTask({ approvalStatus: 'approved' })
      applyTransitionEffects(task, ['reset-approval'])
      expect(task.approvalStatus).toBe('none')
    })

    it('clears blockedReason', () => {
      const task = makeTask({ approvalStatus: 'pending', blockedReason: 'Awaiting human approval' })
      applyTransitionEffects(task, ['reset-approval'])
      expect(task.blockedReason).toBeUndefined()
    })
  })

  describe('reduce-progress', () => {
    it('reduces progress by 20', () => {
      const task = makeTask({ progress: 80 })
      applyTransitionEffects(task, ['reduce-progress'])
      expect(task.progress).toBe(60)
    })

    it('clamps progress at 30 minimum', () => {
      const task = makeTask({ progress: 40 })
      applyTransitionEffects(task, ['reduce-progress'])
      expect(task.progress).toBe(30)
    })

    it('does not go below 30 when progress is already low', () => {
      const task = makeTask({ progress: 30 })
      applyTransitionEffects(task, ['reduce-progress'])
      expect(task.progress).toBe(30)
    })

    it('clamps to 30 even when progress is 31', () => {
      const task = makeTask({ progress: 31 })
      applyTransitionEffects(task, ['reduce-progress'])
      expect(task.progress).toBe(30)
    })
  })

  describe('combined effects', () => {
    it('approve + merge: sets approved, clears block, sets progress 100', () => {
      const task = makeTask({
        approvalStatus: 'pending',
        blockedReason: 'Awaiting human approval',
        progress: 75,
        metrics: { createdAt: 1000, stageEnteredAt: {} },
      })
      applyTransitionEffects(task, ['set-approved', 'mark-complete'])
      expect(task.approvalStatus).toBe('approved')
      expect(task.blockedReason).toBeUndefined()
      expect(task.progress).toBe(100)
      expect(task.metrics!.completedAt).toBeGreaterThan(0)
    })

    it('reset-approval + reduce-progress (review rejection)', () => {
      const task = makeTask({
        approvalStatus: 'pending',
        blockedReason: 'Awaiting human approval',
        progress: 80,
      })
      applyTransitionEffects(task, ['reset-approval', 'reduce-progress'])
      expect(task.approvalStatus).toBe('none')
      expect(task.blockedReason).toBeUndefined()
      expect(task.progress).toBe(60)
    })

    it('returns true when effects are applied', () => {
      const task = makeTask()
      expect(applyTransitionEffects(task, ['set-approved'])).toBe(true)
    })
  })
})
