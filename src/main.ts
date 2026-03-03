import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { useExtension } from './composables/useExtension'
import { useBoard } from './composables/useBoard'
import { useWorkflow } from './composables/useWorkflow'
import { debouncedSave, loadFromLocalStorage, initAutoSave } from './composables/usePersistence'
import type { AgentDecision } from './domain/types'
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
      // Try each role in order; trigger the first matching agent
      for (const role of eligibleRoles) {
        try {
          if (role === 'planner' || role === 'architect') {
            triggerPlannerAgent(taskId, task)
            break
          } else if (role === 'developer' || role === 'devops') {
            board.addToast(`🔧 Triggering ${role} agent for "${task.title}"...`, 'info')
            triggerDeveloperAgent(taskId, task)
            break
          } else if (role === 'reviewer') {
            board.addToast(`🔍 Triggering reviewer agent for "${task.title}"...`, 'info')
            triggerReviewerAgent(taskId, task)
            break
          }
        } catch (err) {
          board.addToast(`❌ Agent trigger error (${role}): ${err instanceof Error ? err.message : String(err)}`, 'error')
        }
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
 * Act on a parsed agent decision — move tasks between stages autonomously.
 */
function handleAgentDecision(agentId: string, taskId: string, decision: AgentDecision) {
  const task = board.tasks.value.find((t) => t.id === taskId)
  if (!task) return

  const agent = board.agents.value.find((a) => a.id === agentId)
  const agentName = agent?.name || agentId

  switch (decision.action) {
    case 'needs-clarification': {
      // Developer needs answers → move backward (to a previous stage)
      const loops = task.metrics?.feedbackLoops?.devToPlanner ?? 0
      if (loops >= MAX_FEEDBACK_LOOPS) {
        board.addToast(`🚫 "${task.title}": Max ${MAX_FEEDBACK_LOOPS} feedback loops reached — human review needed`, 'warning')
        board.addComment(taskId, `⚠️ **Loop limit reached** (${MAX_FEEDBACK_LOOPS}x feedback). Manual intervention required.\n\nLast questions:\n${(decision.questions || []).map(q => `- ${q}`).join('\n')}`, agentId)
        return
      }

      // Store questions as comment
      if (decision.questions?.length) {
        board.addComment(
          taskId,
          `**🔄 Agent questions:**\n${decision.questions.map((q) => `- ${q}`).join('\n')}\n\n_Reason: ${decision.reason}_`,
          agentId,
        )
      }

      // Increment loop counter
      if (task.metrics?.feedbackLoops) {
        task.metrics.feedbackLoops.devToPlanner++
      }

      // Find a backward transition (non-final, non-approval) from current stage
      const backwardTransition = wf.getValidTransitions(task.stage)
        .find(t => !t.requiresApproval && !wf.isFinalStage(t.to))
      if (backwardTransition) {
        const targetLabel = wf.getStageConfig(backwardTransition.to)?.label ?? backwardTransition.to
        board.addToast(`🔄 ${agentName}: Questions → back to ${targetLabel}`, 'info')
        board.moveTask(taskId, backwardTransition.to, 'agent', agentId)
      }
      break
    }

    case 'move-to-review': {
      // Agent done → move forward to the next stage (typically review)
      const forwardTransition = wf.getValidTransitions(task.stage)
        .find(t => !t.requiresApproval && t.trigger !== 'human' && t.from !== t.to)
      if (forwardTransition) {
        const targetLabel = wf.getStageConfig(forwardTransition.to)?.label ?? forwardTransition.to
        board.addComment(taskId, `✅ **Work complete**\n\n_${decision.reason}_\n\nConfidence: ${Math.round(decision.confidence * 100)}%`, agentId)
        board.addToast(`✅ ${agentName}: Done → ${targetLabel}`, 'success')
        board.moveTask(taskId, forwardTransition.to, 'agent', agentId)
      }
      break
    }

    case 'implement': {
      // Agent analyzed and will continue (no stage change)
      board.addToast(`⚙️ ${agentName}: Working...`, 'info')
      break
    }

    case 'ready-for-implementation': {
      // Planner done → move forward to the next stage
      const nextTransition = wf.getValidTransitions(task.stage)
        .find(t => !t.requiresApproval && t.trigger !== 'human' && t.from !== t.to)
      if (nextTransition) {
        const targetLabel = wf.getStageConfig(nextTransition.to)?.label ?? nextTransition.to
        board.addComment(taskId, `✅ **Planning complete**\n\n_${decision.reason}_\n\nConfidence: ${Math.round(decision.confidence * 100)}%`, agentId)
        board.addToast(`✅ ${agentName}: Done → ${targetLabel}`, 'success')
        board.moveTask(taskId, nextTransition.to, 'agent', agentId)
      }
      break
    }

    case 'approve': {
      // Reviewer approves → find the approval-gated transition
      const approvalTransition = wf.getValidTransitions(task.stage)
        .find(t => t.requiresApproval)
      if (approvalTransition) {
        const targetLabel = wf.getStageConfig(approvalTransition.to)?.label ?? approvalTransition.to
        board.addComment(taskId, `✅ **Review approved**\n\n_${decision.reason}_`, agentId)
        board.addToast(`✅ ${agentName}: Approved → ${targetLabel}`, 'success')
        board.moveTask(taskId, approvalTransition.to, 'agent', agentId)
        task.approvalStatus = 'approved'
      }
      break
    }

    case 'request-changes': {
      // Reviewer rejects → move backward to a non-final, non-approval stage
      const loops = task.metrics?.feedbackLoops?.reviewToDev ?? 0
      if (loops >= MAX_FEEDBACK_LOOPS) {
        board.addToast(`🚫 "${task.title}": Max ${MAX_FEEDBACK_LOOPS} review loops reached — human review needed`, 'warning')
        board.addComment(taskId, `⚠️ **Loop limit reached** (${MAX_FEEDBACK_LOOPS}x review). Manual intervention required.\n\n_${decision.reason}_`, agentId)
        return
      }

      board.addComment(
        taskId,
        `🔄 **Changes requested:**\n\n_${decision.reason}_${decision.questions?.length ? `\n\nPunkte:\n${decision.questions.map((q) => `- ${q}`).join('\n')}` : ''}`,
        agentId,
      )

      if (task.metrics?.feedbackLoops) {
        task.metrics.feedbackLoops.reviewToDev++
      }

      // Find backward/rejection transition
      const rejectTransition = wf.getValidTransitions(task.stage)
        .find(t => !t.requiresApproval && !wf.isFinalStage(t.to))
      if (rejectTransition) {
        const targetLabel = wf.getStageConfig(rejectTransition.to)?.label ?? rejectTransition.to
        board.addToast(`🔄 ${agentName}: Changes requested → back to ${targetLabel}`, 'info')
        board.moveTask(taskId, rejectTransition.to, 'agent', agentId)
        task.approvalStatus = 'rejected'
      }
      break
    }
  }

  debouncedSave()
}

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
`

const DECISION_INSTRUCTION_DEVELOPER = `

After your code changes (using the file:path format you were instructed about), you MUST include a structured decision block at the very end of your response. Use exactly this format:

\`\`\`decision
{
  "action": "implement" | "needs-clarification" | "move-to-review",
  "reason": "Brief explanation of your decision",
  "questions": ["question 1", "question 2"],
  "confidence": 0.85
}
\`\`\`

Decision guide:
- "needs-clarification": You have unanswered questions that block implementation. List them in "questions". The task will go back to the Planner agent.
- "implement": You are currently working on the implementation but it's not complete yet (rare — prefer move-to-review when done).
- "move-to-review": Implementation is complete and ready for code review.
`

const DECISION_INSTRUCTION_REVIEWER = `

IMPORTANT: After your review, you MUST include a structured decision block at the very end of your response. Use exactly this format:

\`\`\`decision
{
  "action": "approve" | "request-changes",
  "reason": "Brief explanation of your decision",
  "questions": ["issue 1", "issue 2"],
  "confidence": 0.9
}
\`\`\`

Decision guide:
- "approve": Code is correct, follows conventions, and is ready to merge.
- "request-changes": Issues found that need fixing. List them in "questions". The task will go back to the Developer agent.
`

/**
 * Run the planner agent on a task. Called automatically on move-to-planning,
 * or manually via the "Run Planner" button in TaskDetail.
 */
function triggerPlannerAgent(taskId: string, task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; events?: any[]; branch?: string }) {
  const allAgents = board.agents.value
  const plannerAgent = allAgents.find(
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
function triggerDeveloperAgent(taskId: string, task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; events?: any[]; branch?: string }) {
  const allAgents = board.agents.value
  const devAgent =
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
function triggerReviewerAgent(taskId: string, task: { title: string; description?: string; priority: string; tags: string[]; workspaceId: string; assignedAgents: string[]; branch?: string }) {
  const allAgents = board.agents.value
  const reviewAgent =
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
