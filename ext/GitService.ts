import { execFileSync } from 'child_process'

/** Validate that a branch name is safe (no shell metacharacters). */
function validateBranchName(name: string): string {
  if (!/^[\w\-./]+$/.test(name)) {
    throw new Error(`Invalid branch name: "${name}" — contains disallowed characters`)
  }
  return name
}

/** Validate that a git ref is safe (branch, HEAD, SHA). */
function validateRef(ref: string): string {
  if (!/^[\w\-./]+$/.test(ref)) {
    throw new Error(`Invalid git ref: "${ref}" — contains disallowed characters`)
  }
  return ref
}

export class GitService {
  /**
   * Create and checkout a new branch.
   * Returns the branch name on success.
   */
  createBranch(workspacePath: string, branchName: string): string {
    validateBranchName(branchName)

    if (this.branchExists(workspacePath, branchName)) {
      // Branch already exists — just checkout
      execFileSync('git', ['checkout', branchName], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } else {
      execFileSync('git', ['checkout', '-b', branchName], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    }

    return branchName
  }

  /** Check if a branch already exists locally. */
  branchExists(workspacePath: string, branchName: string): boolean {
    validateBranchName(branchName)
    try {
      const result = execFileSync('git', ['branch', '--list', branchName], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim()
      return result.length > 0
    } catch {
      return false
    }
  }

  /** Get the current branch name. */
  getCurrentBranch(workspacePath: string): string {
    try {
      return execFileSync('git', ['branch', '--show-current'], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim() || 'HEAD'
    } catch {
      return 'HEAD'
    }
  }

  /** Stage specific files. */
  stageFiles(workspacePath: string, files: string[]): void {
    if (files.length === 0) return
    // Stage all files in one call: git add -- file1 file2 ...
    execFileSync('git', ['add', '--', ...files], {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  }

  /** Commit staged changes with a message (supports multiline). */
  commit(workspacePath: string, message: string): string {
    // Use stdin to pass message safely (handles newlines, quotes, special chars)
    execFileSync('git', ['commit', '-F', '-'], {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: message,
    })
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
  }

  /** Return a short diff stat string (e.g. "3 files changed, 42 insertions"). */
  diffStat(workspacePath: string): string {
    try {
      return execFileSync('git', ['diff', '--cached', '--stat'], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim()
    } catch {
      return ''
    }
  }

  /** Check whether there are staged changes. */
  hasStagedChanges(workspacePath: string): boolean {
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], {
        cwd: workspacePath,
        stdio: 'pipe',
      })
      return false // exit 0 → nothing staged
    } catch {
      return true  // exit 1 → changes staged
    }
  }

  /**
   * Get recent commit SHAs (safe ref validation).
   */
  getRecentCommits(workspacePath: string, ref = 'HEAD', count = 20): string[] {
    validateRef(ref)
    try {
      const out = execFileSync('git', ['log', ref, '--oneline', `-${count}`, '--format=%H'], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      return out.trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * Generate a branch name from a task title.
   * e.g. "Add rate limiting to API" → "feature/add-rate-limiting-to-api"
   */
  static slugifyBranchName(taskTitle: string, prefix = 'feature'): string {
    const slug = taskTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
    return `${prefix}/${slug}`
  }
}
