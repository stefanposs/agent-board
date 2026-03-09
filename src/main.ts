import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { useExtension } from './composables/useExtension'
import { useBoard } from './composables/useBoard'
import { useWorkflow } from './composables/useWorkflow'
import { debouncedSave, loadFromLocalStorage, initAutoSave } from './composables/usePersistence'
import type { AgentDecision, PendingDecision, Agent } from './domain/types'
import { MAX_FEEDBACK_LOOPS } from './domain/types'

const app = createApp(App)
app.mount('#app')

// When running inside a VS Code webview, bridge extension data into the board
const ext = useExtension()
const board = useBoard()
const wf = useWorkflow()

if (ext.isWebview.value) {
  // Listen for init data from extension host
  ext.onMessage('init', (msg) => {
    // Apply workflow config before loading board data
    if (msg.data.workflow) {
      wf.setWorkflow(msg.data.workflow)
    }
    board.initFromExtension({
      workspaces: msg.data.workspaces,
      agents: msg.data.agents,
      persistedTasks: msg.data.persistedTasks,
      persistedSessions: msg.data.persistedSessions,
    })
  })

  // Listen for workspace rescan results
  ext.onMessage('workspaces-updated', (msg) => {
    board.updateWorkspacesFromExtension(msg.workspaces)
  })

  // Listen for agents reloaded (after adding/removing agent repo paths)
  ext.onMessage('agents-loaded', (msg) => {
    board.updateAgentsFromExtension(msg.agents)
    board.addToast(`🤖 ${msg.agents.length} agents loaded`, 'success')
  })

  // Track streaming output per agent for session storage
  const agentStreamBuffers = new Map<string, { content: string; taskId: string }>()

  // Listen for agent output (LLM responses)
  ext.onMessage('agent-output', (msg) => {
    if (msg.tokensUsed !== undefined && msg.tokensUsed !== null) {
      // Final message — store accumulated response in session
      if (msg.tokensUsed > 0) {
        board.updateAgentUsage(msg.agentId, msg.tokensUsed)
      }

      const buffer = agentStreamBuffers.get(msg.agentId)
      if (buffer && buffer.content.trim()) {
        // Use taskId from message if available (fixes race condition)
        const effectiveTaskId = msg.taskId || buffer.taskId
        const session = board.getOrCreateSession(effectiveTaskId, msg.agentId)
        board.addSessionMessage(session.id, 'assistant', buffer.content, msg.tokensUsed)
        debouncedSave()

        // Parse structured decision from LLM response and act on it
        const decision = parseAgentDecision(buffer.content)

        if (decision && effectiveTaskId) {
          // Small delay to let UI update before triggering next action
          setTimeout(() => handleAgentDecision(msg.agentId, effectiveTaskId, decision), 1500)
        }
      }
      agentStreamBuffers.delete(msg.agentId)
    } else if (msg.content) {
      // Streaming chunk — accumulate
      const existing = agentStreamBuffers.get(msg.agentId)
      if (existing) {
        existing.content += msg.content
        // Patch taskId if it came from the message
        if (msg.taskId && !existing.taskId) {
          existing.taskId = msg.taskId
        }
      } else {
        // Buffer not yet created — create it with taskId from message if available
        agentStreamBuffers.set(msg.agentId, { content: msg.content, taskId: msg.taskId || '' })
      }
    }
  })

  // Listen for agent status changes
  ext.onMessage('agent-status', (msg) => {
    board.updateAgentStatus(msg.agentId, msg.status, msg.taskId || null)
    if (msg.message) {
      board.addActivity(`🤖 **${msg.agentId}**: ${msg.message}`, 'agent_action')
    }
    // Track which task an agent is working on for stream buffering
    if (msg.status === 'working' && msg.taskId) {
      const existing = agentStreamBuffers.get(msg.agentId)
      if (existing) {
        // Buffer already had some chunks (race condition) — patch the taskId
        existing.taskId = msg.taskId
      } else {
        agentStreamBuffers.set(msg.agentId, { content: '', taskId: msg.taskId })
      }
    }
  })

  // Listen for branch creation results
  ext.onMessage('branch-created', (msg) => {
    board.setTaskBranch(msg.taskId, msg.branchName)
    debouncedSave()
  })

  ext.onMessage('branch-error', (msg) => {
    board.addToast(`Branch error: ${msg.message}`, 'error')
  })

  // Listen for errors
  ext.onMessage('error', (msg) => {
    board.addToast(msg.message, 'error')
  })

  // Listen for notifications
  ext.onMessage('notification', (msg) => {
    board.addToast(msg.message, msg.level || 'info')
  })

  // Listen for file-write results from developer agent
  ext.onMessage('files-written', (msg) => {
    const count = msg.files?.length || 0
    const sha = msg.commitSha ? ` (${msg.commitSha})` : ''
    board.addToast(`📝 ${count} file(s) written${sha}`, 'success')
    board.addActivity(
      `📝 Agent wrote ${count} file(s)${sha}: ${msg.files?.join(', ') || ''}`,
      'agent_action',
    )
  })

  ext.onMessage('files-write-error', (msg) => {
    board.addToast(`❌ File write error: ${msg.message}`, 'error')
  })

  // Listen for CLI agent lifecycle events
  ext.onMessage('cli-agent-started', (msg) => {
    board.addToast(`🖥️ Claude CLI started`, 'info')
    board.addActivity(
      `🖥️ Claude CLI started: ${msg.command || 'claude --print'}`,
      'agent_action',
    )
  })

  ext.onMessage('cli-agent-done', (msg) => {
    const exitCode = msg.exitCode ?? 1
    const commits = msg.commits ?? []
    const status: 'success' | 'error' = exitCode === 0 ? 'success' : 'error'
    const commitCount = commits.length
    board.addToast(
      `🖥️ Claude CLI finished (exit ${exitCode}, ${commitCount} commit${commitCount !== 1 ? 's' : ''})`,
      status,
    )
    board.addActivity(
      `🖥️ Claude CLI done — exit ${exitCode}, commits: ${commits.join(', ') || 'none'}`,
      'agent_action',
    )
  })

  ext.sendReady()
} else {
  // Standalone browser mode: restore from localStorage if available
  const persisted = loadFromLocalStorage()
  if (persisted && persisted.tasks.length > 0) {
    board.tasks.value = persisted.tasks
    board.sessions.value = persisted.sessions || []
    board.addActivity(`💾 ${persisted.tasks.length} tasks restored from localStorage`, 'human_action')
    board.addToast(`${persisted.tasks.length} tasks restored`, 'info')
  }
  // Start auto-save watcher for standalone mode
  initAutoSave()
}

// ─── Auto-branch + Auto-agent on task move ──────────────────

board.onTaskMoved((taskId, fromStage, toStage, task) => {

  try {
    const toLabel = wf.getStageConfig(toStage)?.label ?? toStage
    board.addToast(`⚙️ ${task.title}: ${fromStage} → ${toLabel}`, 'info')

    // Auto-create branch when leaving first stage (only for code-related task types)
    const branchTaskTypes = ['feature', 'bugfix', 'infra']
    if (fromStage === wf.firstStage.value && !task.branch && branchTaskTypes.includes(task.taskType)) {
      const ws = board.workspaces.value.find((w) => w.id === task.workspaceId)
      const branchName = board.slugifyBranchName(task.title)

      if (ext.isWebview.value && ws?.localPath) {
        ext.createBranch(taskId, ws.localPath, branchName)
        board.addToast(`🌿 Branch: ${branchName}`, 'info')
      } else if (!ext.isWebview.value) {
        // Standalone mode: simulate branch creation
        board.setTaskBranch(taskId, branchName)
      } else {
        board.addToast(`⚠️ No local path for workspace "${ws?.name || task.workspaceId}"`, 'warning')
      }
    }

    // Workflow-driven agent triggering: find which roles should run for this stage
    const eligibleRoles = wf.getAgentRolesForStage(toStage)
    if (eligibleRoles.length > 0 && !wf.isFinalStage(toStage)) {
      try {
        triggerBestAgent(taskId, task, eligibleRoles)
      } catch (err) {
        board.addToast(`❌ Agent trigger error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    }

    // Persist after any move
    debouncedSave()
  } catch (e) {
    board.addToast(`❌ Callback Error: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
})

// ─── Agent Decision Parser & Handler ────────────────────────

/**
 * Parse a structured decision block from an LLM response.
 * Looks for ```decision { ... } ``` or ```json { "action": ... } ``` blocks.
 */
function parseAgentDecision(content: string): AgentDecision | null {
  // Try ```decision ... ``` first, then ```json ... ```
  const patterns = [
    /```decision\s*\n([\s\S]*?)\n```/,
    /```json\s*\n(\{[\s\S]*?"action"[\s\S]*?\})\n```/,
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed.action && typeof parsed.action === 'string') {
          return {
            action: parsed.action,
            reason: parsed.reason || '',
            questions: parsed.questions || [],
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
            targetAgent: parsed.targetAgent || undefined,
          }
        }
      } catch {
        // JSON parse failed — continue to next pattern
      }
    }
  }
  return null
}

/**
 * Act on a parsed agent decision — ALL decisions now require human confirmation (HITL).
 * Instead of auto-advancing, the decision is stored as `pendingDecision` on the task.
 * The human must confirm/reject via the HITL gate UI before any action is executed.
 */
function handleAgentDecision(agentId: string, taskId: string, decision: AgentDecision) {
  const task = board.tasks.value.find((t) => t.id === taskId)
  if (!task) return

  const agent = board.agents.value.find((a) => a.id === agentId)
  const agentName = agent?.name || agentId

  // ─── Handle 'discuss' action: inter-agent communication ───
  if (decision.action === 'discuss' && decision.targetAgent) {
    const targetRole = decision.targetAgent
    const targetAgent = board.agents.value.find(a => a.role === targetRole || a.id === targetRole)
    if (targetAgent && decision.questions?.length) {
      for (const q of decision.questions) {
        board.addAgentMessage(agentId, targetAgent.id, taskId, q)
      }
      board.addToast(`💬 ${agentName} wants to discuss with ${targetAgent.name}`, 'info')
      // Discussion also needs human approval before agent response is triggered
      const context = `${agentName} wants to discuss with ${targetAgent.name}:\n${decision.questions.map(q => `• ${q}`).join('\n')}`
      board.setPendingDecision(taskId, decision, agentId, context)
      notifyHumanAttention(task, 'decision-confirmation')
    }
    return
  }

  // ─── Handle 'ask-help' action: agent stays responsible, asks colleague for help ───
  if (decision.action === 'ask-help' && decision.targetAgent) {
    const targetRole = decision.targetAgent
    const targetAgent = board.agents.value.find(a => a.role === targetRole || a.id === targetRole)
    if (targetAgent && decision.questions?.length) {
      for (const q of decision.questions) {
        board.addAgentMessage(agentId, targetAgent.id, taskId, q)
      }
      board.addToast(`🤝 ${agentName} asks ${targetAgent.name} for help`, 'info')
      board.addActivity(
        `🤝 **${agentName}** asks **${targetAgent.name}** for help on "${task.title}"`,
        'agent_discussion',
      )
      // Auto-trigger the helper agent — no HITL gate for agent-to-agent help
      if (ext.isWebview.value) {
        const ws = board.workspaces.value.find(w => w.id === task.workspaceId)
        const questions = decision.questions.join('\n')
        const helpPrompt = `${agentName} (${board.getAgent(agentId)?.role || 'agent'}) needs your help on task "${task.title}":\n\n${questions}\n\nTask description: ${task.description || '(none)'}\n\nPlease provide your expertise. The requesting agent remains the owner of this task — you are providing assistance only.`
        const session = board.getOrCreateSession(taskId, targetAgent.id)
        board.addSessionMessage(session.id, 'user', helpPrompt)
        ext.runAgent(targetAgent.id, taskId, helpPrompt, [], ws?.localPath, task.branch)
        if (!task.assignedAgents.includes(targetAgent.id)) {
          task.assignedAgents.push(targetAgent.id)
        }
      }
    }
    return
  }

  // ─── Handle 'escalate' action: agent needs human help (HITL gate) ───
  if (decision.action === 'escalate') {
    const questions = decision.questions?.map(q => `• ${q}`).join('\n') || ''
    const context = `🆘 **${agentName}** needs your help!\n\n**Reason:** ${decision.reason}\n${questions ? `\n**Questions:**\n${questions}` : ''}\n\nThe agent has paused work and is waiting for your guidance. Please answer the questions or provide direction, then approve to let the agent continue.`
    board.setPendingDecision(taskId, decision, agentId, context)
    task.humanAttentionType = 'escalation'
    notifyHumanAttention(task, 'escalation')
    debouncedSave()
    return
  }

  // ─── Build context summary for the HITL gate ───
  let context = ''
  let proposedStage: string | undefined

  switch (decision.action) {
    case 'needs-clarification': {
      const loops = task.metrics?.feedbackLoops?.devToPlanner ?? 0
      if (loops >= MAX_FEEDBACK_LOOPS) {
        board.addToast(`🚫 "${task.title}": Max ${MAX_FEEDBACK_LOOPS} feedback loops reached — decide manually`, 'warning')
        return
      }
      const backward = wf.getValidTransitions(task.stage).find(t => !t.requiresApproval && !wf.isFinalStage(t.to))
      proposedStage = backward?.to
      const targetLabel = proposedStage ? (wf.getStageConfig(proposedStage)?.label ?? proposedStage) : '(unknown)'
      context = `${agentName} needs clarification and proposes moving back to **${targetLabel}**.\n\nQuestions:\n${(decision.questions || []).map(q => `• ${q}`).join('\n')}\n\nReason: ${decision.reason}`
      break
    }
    case 'move-to-review': {
      const forward = wf.getValidTransitions(task.stage).find(t => !t.requiresApproval && t.trigger !== 'human' && t.from !== t.to)
      proposedStage = forward?.to
      const targetLabel = proposedStage ? (wf.getStageConfig(proposedStage)?.label ?? proposedStage) : '(unknown)'
      context = `${agentName} completed work and proposes moving to **${targetLabel}**.\n\nReason: ${decision.reason}\nConfidence: ${Math.round(decision.confidence * 100)}%`
      break
    }
    case 'implement': {
      context = `${agentName} is working on implementation.\n\nReason: ${decision.reason}\nConfidence: ${Math.round(decision.confidence * 100)}%`
      break
    }
    case 'ready-for-implementation': {
      const next = wf.getValidTransitions(task.stage).find(t => !t.requiresApproval && t.trigger !== 'human' && t.from !== t.to)
      proposedStage = next?.to
      const targetLabel = proposedStage ? (wf.getStageConfig(proposedStage)?.label ?? proposedStage) : '(unknown)'
      context = `${agentName} completed planning and proposes moving to **${targetLabel}**.\n\nReason: ${decision.reason}\nConfidence: ${Math.round(decision.confidence * 100)}%`
      break
    }
    case 'approve': {
      const approval = wf.getValidTransitions(task.stage).find(t => t.requiresApproval)
      proposedStage = approval?.to
      const targetLabel = proposedStage ? (wf.getStageConfig(proposedStage)?.label ?? proposedStage) : '(unknown)'
      context = `${agentName} approves and proposes moving to **${targetLabel}**.\n\nReason: ${decision.reason}\nConfidence: ${Math.round(decision.confidence * 100)}%`
      break
    }
    case 'request-changes': {
      const loops = task.metrics?.feedbackLoops?.reviewToDev ?? 0
      if (loops >= MAX_FEEDBACK_LOOPS) {
        board.addToast(`🚫 "${task.title}": Max ${MAX_FEEDBACK_LOOPS} review loops reached — decide manually`, 'warning')
        return
      }
      const reject = wf.getValidTransitions(task.stage).find(t => !t.requiresApproval && !wf.isFinalStage(t.to))
      proposedStage = reject?.to
      const targetLabel = proposedStage ? (wf.getStageConfig(proposedStage)?.label ?? proposedStage) : '(unknown)'
      context = `${agentName} requests changes and proposes moving back to **${targetLabel}**.\n\nReason: ${decision.reason}\n${decision.questions?.length ? `\nIssues:\n${decision.questions.map(q => `• ${q}`).join('\n')}` : ''}`
      break
    }
  }

  // Store as pending decision — human must confirm
  board.setPendingDecision(taskId, decision, agentId, context, proposedStage)
  notifyHumanAttention(task, 'decision-confirmation')
  debouncedSave()
}

/**
 * Execute a confirmed (approved) decision.
 * Called after the human clicks "Approve" in the HITL gate.
 */
function executeConfirmedDecision(pd: PendingDecision) {
  const task = board.tasks.value.find(t => t.id === pd.taskId)
  if (!task) return

  const agentName = board.getAgent(pd.agentId)?.name || pd.agentId

  switch (pd.decision.action) {
    case 'needs-clarification': {
      if (pd.decision.questions?.length) {
        board.addComment(pd.taskId, `**🔄 Agent questions:**\n${pd.decision.questions.map(q => `- ${q}`).join('\n')}\n\n_Reason: ${pd.decision.reason}_`, pd.agentId)
      }
      if (task.metrics?.feedbackLoops) task.metrics.feedbackLoops.devToPlanner++
      if (pd.proposedStage) {
        board.moveTask(pd.taskId, pd.proposedStage, 'agent', pd.agentId)
      }
      break
    }
    case 'move-to-review': {
      board.addComment(pd.taskId, `✅ **Work complete**\n\n_${pd.decision.reason}_\n\nConfidence: ${Math.round(pd.decision.confidence * 100)}%`, pd.agentId)
      if (pd.proposedStage) {
        board.moveTask(pd.taskId, pd.proposedStage, 'agent', pd.agentId)
      }
      break
    }
    case 'implement': {
      board.addToast(`⚙️ ${agentName}: Continuing work...`, 'info')
      break
    }
    case 'ready-for-implementation': {
      board.addComment(pd.taskId, `✅ **Planning complete**\n\n_${pd.decision.reason}_\n\nConfidence: ${Math.round(pd.decision.confidence * 100)}%`, pd.agentId)
      if (pd.proposedStage) {
        board.moveTask(pd.taskId, pd.proposedStage, 'agent', pd.agentId)
      }
      break
    }
    case 'approve': {
      board.addComment(pd.taskId, `✅ **Review approved**\n\n_${pd.decision.reason}_`, pd.agentId)
      if (pd.proposedStage) {
        board.moveTask(pd.taskId, pd.proposedStage, 'agent', pd.agentId)
        task.approvalStatus = 'approved'
      }
      break
    }
    case 'request-changes': {
      board.addComment(pd.taskId, `🔄 **Changes requested:**\n\n_${pd.decision.reason}_${pd.decision.questions?.length ? `\n\nPunkte:\n${pd.decision.questions.map(q => `- ${q}`).join('\n')}` : ''}`, pd.agentId)
      if (task.metrics?.feedbackLoops) task.metrics.feedbackLoops.reviewToDev++
      if (pd.proposedStage) {
        board.moveTask(pd.taskId, pd.proposedStage, 'agent', pd.agentId)
        task.approvalStatus = 'rejected'
      }
      break
    }
    case 'discuss': {
      // Discussion was already recorded when the decision was created
      // Now trigger the target agent to respond
      const targetRole = pd.decision.targetAgent
      if (targetRole) {
        const targetAgent = board.agents.value.find(a => a.role === targetRole || a.id === targetRole)
        if (targetAgent && ext.isWebview.value) {
          const ws = board.workspaces.value.find(w => w.id === task.workspaceId)
          const questions = pd.decision.questions?.join('\n') || ''
          const fromAgent = board.getAgent(pd.agentId)
          const prompt = `${fromAgent?.name || pd.agentId} (${fromAgent?.role || 'agent'}) has a question for you about task "${task.title}":\n\n${questions}\n\nPlease answer their questions based on your expertise and the task context.`
          const session = board.getOrCreateSession(pd.taskId, targetAgent.id)
          board.addSessionMessage(session.id, 'user', prompt)
          ext.runAgent(targetAgent.id, pd.taskId, prompt, [], ws?.localPath, task.branch)
        }
      }
      break
    }
    case 'escalate': {
      // Human provided feedback/answers — re-trigger the assignee agent with the guidance
      const assigneeAgent = task.assignee ? board.getAgent(task.assignee) : board.getAgent(pd.agentId)
      if (assigneeAgent && ext.isWebview.value) {
        const ws = board.workspaces.value.find(w => w.id === task.workspaceId)
        const humanGuidance = pd.humanFeedback || '(no specific feedback provided)'
        const resumePrompt = `You previously escalated task "${task.title}" to the human for help.\n\nYour original questions/reason:\n${pd.decision.reason}\n${pd.decision.questions?.map(q => `• ${q}`).join('\n') || ''}\n\n**Human response:**\n${humanGuidance}\n\nPlease continue working on the task with this guidance.`
        const session = board.getOrCreateSession(pd.taskId, assigneeAgent.id)
        board.addSessionMessage(session.id, 'user', resumePrompt)
        ext.runAgent(assigneeAgent.id, pd.taskId, resumePrompt, [], ws?.localPath, task.branch)
        board.addToast(`🤖 ${assigneeAgent.name} resuming work with your guidance`, 'success')
      }
      task.humanAttentionType = undefined
      break
    }
  }

  debouncedSave()
}

// ─── Notification / Feedback System ─────────────────────────

/** Audio context for notification sounds (created on first use). */
let audioCtx: AudioContext | null = null

function playNotificationSound(type: 'attention' | 'success' | 'error' = 'attention') {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)

    const now = audioCtx.currentTime
    gain.gain.setValueAtTime(0.15, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5)

    if (type === 'attention') {
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.setValueAtTime(1100, now + 0.1)
      osc.frequency.setValueAtTime(880, now + 0.2)
    } else if (type === 'success') {
      osc.frequency.setValueAtTime(523, now)
      osc.frequency.setValueAtTime(659, now + 0.1)
      osc.frequency.setValueAtTime(784, now + 0.2)
    } else {
      osc.frequency.setValueAtTime(440, now)
      osc.frequency.setValueAtTime(330, now + 0.15)
    }

    osc.start(now)
    osc.stop(now + 0.5)
  } catch {
    // Audio not supported or blocked — silently ignore
  }
}

function notifyHumanAttention(task: { id: string; title: string }, type: string) {
  // 1. Sound notification
  playNotificationSound(type === 'decision-confirmation' ? 'attention' : 'success')

  // 2. VS Code notification (if in webview)
  if (ext.isWebview.value) {
    ext.post({
      type: 'show-notification',
      title: '🔔 Agent Board — Action Required',
      body: `"${task.title}" needs your attention: ${type}`,
      severity: 'warning',
    })
  }

  // 3. Browser title flash
  if (typeof document !== 'undefined') {
    const originalTitle = document.title
    let flash = true
    const interval = setInterval(() => {
      document.title = flash ? `🔔 Action Required — ${task.title}` : originalTitle
      flash = !flash
    }, 1000)
    setTimeout(() => {
      clearInterval(interval)
      document.title = originalTitle
    }, 10000)
  }
}

// Expose executeConfirmedDecision for use in components
;(window as any).__agentBoard_executeConfirmedDecision = executeConfirmedDecision
;(window as any).__agentBoard_notifyHumanAttention = notifyHumanAttention

// ─── Decision instruction appended to agent prompts ─────────

const DECISION_INSTRUCTION_PLANNER = `

IMPORTANT: After your planning and analysis, you MUST include a structured decision block at the very end of your response. Use exactly this format:

\`\`\`decision
{
  "action": "ready-for-implementation",
  "reason": "Brief summary of the plan",
  "confidence": 0.85
}
\`\`\`

Decision guide:
- "ready-for-implementation": Planning is complete. The task will automatically move to Implementation and a Developer agent will start working.
- "needs-clarification": You need more information from the user/developer before planning can be completed. List questions in "questions" array.
- "discuss": You want to ask another agent a question. Set "targetAgent" to the role (e.g. "developer", "reviewer") and list questions in "questions" array.
- "ask-help": You need input from another agent but remain responsible for this task. Set "targetAgent" and list questions. The helper agent will respond directly — no human approval needed.
- "escalate": You are stuck and need the human's help to continue. List your questions/blockers in "questions". Work will pause until the human responds.
`

const DECISION_INSTRUCTION_DEVELOPER = `

After your code changes (using the file:path format you were instructed about), you MUST include a structured decision block at the very end of your response. Use exactly this format:

\`\`\`decision
{
  "action": "implement" | "needs-clarification" | "move-to-review" | "discuss" | "ask-help" | "escalate",
  "reason": "Brief explanation of your decision",
  "questions": ["question 1", "question 2"],
  "confidence": 0.85,
  "targetAgent": "planner"
}
\`\`\`

Decision guide:
- "needs-clarification": You have unanswered questions that block implementation. List them in "questions". The task will go back to the Planner agent.
- "implement": You are currently working on the implementation but it's not complete yet (rare — prefer move-to-review when done).
- "move-to-review": Implementation is complete and ready for code review.
- "discuss": You want to ask another agent a question. Set "targetAgent" to the role (e.g. "planner", "reviewer") and list questions in "questions" array.
- "ask-help": You need input from another agent but remain responsible for this task. Set "targetAgent" and list questions. The helper agent will respond directly.
- "escalate": You are stuck and need the human's help. List blockers in "questions". Work pauses until they respond.
`

const DECISION_INSTRUCTION_REVIEWER = `

IMPORTANT: After your review, you MUST include a structured decision block at the very end of your response. Use exactly this format:

\`\`\`decision
{
  "action": "approve" | "request-changes" | "discuss" | "ask-help" | "escalate",
  "reason": "Brief explanation of your decision",
  "questions": ["issue 1", "issue 2"],
  "confidence": 0.9,
  "targetAgent": "developer"
}
\`\`\`

Decision guide:
- "approve": Code is correct, follows conventions, and is ready to merge.
- "request-changes": Issues found that need fixing. List them in "questions". The task will go back to the Developer agent.
- "discuss": You want to ask another agent a question. Set "targetAgent" to the role (e.g. "developer", "planner") and list questions in "questions" array.
- "ask-help": You need input from another agent for your review. Set "targetAgent" and list questions.
- "escalate": You need the human's judgment on something. List concerns in "questions". Work pauses until they respond.
`

/**
 * Unified agent trigger: if the task has an assignee, use that agent directly.
 * Otherwise find the best agent based on skills + roles, then dispatch to the
 * appropriate prompt builder.
 */
function triggerBestAgent(
  taskId: string,
  task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; events?: any[]; branch?: string },
  eligibleRoles: string[],
) {
  const taskObj = board.tasks.value.find((t) => t.id === taskId)

  // 1. If an assignee is set, use that agent directly (like a real team — you pick who works)
  let agent: Agent | null = null
  if (taskObj?.assignee) {
    agent = board.getAgent(taskObj.assignee) || null
    if (agent) {
      board.addToast(`🤖 ${agent.displayName || agent.name} picks up "${task.title}" (assigned)`, 'info')
    }
  }

  // 2. Fallback: skill-based matching
  if (!agent) {
    agent = board.getBestAgentForTask(board.agents.value, eligibleRoles, taskObj || task as any)
  }

  if (!agent) {
    board.addToast(`❌ No agent found for roles [${eligibleRoles.join(', ')}] (${board.agents.value.length} agents total)`, 'error')
    return
  }

  // Auto-assign as assignee if none set
  if (taskObj && !taskObj.assignee) {
    taskObj.assignee = agent.id
    if (!taskObj.assignedAgents.includes(agent.id)) {
      taskObj.assignedAgents.push(agent.id)
    }
  }

  // Route to the correct prompt builder based on the agent's role
  const plannerRoles = ['planner', 'architect']
  const devRoles = ['developer', 'devops']
  const reviewerRoles = ['reviewer']

  if (plannerRoles.includes(agent.role)) {
    triggerPlannerAgent(taskId, task, agent)
  } else if (devRoles.includes(agent.role)) {
    triggerDeveloperAgent(taskId, task, agent)
  } else if (reviewerRoles.includes(agent.role)) {
    triggerReviewerAgent(taskId, task, agent)
  } else {
    // Unknown role — use developer prompt as default
    board.addToast(`🤖 Triggering ${agent.name} (role: ${agent.role}) for "${task.title}"...`, 'info')
    triggerDeveloperAgent(taskId, task, agent)
  }
}

/**
 * Run the planner agent on a task. Called automatically on move-to-planning,
 * or manually via the "Run Planner" button in TaskDetail.
 */
function triggerPlannerAgent(taskId: string, task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; events?: any[]; branch?: string }, preselectedAgent?: any) {
  const allAgents = board.agents.value
  const plannerAgent = preselectedAgent || allAgents.find(
    (a) => a.role === 'planner' || a.role === 'architect',
  )

  if (!plannerAgent) {
    board.addToast(`❌ No Planner Agent found (${allAgents.length} agents, roles: ${allAgents.map(a => a.role).join(', ')})`, 'error')
    return
  }

  const ws = board.workspaces.value.find((w) => w.id === task.workspaceId)
  board.addToast(`🤖 Starting ${plannerAgent.name}... (ws: ${ws?.name || 'none'}, path: ${ws?.localPath || 'none'})`, 'info')

  // Check if this is a return from implementation (feedback loop)
  const stageEvents = (task.events || []).filter((e: any) => e.type === 'stage_change')
  const lastEvent = stageEvents[stageEvents.length - 1]
  const isReturnFromImpl = lastEvent?.fromStage === 'implementation'

  // Gather developer questions from recent comments
  const taskObj = board.tasks.value.find((t) => t.id === taskId)
  const devQuestions = taskObj?.comments
    ?.filter((c) => c.author !== 'user' && (c.content.includes('Developer questions') || c.content.includes('Rückfragen')))
    .map((c) => c.content)
    .join('\n\n') || ''

  const session = board.getOrCreateSession(taskId, plannerAgent.id)

  let prompt: string
  if (isReturnFromImpl && devQuestions) {
    // Feedback loop: planner answers developer's questions
    prompt = `The Developer agent returned this task to planning with questions that need answering.\n\nTask: "${task.title}"\nDescription: ${task.description || '(no description provided)'}\nPriority: ${task.priority}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\n--- Developer Questions ---\n${devQuestions}\n\nPlease:\n1. Address each of the developer's questions specifically\n2. Provide concrete answers with code examples where helpful\n3. Update the implementation plan if needed based on the questions\n4. Resolve any ambiguities so the developer can proceed${DECISION_INSTRUCTION_PLANNER}`
  } else {
    prompt = `Analyze and plan the implementation for this task:\n\nTask: "${task.title}"\nDescription: ${task.description || '(no description provided)'}\nPriority: ${task.priority}\nTags: ${task.tags.length > 0 ? task.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\n\nBased on the project context provided, please:\n1. Identify which files/components are relevant to this task\n2. Assess feasibility and complexity\n3. Provide a step-by-step implementation plan\n4. List dependencies and potential risks\n5. Suggest which existing patterns/conventions to follow${DECISION_INSTRUCTION_PLANNER}`
  }

  board.addSessionMessage(session.id, 'user', prompt)

  if (ext.isWebview.value) {
    ext.runAgent(plannerAgent.id, taskId, prompt, [], ws?.localPath, task.branch)
    board.addToast(`✅ Agent request sent (${plannerAgent.id})`, 'success')
  } else {
    board.addToast(`ℹ️ Not in webview mode — agent not started`, 'warning')
  }

  // Assign agent to task
  if (!task.assignedAgents.includes(plannerAgent.id)) {
    task.assignedAgents.push(plannerAgent.id)
  }

  board.addActivity(
    `🤖 **${plannerAgent.name}** auto-started planning for "${task.title}"`,
    'agent_action',
  )
}

/**
 * Run a developer agent on a task entering implementation.
 * Picks the first idle developer (or devops as fallback).
 */
function triggerDeveloperAgent(taskId: string, task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; events?: any[]; branch?: string }, preselectedAgent?: any) {
  const allAgents = board.agents.value
  const devAgent = preselectedAgent ||
    allAgents.find((a) => a.role === 'developer' && a.status === 'idle') ||
    allAgents.find((a) => a.role === 'developer') ||
    allAgents.find((a) => a.role === 'devops' && a.status === 'idle') ||
    allAgents.find((a) => a.role === 'devops')

  if (!devAgent) {
    board.addToast(`❌ No Developer Agent found (roles: ${allAgents.map(a => a.role).join(', ')})`, 'error')
    return
  }

  const ws = board.workspaces.value.find((w) => w.id === task.workspaceId)
  board.addToast(`🤖 Starting ${devAgent.name} for implementation...`, 'info')

  // Gather planner output from existing sessions as context
  const plannerSessions = board.sessions.value.filter(
    (s) => s.taskId === taskId && s.messages.some((m) => m.role === 'assistant'),
  )
  const plannerContext = plannerSessions
    .flatMap((s) => s.messages.filter((m) => m.role === 'assistant').map((m) => m.content))
    .join('\n\n')

  // Check if returning from review (reviewer sent changes back)
  const stageEvents = (task.events || []).filter((e: any) => e.type === 'stage_change')
  const lastEvent = stageEvents[stageEvents.length - 1]
  const isReturnFromReview = lastEvent?.fromStage === 'review'

  // Gather reviewer feedback from comments
  const taskObj = board.tasks.value.find((t) => t.id === taskId)
  const reviewerFeedback = taskObj?.comments
    ?.filter((c) => c.author !== 'user' && c.content.includes('Changes requested'))
    .map((c) => c.content)
    .join('\n\n') || ''

  const session = board.getOrCreateSession(taskId, devAgent.id)

  let prompt: string
  if (isReturnFromReview && reviewerFeedback) {
    prompt = `The Reviewer sent this task back with requested changes.\n\nTask: "${task.title}"\nDescription: ${task.description || '(no description provided)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\nBranch: ${task.branch || '(not set)'}\n\n--- Reviewer Feedback ---\n${reviewerFeedback}\n\n${plannerContext ? `--- Planning Context ---\n${plannerContext}\n\n` : ''}Please:\n1. Address each issue raised by the reviewer\n2. Make the requested changes\n3. Ensure code quality and conventions are maintained${DECISION_INSTRUCTION_DEVELOPER}`
  } else {
    prompt = `Implement the following task:\n\nTask: "${task.title}"\nDescription: ${task.description || '(no description provided)'}\nPriority: ${task.priority}\nTags: ${task.tags.length > 0 ? task.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\nBranch: ${task.branch || '(not set)'}\n\n${plannerContext ? `--- Planning Context ---\n${plannerContext}\n\n` : ''}Please:\n1. Implement the changes described in the planning phase\n2. Follow existing code patterns and conventions\n3. Write clean, well-tested code\n4. Commit your changes with meaningful messages${DECISION_INSTRUCTION_DEVELOPER}`
  }

  board.addSessionMessage(session.id, 'user', prompt)

  if (ext.isWebview.value) {
    ext.runAgent(devAgent.id, taskId, prompt, [], ws?.localPath, task.branch)
    board.addToast(`✅ Agent request sent (${devAgent.id})`, 'success')
  } else {
    board.addToast(`ℹ️ Not in webview mode — agent not started`, 'warning')
  }

  if (!task.assignedAgents.includes(devAgent.id)) {
    task.assignedAgents.push(devAgent.id)
  }

  board.addActivity(
    `🤖 **${devAgent.name}** auto-started implementation for "${task.title}"`,
    'agent_action',
  )
}

/**
 * Run a reviewer agent on a task entering review.
 */
function triggerReviewerAgent(taskId: string, task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; branch?: string }, preselectedAgent?: any) {
  const allAgents = board.agents.value
  const reviewAgent = preselectedAgent ||
    allAgents.find((a) => a.role === 'reviewer' && a.status === 'idle') ||
    allAgents.find((a) => a.role === 'reviewer')

  if (!reviewAgent) {
    board.addToast(`❌ No Reviewer Agent found (roles: ${allAgents.map(a => a.role).join(', ')})`, 'error')
    return
  }

  const ws = board.workspaces.value.find((w) => w.id === task.workspaceId)
  board.addToast(`🤖 Starting ${reviewAgent.name} for review...`, 'info')

  // Gather implementation output as context
  const implSessions = board.sessions.value.filter(
    (s) => s.taskId === taskId && s.messages.some((m) => m.role === 'assistant'),
  )
  const implContext = implSessions
    .flatMap((s) => s.messages.filter((m) => m.role === 'assistant').map((m) => m.content))
    .join('\n\n')

  const session = board.getOrCreateSession(taskId, reviewAgent.id)
  const prompt = `Review the implementation for this task:\n\nTask: "${task.title}"\nDescription: ${task.description || '(no description provided)'}\nPriority: ${task.priority}\nTags: ${task.tags.length > 0 ? task.tags.join(', ') : '(none)'}\nWorkspace: ${ws?.name || 'unknown'}${ws?.repo ? ` (${ws.repo})` : ''}\nBranch: ${task.branch || '(not set)'}\n\n${implContext ? `--- Implementation Context ---\n${implContext}\n\n` : ''}Please:\n1. Review the code changes for correctness and quality\n2. Check for potential bugs, security issues, and performance concerns\n3. Verify adherence to project conventions and patterns\n4. Provide actionable feedback or approve the changes${DECISION_INSTRUCTION_REVIEWER}`

  board.addSessionMessage(session.id, 'user', prompt)

  if (ext.isWebview.value) {
    ext.runAgent(reviewAgent.id, taskId, prompt, [], ws?.localPath, task.branch)
    board.addToast(`✅ Agent request sent (${reviewAgent.id})`, 'success')
  } else {
    board.addToast(`ℹ️ Not in webview mode — agent not started`, 'warning')
  }

  if (!task.assignedAgents.includes(reviewAgent.id)) {
    task.assignedAgents.push(reviewAgent.id)
  }

  board.addActivity(
    `🤖 **${reviewAgent.name}** auto-started review for "${task.title}"`,
    'agent_action',
  )
}
