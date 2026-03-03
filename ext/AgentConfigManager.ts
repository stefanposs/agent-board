import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs/promises'
import { Dirent } from 'fs'
import type { AgentConfig } from './protocol'

// ─── Sensible defaults that work out-of-the-box ─────────────────

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'agent-planner',
    name: 'Planner',
    role: 'planner',
    avatar: '📋',
    color: '#8b5cf6',
    model: 'copilot-claude-sonnet-4',
    temperature: 0.3,
    maxContextTokens: 128_000,
    systemPrompt:
      'You are a planning agent. Break down features into concrete implementation tasks with clear acceptance criteria.',
  },
  {
    id: 'agent-developer',
    name: 'Developer',
    role: 'developer',
    avatar: '⚙️',
    color: '#3b82f6',
    model: 'copilot-claude-sonnet-4',
    temperature: 0.2,
    maxContextTokens: 128_000,
    systemPrompt:
      'You are a developer agent. Implement code changes based on task specifications. Write clean, tested, production-ready code. You will receive specific output format instructions with each task.',
    executionMode: 'cli' as const,
  },
  {
    id: 'agent-reviewer',
    name: 'Reviewer',
    role: 'reviewer',
    avatar: '🔍',
    color: '#f97316',
    model: 'copilot-gpt-4o',
    temperature: 0.1,
    maxContextTokens: 128_000,
    systemPrompt:
      'You are a code review agent. Review code for correctness, security, performance, and adherence to best practices.',
  },
  {
    id: 'agent-architect',
    name: 'Architect',
    role: 'architect',
    avatar: '🏛️',
    color: '#10b981',
    model: 'copilot-claude-opus-4',
    temperature: 0.4,
    maxContextTokens: 200_000,
    systemPrompt:
      'You are an architect agent. Design system architecture, evaluate trade-offs, and ensure technical coherence.',
  },
]

// ─── Manager ────────────────────────────────────────────────────

const ROLE_MAP: Record<string, string> = {
  architecture: 'architect', 'system-design': 'architect',
  testing: 'reviewer', 'code-reviewer': 'reviewer',
  'project-management': 'planner', 'team-collaboration': 'planner',
  'software-engineering': 'developer', general: 'developer',
  // Agent .md file name mappings
  'architecture-reviewer': 'architect', 'lead-architect': 'architect',
  'gcp-architect': 'architect',
  'task-orchestrator': 'planner', 'context-manager': 'planner',
  'stakeholder-agent': 'planner', 'proposal-pitch': 'planner',
  'presentation-agent': 'planner',
  'devops-agent': 'devops',
  'test-strategist': 'reviewer',
  'creative-app-developer': 'developer', 'frontend-expert': 'developer',
  'game-developer': 'developer', 'iot-embedded-expert': 'developer',
  'python-expert': 'developer', 'golang-expert': 'developer',
  'flutter-ios-expert': 'developer',
}

const AVATARS = ['📋', '⚙️', '🔍', '🏛️', '🎮', '🌐', '📱', '🛡️', '🧪', '🔧', '☁️', '🎨', '📊', '🤖', '⚡', '🏗️', '🧩']
const COLORS = ['#8b5cf6', '#3b82f6', '#f97316', '#10b981', '#ef4444', '#ec4899', '#06b6d4', '#f59e0b', '#84cc16', '#6366f1']

export class AgentConfigManager {

  async loadAgents(yamlConfigPath?: string, yamlRepoPaths?: string[]): Promise<AgentConfig[]> {
    const cfg = vscode.workspace.getConfiguration('agentBoard')
    const configPath = yamlConfigPath || cfg.get<string>('agentConfigPath', '')

    // Merge repo paths from YAML + VS Code settings
    let repoPaths = yamlRepoPaths ? [...yamlRepoPaths] : []
    const vscodePaths = cfg.get<string[]>('agentRepoPaths', [])
    for (const p of vscodePaths) {
      if (p && !repoPaths.includes(p)) repoPaths.push(p)
    }
    const legacyRepoPath = cfg.get<string>('agentRepoPath', '')
    if (legacyRepoPath && !repoPaths.includes(legacyRepoPath)) {
      repoPaths = [legacyRepoPath, ...repoPaths]
    }

    let agents: AgentConfig[] = []

    // 1. Load from JSON config (file or directory)
    if (configPath) {
      const expanded = expandPath(configPath)
      try {
        const stat = await fs.stat(expanded)
        if (stat.isFile()) agents = await this.loadFromFile(expanded)
        else if (stat.isDirectory()) agents = await this.loadFromDirectory(expanded)
      } catch {
        // fall through
      }
    }

    // 2. Load from all agent repos
    for (const repoPath of repoPaths) {
      if (!repoPath) continue
      const expanded = expandPath(repoPath)

      // 2a. Load from skills/*/SKILL.md
      try {
        const skillAgents = await this.loadFromSkillsRepo(expanded)
        agents = [...agents, ...skillAgents]
      } catch {
        // fall through
      }

      // 2b. Load from agents/*.agent.md
      try {
        const mdAgents = await this.loadFromAgentsMd(expanded)
        agents = [...agents, ...mdAgents]
      } catch {
        // fall through
      }
    }

    // 3. Deduplicate by id (first wins)
    const seen = new Set<string>()
    agents = agents.filter((a) => {
      if (seen.has(a.id)) return false
      seen.add(a.id)
      return true
    })

    // 4. Merge defaults if nothing found
    if (agents.length === 0) agents = DEFAULT_AGENTS

    return agents
  }

  async saveAgent(agent: AgentConfig, dirPath?: string): Promise<void> {
    const target = dirPath ?? path.join(process.env.HOME || '', '.config', 'agent-board', 'agents')
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(
      path.join(target, `${agent.id}.json`),
      JSON.stringify(agent, null, 2),
      'utf-8',
    )
  }

  // ───────────────────────────────────────────────────────────────

  private async loadFromSkillsRepo(repoPath: string): Promise<AgentConfig[]> {
    const skillsDir = path.join(repoPath, 'skills')
    const agents: AgentConfig[] = []
    let entries: Dirent<string>[]
    try {
      entries = await fs.readdir(skillsDir, { withFileTypes: true, encoding: 'utf-8' })
    } catch {
      return agents
    }

    let idx = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')
      try {
        const content = await fs.readFile(skillFile, 'utf-8')
        const { name, description } = parseFrontmatter(content)
        const folderName = entry.name
        const displayName =
          name || folderName.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
        const role = ROLE_MAP[folderName] || 'developer'

        agents.push({
          id: `agent-${folderName}`,
          name: displayName,
          role,
          avatar: AVATARS[idx % AVATARS.length],
          color: COLORS[idx % COLORS.length],
          model: 'copilot-claude-sonnet-4',
          temperature: 0.3,
          maxContextTokens: 128_000,
          systemPrompt: content,
        })
        idx++
      } catch {
        /* no SKILL.md in this folder — skip */
      }
    }
    return agents
  }

  /** Load agents from agents/*.agent.md files. */
  private async loadFromAgentsMd(repoPath: string): Promise<AgentConfig[]> {
    const agentsDir = path.join(repoPath, 'agents')
    const agents: AgentConfig[] = []
    let entries: Dirent<string>[]
    try {
      entries = await fs.readdir(agentsDir, { withFileTypes: true, encoding: 'utf-8' })
    } catch {
      return agents
    }

    let idx = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.agent.md')) continue
      try {
        const content = await fs.readFile(path.join(agentsDir, entry.name), 'utf-8')
        const slug = entry.name.replace(/\.agent\.md$/, '')

        // Parse name from first # heading
        const headingMatch = content.match(/^#\s+(.+)$/m)
        const displayName = headingMatch
          ? headingMatch[1].trim()
          : slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())

        const role = ROLE_MAP[slug] || 'developer'

        agents.push({
          id: `agent-${slug}`,
          name: displayName,
          role,
          avatar: AVATARS[(idx + 5) % AVATARS.length],
          color: COLORS[(idx + 3) % COLORS.length],
          model: 'copilot-claude-sonnet-4',
          temperature: 0.3,
          maxContextTokens: 128_000,
          systemPrompt: content,
        })
        idx++
      } catch {
        /* skip unreadable */
      }
    }
    return agents
  }

  private async loadFromFile(filePath: string): Promise<AgentConfig[]> {
    const raw = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(raw)
    const list = Array.isArray(data) ? data : data.agents
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_AGENTS
  }

  private async loadFromDirectory(dirPath: string): Promise<AgentConfig[]> {
    const agents: AgentConfig[] = []
    for (const entry of await fs.readdir(dirPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(dirPath, entry.name), 'utf-8')
        const agent = JSON.parse(raw) as AgentConfig
        if (agent.id && agent.name) agents.push(agent)
      } catch { /* skip malformed */ }
    }
    return agents.length > 0 ? agents : DEFAULT_AGENTS
  }
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '' }
  const fm = match[1]
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() || ''
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
  return { name, description }
}

function expandPath(p: string): string {
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2))
  return path.resolve(p)
}
