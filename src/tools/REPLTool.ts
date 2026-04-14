import type { Tool, ToolDefinition } from '../types.js'
import { execSync } from 'child_process'

/**
 * REPL Tool — execute code in a persistent-like session.
 * Supports Python, Node.js, and other interpreters.
 * Each call is independent (no state between calls) but allows
 * running multi-line code snippets.
 */
export class REPLTool implements Tool {
  name = 'REPL'
  description = 'Execute code in Python or Node.js. For quick scripts, calculations, or testing code snippets without creating files.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'REPL',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description: 'Language: "python" or "node" (default: "python")',
            enum: ['python', 'node'],
          },
          code: {
            type: 'string',
            description: 'The code to execute',
          },
        },
        required: ['code'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const language = String(args.language || 'python')
    const code = String(args.code || '')

    if (!code.trim()) return 'Error: No code provided'

    try {
      let cmd: string
      if (language === 'node') {
        // Escape for passing to node -e
        const escaped = code.replace(/"/g, '\\"')
        cmd = `node -e "${escaped}"`
      } else {
        // Python — use -c with proper escaping
        if (process.platform === 'win32') {
          // PowerShell: use here-string
          const escaped = code.replace(/'/g, "''")
          cmd = `python -c '${escaped}'`
        } else {
          const escaped = code.replace(/'/g, "'\\''")
          cmd = `python3 -c '${escaped}'`
        }
      }

      const output = execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      }).trim()

      return output || '(No output)'
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      const stdout = e.stdout?.trim() || ''
      const stderr = e.stderr?.trim() || ''
      let result = ''
      if (stdout) result += stdout + '\n'
      if (stderr) result += `Error: ${stderr}`
      return result || `Execution error: ${e.message}`
    }
  }
}
