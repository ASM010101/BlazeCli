import type { Tool, ToolDefinition } from '../types.js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'

export class FileWriteTool implements Tool {
  name = 'FileWrite'
  description = 'Create a new file or overwrite an existing file with the given content. Parent directories will be created automatically.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'FileWrite',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write (relative to cwd or absolute)' },
          content: { type: 'string', description: 'The content to write to the file' },
        },
        required: ['path', 'content'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const filePath = resolve(cwd, String(args.path || ''))
    const content = String(args.content ?? '')
    const existed = existsSync(filePath)

    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      writeFileSync(filePath, content, 'utf-8')
      const lines = content.split('\n').length
      return `${existed ? 'Updated' : 'Created'}: ${filePath} (${lines} lines, ${content.length} bytes)`
    } catch (err: unknown) {
      return `Error writing file: ${(err as Error).message}`
    }
  }
}
