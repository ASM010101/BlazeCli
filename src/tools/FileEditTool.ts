import type { Tool, ToolDefinition } from '../types.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export class FileEditTool implements Tool {
  name = 'FileEdit'
  description = 'Edit an existing file by replacing a specific text string with new content. The target text must match exactly (including whitespace). Use FileRead first to see the current content.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'FileEdit',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit' },
          target: { type: 'string', description: 'The exact text to find and replace (must match exactly)' },
          replacement: { type: 'string', description: 'The new text to replace the target with' },
          replaceAll: { type: 'string', description: 'If "true", replace ALL occurrences. Default: replace first occurrence only.' },
        },
        required: ['path', 'target', 'replacement'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const filePath = resolve(cwd, String(args.path || ''))
    const target = String(args.target ?? '')
    const replacement = String(args.replacement ?? '')
    const replaceAll = String(args.replaceAll) === 'true'

    if (!existsSync(filePath)) {
      return `Error: File not found: ${filePath}`
    }

    if (!target) {
      return 'Error: target text cannot be empty'
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const occurrences = content.split(target).length - 1

      if (occurrences === 0) {
        // Show nearby content for debugging
        const lines = content.split('\n')
        const preview = lines.slice(0, Math.min(20, lines.length)).join('\n')
        return `Error: Target text not found in ${filePath}.\n\nFile starts with:\n${preview}\n\n(${lines.length} lines total)`
      }

      let newContent: string
      let replacedCount: number

      if (replaceAll) {
        newContent = content.split(target).join(replacement)
        replacedCount = occurrences
      } else {
        newContent = content.replace(target, replacement)
        replacedCount = 1
      }

      writeFileSync(filePath, newContent, 'utf-8')

      const addedLines = replacement.split('\n').length
      const removedLines = target.split('\n').length
      const diff = addedLines - removedLines

      return `Edited: ${filePath}\n  Replaced ${replacedCount} of ${occurrences} occurrence(s)${replaceAll ? ' (all)' : ''}\n  Lines: ${diff >= 0 ? '+' : ''}${diff}`
    } catch (err: unknown) {
      return `Error editing file: ${(err as Error).message}`
    }
  }
}
