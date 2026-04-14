import type { Message, ToolCall, BlazeConfig } from './types.js'
import { estimateCost } from './types.js'
import { LLMClient } from './llm.js'
import { getToolDefinitions, findTool } from './tools/index.js'
import { getSystemPrompt } from './prompt.js'
import { runHooks, runSessionHook } from './hooks.js'
import { checkPermission } from './permissions.js'
import { handleRateLimit } from './failover.js'
import * as ui from './ui.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * Parse XML-style tool calls from model output.
 * Some models (DeepSeek) output <function_calls><invoke name="..."> instead of OpenAI tool_calls.
 */
function parseXmlToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi
  const paramPattern = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/gi

  let invokeMatch
  while ((invokeMatch = invokePattern.exec(text)) !== null) {
    const name = invokeMatch[1]!
    const body = invokeMatch[2]!
    const args: Record<string, string> = {}

    let paramMatch
    paramPattern.lastIndex = 0
    while ((paramMatch = paramPattern.exec(body)) !== null) {
      args[paramMatch[1]!] = paramMatch[2]!
    }

    calls.push({
      id: `call_xml_${Date.now()}_${calls.length}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })
  }

  return calls
}

/**
 * Agent — the core brain of Blaze CLI.
 */
export class Agent {
  private llm: LLMClient
  private messages: Message[] = []
  private cwd: string
  private config: BlazeConfig
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private autoApproveAll = false
  private sessionId: string
  private planMode: boolean
  private branchHistory: Message[][] = [] // For /branch
  private abortController: AbortController | null = null // For soft interrupt
  private checkpoints: Array<{ messages: Message[]; timestamp: string }> = [] // For /rewind

  constructor(config: BlazeConfig) {
    this.config = config
    this.llm = new LLMClient(config)
    this.cwd = process.cwd()
    this.sessionId = `session_${Date.now()}`
    this.planMode = config.planMode || false

    // Initialize with system prompt
    this.messages.push({
      role: 'system',
      content: getSystemPrompt(this.cwd, this.planMode),
    })

    if (config.autoApprove) {
      this.autoApproveAll = true
    }

    // Run session start hooks
    runSessionHook(config.hooks, 'sessionStart', this.cwd)
  }

  /** Soft-interrupt: stop the current agent run but keep the REPL alive */
  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  isRunning(): boolean {
    return this.abortController !== null
  }

  /** Process a user message through the full agentic loop */
  async run(userMessage: string): Promise<string> {
    this.messages.push({ role: 'user', content: userMessage })

    // Save checkpoint before each run
    this.saveCheckpoint()

    // Auto-compact if needed
    await this.maybeAutoCompact()

    // Create abort controller for this run
    this.abortController = new AbortController()
    const { signal } = this.abortController

    const startTime = Date.now()
    let totalToolCalls = 0
    let iteration = 0
    const maxIterations = this.config.maxIterations
    let lastResponse = ''

    while (iteration < maxIterations) {
      iteration++

      // Check for interrupt
      if (signal.aborted) {
        console.log(ui.c.warn('\n  ⚠ Interrupted by user.'))
        this.messages.push({ role: 'assistant', content: '(Interrupted by user)' })
        break
      }

      // ── Call the LLM with streaming ──
      ui.startSpinner('Thinking...')

      let fullText = ''
      let thinkingBuffer = ''
      let hasSeenContent = false
      let toolCalls: ToolCall[] = []
      const pendingToolArgs = new Map<number, { id: string; name: string; args: string }>()

      try {
        const tools = getToolDefinitions(this.planMode)
        for await (const chunk of this.llm.stream(this.messages, tools)) {
          // Check abort mid-stream
          if (signal.aborted) throw new Error('INTERRUPTED')

          ui.stopSpinner()

          const choice = chunk.choices[0]
          if (!choice) continue

          // Stream text tokens
          // Use content if available. Fall back to reasoning for models that put
          // everything there (Qwen3.5:cloud via Ollama).
          const contentToken = choice.delta.content || null
          const reasoningToken = choice.delta.reasoning || choice.delta.reasoning_content || null

          if (contentToken) {
            hasSeenContent = true
            fullText += contentToken
            ui.streamToken(contentToken)
          } else if (reasoningToken) {
            thinkingBuffer += reasoningToken
          }

          // Accumulate tool calls
          if (choice.delta.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              if (!pendingToolArgs.has(tc.index)) {
                pendingToolArgs.set(tc.index, {
                  id: tc.id || `call_${Date.now()}_${tc.index}`,
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || '',
                })
              } else {
                const existing = pendingToolArgs.get(tc.index)!
                if (tc.function?.name) existing.name = tc.function.name
                if (tc.function?.arguments) existing.args += tc.function.arguments
              }
            }
          }

          // Track usage
          if (chunk.usage) {
            this.totalInputTokens += chunk.usage.prompt_tokens || 0
            this.totalOutputTokens += chunk.usage.completion_tokens || 0
          }
        }
      } catch (err: unknown) {
        ui.stopSpinner()
        ui.endStream()

        const errMsg = (err as Error).message || ''

        // ── Soft interrupt ──
        if (errMsg === 'INTERRUPTED' || signal.aborted) {
          if (fullText) {
            this.messages.push({ role: 'assistant', content: fullText + '\n(interrupted)' })
          }
          console.log(ui.c.warn('\n  ⚠ Interrupted. Your conversation is preserved.'))
          break
        }

        // ── Rate limit detection & failover ──
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('usage limit')) {
          const provider = await handleRateLimit(this.config, this.llm.getUrl(), this.llm.getModel())
          if (provider) {
            this.llm.switchProvider(provider.url, provider.model, provider.apiKey)
            this.config.llmModel = provider.model
            console.log(ui.c.success(`  ✓ Now using ${provider.model} — retrying...\n`))
            continue
          }
          console.log(ui.c.dim('  Stopping due to rate limit.'))
          break
        }

        console.log(ui.c.error(`\n  Error: ${errMsg}`))
        break
      }

      ui.endStream()

      // ── Convert accumulated tool calls ──
      toolCalls = Array.from(pendingToolArgs.values()).map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      }))

      // ── Parse XML-style tool calls from content (DeepSeek, some other models) ──
      if (toolCalls.length === 0 && fullText.includes('<function_calls>')) {
        const xmlCalls = parseXmlToolCalls(fullText)
        if (xmlCalls.length > 0) {
          toolCalls = xmlCalls
          fullText = '' // Clear text since it was tool calls, not a response
        }
      }
      // Also check thinking buffer for XML tool calls
      if (toolCalls.length === 0 && thinkingBuffer.includes('<function_calls>')) {
        const xmlCalls = parseXmlToolCalls(thinkingBuffer)
        if (xmlCalls.length > 0) {
          toolCalls = xmlCalls
          thinkingBuffer = ''
        }
      }

      // ── If no tool calls, we're done ──
      if (toolCalls.length === 0) {
        // Thinking buffer is NEVER shown to user — it's internal model reasoning.
        // If the model only produced thinking and no content, it means it failed
        // to generate a useful response. We keep the thinking in message history
        // so the model has context on the next turn, but don't display it.
        if (!fullText && thinkingBuffer) {
          // Store thinking as assistant message so model knows what it thought
          fullText = '(Processing... please repeat or rephrase your request)'
          ui.streamToken(fullText)
          ui.endStream()
          // Include thinking in history so model can build on it
          this.messages.push({ role: 'assistant', content: `[Internal reasoning]\n${thinkingBuffer.slice(0, 2000)}` })
          lastResponse = fullText
          break
        }
        if (fullText) {
          this.messages.push({ role: 'assistant', content: fullText })
          lastResponse = fullText
        }
        break
      }

      // ── Add assistant message with tool calls to history ──
      this.messages.push({
        role: 'assistant',
        content: fullText || null,
        tool_calls: toolCalls,
      })

      // ── Execute tool calls ──
      if (toolCalls.length > 1) {
        // PARALLEL execution — but with safe UI (single spinner, batched output)
        totalToolCalls += toolCalls.length
        const results = await this.executeToolsBatch(toolCalls)
        for (const result of results) {
          this.messages.push(result)
        }
      } else {
        // SEQUENTIAL execution for single tool call
        totalToolCalls++
        const result = await this.executeSingleTool(toolCalls[0]!)
        this.messages.push(result)
      }

      // Loop continues — LLM will see tool results and decide next action
    }

    if (iteration >= maxIterations) {
      console.log(ui.c.warn(`\n  ⚠ Reached maximum iterations (${maxIterations}). Stopping.`))
    }

    // Clear abort controller
    this.abortController = null

    // Print stats with cost estimation
    const elapsed = Date.now() - startTime
    const costStr = estimateCost(this.totalInputTokens, this.totalOutputTokens, this.config.llmModel)
    ui.printStats(this.totalInputTokens, this.totalOutputTokens, elapsed, totalToolCalls, costStr)

    // Auto-save after each exchange
    this.autoSave()

    return lastResponse
  }

  // ─── Tool Execution ──────────────────────────────────────────────

  /** Execute a single tool call with permission checks and hooks */
  private async executeSingleTool(tc: ToolCall): Promise<Message> {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments || '{}')
    } catch {
      args = { raw: tc.function.arguments }
    }

    const tool = findTool(tc.function.name)
    if (!tool) {
      const errorResult = `Error: Unknown tool "${tc.function.name}". Available tools: Bash, FileRead, FileWrite, FileEdit, Grep, Glob, ListDir, WebFetch, WebSearch, ResearchAgent`
      console.log(ui.c.error(`  ✗ Unknown tool: ${tc.function.name}`))
      return { role: 'tool', content: errorResult, tool_call_id: tc.id }
    }

    // Display tool call
    ui.printToolCall(tool.name, args)

    // ── Pre-tool hook ──
    const preHook = runHooks(this.config.hooks, 'preToolUse', {
      toolName: tool.name, args, cwd: this.cwd,
    })
    if (!preHook.allowed) {
      const blocked = `Blocked by hook: ${preHook.output || 'pre-tool hook denied'}`
      console.log(ui.c.warn(`  ⚡ ${blocked}`))
      return { role: 'tool', content: blocked, tool_call_id: tc.id }
    }
    if (preHook.output) ui.printHookResult('preToolUse', preHook.output)

    // ── Permission check (async with prompt) ──
    const allowed = await this.checkAndPromptPermission(tool.name, tool.needsPermission, args)
    if (!allowed) {
      const deniedResult = `Permission denied for ${tool.name}`
      console.log(ui.c.warn('  ✗ Denied'))
      return { role: 'tool', content: deniedResult, tool_call_id: tc.id }
    }

    // ── Execute ──
    ui.startSpinner(`Running ${tool.name}...`)
    try {
      const result = await tool.execute(args, this.cwd)
      ui.stopSpinner()
      ui.printToolResult(result)

      // ── Post-tool hook ──
      const postHook = runHooks(this.config.hooks, 'postToolUse', {
        toolName: tool.name, args, result, cwd: this.cwd,
      })
      if (postHook.output) ui.printHookResult('postToolUse', postHook.output)

      return { role: 'tool', content: result, tool_call_id: tc.id }
    } catch (err: unknown) {
      ui.stopSpinner()
      const errorResult = `Tool execution error: ${(err as Error).message}`
      console.log(ui.c.error(`  ✗ Error: ${(err as Error).message}`))
      return { role: 'tool', content: errorResult, tool_call_id: tc.id }
    }
  }

  /**
   * Execute multiple tool calls in a batch — tools run in parallel,
   * but UI is serialized: one spinner for the batch, results printed after all finish.
   */
  private async executeToolsBatch(toolCalls: ToolCall[]): Promise<Message[]> {
    // Parse all args upfront
    const parsed = toolCalls.map(tc => {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = {} }
      const tool = findTool(tc.function.name)
      return { tc, args, tool }
    })

    // Show all tool names upfront
    for (const { tool, args } of parsed) {
      const toolName = tool?.name || '???'
      const primary = String(args.path || args.command || args.query || args.pattern || args.task || '').slice(0, 80)
      console.log(ui.c.tool(`  🔧 ${toolName}`) + (primary ? ui.c.dim(` ${primary}`) : ''))
    }

    // ── Permission gate: ask ONCE if any dangerous tools are in the batch ──
    if (!this.autoApproveAll && !this.config.autoApprove) {
      const dangerousTools = parsed.filter(p => p.tool?.needsPermission)

      if (dangerousTools.length > 0) {
        // Check deny rules first — block any explicitly denied
        for (const { tc, tool, args } of dangerousTools) {
          const decision = checkPermission(this.config.permissions, tool!.name, args)
          if (decision === 'deny') {
            // Abort the whole batch with deny messages
            return parsed.map(p => ({
              role: 'tool' as const,
              content: `Permission denied for batch containing ${tool!.name}`,
              tool_call_id: p.tc.id,
            }))
          }
          // If allow rule matches, skip the prompt for that tool
          if (decision === 'allow') continue
        }

        // Some dangerous tools need prompting — ask once for the whole batch
        const needsPrompt = dangerousTools.filter(p => {
          const decision = checkPermission(this.config.permissions, p.tool!.name, p.args)
          return decision === 'ask'
        })

        if (needsPrompt.length > 0) {
          const names = [...new Set(needsPrompt.map(p => p.tool!.name))].join(', ')
          console.log()
          console.log(ui.c.warn(`  ⚠  Batch contains ${dangerousTools.length} dangerous tool call(s): ${names}`))
          for (const { tool, args } of needsPrompt.slice(0, 5)) {
            const primary = String(args.command || args.path || args.content?.toString().slice(0, 40) || '').slice(0, 60)
            console.log(ui.c.dim(`     ${tool!.name}: ${primary}`))
          }
          if (needsPrompt.length > 5) {
            console.log(ui.c.dim(`     ... and ${needsPrompt.length - 5} more`))
          }

          const decision = await ui.askPermission(`Batch (${dangerousTools.length} calls)`, { tools: names })
          if (decision === 'no') {
            return parsed.map(p => ({
              role: 'tool' as const,
              content: `Permission denied by user for batch execution`,
              tool_call_id: p.tc.id,
            }))
          }
          if (decision === 'always') {
            this.autoApproveAll = true
            console.log(ui.c.success('  ✓ Auto-approving all future tool calls this session'))
          }
        }
      }
    }

    // Single spinner for the whole batch
    ui.startSpinner(`Running ${toolCalls.length} tools in parallel...`)

    // Execute all tools in parallel (permission already checked above)
    const promises = parsed.map(async ({ tc, args, tool }): Promise<Message> => {
      if (!tool) {
        return { role: 'tool', content: `Error: Unknown tool "${tc.function.name}"`, tool_call_id: tc.id }
      }

      // Pre-tool hook
      const preHook = runHooks(this.config.hooks, 'preToolUse', { toolName: tool.name, args, cwd: this.cwd })
      if (!preHook.allowed) {
        return { role: 'tool', content: `Blocked by hook: ${preHook.output}`, tool_call_id: tc.id }
      }

      try {
        const result = await tool.execute(args, this.cwd)

        // Post-tool hook
        runHooks(this.config.hooks, 'postToolUse', { toolName: tool.name, args, result, cwd: this.cwd })

        return { role: 'tool', content: result, tool_call_id: tc.id }
      } catch (err: unknown) {
        return { role: 'tool', content: `Tool error: ${(err as Error).message}`, tool_call_id: tc.id }
      }
    })

    const results = await Promise.all(promises)

    // Stop spinner, then print all results sequentially (no interleaving)
    ui.stopSpinner()

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]!
      const result = results[i]!
      const tool = findTool(tc.function.name)
      const toolName = tool?.name || tc.function.name
      const content = result.content || ''

      // Compact result display for batches
      if (content.startsWith('Error') || content.startsWith('Tool error') || content.startsWith('Permission denied') || content.startsWith('Blocked')) {
        console.log(ui.c.error(`  ✗ ${toolName}: ${content.slice(0, 100)}`))
      } else {
        // Show first 3 lines of each result
        const lines = content.split('\n')
        const preview = lines.slice(0, 3).join('\n     │ ')
        const more = lines.length > 3 ? ui.c.dim(` (+${lines.length - 3} lines)`) : ''
        console.log(ui.c.tool(`  ✓ ${toolName}`) + more)
        if (preview.trim()) {
          console.log(ui.c.dim('     │ ') + preview.slice(0, 200))
        }
      }
    }

    return results
  }

  /** Check permission with async prompt support */
  private async checkAndPromptPermission(
    toolName: string,
    needsPermission: boolean,
    args: Record<string, unknown>
  ): Promise<boolean> {
    if (this.autoApproveAll || this.config.autoApprove) return true

    const ruleDecision = checkPermission(this.config.permissions, toolName, args)
    if (ruleDecision === 'allow') return true
    if (ruleDecision === 'deny') return false

    if (!needsPermission) return true

    const decision = await ui.askPermission(toolName, args)
    if (decision === 'no') return false
    if (decision === 'always') {
      this.autoApproveAll = true
      console.log(ui.c.success('  ✓ Auto-approving all future tool calls this session'))
    }
    return true
  }

  // ─── Context Window Management ──────────────────────────────────

  /** Estimate current context size (rough: 1 token ≈ 4 chars) */
  private estimateTokens(): number {
    let chars = 0
    for (const msg of this.messages) {
      if (msg.content) chars += msg.content.length
      if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length
    }
    return Math.ceil(chars / 4)
  }

  /** Auto-compact when approaching context limit */
  private async maybeAutoCompact(): Promise<void> {
    const estimatedTokens = this.estimateTokens()
    const threshold = this.config.maxContextTokens * this.config.compactThreshold

    if (estimatedTokens > threshold) {
      console.log(ui.c.warn(`\n  ⚠ Context getting large (~${estimatedTokens} tokens). Auto-compacting...`))
      await this.compact()
    }
  }

  /** Compact the conversation — smart approach */
  async compact(): Promise<void> {
    if (this.messages.length <= 3) {
      console.log(ui.c.dim('  Nothing to compact.'))
      return
    }

    const oldCount = this.messages.length
    const oldTokens = this.estimateTokens()

    // Keep: system prompt (0), last 6 messages
    const systemMsg = this.messages[0]!
    const keepCount = Math.min(6, this.messages.length - 1)
    const oldMessages = this.messages.slice(1, this.messages.length - keepCount)
    const recentMessages = this.messages.slice(this.messages.length - keepCount)

    // Build a smarter summary — group by user request + assistant response
    const summaryParts: string[] = []
    let currentExchange = ''

    for (const msg of oldMessages) {
      if (msg.role === 'user' && msg.content) {
        if (currentExchange) summaryParts.push(currentExchange)
        currentExchange = `• User: ${msg.content.slice(0, 150)}`
      } else if (msg.role === 'assistant' && msg.content) {
        currentExchange += `\n  Assistant: ${msg.content.slice(0, 150)}`
      } else if (msg.role === 'tool' && msg.content) {
        // Only include tool errors, skip normal results
        if (msg.content.startsWith('Error') || msg.content.startsWith('Tool execution error')) {
          currentExchange += `\n  [Tool error: ${msg.content.slice(0, 80)}]`
        } else {
          currentExchange += `\n  [Tool result: ${msg.content.slice(0, 60)}...]`
        }
      }
    }
    if (currentExchange) summaryParts.push(currentExchange)

    const summary = summaryParts.join('\n')

    // Rebuild messages
    this.messages = [
      systemMsg,
      {
        role: 'user',
        content: `[CONVERSATION SUMMARY — earlier in this session]\n${summary}\n[END SUMMARY — continue from here]`,
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our earlier conversation and will continue from here.',
      },
      ...recentMessages,
    ]

    const newTokens = this.estimateTokens()
    ui.printCompactSummary(oldCount, this.messages.length, oldTokens - newTokens)
  }

  // ─── Checkpoint / Rewind ─────────────────────────────────────────

  /** Save a checkpoint of current conversation state */
  private saveCheckpoint(): void {
    this.checkpoints.push({
      messages: JSON.parse(JSON.stringify(this.messages)),
      timestamp: new Date().toISOString(),
    })
    // Keep max 20 checkpoints
    if (this.checkpoints.length > 20) {
      this.checkpoints.shift()
    }
  }

  /** Rewind to a specific checkpoint */
  rewind(index: number): boolean {
    if (index < 1 || index > this.checkpoints.length) return false
    const cp = this.checkpoints[index - 1]!
    this.messages = JSON.parse(JSON.stringify(cp.messages))
    // Remove all checkpoints after the one we rewound to
    this.checkpoints = this.checkpoints.slice(0, index - 1)
    return true
  }

  /** Rewind to the last checkpoint */
  rewindLast(): boolean {
    if (this.checkpoints.length === 0) return false
    return this.rewind(this.checkpoints.length)
  }

  getCheckpoints(): Array<{ index: number; timestamp: string; messageCount: number }> {
    return this.checkpoints.map((cp, i) => ({
      index: i + 1,
      timestamp: cp.timestamp,
      messageCount: cp.messages.length,
    }))
  }

  /** Get conversation messages for export */
  getMessages(): Message[] {
    return this.messages
  }

  // ─── Plan Mode ──────────────────────────────────────────────────

  /** Toggle plan mode */
  setPlanMode(enabled: boolean) {
    this.planMode = enabled
    // Update system prompt to reflect mode
    this.messages[0] = {
      role: 'system',
      content: getSystemPrompt(this.cwd, this.planMode),
    }
  }

  getPlanMode(): boolean {
    return this.planMode
  }

  // ─── Conversation Branching ────────────────────────────────────

  /** Save current conversation as a branch point */
  branch(): number {
    this.branchHistory.push([...this.messages])
    return this.branchHistory.length
  }

  /** Restore to a branch point */
  restoreBranch(index: number): boolean {
    if (index < 1 || index > this.branchHistory.length) return false
    this.messages = [...this.branchHistory[index - 1]!]
    return true
  }

  getBranchCount(): number {
    return this.branchHistory.length
  }

  // ─── Conversation Persistence ────────────────────────────────────

  private autoSave(): void {
    try {
      const dir = this.config.historyDir
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const savePath = join(dir, `${this.sessionId}.json`)
      const data = {
        sessionId: this.sessionId,
        model: this.config.llmModel,
        cwd: this.cwd,
        savedAt: new Date().toISOString(),
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        messages: this.messages,
      }
      writeFileSync(savePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch {
      // Silently fail
    }
  }

  save(): string {
    const dir = this.config.historyDir
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const savePath = join(dir, `${this.sessionId}.json`)
    const data = {
      sessionId: this.sessionId,
      model: this.config.llmModel,
      cwd: this.cwd,
      savedAt: new Date().toISOString(),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      messages: this.messages,
    }
    writeFileSync(savePath, JSON.stringify(data, null, 2), 'utf-8')
    return savePath
  }

  load(sessionPath: string): boolean {
    try {
      if (!existsSync(sessionPath)) return false
      const raw = readFileSync(sessionPath, 'utf-8')
      const data = JSON.parse(raw) as {
        sessionId: string
        messages: Message[]
        totalInputTokens?: number
        totalOutputTokens?: number
      }

      this.sessionId = data.sessionId || this.sessionId
      this.messages = data.messages || []
      this.totalInputTokens = data.totalInputTokens || 0
      this.totalOutputTokens = data.totalOutputTokens || 0

      // Update system prompt to current CWD + plan mode
      if (this.messages.length > 0 && this.messages[0]!.role === 'system') {
        this.messages[0]!.content = getSystemPrompt(this.cwd, this.planMode)
      }

      return true
    } catch {
      return false
    }
  }

  /** List saved sessions, optionally filtered to current CWD */
  listSessions(filterCwd?: string): Array<{ id: string; date: string; path: string; cwd: string }> {
    const dir = this.config.historyDir
    if (!existsSync(dir)) return []

    try {
      const files = readdirSync(dir) as string[]
      let sessions = files
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => {
          const path = join(dir, f)
          try {
            const raw = readFileSync(path, 'utf-8')
            const data = JSON.parse(raw)
            return {
              id: data.sessionId || f.replace('.json', ''),
              date: data.savedAt || 'unknown',
              path,
              cwd: data.cwd || '',
            }
          } catch {
            return { id: f.replace('.json', ''), date: 'unknown', path, cwd: '' }
          }
        })
        .sort((a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date))

      // Filter by CWD if requested
      if (filterCwd) {
        const normalized = filterCwd.toLowerCase().replace(/\\/g, '/')
        sessions = sessions.filter(s => s.cwd.toLowerCase().replace(/\\/g, '/') === normalized)
      }

      return sessions.slice(0, 10)
    } catch {
      return []
    }
  }

  /** Find the most recent session for a specific CWD */
  findRecentSession(cwd: string): { id: string; date: string; path: string; cwd: string } | null {
    const sessions = this.listSessions(cwd)
    return sessions.length > 0 ? sessions[0]! : null
  }

  /** Force-save current state (for Ctrl+C handler) */
  emergencySave(): void {
    this.autoSave()
  }

  // ─── Getters & Setters ────────────────────────────────────────────

  reset() {
    this.messages = [{
      role: 'system',
      content: getSystemPrompt(this.cwd, this.planMode),
    }]
    this.totalInputTokens = 0
    this.totalOutputTokens = 0
    this.sessionId = `session_${Date.now()}`
    this.branchHistory = []
  }

  /** Alias for reset() — clear conversation and start fresh */
  clear() {
    this.reset()
  }

  setCwd(newCwd: string) {
    this.cwd = newCwd
    this.messages[0] = {
      role: 'system',
      content: getSystemPrompt(this.cwd, this.planMode),
    }
  }

  getCwd(): string {
    return this.cwd
  }

  getMessageCount(): number {
    return this.messages.length
  }

  getEstimatedTokens(): number {
    return this.estimateTokens()
  }

  getMaxContextTokens(): number {
    return this.config.maxContextTokens
  }

  /** Switch to a different model/provider mid-conversation */
  switchProvider(url: string, model: string, apiKey?: string): void {
    this.llm.switchProvider(url, model, apiKey)
    this.config.llmModel = model
    this.config.llmUrl = url
    if (apiKey) this.config.llmApiKey = apiKey
  }

  getCurrentModel(): string { return this.llm.getModel() }
  getCurrentUrl(): string { return this.llm.getUrl() }
  getConfig(): BlazeConfig { return this.config }

  destroy(): void {
    runSessionHook(this.config.hooks, 'sessionEnd', this.cwd)
  }
}
