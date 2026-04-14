import type { Tool, ToolDefinition } from '../types.js'
import { execSync } from 'child_process'
import { resolve, normalize } from 'path'

/**
 * Dangerous command patterns that could kill Blaze or cause serious harm.
 * These are blocked outright — the LLM gets an error message instead.
 */
const BLOCKED_PATTERNS = [
  // Self-kill: Blaze runs on Node.js, killing node kills Blaze
  /stop-process\s.*node/i,
  /taskkill\s.*node/i,
  /kill\s.*node/i,
  /killall\s+node/i,
  /pkill\s.*node/i,

  // Destructive system commands
  /rm\s+-rf\s+[\/~]/,           // rm -rf / or rm -rf ~
  /rm\s+-rf\s+\.\.\//,          // rm -rf ../
  /rm\s+-rf\s+\*$/,             // rm -rf *
  /del\s+\/s\s+\/q\s+[cC]:\\/,  // del /s /q C:\
  /format\s+[cC]:/i,            // format C:
  /:(){ :\|:& };:/,             // fork bomb
  /\bdd\b.*of=\/dev\/[hs]d/i,   // dd to disk device
  /mkfs\./i,                    // format filesystem
  /wipefs/i,                    // wipe filesystem signatures

  // Modify Blaze's own process
  /stop-process\s+-id\s+\$pid/i,

  // Credential/environment theft
  /curl\s.*\|\s*(bash|sh|zsh)/i,   // curl pipe to shell
  /wget\s.*\|\s*(bash|sh|zsh)/i,   // wget pipe to shell
  /eval\s*\$\(/i,                   // eval with subshell

  // Privilege escalation
  /chmod\s+777\s+\//i,              // chmod 777 /
  /chmod\s+-R\s+777/i,             // chmod -R 777
  /chown\s+-R\s+root/i,            // chown -R root

  // Crypto miners and reverse shells
  /xmrig|cryptonight|minerd/i,     // crypto miners
  /\/dev\/tcp\//i,                  // bash reverse shell
  /nc\s+-e\s+\/bin\/(bash|sh)/i,   // netcat reverse shell
  /ncat\s.*-e/i,                   // ncat reverse shell

  // System destruction
  /registry\s+delete\s+HKLM/i,    // Windows registry destruction
  /Remove-Item\s+-Recurse.*\$env:SystemRoot/i, // Delete Windows system
]

/**
 * Warn patterns — allowed but the user should know about them.
 */
const WARN_PATTERNS = [
  { pattern: /stop-process|taskkill|kill\s+-9/i, reason: 'kills processes' },
  { pattern: /rm\s+-rf|rmdir\s+\/s/i, reason: 'recursive delete' },
  { pattern: /drop\s+database|drop\s+table/i, reason: 'drops database objects' },
  { pattern: />\s*\/dev\/null\s*2>&1|Out-Null/i, reason: 'suppresses all output' },
  { pattern: /sudo\s+/i, reason: 'elevated privileges' },
  { pattern: /npm\s+publish/i, reason: 'publishes to npm registry' },
  { pattern: /git\s+push\s+--force/i, reason: 'force push overwrites remote history' },
]

// Maximum allowed timeout (2 minutes)
const MAX_TIMEOUT = 120000

export class BashTool implements Tool {
  name = 'Bash'
  description = 'Run a shell command and return its output. Use for running scripts, installing packages, git operations, testing, and any system commands.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'Bash',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout: { type: 'string', description: 'Timeout in milliseconds (default: 30000, max: 120000)' },
        },
        required: ['command'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const command = String(args.command || '')
    const rawTimeout = parseInt(String(args.timeout || '30000'), 10)
    const timeout = Math.min(Math.max(rawTimeout, 1000), MAX_TIMEOUT) // Clamp 1s-120s

    if (!command) return 'Error: No command provided'

    // Check for blocked commands
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return `Error: Command blocked for safety — "${command.slice(0, 80)}" matches a dangerous pattern. Use a more targeted command instead.`
      }
    }

    // Check for path traversal attempts (escaping the project directory)
    const cdMatch = command.match(/cd\s+([^\s;&|]+)/)
    if (cdMatch && cdMatch[1]) {
      const targetPath = normalize(resolve(cwd, cdMatch[1]))
      const cwdNorm = normalize(cwd)
      if (!targetPath.startsWith(cwdNorm) && cdMatch[1].includes('..')) {
        return `Warning: Command attempts to navigate outside the project directory. Target: ${targetPath}`
      }
    }

    try {
      const output = execSync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      })
      const result = output.trim()
      // Truncate very large outputs
      if (result.length > 100000) {
        return result.slice(0, 100000) + `\n\n... (output truncated, ${result.length} chars total)`
      }
      return result || '(Command completed with no output)'
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean }

      // Timeout detection
      if (e.killed) {
        return `Error: Command timed out after ${timeout / 1000}s. Consider breaking into smaller steps or increasing timeout.`
      }

      const stdout = e.stdout?.trim() || ''
      const stderr = e.stderr?.trim() || ''
      const code = e.status ?? 1
      let result = `Exit code: ${code}`
      if (stdout) result += `\nStdout:\n${stdout}`
      if (stderr) result += `\nStderr:\n${stderr}`
      return result || `Command failed: ${e.message}`
    }
  }
}
