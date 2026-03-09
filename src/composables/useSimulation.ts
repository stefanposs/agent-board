import { useBoard } from './useBoard'
import { useExtension } from './useExtension'
import { useWorkflow } from './useWorkflow'

// ─── Real Agent Orchestration ───────────────────────────────────
// When running in extension mode: kicks off real LLM calls per task
// When running standalone: uses the old simulation for demo purposes

let simulationIntervals: ReturnType<typeof setInterval>[] = []

/** Fallback prompts when workflow config has no promptTemplate. */
const FALLBACK_PROMPTS: Record<string, Record<string, string>> = {
  planner: {
    default: 'Analyze this task and create a structured plan:\n\nTask: "{title}"\nDescription: {description}\n\nProvide:\n1. Feasibility assessment\n2. Key requirements\n3. Implementation approach\n4. Estimated complexity',
  },
  architect: {
    default: 'Design the architecture for:\n\nTask: "{title}"\nDescription: {description}\n\nCover: component design, data flow, API contracts, and trade-offs.',
  },
  developer: {
    default: 'Implement the following task:\n\nTask: "{title}"\nDescription: {description}\n\nProvide the implementation approach with code structure.',
  },
  reviewer: {
    default: 'Review the implementation for:\n\nTask: "{title}"\nDescription: {description}\n\nCheck: correctness, security, performance, test coverage, code quality.',
  },
  devops: {
    default: 'Set up the infrastructure/CI for:\n\nTask: "{title}"\nDescription: {description}\n\nDefine: build pipeline, deployment config, monitoring.',
  },
}

function getAgentPromptForStage(agentRole: string, taskTitle: string, taskDescription: string, _stage: string): string {
  const wf = useWorkflow()

  // Check if the workflow config has a promptTemplate for this role
  const mapping = wf.agentStageMappings.value.find(m => m.role === agentRole)
  if (mapping?.promptTemplate) {
    return mapping.promptTemplate
      .replace('{title}', taskTitle)
      .replace('{description}', taskDescription)
      .replace('{stage}', _stage)
  }

  // Fallback to built-in prompts
  const rolePrompts = FALLBACK_PROMPTS[agentRole]
  const template = rolePrompts?.[_stage] ?? rolePrompts?.['default'] ?? `Work on task: "${taskTitle}"\n\n${taskDescription}`
  return template.replace('{title}', taskTitle).replace('{description}', taskDescription)
}

export function startAgents() {
  const board = useBoard()
  const ext = useExtension()

  if (board.simulationRunning.value) return
  board.simulationRunning.value = true
  board.addActivity('🤖 **Agents activated** — processing tasks with Copilot LLM', 'system')
  board.addToast('Agents activated', 'info')

  if (!ext.isWebview.value) {
    // Standalone mode: run demo simulation
    startStandaloneSimulation()
    return
  }

  // Extension mode: run real orchestration loop
  const wf = useWorkflow()

  for (const agent of board.agents.value) {
    const interval = setInterval(() => {
      if (!board.simulationRunning.value) return
      if (agent.status === 'working') return // Agent is busy

      const eligibleStages = wf.agentStageMappings.value
            .filter(m => m.role === agent.role)
            .flatMap(m => m.stages)
      const eligibleTasks = board.tasks.value.filter(
        (t) =>
          eligibleStages.includes(t.stage) &&
          !wf.isFinalStage(t.stage) &&
          t.approvalStatus !== 'pending' &&
          !(t.pendingDecision && t.pendingDecision.status === 'pending') &&
          // Respect manual assignment: only the assigned agent may work on locked tasks
          (!t.manuallyAssigned || t.assignee === agent.id || !t.assignee),
      )

      if (eligibleTasks.length === 0) return

      // Prioritize tasks assigned to this agent, then score by priority + skill match
      const priorityOrder = ['critical', 'high', 'medium', 'low']
      const scoredTasks = eligibleTasks.map(t => {
        // Direct assignment: if this agent is the assignee, max priority
        const assigneeBonus = t.assignee === agent.id ? 1.0 : 0.0

        const priorityScore = (4 - priorityOrder.indexOf(t.priority)) / 4
        const neededSkills = t.requiredSkills || []
        let skillScore = 0
        if (neededSkills.length > 0) {
          const hits = neededSkills.filter(s =>
            agent.skills.some(sk => sk.toLowerCase() === s.toLowerCase()) ||
            agent.languages.some(l => l.toLowerCase() === s.toLowerCase()),
          ).length
          skillScore = hits / neededSkills.length
        }
        // Weighted: assignee bonus dominates, then priority + skill
        const totalScore = assigneeBonus * 0.50 + priorityScore * 0.20 + skillScore * 0.30
        return { task: t, score: totalScore }
      })
      scoredTasks.sort((a, b) => b.score - a.score)
      const task = scoredTasks[0].task

      // Generate prompt for this agent + task stage
      const prompt = getAgentPromptForStage(agent.role, task.title, task.description, task.stage)

      // Get or create session, include history for multi-turn
      const session = board.getOrCreateSession(task.id, agent.id)
      const sessionMessages = session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      // Add user message to session
      board.addSessionMessage(session.id, 'user', prompt)

      // Run agent via extension
      ext.runAgent(agent.id, task.id, prompt, sessionMessages)
      board.updateAgentStatus(agent.id, 'working', task.id)

      // Assign agent to task if not already
      if (!task.assignedAgents.includes(agent.id)) {
        task.assignedAgents.push(agent.id)
      }

    }, 15000) // Check every 15 seconds

    simulationIntervals.push(interval)
  }
}

export function stopAgents() {
  const board = useBoard()
  board.simulationRunning.value = false

  for (const interval of simulationIntervals) {
    clearInterval(interval)
  }
  simulationIntervals = []

  // Reset all agents to idle
  for (const agent of board.agents.value) {
    board.updateAgentStatus(agent.id, 'idle', null)
  }

  board.addActivity('⏸️ **Agents paused**', 'system')
  board.addToast('Agents paused', 'warning')
}

export function toggleSimulation() {
  const board = useBoard()
  if (board.simulationRunning.value) {
    stopAgents()
  } else {
    startAgents()
  }
}

// ─── Standalone Demo Simulation ─────────────────────────────────

const ROLE_MESSAGES: Record<string, string[]> = {
  planner: ['Analyzing requirements...', 'Creating task breakdown...', 'Mapping dependencies...'],
  architect: ['Reviewing system design...', 'Validating API contract...'],
  developer: ['Writing implementation...', 'Adding tests...', 'Refactoring...'],
  reviewer: ['Reviewing code quality...', 'Checking security...'],
  devops: ['Configuring CI pipeline...', 'Running integration tests...'],
}

function startStandaloneSimulation() {
  const board = useBoard()
  const wf = useWorkflow()

  for (const agent of board.agents.value) {
    const interval = setInterval(() => {
      if (!board.simulationRunning.value) return

      const agentStages = wf.agentStageMappings.value
        .filter(m => m.role === agent.role)
        .flatMap(m => m.stages)
      const eligibleTasks = board.tasks.value.filter(
        (t) =>
          agentStages.includes(t.stage) &&
          !wf.isFinalStage(t.stage) &&
          !wf.stageHasApprovalGate(t.stage) &&
          t.approvalStatus !== 'pending' &&
          !(t.pendingDecision && t.pendingDecision.status === 'pending') &&
          // Respect manual assignment: only the assigned agent may work on locked tasks
          (!t.manuallyAssigned || t.assignee === agent.id || !t.assignee),
      )

      if (eligibleTasks.length === 0) {
        board.updateAgentStatus(agent.id, 'idle', null)
        return
      }

      const task = eligibleTasks[Math.floor(Math.random() * eligibleTasks.length)]
      const messages = ROLE_MESSAGES[agent.role] || ['Processing...']
      const message = messages[Math.floor(Math.random() * messages.length)]

      board.updateAgentStatus(agent.id, 'working', task.id)
      board.addActivity(`${agent.avatar} **${agent.name}**: ${message} (${task.title})`, 'agent_action')

      const tokensUsed = Math.floor(Math.random() * 3700) + 800
      board.updateAgentUsage(agent.id, tokensUsed)
      board.updateTaskProgress(task.id, task.progress + Math.floor(Math.random() * 16) + 10)

      if (task.progress >= 80) {
        // Find valid non-approval forward transition
        const nextTransition = wf.getValidTransitions(task.stage)
          .find(t => !t.requiresApproval && t.trigger !== 'human')
        if (nextTransition) {
          setTimeout(() => {
            board.moveTask(task.id, nextTransition.to, 'agent', agent.id)
            board.updateAgentStatus(agent.id, 'idle', null)
          }, Math.floor(Math.random() * 2000) + 2000)
        }
      } else {
        setTimeout(() => {
          board.updateAgentStatus(agent.id, 'idle', null)
        }, Math.floor(Math.random() * 1500) + 1500)
      }
    }, Math.floor(Math.random() * 8000) + 6000)

    simulationIntervals.push(interval)
  }
}
