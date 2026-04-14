import type { Tool, ToolDefinition, Message } from '../types.js'
import { getConfig } from '../types.js'
import { LLMClient } from '../llm.js'
import { BashTool } from './BashTool.js'
import { FileReadTool } from './FileReadTool.js'
import { FileWriteTool } from './FileWriteTool.js'
import { FileEditTool } from './FileEditTool.js'
import { GrepTool } from './GrepTool.js'
import { GlobTool } from './GlobTool.js'
import { ListDirTool } from './ListDirTool.js'
import { WebFetchTool } from './WebFetchTool.js'
import { WebSearchTool } from './WebSearchTool.js'

/** Research agent's own tool set (avoids circular dependency with index.ts) */
function getResearchAgentTools(): Tool[] {
  return [
    new BashTool(),
    new FileReadTool(),
    new FileWriteTool(),
    new FileEditTool(),
    new GrepTool(),
    new GlobTool(),
    new ListDirTool(),
    new WebFetchTool(),
    new WebSearchTool(),
  ]
}

function getResearchAgentToolDefs(): ToolDefinition[] {
  return getResearchAgentTools().map(t => t.definition)
}

function findResearchAgentTool(name: string): Tool | undefined {
  return getResearchAgentTools().find(t => t.name === name)
}

/**
 * ResearchAgent Tool — spawn isolated research agents for delegated work.
 *
 * The research agent gets its own conversation context, runs an agentic loop,
 * and returns the final result to the parent agent.
 *
 * Use cases:
 * - Research/exploration without polluting parent context
 * - Parallel task delegation
 * - Using a different model for specific subtasks
 */
export class ResearchAgentTool implements Tool {
  name = 'ResearchAgent'
  description = 'Spawn an isolated research agent to handle a task independently. The research agent gets its own context and tools. Use for research, exploration, or delegating subtasks.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'ResearchAgent',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task for the research agent to complete. Be specific and provide full context.',
          },
          context: {
            type: 'string',
            description: 'Optional additional context or background info for the research agent.',
          },
        },
        required: ['task'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const task = String(args.task || '')
    const context = args.context ? String(args.context) : ''

    if (!task.trim()) {
      return 'Error: task is required for ResearchAgent'
    }

    const config = getConfig()
    const llm = new LLMClient(config)

    // Build research agent system prompt
    const systemPrompt = `You are a focused research agent working on a specific task.
You have access to tools to read files, search code, run commands, and more.
Complete the task thoroughly and report your findings clearly.

WORKING DIRECTORY: ${cwd}
OS: ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'}
SHELL: ${process.platform === 'win32' ? 'PowerShell' : 'bash'}

Rules:
- Focus ONLY on the assigned task
- Use tools to gather information — don't guess
- Be thorough but concise in your final response
- Report what you found, what you did, and any issues`

    // Build initial messages
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ]

    if (context) {
      messages.push({ role: 'user', content: `Background context:\n${context}` })
      messages.push({ role: 'assistant', content: 'Understood. I have the context. Ready for the task.' })
    }

    messages.push({ role: 'user', content: task })

    // Get tool definitions (all tools except ResearchAgent to prevent recursion)
    const tools = getResearchAgentToolDefs()

    // Run the agentic loop (max 15 iterations for research agent)
    const maxIterations = 15
    let finalText = ''
    let toolCallCount = 0

    for (let i = 0; i < maxIterations; i++) {
      let response
      try {
        response = await llm.chat(messages, tools)
      } catch (err: unknown) {
        return `ResearchAgent error: ${(err as Error).message}`
      }

      const choice = response.choices[0]
      if (!choice) break

      const msg = choice.message

      // If no tool calls, we're done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalText = msg.content || ''
        break
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      })

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        toolCallCount++
        let toolArgs: Record<string, unknown> = {}
        try {
          toolArgs = JSON.parse(tc.function.arguments || '{}')
        } catch {
          toolArgs = { raw: tc.function.arguments }
        }

        const tool = findResearchAgentTool(tc.function.name)
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
            content: result.slice(0, 50000), // Limit tool result size
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
      finalText = '(ResearchAgent reached max iterations without final response)'
    }

    return `[ResearchAgent completed — ${toolCallCount} tool calls]\n\n${finalText}`
  }
}