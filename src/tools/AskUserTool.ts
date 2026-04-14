import type { Tool, ToolDefinition } from '../types.js'
import * as ui from '../ui.js'

/**
 * AskUser Tool — lets the agent ask the user a question mid-flow.
 *
 * The agent can present options and get the user's choice,
 * or ask an open-ended question.
 */
export class AskUserTool implements Tool {
  name = 'AskUser'
  description = 'Ask the user a question and wait for their response. Use when you need clarification, want the user to choose between options, or need input before proceeding.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'AskUser',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user.',
          },
          options: {
            type: 'string',
            description: 'Optional comma-separated list of choices (e.g., "Option A, Option B, Option C"). If omitted, user gives free-form answer.',
          },
        },
        required: ['question'],
      },
    },
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const question = String(args.question || '')
    const optionsStr = String(args.options || '')

    if (!question.trim()) {
      return 'Error: question is required'
    }

    console.log()
    console.log(ui.c.info('  ❓ ') + ui.c.bold(question))

    if (optionsStr.trim()) {
      const options = optionsStr.split(',').map(o => o.trim()).filter(o => o)
      options.forEach((opt, i) => {
        console.log(ui.c.dim(`     ${i + 1}. `) + ui.c.assistant(opt))
      })
      console.log(ui.c.dim(`     Type a number or your own answer.`))

      const answer = await ui.getUserInput(ui.c.info('  Your answer: '))
      const num = parseInt(answer.trim(), 10)
      if (num >= 1 && num <= options.length) {
        const chosen = options[num - 1]!
        console.log(ui.c.dim(`  → ${chosen}`))
        return `User chose: ${chosen}`
      }
      return `User answered: ${answer.trim()}`
    }

    const answer = await ui.getUserInput(ui.c.info('  Your answer: '))
    return `User answered: ${answer.trim()}`
  }
}
