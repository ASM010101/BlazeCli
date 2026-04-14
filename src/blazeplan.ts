import { Agent } from './agent.js'
import { getConfig } from './types.js'
import { LLMClient } from './llm.js'
import { BashTool } from './tools/BashTool.js'
import { FileReadTool } from './tools/FileReadTool.js'
import { GrepTool } from './tools/GrepTool.js'
import { GlobTool } from './tools/GlobTool.js'
import { ListDirTool } from './tools/ListDirTool.js'
import { WebFetchTool } from './tools/WebFetchTool.js'
import { WebSearchTool } from './tools/WebSearchTool.js'
import * as ui from './ui.js'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'
import type { Message, ToolDefinition, Tool } from './types.js'

/**
 * blazeplan — Deep multi-agent planning system for Blaze CLI.
 *
 * Instead of blocking the terminal, blazeplan spawns parallel research agents
 * that explore the codebase from different angles, synthesizes their findings
 * into a comprehensive plan, then runs a critique agent to review it.
 *
 * The plan is generated in the background (terminal stays free),
 * and when ready, the user can review and choose how to execute.
 */

// ─── blazeplan Task Storage ────────────────────────────────────────

export interface blazeplanTask {
  id: string
  prompt: string
  status: 'drafting' | 'synthesizing' | 'critiquing' | 'ready' | 'implementing' | 'completed' | 'failed' | 'stopped'
  createdAt: string
  completedAt?: string
  cwd: string
  model: string
  plan?: string
  error?: string
  agentResults: {
    explorer?: string
    files?: string
    risks?: string
    critique?: string
  }
}

const blazeplan_DIR = resolve(homedir(), '.blaze', 'blazeplan')

function ensureDir(): void {
  if (!existsSync(blazeplan_DIR)) {
    mkdirSync(blazeplan_DIR, { recursive: true })
  }
}

function taskPath(id: string): string {
  return join(blazeplan_DIR, `${id}.json`)
}

function saveTask(task: blazeplanTask): void {
  ensureDir()
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2), 'utf-8')
}

export function loadblazeplanTask(id: string): blazeplanTask | null {
  const path = taskPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as blazeplanTask
  } catch {
    return null
  }
}

export function listblazeplanTasks(limit = 10): blazeplanTask[] {
  ensureDir()
  try {
    const files = readdirSync(blazeplan_DIR)
      .filter((f: string) => f.startsWith('up_') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit)

    return files.map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(blazeplan_DIR, f), 'utf-8')) as blazeplanTask
      } catch {
        return null
      }
    }).filter((t): t is blazeplanTask => t !== null)
  } catch {
    return []
  }
}

export function stopblazeplanTask(id: string): boolean {
  const task = loadblazeplanTask(id)
  if (!task || (task.status !== 'drafting' && task.status !== 'synthesizing' && task.status !== 'critiquing')) return false
  task.status = 'stopped'
  task.completedAt = new Date().toISOString()
  saveTask(task)
  return true
}

// ─── blazeplan Agent Tools (read-only for planning) ────────────────

function getblazeplanAgentTools(): Tool[] {
  return [
    new BashTool(),
    new FileReadTool(),
    new GrepTool(),
    new GlobTool(),
    new ListDirTool(),
    new WebFetchTool(),
    new WebSearchTool(),
  ]
}

function getblazeplanAgentToolDefs(): ToolDefinition[] {
  return getblazeplanAgentTools().map(t => t.definition)
}

function findblazeplanAgentTool(name: string): Tool | undefined {
  return getblazeplanAgentTools().find(t => t.name === name)
}

// ─── Run a single research agent ───────────────────────────────────

async function runResearchAgent(
  task: string,
  systemPrompt: string,
  cwd: string,
  config: ReturnType<typeof getConfig>,
  maxIterations = 12,
): Promise<string> {
  const llm = new LLMClient(config)
  const tools = getblazeplanAgentToolDefs()

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ]

  let finalText = ''

  for (let i = 0; i < maxIterations; i++) {
    let response
    try {
      response = await llm.chat(messages, tools)
    } catch (err: unknown) {
      return `Agent error: ${(err as Error).message}`
    }

    const choice = response.choices[0]
    if (!choice) break

    const msg = choice.message

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalText = msg.content || ''
      break
    }

    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls,
    })

    for (const tc of msg.tool_calls) {
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs = JSON.parse(tc.function.arguments || '{}')
      } catch {
        toolArgs = { raw: tc.function.arguments }
      }

      const tool = findblazeplanAgentTool(tc.function.name)
      if (!tool) {
        messages.push({
          role: 'tool',
          content: `Error: Unknown tool "${tc.function.name}"`,
          tool_call_id: tc.id,
        })
        continue
      }

      try {
        const result = await tool.execute(toolArgs, cwd)
        messages.push({
          role: 'tool',
          content: result.slice(0, 50000),
          tool_call_id: tc.id,
        })
      } catch (err: unknown) {
        messages.push({
          role: 'tool',
          content: `Tool error: ${(err as Error).message}`,
          tool_call_id: tc.id,
        })
      }
    }
  }

  if (!finalText) {
    finalText = '(Agent reached max iterations without final response)'
  }

  return finalText
}

// ─── The 3 Parallel Research Agents ────────────────────────────────

const EXPLORER_PROMPT = `You are an expert codebase explorer. Your job is to understand the architecture and structure of the project.

WORKING DIRECTORY: {CWD}
OS: {OS}
SHELL: {SHELL}

Rules:
- Use tools to explore the codebase — don't guess
- Focus on: project structure, key modules, architecture patterns, entry points, dependencies
- Identify the main components and how they relate
- Note any configuration files, build systems, and test setups
- Be thorough but concise in your final report
- End with a clear summary of the architecture`

const FILES_AGENT_PROMPT = `You are an expert at identifying which files need modification for a given task.

WORKING DIRECTORY: {CWD}
OS: {OS}
SHELL: {SHELL}

Rules:
- Use tools to explore the codebase — don't guess
- Focus on: finding specific files that need to be created, modified, or deleted
- For each file, explain WHAT needs to change and WHY
- Consider imports, exports, and dependency chains
- Note any files that might need updates as side effects
- Be specific — give file paths and describe the changes
- End with a prioritized list of files and their required changes`

const RISKS_AGENT_PROMPT = `You are an expert at identifying risks, edge cases, and dependencies in code changes.

WORKING DIRECTORY: {CWD}
OS: {OS}
SHELL: {SHELL}

Rules:
- Use tools to explore the codebase — don't guess
- Focus on: potential breaking changes, edge cases, dependency conflicts, test coverage gaps
- Consider: backwards compatibility, performance implications, security concerns
- Identify any circular dependencies or coupling that could cause issues
- Note any environment-specific concerns (OS differences, config dependencies)
- End with a prioritized risk assessment with mitigation strategies`

const CRITIQUE_PROMPT = `You are a senior engineer reviewing an implementation plan. Your job is to find gaps, inconsistencies, and improvements.

Rules:
- Review the plan critically but constructively
- Check for: missing steps, incorrect assumptions, unclear instructions, potential issues
- Verify the plan is actionable — each step should be specific enough to implement
- Check the order of operations — are dependencies respected?
- Identify any steps that are too vague or could be interpreted multiple ways
- Suggest improvements but don't rewrite the entire plan
- End with: APPROVED (if plan is solid) or NEEDS_REVISION with specific issues`

// ─── Synthesize findings into a plan ──────────────────────────────

const SYNTHESIZER_PROMPT = `You are an expert technical planner. You will receive findings from three research agents who explored a codebase from different angles. Your job is to synthesize their findings into a comprehensive, actionable implementation plan.

Rules:
- Combine insights from all three agents into a coherent plan
- Structure the plan with clear sections and numbered steps
- Each step should be specific and actionable
- Include file paths, function names, and concrete changes
- Order steps by dependency (what must happen first)
- Include a testing/verification strategy
- Note any risks or caveats
- Use markdown formatting for readability

Plan format:
# Implementation Plan: [Task Title]

## Overview
[Brief summary of what will be done and why]

## Architecture Context
[Key architectural insights from exploration]

## Step-by-Step Implementation

### Phase 1: [Phase Name]
1. [Specific action with file path and details]
2. ...

### Phase 2: [Phase Name]
1. ...

## Files to Modify
- \`path/to/file\` — [what changes and why]
- ...

## Risks & Mitigations
- [Risk]: [Mitigation strategy]

## Testing Strategy
[How to verify the changes work correctly]

## Estimated Complexity
[Simple/Medium/Complex] — [brief justification]`

// ─── Main blazeplan Execution ─────────────────────────────────────

export async function runblazeplan(
  prompt: string,
  cwd: string,
  config: ReturnType<typeof getConfig>,
  onStatusUpdate?: (status: blazeplanTask['status']) => void,
): Promise<blazeplanTask> {
  const id = `up_${Date.now()}`

  const task: blazeplanTask = {
    id,
    prompt,
    status: 'drafting',
    createdAt: new Date().toISOString(),
    cwd,
    model: config.llmModel,
    agentResults: {},
  }

  saveTask(task)

  const osLabel = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  const shellLabel = process.platform === 'win32' ? 'PowerShell' : 'bash'

  const formatPrompt = (template: string) =>
    template.replace('{CWD}', cwd).replace('{OS}', osLabel).replace('{SHELL}', shellLabel)

  // Run in background
  ;(async () => {
    try {
      // ── Phase 1: Parallel Research Agents ──
      onStatusUpdate?.('drafting')

      const [explorerResult, filesResult, risksResult] = await Promise.all([
        runResearchAgent(
          `Explore this codebase to understand its architecture. The task we're planning for is:\n\n${prompt}`,
          formatPrompt(EXPLORER_PROMPT),
          cwd,
          config,
        ),
        runResearchAgent(
          `Identify all files that need to be created, modified, or deleted for this task:\n\n${prompt}`,
          formatPrompt(FILES_AGENT_PROMPT),
          cwd,
          config,
        ),
        runResearchAgent(
          `Identify risks, edge cases, and dependencies for this task:\n\n${prompt}`,
          formatPrompt(RISKS_AGENT_PROMPT),
          cwd,
          config,
        ),
      ])

      task.agentResults.explorer = explorerResult
      task.agentResults.files = filesResult
      task.agentResults.risks = risksResult
      task.status = 'synthesizing'
      saveTask(task)
      onStatusUpdate?.('synthesizing')

      // ── Phase 2: Synthesize into a Plan ──
      const synthesisInput = `## Task\n${prompt}\n\n## Agent 1: Architecture Explorer\n${explorerResult}\n\n## Agent 2: Files to Modify\n${filesResult}\n\n## Agent 3: Risks & Dependencies\n${risksResult}`

      const plan = await runResearchAgent(
        synthesisInput,
        SYNTHESIZER_PROMPT,
        cwd,
        config,
        5, // Fewer iterations for synthesis (no tools needed, just text generation)
      )

      task.plan = plan
      task.status = 'critiquing'
      saveTask(task)
      onStatusUpdate?.('critiquing')

      // ── Phase 3: Critique the Plan ──
      const critiqueResult = await runResearchAgent(
        `Review this implementation plan for the task:\n\n${prompt}\n\n## Plan to Review\n${plan}`,
        CRITIQUE_PROMPT,
        cwd,
        config,
        5,
      )

      task.agentResults.critique = critiqueResult
      task.status = 'ready'
      task.completedAt = new Date().toISOString()
      saveTask(task)
      onStatusUpdate?.('ready')
    } catch (err: unknown) {
      task.status = 'failed'
      task.error = (err as Error).message
      task.completedAt = new Date().toISOString()
      saveTask(task)
      onStatusUpdate?.('failed')
    }
  })()

  return task
}

// ─── Keyword Detection ─────────────────────────────────────────────

/**
 * Detect "blazeplan" keyword in user input, with smart filtering
 * to avoid false positives.
 *
 * Skips occurrences inside:
 * - Paired delimiters (backticks, quotes, brackets, braces, parens, angle brackets)
 * - Path/identifier-like contexts (preceded/followed by / \ - or file extensions)
 * - Questions about the feature (followed by ?)
 * - Slash command input (text starting with /)
 */
export function hasblazeplanKeyword(input: string): boolean {
  const keyword = 'blazeplan'
  const lower = input.toLowerCase()

  // Skip slash commands (except /blazeplan itself)
  if (lower.startsWith('/') && !lower.startsWith('/blazeplan')) return false

  // Character-by-character scan with delimiter tracking
  const delimiterStack: string[] = []
  const openers = new Set(['`', '"', "'", '[', '{', '(', '<'])
  const closers: Record<string, string> = {
    '`': '`', '"': '"', "'": "'", ']': '[', '}': '{', ')': '(', '>': '<',
  }

  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!

    // Track delimiters
    if (openers.has(ch)) {
      // Single quote: only treat as delimiter if not an apostrophe
      if (ch === "'") {
        const prev = i > 0 ? lower[i - 1]! : ' '
        const next = i < lower.length - 1 ? lower[i + 1]! : ' '
        const isApostrophe = /\w/.test(prev) && /\w/.test(next)
        if (!isApostrophe) {
          delimiterStack.push(ch)
        }
      } else {
        delimiterStack.push(ch)
      }
      continue
    }

    // Close delimiters
    if (Object.keys(closers).includes(ch)) {
      const opener = closers[ch]!
      if (delimiterStack.length > 0 && delimiterStack[delimiterStack.length - 1] === opener) {
        delimiterStack.pop()
      }
      continue
    }

    // Check for keyword match (only outside delimiters)
    if (delimiterStack.length === 0) {
      if (lower.slice(i, i + keyword.length) === keyword) {
        // Check it's a word boundary
        const prev = i > 0 ? lower[i - 1]! : ' '
        const next = i + keyword.length < lower.length ? lower[i + keyword.length]! : ' '

        // Skip if inside a path/identifier (but allow /blazeplan slash command)
        const isSlashCommand = prev === '/' && i === 1
        if (!isSlashCommand && /[\/\\\-_.]/.test(prev)) continue
        if (/[\/\\\-_.a-zA-Z0-9]/.test(next)) continue

        // Skip if followed by ? (question about the feature)
        if (next === '?') continue

        return true
      }
    }
  }

  return false
}

/**
 * Remove the "blazeplan" keyword from input before sending to the planner.
 */
export function stripblazeplanKeyword(input: string): string {
  return input.replace(/\bblazeplan\b/i, '').replace(/\s+/g, ' ').trim()
}

// ─── Format the plan for display ──────────────────────────────────

export function formatblazeplanPlan(task: blazeplanTask): string {
  const lines: string[] = []

  lines.push('')
  lines.push(ui.c.bold('  ╔══════════════════════════════════════════════════════════╗'))
  lines.push(ui.c.bold('  ║') + ui.c.brand('  🔥 blazeplan — Deep Multi-Agent Plan  ') + ui.c.bold('            ║'))
  lines.push(ui.c.bold('  ╚══════════════════════════════════════════════════════════╝'))
  lines.push('')
  lines.push(ui.c.dim(`  Task: `) + ui.c.assistant(task.prompt.slice(0, 100) + (task.prompt.length > 100 ? '...' : '')))
  lines.push(ui.c.dim(`  ID:   `) + ui.c.info(task.id))
  lines.push(ui.c.dim(`  Time: `) + ui.c.dim(new Date(task.createdAt).toLocaleString()))
  lines.push('')

  if (task.plan) {
    // Render the plan with syntax highlighting
    const planLines = task.plan.split('\n')
    for (const line of planLines) {
      if (line.startsWith('# ')) {
        lines.push(ui.c.brand(`  ${line}`))
      } else if (line.startsWith('## ')) {
        lines.push(ui.c.bold(`  ${line}`))
      } else if (line.startsWith('### ')) {
        lines.push(ui.c.info(`  ${line}`))
      } else if (line.startsWith('- ')) {
        lines.push(ui.c.dim('  • ') + line.slice(2))
      } else if (/^\d+\.\s/.test(line)) {
        lines.push(ui.c.success(`  ${line}`))
      } else if (line.startsWith('`')) {
        lines.push(ui.c.info(`  ${line}`))
      } else if (line.trim() === '') {
        lines.push('')
      } else {
        lines.push(`  ${line}`)
      }
    }
  }

  // Show critique summary
  if (task.agentResults.critique) {
    lines.push('')
    lines.push(ui.c.bold('  ── Critique ──'))
    const critiqueLines = task.agentResults.critique.split('\n').slice(0, 20)
    for (const line of critiqueLines) {
      if (line.toLowerCase().includes('approved')) {
        lines.push(ui.c.success(`  ✓ ${line.trim()}`))
      } else if (line.toLowerCase().includes('needs_revision') || line.toLowerCase().includes('needs revision')) {
        lines.push(ui.c.warn(`  ⚠ ${line.trim()}`))
      } else {
        lines.push(ui.c.dim(`  ${line}`))
      }
    }
  }

  lines.push('')
  lines.push(ui.c.dim('  ──────────────────────────────────────────────'))
  lines.push('')

  return lines.join('\n')
}

/** Format the status indicator for the REPL prompt */
export function getblazeplanStatusIndicator(): string {
  const tasks = listblazeplanTasks(5)
  const active = tasks.find(t =>
    t.status === 'drafting' || t.status === 'synthesizing' || t.status === 'critiquing'
  )

  if (!active) return ''

  const icons: Record<string, string> = {
    drafting: ui.c.warn('◇'),
    synthesizing: ui.c.info('◇'),
    critiquing: ui.c.brand('◇'),
  }

  const labels: Record<string, string> = {
    drafting: 'blazeplan — researching codebase',
    synthesizing: 'blazeplan — synthesizing plan',
    critiquing: 'blazeplan — reviewing plan',
  }

  return ` ${icons[active.status] || '◇'} ${labels[active.status] || 'blazeplan'} `
}

/** Save plan to a file and return the path */
export function savePlanToFile(task: blazeplanTask, cwd: string): string {
  const dir = resolve(cwd, '.blaze', 'plans')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const filename = `blazeplan_${task.id.slice(3)}.md`
  const filepath = join(dir, filename)

  let content = `# blazeplan: ${task.prompt.slice(0, 80)}\n\n`
  content += `> Generated: ${new Date(task.createdAt).toLocaleString()}\n`
  content += `> ID: ${task.id}\n\n`
  content += `## Original Task\n${task.prompt}\n\n`

  if (task.agentResults.explorer) {
    content += `## Architecture Exploration\n${task.agentResults.explorer}\n\n`
  }
  if (task.agentResults.files) {
    content += `## Files to Modify\n${task.agentResults.files}\n\n`
  }
  if (task.agentResults.risks) {
    content += `## Risks & Dependencies\n${task.agentResults.risks}\n\n`
  }
  if (task.plan) {
    content += `## Implementation Plan\n${task.plan}\n\n`
  }
  if (task.agentResults.critique) {
    content += `## Critique\n${task.agentResults.critique}\n\n`
  }

  writeFileSync(filepath, content, 'utf-8')
  return filepath
}