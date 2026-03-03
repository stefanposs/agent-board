import { ref, computed } from 'vue'
import { DEFAULT_WORKFLOW } from '../../ext/protocol'
import type { WorkflowConfig, StageConfigDto, TransitionDto, AgentStageMapping, TransitionEffect } from '../../ext/protocol'
import type { Task } from '../domain'

// ─── Reactive State (singleton) ─────────────────────────────────

const stages = ref<StageConfigDto[]>([...DEFAULT_WORKFLOW.stages])
const transitions = ref<TransitionDto[]>([...DEFAULT_WORKFLOW.transitions])
const agentStageMappings = ref<AgentStageMapping[]>([...(DEFAULT_WORKFLOW.agentStageMappings ?? [])])

// ─── Composable ─────────────────────────────────────────────────

export function useWorkflow() {
  /** The first stage (where new tasks are created). */
  const firstStage = computed(() =>
    stages.value.find(s => s.isFirst)?.id ?? stages.value[0]?.id ?? 'idea',
  )

  /** All final stages (task is complete). */
  const finalStages = computed(() =>
    stages.value.filter(s => s.isFinal).map(s => s.id),
  )

  /** Check if a stage is a final (completed) stage. */
  function isFinalStage(stageId: string): boolean {
    return finalStages.value.includes(stageId)
  }

  /** Get valid transitions from a given stage. */
  function getValidTransitions(stageId: string): TransitionDto[] {
    return transitions.value.filter(t => t.from === stageId)
  }

  /** Check if a specific transition exists (from → to). */
  function canTransition(from: string, to: string): TransitionDto | undefined {
    return transitions.value.find(t => t.from === from && t.to === to)
  }

  /** Get stage config by ID. */
  function getStageConfig(stageId: string): StageConfigDto | undefined {
    return stages.value.find(s => s.id === stageId)
  }

  /** Get which agent roles are eligible for a given stage. */
  function getAgentRolesForStage(stageId: string): string[] {
    return agentStageMappings.value
      .filter(m => m.stages.includes(stageId))
      .map(m => m.role)
  }

  /** Check if a stage has any outgoing transition that requires approval. */
  function stageHasApprovalGate(stageId: string): boolean {
    return transitions.value.some(t => t.from === stageId && t.requiresApproval)
  }

  /** Apply transition effects to a task. Returns true if any effects were applied. */
  function applyTransitionEffects(task: Task, effects: TransitionEffect[] | undefined): boolean {
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

  /** Generate the pipeline description string (e.g., "Idea → Planning → …"). */
  const pipelineDescription = computed(() =>
    stages.value.map(s => s.label).join(' → '),
  )

  /** Update the workflow configuration (called from init message). */
  function setWorkflow(config: WorkflowConfig) {
    if (config.stages && config.stages.length > 0) {
      stages.value = config.stages
    }
    if (config.transitions && config.transitions.length > 0) {
      transitions.value = config.transitions
    }
    if (config.agentStageMappings && config.agentStageMappings.length > 0) {
      agentStageMappings.value = config.agentStageMappings
    }
  }

  /** Get the current workflow config object (for protocol serialization). */
  function getWorkflowConfig(): WorkflowConfig {
    return {
      stages: stages.value,
      transitions: transitions.value,
      agentStageMappings: agentStageMappings.value,
    }
  }

  return {
    // Reactive state
    stages,
    transitions,
    agentStageMappings,
    // Computed
    firstStage,
    finalStages,
    pipelineDescription,
    // Functions
    isFinalStage,
    getValidTransitions,
    canTransition,
    getStageConfig,
    getAgentRolesForStage,
    stageHasApprovalGate,
    applyTransitionEffects,
    setWorkflow,
    getWorkflowConfig,
  }
}
