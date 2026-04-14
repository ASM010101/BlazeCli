import type { Tool, ToolDefinition } from '../types.js'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

/**
 * Worktree Tool — create/manage git worktrees for isolated work.
 *
 * Creates a temporary branch + worktree so the agent can work
 * without affecting the main branch.
 */
export class WorktreeTool implements Tool {
  name = 'Worktree'
  description = 'Create or manage git worktrees for isolated work. Use "create" to start isolated work, "list" to see worktrees, "remove" to clean up.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'Worktree',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action: "create", "list", or "remove"',
            enum: ['create', 'list', 'remove'],
          },
          name: {
            type: 'string',
            description: 'Worktree/branch name (for create/remove). Default: "blaze-wt-<timestamp>"',
          },
        },
        required: ['action'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const action = String(args.action || 'list')
    const name = String(args.name || `blaze-wt-${Date.now()}`)

    // Check if git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
      })
    } catch {
      return 'Error: Not a git repository. Worktrees require git.'
    }

    switch (action) {
      case 'create': {
        const worktreePath = `../${name}`
        try {
          // Create a new branch + worktree
          const branch = `blaze/${name}`
          execSync(`git worktree add -b "${branch}" "${worktreePath}"`, {
            cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
          })
          return `Created worktree:\n  Path: ${worktreePath}\n  Branch: ${branch}\n\nUse /cd ${worktreePath} to switch to it. When done, use Worktree remove to clean up.`
        } catch (err: unknown) {
          return `Error creating worktree: ${(err as Error).message}`
        }
      }

      case 'list': {
        try {
          const output = execSync('git worktree list', {
            cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
          }).trim()
          return output || 'No worktrees found.'
        } catch (err: unknown) {
          return `Error listing worktrees: ${(err as Error).message}`
        }
      }

      case 'remove': {
        const worktreePath = `../${name}`
        try {
          execSync(`git worktree remove "${worktreePath}" --force`, {
            cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
          })
          // Also delete the branch
          try {
            execSync(`git branch -D "blaze/${name}"`, {
              cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
            })
          } catch { /* branch might not exist */ }
          return `Removed worktree: ${worktreePath}`
        } catch (err: unknown) {
          return `Error removing worktree: ${(err as Error).message}`
        }
      }

      default:
        return `Error: Unknown action "${action}". Use: create, list, remove`
    }
  }
}
