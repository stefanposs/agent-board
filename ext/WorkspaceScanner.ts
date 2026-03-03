import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs/promises'
import { execFileSync } from 'child_process'
import type { ScannedWorkspace } from './protocol'

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#f97316']
const ICONS = ['📦', '🔌', '🎨', '🏗️', '⚡', '🔧', '📱', '🌐', '🛡️', '🧪']

export class WorkspaceScanner {

  async scanPaths(paths: string[]): Promise<ScannedWorkspace[]> {
    const workspaces: ScannedWorkspace[] = []
    let idx = 0

    for (const scanPath of paths) {
      const expanded = expandPath(scanPath)
      try {
        // Check if the path itself is a git repo
        try {
          await fs.access(path.join(expanded, '.git'))
          const ws = await this.scanRepo(expanded, idx)
          workspaces.push(ws)
          idx++
          continue  // Don't scan children if the path itself is a repo
        } catch {
          // Not a repo itself — scan children
        }

        const entries = await fs.readdir(expanded, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue
          const fullPath = path.join(expanded, entry.name)
          try {
            await fs.access(path.join(fullPath, '.git'))
            const ws = await this.scanRepo(fullPath, idx)
            workspaces.push(ws)
            idx++
          } catch {
            // Not a git repo — skip
          }
        }
      } catch {
        vscode.window.showWarningMessage(`Agent Board: Cannot scan path "${scanPath}"`)
      }
    }

    return workspaces
  }

  // ───────────────────────────────────────────────────────────────

  private async scanRepo(repoPath: string, idx: number): Promise<ScannedWorkspace> {
    const name = path.basename(repoPath)
    let repo = name
    let branch = 'main'
    let hasChanges = false

    try {
      const raw = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoPath, encoding: 'utf-8' }).trim()
      repo = raw.replace(/\.git$/, '').replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1')
    } catch { /* no remote */ }

    try {
      branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoPath, encoding: 'utf-8' }).trim() || 'HEAD'
    } catch { /* detached HEAD */ }

    try {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf-8' }).trim()
      hasChanges = status.length > 0
    } catch { /* ignore */ }

    return {
      id: `ws-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      localPath: repoPath,
      repo,
      branch,
      hasChanges,
      icon: ICONS[idx % ICONS.length],
      color: COLORS[idx % COLORS.length],
    }
  }
}

function expandPath(p: string): string {
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2))
  return path.resolve(p)
}
