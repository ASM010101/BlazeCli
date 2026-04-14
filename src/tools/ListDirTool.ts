import type { Tool, ToolDefinition } from '../types.js'
import { readdirSync, statSync, existsSync } from 'fs'
import { resolve, join } from 'path'

export class ListDirTool implements Tool {
  name = 'ListDir'
  description = 'List contents of a directory showing files and subdirectories with sizes. Quick way to explore project structure.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'ListDir',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list (default: current directory)' },
          recursive: { type: 'string', description: 'Whether to list recursively (default: false, max depth 2)' },
        },
        required: [],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const dirPath = resolve(cwd, String(args.path || '.'))
    const recursive = String(args.recursive) === 'true'

    if (!existsSync(dirPath)) {
      return `Error: Directory not found: ${dirPath}`
    }

    try {
      const entries = this.listDir(dirPath, recursive ? 2 : 0, '')
      if (entries.length === 0) return `Directory is empty: ${dirPath}`

      return `Contents of ${dirPath}:\n\n${entries.join('\n')}`
    } catch (err: unknown) {
      return `Error listing directory: ${(err as Error).message}`
    }
  }

  private listDir(dir: string, depth: number, prefix: string): string[] {
    const results: string[] = []
    const items = readdirSync(dir).sort()

    for (const item of items) {
      if (item.startsWith('.') || item === 'node_modules' || item === '__pycache__') continue

      const fullPath = join(dir, item)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          results.push(`${prefix}📁 ${item}/`)
          if (depth > 0) {
            results.push(...this.listDir(fullPath, depth - 1, prefix + '  '))
          }
        } else {
          const size = this.formatSize(stat.size)
          results.push(`${prefix}📄 ${item} (${size})`)
        }
      } catch { /* skip unreadable */ }
    }
    return results
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }
}
