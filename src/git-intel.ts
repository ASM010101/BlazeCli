/**
 * Git Intelligence — deep git integration that goes beyond simple diff/status.
 * 
 * UNIQUE FEATURES:
 * 1. Smart commit messages based on actual changes (not just "update")
 * 2. PR description generation
 * 3. Branch change analysis
 * 4. Conflict resolution assistance
 * 5. Commit history pattern learning
 */

import { execSync } from 'child_process'
import * as ui from './ui.js'

export interface GitChange {
  status: string  // M, A, D, R, ??
  path: string
  oldPath?: string  // for renames
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export interface BranchInfo {
  name: string
  isCurrent: boolean
  isRemote: boolean
  lastCommit: string
}

/** Check if we're in a git repo */
export function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
    })
    return true
  } catch {
    return false
  }
}

/** Get current branch name */
export function getCurrentBranch(cwd: string): string {
  try {
    return execSync('git branch --show-current', {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
    }).trim()
  } catch {
    return 'unknown'
  }
}

/** Get list of changed files */
export function getChangedFiles(cwd: string): GitChange[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim()

    if (!output) return []

    return output.split('\n').map(line => {
      const status = line.slice(0, 2).trim()
      const path = line.slice(3)
      // Handle renames
      if (path.includes(' -> ')) {
        const parts = path.split(' -> ')
        return { status, path: parts[1]!.trim(), oldPath: parts[0]!.trim() }
      }
      return { status, path: path.trim() }
    })
  } catch {
    return []
  }
}

/** Get diff of staged or unstaged changes */
export function getDiff(cwd: string, staged = false, maxLines = 200): string {
  try {
    const cmd = staged ? 'git diff --cached' : 'git diff'
    const output = execSync(cmd, {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    }).trim()

    if (!output) return ''

    const lines = output.split('\n')
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`
    }
    return output
  } catch {
    return ''
  }
}

/** Get recent commit history */
export function getRecentCommits(cwd: string, count = 10): GitCommit[] {
  try {
    const output = execSync(`git log --oneline -${count} --format="%H|%s|%an|%ai"`, {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim()

    if (!output) return []

    return output.split('\n').map(line => {
      const [hash, message, author, date] = line.split('|')
      return { hash: hash || '', message: message || '', author: author || '', date: date || '' }
    })
  } catch {
    return []
  }
}

/** Get all branches */
export function getBranches(cwd: string): BranchInfo[] {
  try {
    const output = execSync('git branch -a --format="%(refname:short)|%(HEAD)|%(subject)"', {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim()

    if (!output) return []

    return output.split('\n').map(line => {
      const [name, head, lastCommit] = line.split('|')
      return {
        name: name?.replace('remotes/', '') || '',
        isCurrent: head === '*',
        isRemote: name?.startsWith('remotes/') || false,
        lastCommit: lastCommit || '',
      }
    })
  } catch {
    return []
  }
}

/** Generate a smart commit message based on changes */
export function generateCommitMessage(cwd: string): string {
  const changes = getChangedFiles(cwd)
  if (changes.length === 0) return 'chore: no changes'

  const diff = getDiff(cwd, false, 100)
  const stagedDiff = getDiff(cwd, true, 100)

  // Classify changes
  const added = changes.filter(c => c.status === 'A' || c.status === '??')
  const modified = changes.filter(c => c.status === 'M')
  const deleted = changes.filter(c => c.status === 'D')
  const renamed = changes.filter(c => c.oldPath)

  // Detect change type from file patterns
  const hasTests = changes.some(c => c.path.includes('.test.') || c.path.includes('.spec.') || c.path.includes('__tests__'))
  const hasDocs = changes.some(c => c.path.endsWith('.md') && !c.path.includes('BLAZE.md'))
  const hasConfig = changes.some(c => c.path.includes('config') || c.path.endsWith('.json') || c.path.endsWith('.yaml') || c.path.endsWith('.yml'))
  const hasStyles = changes.some(c => c.path.endsWith('.css') || c.path.endsWith('.scss') || c.path.endsWith('.less'))
  const hasDeps = changes.some(c => c.path.includes('package.json') || c.path.includes('package-lock.json') || c.path.includes('yarn.lock'))

  // Build commit message
  const parts: string[] = []

  if (added.length > 0 && modified.length === 0 && deleted.length === 0) {
    // All new files
    if (added.length === 1) {
      return `feat: add ${added[0]!.path.split('/').pop()}`
    }
    return `feat: add ${added.length} new files`
  }

  if (deleted.length > 0 && modified.length === 0 && added.length === 0) {
    if (deleted.length === 1) {
      return `chore: remove ${deleted[0]!.path.split('/').pop()}`
    }
    return `chore: remove ${deleted.length} files`
  }

  if (hasTests && !hasDeps && modified.length <= 3) {
    return `test: update ${modified.length === 1 ? modified[0]!.path.split('/').pop() : `${modified.length} test files`}`
  }

  if (hasDocs && !hasDeps && modified.length <= 2) {
    return `docs: update ${modified.length === 1 ? modified[0]!.path.split('/').pop() : 'documentation'}`
  }

  if (hasStyles && !hasDeps) {
    return `style: update ${modified.length === 1 ? modified[0]!.path.split('/').pop() : 'styles'}`
  }

  if (hasDeps) {
    return `chore: update dependencies`
  }

  if (hasConfig) {
    return `chore: update configuration`
  }

  // Analyze diff for semantic meaning
  if (diff.includes('fix') || diff.includes('bug') || diff.includes('error') || diff.includes('issue')) {
    return `fix: resolve ${modified.length === 1 ? modified[0]!.path.split('/').pop() : `${modified.length} issues`}`
  }

  if (diff.includes('feature') || diff.includes('feat') || diff.includes('add') || diff.includes('new')) {
    return `feat: ${modified.length === 1 ? `update ${modified[0]!.path.split('/').pop()}` : `update ${modified.length} files`}`
  }

  if (diff.includes('refactor') || diff.includes('rename') || diff.includes('move') || diff.includes('extract')) {
    return `refactor: ${modified.length === 1 ? `restructure ${modified[0]!.path.split('/').pop()}` : `restructure ${modified.length} files`}`
  }

  // Default
  return `chore: update ${modified.length} file${modified.length !== 1 ? 's' : ''}${added.length ? `, add ${added.length}` : ''}${deleted.length ? `, remove ${deleted.length}` : ''}`
}

/** Generate a PR description from recent commits and changes */
export function generatePRDescription(cwd: string): string {
  const branch = getCurrentBranch(cwd)
  const changes = getChangedFiles(cwd)
  const commits = getRecentCommits(cwd, 20)
  const diff = getDiff(cwd, false, 50)

  const lines: string[] = [
    `## ${branch.replace(/[-/]/g, ' ').replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())}`,
    '',
    '### Changes',
    '',
  ]

  // List changed files
  for (const change of changes) {
    const icon = change.status === 'A' || change.status === '??' ? '➕' :
                 change.status === 'D' ? '🗑️' :
                 change.status === 'R' ? '📝' : '✏️'
    lines.push(`- ${icon} ${change.path}${change.oldPath ? ` (from ${change.oldPath})` : ''}`)
  }

  // List recent commits on this branch
  if (commits.length > 0) {
    lines.push('')
    lines.push('### Commits')
    lines.push('')
    for (const commit of commits.slice(0, 10)) {
      lines.push(`- ${commit.message} (${commit.hash.slice(0, 7)})`)
    }
  }

  // Add diff summary
  if (diff) {
    const additions = (diff.match(/^\+[^+]/gm) || []).length
    const deletions = (diff.match(/^\-[^-]/gm) || []).length
    lines.push('')
    lines.push(`### Stats: +${additions} / -${deletions} lines across ${changes.length} files`)
  }

  return lines.join('\n')
}

/** Analyze what changed on the current branch vs main */
export function analyzeBranchChanges(cwd: string): string {
  try {
    // Get the merge base with main/master
    let baseBranch = 'main'
    try {
      execSync('git rev-parse --verify main', { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 })
    } catch {
      try {
        execSync('git rev-parse --verify master', { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 })
        baseBranch = 'master'
      } catch {
        return 'No main/master branch found for comparison'
      }
    }

    const diffStat = execSync(`git diff ${baseBranch}...HEAD --stat`, {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    }).trim()

    const commits = execSync(`git log ${baseBranch}..HEAD --oneline`, {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim()

    const lines: string[] = [
      `Branch: ${getCurrentBranch(cwd)} (vs ${baseBranch})`,
      '',
    ]

    if (commits) {
      lines.push('Commits:')
      lines.push(commits)
      lines.push('')
    }

    if (diffStat) {
      lines.push('Changed files:')
      lines.push(diffStat)
    }

    return lines.join('\n')
  } catch {
    return 'Unable to analyze branch changes'
  }
}

/** Smart git commit — stages all changes and creates a commit with a generated message */
export function smartCommit(cwd: string, message?: string): string {
  if (!isGitRepo(cwd)) return 'Not a git repository'

  const changes = getChangedFiles(cwd)
  if (changes.length === 0) return 'No changes to commit'

  const commitMsg = message || generateCommitMessage(cwd)

  try {
    // Stage all changes
    execSync('git add -A', { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })

    // Create commit
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    })

    return `✓ Committed: ${commitMsg}`
  } catch (err: unknown) {
    const e = err as { stderr?: string }
    return `Commit failed: ${e.stderr || (err as Error).message}`
  }
}