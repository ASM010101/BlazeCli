import { execSync } from 'child_process'

/**
 * Hooks System — event-driven automation.
 * Hooks are shell commands that run at specific lifecycle points.
 *
 * Configured in .blazerc:
 * {
 *   "hooks": {
 *     "preToolUse": [
 *       { "match": "FileWrite|FileEdit", "command": "echo 'Writing file...'" },
 *       { "match": "Bash", "command": "echo 'Running command...'" }
 *     ],
 *     "postToolUse": [
 *       { "match": "FileWrite|FileEdit", "command": "prettier --write $BLAZE_FILE_PATH" }
 *     ],
 *     "sessionStart": [{ "command": "echo 'Session started'" }],
 *     "sessionEnd": [{ "command": "echo 'Session ended'" }]
 *   }
 * }
 */

export interface HookEntry {
  match?: string   // regex pattern for tool name (e.g., "FileWrite|FileEdit", "Bash")
  command: string  // shell command to execute
}

export interface HooksConfig {
  preToolUse?: HookEntry[]
  postToolUse?: HookEntry[]
  sessionStart?: HookEntry[]
  sessionEnd?: HookEntry[]
}

export type HookEvent = 'preToolUse' | 'postToolUse' | 'sessionStart' | 'sessionEnd'

export interface HookContext {
  toolName?: string
  args?: Record<string, unknown>
  result?: string
  cwd: string
}

export interface HookResult {
  allowed: boolean
  output: string
}

/**
 * Run hooks for a given event.
 * For preToolUse, a non-zero exit code blocks the tool (allowed=false).
 * For other events, hooks are informational only.
 */
export function runHooks(
  hooks: HooksConfig,
  event: HookEvent,
  context: HookContext
): HookResult {
  const entries = hooks[event]
  if (!entries || entries.length === 0) {
    return { allowed: true, output: '' }
  }

  const outputs: string[] = []
  let allowed = true

  for (const entry of entries) {
    // Check if this hook matches the tool
    if (entry.match && context.toolName) {
      const regex = new RegExp(entry.match, 'i')
      if (!regex.test(context.toolName)) continue
    }

    // Build environment variables for the hook
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      BLAZE_EVENT: event,
      BLAZE_CWD: context.cwd,
    }

    if (context.toolName) env.BLAZE_TOOL_NAME = context.toolName
    if (context.args) {
      // Set commonly useful args as env vars
      if (context.args.path) env.BLAZE_FILE_PATH = String(context.args.path)
      if (context.args.command) env.BLAZE_COMMAND = String(context.args.command)
      if (context.args.pattern) env.BLAZE_PATTERN = String(context.args.pattern)
      env.BLAZE_ARGS = JSON.stringify(context.args)
    }
    if (context.result) {
      env.BLAZE_RESULT = context.result.slice(0, 10000) // Limit env var size
    }

    try {
      const output = execSync(entry.command, {
        cwd: context.cwd,
        encoding: 'utf-8',
        timeout: 10000,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (output) outputs.push(output)
    } catch (err: unknown) {
      const error = err as { status?: number; stderr?: string; message?: string }
      // For preToolUse, non-zero exit = block
      if (event === 'preToolUse' && error.status && error.status !== 0) {
        allowed = false
        const reason = error.stderr || error.message || 'Hook blocked this action'
        outputs.push(`Hook blocked: ${reason}`)
      }
    }
  }

  return { allowed, output: outputs.join('\n') }
}

/** Run session lifecycle hooks (fire-and-forget) */
export function runSessionHook(hooks: HooksConfig, event: 'sessionStart' | 'sessionEnd', cwd: string): void {
  try {
    runHooks(hooks, event, { cwd })
  } catch {
    // Session hooks should never crash the app
  }
}
