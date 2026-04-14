import chalk from 'chalk'
import * as readline from 'readline'

// ─── Colors & Formatting ────────────────────────────────────────
export const c = {
  brand: (t: string) => chalk.hex('#FF6B35').bold(t),
  fire: (t: string) => chalk.hex('#FF6B35')(t),
  user: (t: string) => chalk.hex('#6366F1')(t),
  assistant: (t: string) => chalk.hex('#E2E8F0')(t),
  tool: (t: string) => chalk.hex('#22C55E')(t),
  toolName: (t: string) => chalk.hex('#22C55E').bold(t),
  dim: (t: string) => chalk.hex('#64748B')(t),
  error: (t: string) => chalk.hex('#EF4444').bold(t),
  warn: (t: string) => chalk.hex('#F59E0B')(t),
  success: (t: string) => chalk.hex('#22C55E').bold(t),
  info: (t: string) => chalk.hex('#38BDF8')(t),
  bold: (t: string) => chalk.bold(t),
  code: (t: string) => chalk.bgHex('#1E1E2E').hex('#E2E8F0')(` ${t} `),
  muted: (t: string) => chalk.hex('#475569')(t),
  gitBranch: (t: string) => chalk.hex('#A78BFA')(t),
  gitDirty: (t: string) => chalk.hex('#F59E0B')(t),
  gitClean: (t: string) => chalk.hex('#22C55E')(t),
  // colors
  research: (t: string) => chalk.hex('#C084FC')(t),
  plan: (t: string) => chalk.hex('#67E8F9')(t),
  memory: (t: string) => chalk.hex('#FCD34D')(t),
  hook: (t: string) => chalk.hex('#FB923C')(t),
}

// ─── Banner ──────────────────────────────────────────────────────
export function printBanner(
  model: string,
  cwd: string,
  extras?: {
    gitBranch?: string
    gitDirty?: boolean
    hasProjectContext?: boolean
    hasMemory?: boolean
    planMode?: boolean
    toolCount?: number
  }
) {
  const toolCount = extras?.toolCount || 10
  console.log()
  console.log(c.brand('  🔥 Blaze CLI') + c.dim(' — Your Agentic Coding Platform'))
  console.log(c.dim('  ─────────────────────────────────────────'))
  console.log(c.dim('  Model:  ') + c.info(model))
  console.log(c.dim('  CWD:    ') + c.assistant(cwd))
  console.log(c.dim('  Tools:  ') + c.tool(`${toolCount} available`) + c.dim(' (Bash, FileRead, FileWrite, FileEdit, Grep, Glob, ListDir, WebFetch, WebSearch, ResearchAgent, AskUser, NotebookEdit, Worktree, REPL)'))

  if (extras?.planMode) {
    console.log(c.dim('  Mode:   ') + c.plan('PLAN (read-only)'))
  }

  if (extras?.gitBranch) {
    const status = extras.gitDirty ? c.gitDirty('(dirty)') : c.gitClean('(clean)')
    console.log(c.dim('  Git:    ') + c.gitBranch(extras.gitBranch) + ' ' + status)
  }

  if (extras?.hasProjectContext) {
    console.log(c.dim('  Context:') + c.success(' BLAZE.md loaded'))
  }

  if (extras?.hasMemory) {
    console.log(c.dim('  Memory: ') + c.memory('auto-memory enabled'))
  }

  console.log(c.dim('  ─────────────────────────────────────────'))
  console.log(c.dim('  Type your request. Press Ctrl+C to exit.'))
  console.log(c.dim('  Type ') + c.info('/help') + c.dim(' for commands.'))
  console.log()
}

// ─── Token / Cost Display ────────────────────────────────────────
export function printStats(inputTokens: number, outputTokens: number, elapsed: number, toolCalls: number, costStr?: string) {
  const parts = [
    c.dim(`${inputTokens + outputTokens} tokens`),
    c.dim(`${(elapsed / 1000).toFixed(1)}s`),
  ]
  if (toolCalls > 0) parts.push(c.tool(`${toolCalls} tool call${toolCalls > 1 ? 's' : ''}`))
  if (costStr) parts.push(c.info(costStr))
  console.log('\n' + c.dim('  ') + parts.join(c.dim(' · ')))
}

// ─── Tool Call Display ───────────────────────────────────────────
export function printToolCall(name: string, args: Record<string, unknown>) {
  console.log()
  const icon = name === 'ResearchAgent' ? c.research('  🔍 ') : c.tool('  🔧 ')
  const nameColor = name === 'ResearchAgent' ? c.research(name) : c.toolName(name)
  console.log(icon + nameColor)

  for (const [key, val] of Object.entries(args)) {
    const valStr = String(val)
    const display = valStr.length > 120 ? valStr.slice(0, 120) + '...' : valStr
    console.log(c.dim(`     ${key}: `) + c.assistant(display))
  }
}

export function printToolResult(result: string, maxLines = 20) {
  const lines = result.split('\n')
  const shown = lines.slice(0, maxLines)
  for (const line of shown) {
    console.log(c.dim('     │ ') + line)
  }
  if (lines.length > maxLines) {
    console.log(c.dim(`     │ ... (${lines.length - maxLines} more lines)`))
  }
}

// ─── Streaming Text ──────────────────────────────────────────────
let streamingLine = false

export function streamToken(token: string) {
  if (!streamingLine) {
    process.stdout.write('  ')
    streamingLine = true
  }
  process.stdout.write(token)
}

export function endStream() {
  if (streamingLine) {
    process.stdout.write('\n')
    streamingLine = false
  }
}

// ─── Permission Prompt ───────────────────────────────────────────
export async function askPermission(toolName: string, args: Record<string, unknown>): Promise<'yes' | 'no' | 'always'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    const argsDisplay = Object.entries(args)
      .map(([k, v]) => {
        const vs = String(v)
        return `${k}: ${vs.length > 80 ? vs.slice(0, 80) + '...' : vs}`
      })
      .join(', ')

    console.log()
    console.log(c.warn(`  ⚠  ${toolName} requires permission`))
    console.log(c.dim(`     ${argsDisplay}`))

    rl.question(c.warn('  Allow? ') + c.dim('[Y/n/always] ') , (answer) => {
      rl.close()
      const a = answer.trim().toLowerCase()
      if (a === 'always' || a === 'a') return resolve('always')
      if (a === '' || a === 'y' || a === 'yes') return resolve('yes')
      resolve('no')
    })
  })
}

// ─── User Input ──────────────────────────────────────────────────
export async function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

// ─── Spinner ─────────────────────────────────────────────────────
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinnerInterval: ReturnType<typeof setInterval> | null = null

export function startSpinner(msg: string) {
  let i = 0
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r  ${c.fire(frames[i % frames.length]!)} ${c.dim(msg)}`)
    i++
  }, 80)
}

export function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval)
    spinnerInterval = null
    process.stdout.write('\r' + ' '.repeat(60) + '\r')
  }
}

// ─── Context Visualization ──────────────────────────────────────
export function printContextGrid(estimatedTokens: number, maxTokens: number) {
  const used = Math.min(estimatedTokens / maxTokens, 1)
  const totalBlocks = 40
  const filledBlocks = Math.round(used * totalBlocks)

  let bar = ''
  for (let i = 0; i < totalBlocks; i++) {
    if (i < filledBlocks) {
      if (used > 0.9) bar += chalk.hex('#EF4444')('█')
      else if (used > 0.75) bar += chalk.hex('#F59E0B')('█')
      else bar += chalk.hex('#22C55E')('█')
    } else {
      bar += chalk.hex('#334155')('░')
    }
  }

  const pct = (used * 100).toFixed(1)
  console.log(c.bold('\n  Context Window:'))
  console.log(`  [${bar}] ${pct}%`)
  console.log(c.dim(`  ~${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`))

  if (used > 0.9) {
    console.log(c.error('  ⚠ Context nearly full! Use /compact to free space.'))
  } else if (used > 0.75) {
    console.log(c.warn('  Auto-compact will trigger soon.'))
  }
}

// ─── Conversation Compact Display ────────────────────────────────
export function printCompactSummary(oldCount: number, newCount: number, savedTokens: number) {
  console.log()
  console.log(c.success('  ✓ Conversation compacted'))
  console.log(c.dim(`     Messages: ${oldCount} → ${newCount}`))
  console.log(c.dim(`     Estimated tokens saved: ~${savedTokens}`))
}

// ─── Save/Load Notifications ─────────────────────────────────────
export function printSaved(path: string) {
  console.log(c.success('  ✓ Conversation saved: ') + c.dim(path))
}

export function printLoaded(path: string, messageCount: number) {
  console.log(c.success('  ✓ Conversation loaded: ') + c.dim(path) + c.dim(` (${messageCount} messages)`))
}

// ─── Hook Display ────────────────────────────────────────────────
export function printHookResult(event: string, output: string) {
  if (!output) return
  console.log(c.hook(`  ⚡ Hook (${event}):`))
  for (const line of output.split('\n').slice(0, 5)) {
    console.log(c.dim(`     ${line}`))
  }
}

// ─── Plan Mode Display ──────────────────────────────────────────
export function printPlanMode(enabled: boolean) {
  if (enabled) {
    console.log(c.plan('\n  📋 PLAN MODE — Read-only. Use /plan off to switch to execution mode.'))
  } else {
    console.log(c.success('\n  🔧 EXECUTION MODE — Full tool access restored.'))
  }
}

// ─── Diff Display ───────────────────────────────────────────────
export function printDiff(oldContent: string, newContent: string, filepath: string) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  console.log(c.bold(`\n  Diff: ${filepath}`))
  console.log(c.dim('  ─────────────────────────────'))

  const maxLines = Math.max(oldLines.length, newLines.length)
  let changes = 0

  for (let i = 0; i < Math.min(maxLines, 50); i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]

    if (oldLine !== newLine) {
      changes++
      if (oldLine !== undefined) {
        console.log(chalk.red(`  - ${oldLine}`))
      }
      if (newLine !== undefined) {
        console.log(chalk.green(`  + ${newLine}`))
      }
    }
  }

  if (maxLines > 50) {
    console.log(c.dim(`  ... (${maxLines - 50} more lines)`))
  }

  console.log(c.dim(`  ─────────────────────────────`))
  console.log(c.dim(`  ${changes} change(s)`))
}
