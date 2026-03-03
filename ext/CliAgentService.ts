import { spawn, ChildProcess, execFileSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import { GitService } from './GitService'

export interface CliRunOptions {
  workspacePath: string
  taskFilePath: string   // relative path to .tasks/<id>.md
  branch?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onDone?: (exitCode: number) => void
}

export interface CliRunResult {
  exitCode: number
  stdout: string
  stderr: string
  commits: string[]       // short SHAs committed during the run
}

/**
 * Service to run Claude CLI as a subprocess for code implementation.
 * This replaces the file-block-parsing approach with a real agentic CLI
 * that has full filesystem and shell access.
 */
export class CliAgentService {
  private processes = new Map<string, ChildProcess>()
  private git = new GitService()

  /** Configurable CLI command (default: 'claude'). */
  cliCommand = 'claude'
  /** Configurable CLI arguments. */
  cliArgs = ['--print', '--allowedTools', 'Edit,Write,Bash,Read,MultiEdit']

  /**
   * Check if the configured CLI is available on PATH.
   */
  async isAvailable(): Promise<boolean> {
    try {
      execFileSync('which', [this.cliCommand], { stdio: 'pipe', encoding: 'utf-8' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Run claude CLI on a task file in the given workspace.
   * Returns a promise that resolves when the process exits.
   */
  async run(agentId: string, opts: CliRunOptions): Promise<CliRunResult> {
    const { workspacePath, taskFilePath, branch, onStdout, onStderr, onDone } = opts

    // Get commits before run to diff later
    const commitsBefore = this.getRecentCommits(workspacePath, branch)

    // Build the claude CLI prompt
    const absTaskFile = path.join(workspacePath, taskFilePath)
    const prompt = [
      `Read the task file at "${taskFilePath}" for full context and instructions.`,
      `Implement the described changes in this repository.`,
      branch ? `You are working on branch "${branch}".` : '',
      `After making changes, stage and commit them with a descriptive commit message.`,
      `Work in the repository at: ${workspacePath}`,
    ].filter(Boolean).join(' ')

    // Spawn CLI with configured command and arguments
    // Build args: ensure --print comes first, then remaining args, then -p <prompt>
    const baseArgs = this.cliArgs.filter(a => a !== '--print')
    const args = ['--print', ...baseArgs, '-p', prompt]

    return new Promise<CliRunResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''

      const proc = spawn(this.cliCommand, args, {
        cwd: workspacePath,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.processes.set(agentId, proc)

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk
        onStdout?.(chunk)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stderr += chunk
        onStderr?.(chunk)
      })

      proc.on('close', (code: number | null) => {
        const exitCode = code ?? 1
        this.processes.delete(agentId)

        // Discover new commits
        const commitsAfter = this.getRecentCommits(workspacePath, branch)
        const newCommits = commitsAfter.filter(c => !commitsBefore.includes(c))

        onDone?.(exitCode)
        resolve({ exitCode, stdout, stderr, commits: newCommits })
      })

      proc.on('error', (err: Error) => {
        this.processes.delete(agentId)
        reject(err)
      })
    })
  }

  /**
   * Stop a running CLI process.
   */
  stop(agentId: string): boolean {
    const proc = this.processes.get(agentId)
    if (proc) {
      proc.kill('SIGTERM')
      this.processes.delete(agentId)
      return true
    }
    return false
  }

  /**
   * Get recent commit SHAs on the current (or specified) branch.
   * Delegates to GitService for safe ref handling.
   */
  private getRecentCommits(workspacePath: string, branch?: string): string[] {
    return this.git.getRecentCommits(workspacePath, branch || 'HEAD', 20)
  }

  /**
   * Build a markdown task file for the developer agent.
   */
  static async writeTaskFile(
    workspacePath: string,
    taskId: string,
    data: {
      title: string
      description: string
      stage: string
      branch?: string
      priority: string
      tags: string[]
      plannerNotes: string
      reviewerFeedback: string
      conversationHistory: string
    },
  ): Promise<string> {
    const tasksDir = path.join(workspacePath, '.tasks')
    await fs.mkdir(tasksDir, { recursive: true })

    // Ensure .tasks/ is in .gitignore
    await CliAgentService.ensureGitignore(workspacePath, '.tasks/')

    const slug = data.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
    const filename = `${taskId.slice(0, 8)}-${slug}.md`
    const relPath = `.tasks/${filename}`
    const absPath = path.join(tasksDir, filename)

    const sections: string[] = []
    sections.push(`# ${data.title}`)
    sections.push('')
    sections.push(`| Field | Value |`)
    sections.push(`|-------|-------|`)
    sections.push(`| ID | ${taskId} |`)
    sections.push(`| Status | ${data.stage} |`)
    sections.push(`| Branch | ${data.branch || '(none)'} |`)
    sections.push(`| Priority | ${data.priority} |`)
    sections.push(`| Tags | ${data.tags.join(', ') || '(none)'} |`)
    sections.push('')

    if (data.description) {
      sections.push(`## Description`)
      sections.push('')
      sections.push(data.description)
      sections.push('')
    }

    if (data.plannerNotes) {
      sections.push(`## Planner Notes`)
      sections.push('')
      sections.push(data.plannerNotes)
      sections.push('')
    }

    if (data.reviewerFeedback) {
      sections.push(`## Reviewer Feedback`)
      sections.push('')
      sections.push(data.reviewerFeedback)
      sections.push('')
    }

    sections.push(`## Implementation Instructions`)
    sections.push('')
    sections.push(`Implement the changes described above. Follow existing code patterns and conventions.`)
    sections.push(`After implementation, commit your changes with descriptive messages.`)
    sections.push('')

    if (data.conversationHistory) {
      sections.push(`## Conversation History`)
      sections.push('')
      sections.push(data.conversationHistory)
      sections.push('')
    }

    sections.push(`## Implementation Log`)
    sections.push('')
    sections.push(`_(will be filled by the developer agent)_`)
    sections.push('')

    await fs.writeFile(absPath, sections.join('\n'), 'utf-8')
    return relPath
  }

  /**
   * Append implementation results to the task file.
   */
  static async appendResults(
    workspacePath: string,
    taskFilePath: string,
    result: CliRunResult,
  ): Promise<void> {
    const absPath = path.join(workspacePath, taskFilePath)
    try {
      let content = await fs.readFile(absPath, 'utf-8')

      // Replace the placeholder in Implementation Log
      const logSection = [
        `## Implementation Log`,
        '',
        `**Exit Code:** ${result.exitCode}`,
        `**Commits:** ${result.commits.length > 0 ? result.commits.map(c => c.slice(0, 7)).join(', ') : '(none)'}`,
        '',
        '### Output',
        '',
        '```',
        result.stdout.slice(-5000), // last 5000 chars
        '```',
        '',
      ].join('\n')

      content = content.replace(
        /## Implementation Log\n\n_\(will be filled by the developer agent\)_\n?/,
        logSection,
      )
      await fs.writeFile(absPath, content, 'utf-8')
    } catch { /* file might not exist anymore */ }
  }

  /**
   * Ensure a pattern is in .gitignore.
   */
  private static async ensureGitignore(workspacePath: string, pattern: string): Promise<void> {
    const gitignorePath = path.join(workspacePath, '.gitignore')
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8')
      if (!content.includes(pattern)) {
        await fs.writeFile(gitignorePath, content.trimEnd() + '\n' + pattern + '\n', 'utf-8')
      }
    } catch {
      // No .gitignore — create one
      await fs.writeFile(gitignorePath, pattern + '\n', 'utf-8')
    }
  }
}
