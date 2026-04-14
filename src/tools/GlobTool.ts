import type { Tool, ToolDefinition } from '../types.js'
import { globSync } from 'glob'
import { resolve } from 'path'

export class GlobTool implements Tool {
  name = 'Glob'
  description = 'Find files matching a glob pattern. Use to discover project structure, find files by extension, or locate specific files.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'Glob',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.py", "*.json")' },
          path: { type: 'string', description: 'Directory to search in (default: current directory)' },
        },
        required: ['pattern'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const pattern = String(args.pattern || '')
    const searchPath = args.path ? resolve(cwd, String(args.path)) : cwd

    if (!pattern) return 'Error: No glob pattern provided'

    try {
      const matches = globSync(pattern, {
        cwd: searchPath,
        nodir: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/__pycache__/**'],
        maxDepth: 10,
      })

      if (matches.length === 0) {
        return `No files found matching: "${pattern}" in ${searchPath}`
      }

      const sorted = matches.sort()
      const shown = sorted.slice(0, 100)
      const header = `Found ${matches.length} file(s) matching "${pattern}":\n`
      const list = shown.join('\n')
      const footer = matches.length > 100 ? `\n... and ${matches.length - 100} more` : ''

      return header + list + footer
    } catch (err: unknown) {
      return `Error searching files: ${(err as Error).message}`
    }
  }
}
