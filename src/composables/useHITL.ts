import { ref } from 'vue'
import type { PendingDecision, Task } from '../domain/types'

// ─── HITL action callbacks (singleton) ──────────────────────────
// Set by main.ts orchestration, consumed by TaskHITLGate.vue.
// Replaces the old window.__agentBoard_* globals with a type-safe composable.

type DecisionExecutor = (pd: PendingDecision) => void
type AttentionNotifier = (task: Pick<Task, 'id' | 'title'>, type: string) => void

const executeConfirmedDecision = ref<DecisionExecutor | null>(null)
const notifyHumanAttention = ref<AttentionNotifier | null>(null)

export function useHITL() {
  function registerDecisionExecutor(fn: DecisionExecutor) {
    executeConfirmedDecision.value = fn
  }

  function registerAttentionNotifier(fn: AttentionNotifier) {
    notifyHumanAttention.value = fn
  }

  return {
    executeConfirmedDecision,
    notifyHumanAttention,
    registerDecisionExecutor,
    registerAttentionNotifier,
  }
}
