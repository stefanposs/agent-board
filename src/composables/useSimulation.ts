import { useBoard } from './useBoard'
import { useExtension } from './useExtension'
import { useWorkflow } from './useWorkflow'

// ─── Real Agent Orchestration ───────────────────────────────────
// When running in extension mode: kicks off real LLM calls per task
// When running standalone: uses the old simulation for demo purposes

let simulationIntervals: ReturnType<typeof setInterval>[] = []
const MAX_CONCURRENT_AGENTS = 3 // Don't overwhelm the LLM API

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

/** Send a log message from the webview to the extension host Output panel. */
function logToHost(ext: ReturnType<typeof useExtension>, msg: string) {
  console.log(`[Sim] ${msg}`)
  ext.post({ type: 'webview-log', message: msg })
}

export function startAgents() {
  const board = useBoard()
  const ext = useExtension()

  logToHost(ext, `startAgents() called — running=${board.simulationRunning.value}, isWebview=${ext.isWebview.value}, agents=${board.agents.value.length}, tasks=${board.tasks.value.length}`)

  if (board.simulationRunning.value) return
  board.simulationRunning.value = true
  board.addActivity('🤖 **Agents activated** — processing tasks with Copilot LLM', 'system')
  board.addToast('Agents activated', 'info')

  if (!ext.isWebview.value) {
    logToHost(ext, '⚠️ NOT in webview mode — falling back to standalone simulation')
    startStandaloneSimulation()
    return
  }

  // Extension mode: run real orchestration loop
  const wf = useWorkflow()

  logToHost(ext, `🚀 Extension orchestration: ${board.agents.value.length} agents, ${board.tasks.value.length} tasks`)
  logToHost(ext, `  Agents: ${board.agents.value.map(a => `${a.id}(${a.role})`).join(', ')}`)
  logToHost(ext, `  Tasks: ${board.tasks.value.map(t => `${t.id}(stage=${t.stage},assignee=${t.assignee},manual=${t.manuallyAssigned})`).join(', ')}`)

  // Prioritize: first dispatch agents that have manually assigned tasks
  const assignedAgents: typeof board.agents.value = []
  const otherAgents: typeof board.agents.value = []
  for (const agent of board.agents.value) {
    const hasAssignment = board.tasks.value.some(t => t.manuallyAssigned && t.assignee === agent.id && !wf.isFinalStage(t.stage))
    if (hasAssignment) assignedAgents.push(agent)
    else otherAgents.push(agent)
  }
  const orderedAgents = [...assignedAgents, ...otherAgents]
  logToHost(ext, `  Priority agents (assigned): ${assignedAgents.map(a => a.id).join(', ') || '(none)'}`)

  function checkAgent(agent: typeof board.agents.value[0]) {
    try {
      if (!board.simulationRunning.value) return
      if (agent.status === 'working') return

      // Limit concurrent agents to avoid overwhelming the LLM API
      const workingCount = board.agents.value.filter(a => a.status === 'working').length
      const isAssigned = board.tasks.value.some(t => t.manuallyAssigned && t.assignee === agent.id && !wf.isFinalStage(t.stage))
      if (workingCount >= MAX_CONCURRENT_AGENTS && !isAssigned) {
        logToHost(ext, `⏳ "${agent.name}" waiting — ${workingCount} agents already working`)
        return
      }

      const eligibleTasks = board.tasks.value.filter(
        (t) =>
          !wf.isFinalStage(t.stage) &&
          t.approvalStatus !== 'pending' &&
          !(t.pendingDecision && t.pendingDecision.status === 'pending') &&
          // Agent works on any non-final task: either assigned to it, or unassigned
          (!t.manuallyAssigned || t.assignee === agent.id),
      )

      logToHost(ext, `checkAgent "${agent.name}" (${agent.role}): eligible=${eligibleTasks.length}/${board.tasks.value.length}`)

      if (eligibleTasks.length === 0) {
        for (const t of board.tasks.value) {
          logToHost(ext, `  skip "${t.title}": stage=${t.stage} final=${wf.isFinalStage(t.stage)} approval=${t.approvalStatus} manual=${t.manuallyAssigned} assignee=${t.assignee} agent=${agent.id}`)
        }
        return
      }

      // Prioritize tasks assigned to this agent, then score by skill match
      const scoredTasks = eligibleTasks.map(t => {
        const assigneeBonus = t.assignee === agent.id ? 1.0 : 0.0
        const neededSkills = t.requiredSkills || []
        let skillScore = 0
        if (neededSkills.length > 0) {
          const hits = neededSkills.filter(s =>
            agent.skills.some(sk => sk.toLowerCase() === s.toLowerCase()) ||
            agent.languages.some(l => l.toLowerCase() === s.toLowerCase()),
          ).length
          skillScore = hits / neededSkills.length
        }
        const totalScore = assigneeBonus * 0.60 + skillScore * 0.40
        return { task: t, score: totalScore }
      })
      scoredTasks.sort((a, b) => b.score - a.score)
      const task = scoredTasks[0].task

      const prompt = getAgentPromptForStage(agent.role, task.title, task.description, task.stage)
      const session = board.getOrCreateSession(task.id, agent.id)
      const sessionMessages = session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
      board.addSessionMessage(session.id, 'user', prompt)

      const ws = board.getWorkspace(task.workspaceId)
      const workspacePath = ws?.localPath
      const branch = task.branch

      logToHost(ext, `▶ RUNNING "${agent.name}" → "${task.title}", ws=${workspacePath || 'none'}, branch=${branch || 'none'}`)
      board.addToast(`🤖 ${agent.name} → "${task.title}"`, 'info')
      board.addActivity(`▶ **${agent.name}** started on "${task.title}"`, 'agent_action')

      ext.runAgent(agent.id, task.id, prompt, sessionMessages, workspacePath, branch)
      board.updateAgentStatus(agent.id, 'working', task.id)

      if (!task.assignedAgents.includes(agent.id)) {
        task.assignedAgents.push(agent.id)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logToHost(ext, `❌ checkAgent ERROR for "${agent.name}": ${msg}`)
      board.addToast(`Agent error: ${agent.name} — ${msg}`, 'error')
    }
  }

  // Stagger agent starts: assigned agents first (immediately), then others with delays
  let delay = 500
  for (const agent of orderedAgents) {
    setTimeout(() => {
      logToHost(ext, `⏱️ First check for "${agent.name}" (${agent.role})`)
      checkAgent(agent)
    }, delay)
    const interval = setInterval(() => checkAgent(agent), 15000)
    simulationIntervals.push(interval)
    delay += 300 // Stagger by 300ms to avoid overwhelming the LLM API
  }
  board.addToast(`🚀 Dispatching ${orderedAgents.length} agents (${assignedAgents.length} assigned)`, 'success')

  // Watchdog: auto-recover agents stuck in 'working' for more than 5 minutes
  const AGENT_TIMEOUT_MS = 5 * 60 * 1000
  const agentWorkStartTimes = new Map<string, number>()

  const watchdogInterval = setInterval(() => {
    if (!board.simulationRunning.value) return
    const now = Date.now()
    for (const agent of board.agents.value) {
      if (agent.status === 'working') {
        const started = agentWorkStartTimes.get(agent.id)
        if (!started) {
          agentWorkStartTimes.set(agent.id, now)
        } else if (now - started > AGENT_TIMEOUT_MS) {
          logToHost(ext, `⏰ Watchdog: "${agent.name}" stuck in working for >5min — resetting to idle`)
          board.updateAgentStatus(agent.id, 'idle', null)
          board.addToast(`⏰ ${agent.name} timed out — reset to idle`, 'warning')
          board.addActivity(`⏰ **${agent.name}** watchdog timeout — auto-recovered`, 'system')
          agentWorkStartTimes.delete(agent.id)
        }
      } else {
        agentWorkStartTimes.delete(agent.id)
      }
    }
  }, 30_000)
  simulationIntervals.push(watchdogInterval)
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
  const ext = useExtension()
  // Always send diagnostic to extension host
  ext.post({ type: 'webview-log', message: `toggleSimulation called — running=${board.simulationRunning.value}` })
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
          !wf.isFinalStage(t.stage) &&
          !wf.stageHasApprovalGate(t.stage) &&
          t.approvalStatus !== 'pending' &&
          !(t.pendingDecision && t.pendingDecision.status === 'pending') &&
          // Manually assigned to THIS agent → bypass stage/role filter, agent leads the task
          (t.manuallyAssigned && t.assignee === agent.id
            ? true
            : agentStages.includes(t.stage) && (!t.manuallyAssigned || t.assignee === agent.id)),
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
