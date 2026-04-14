import type { Tool, ToolDefinition } from '../types.js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export class FileReadTool implements Tool {
  name = 'FileRead'
  description = 'Read the contents of a file. Supports reading specific line ranges. Returns file content with line numbers.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'FileRead',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read (relative to cwd or absolute)' },
          startLine: { type: 'string', description: 'Start line number (1-indexed, optional)' },
          endLine: { type: 'string', description: 'End line number (1-indexed, inclusive, optional)' },
        },
        required: ['path'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const filePath = resolve(cwd, String(args.path || ''))

    if (!existsSync(filePath)) {
      return `Error: File not found: ${filePath}`
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const start = args.startLine ? Math.max(1, parseInt(String(args.startLine), 10)) : 1
      const end = args.endLine ? Math.min(lines.length, parseInt(String(args.endLine), 10)) : lines.length

      const selectedLines = lines.slice(start - 1, end)
      const numbered = selectedLines.map((line, i) => `${start + i}: ${line}`).join('\n')

      return `File: ${filePath} (${lines.length} lines total, showing ${start}-${end})\n\n${numbered}`
    } catch (err: unknown) {
      return `Error reading file: ${(err as Error).message}`
    }
  }
}
