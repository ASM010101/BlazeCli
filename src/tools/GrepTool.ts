import type { Tool, ToolDefinition } from '../types.js'
import { execSync } from 'child_process'
import { resolve } from 'path'

export class GrepTool implements Tool {
  name = 'Grep'
  description = 'Search for a text pattern across files in a directory. Returns matching lines with file names and line numbers. Supports regex patterns.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'Grep',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The text or regex pattern to search for' },
          path: { type: 'string', description: 'Directory or file to search in (default: current directory)' },
          include: { type: 'string', description: 'File glob pattern to include (e.g., "*.ts", "*.py")' },
          caseSensitive: { type: 'string', description: 'Whether search is case-sensitive (default: true)' },
        },
        required: ['pattern'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const pattern = String(args.pattern || '')
    const searchPath = args.path ? resolve(cwd, String(args.path)) : cwd
    const include = args.include ? String(args.include) : ''
    const caseSensitive = String(args.caseSensitive) !== 'false'

    if (!pattern) return 'Error: No search pattern provided'

    try {
      // Try ripgrep first, fall back to findstr on Windows / grep on Unix
      let cmd: string
      if (process.platform === 'win32') {
        const flags = caseSensitive ? '' : '/I'
        const includeFlag = include ? `--include "${include}"` : ''
        // Try git grep first (available in most dev environments)
        cmd = `git grep -n ${caseSensitive ? '' : '-i'} "${pattern.replace(/"/g, '\\"')}" -- "${searchPath}" ${include ? `"${include}"` : ''} 2>$null; if ($LASTEXITCODE -ne 0) { Get-ChildItem -Path "${searchPath}" -Recurse ${include ? `-Filter "${include}"` : ''} -File | Select-String -Pattern "${pattern.replace(/"/g, '`"')}" ${caseSensitive ? '-CaseSensitive' : ''} | Select-Object -First 50 | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line)" } }`
      } else {
        const flags = `-rn${caseSensitive ? '' : 'i'}`
        const includeFlag = include ? `--include="${include}"` : ''
        cmd = `grep ${flags} ${includeFlag} "${pattern}" "${searchPath}" 2>/dev/null | head -50`
      }

      const output = execSync(cmd, {
        cwd,
        timeout: 15000,
        maxBuffer: 1024 * 1024 * 5,
        encoding: 'utf-8',
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      }).trim()

      if (!output) return `No matches found for pattern: "${pattern}"`

      const lines = output.split('\n')
      const header = `Found ${lines.length}${lines.length >= 50 ? '+' : ''} matches for "${pattern}":\n`
      return header + output
    } catch {
      return `No matches found for pattern: "${pattern}"`
    }
  }
}
