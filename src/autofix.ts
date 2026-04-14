/**
 * Auto-Fix Engine — watches for common errors and suggests/applies fixes.
 * 
 * When a Bash command or tool fails, AutoFix analyzes the error and:
 * 1. Classifies the error type (missing dep, syntax, type, permission, etc.)
 * 2. Generates a targeted fix prompt
 * 3. Optionally auto-applies the fix (with permission)
 * 
 * This is a UNIQUE feature — no other CLI AI tool has intelligent auto-repair.
 */

import { Agent } from './agent.js'
import * as ui from './ui.js'

export interface AutoFixResult {
  fixed: boolean
  description: string
  toolCalls: number
}

/** Error pattern classifiers */
const ERROR_PATTERNS: Array<{ pattern: RegExp; type: string; description: string }> = [
  // TypeScript/JavaScript
  { pattern: /Cannot find module ['"](.+?)['"]/i, type: 'missing_dep', description: 'Missing dependency' },
  { pattern: /Module not found.*['"](.+?)['"]/i, type: 'missing_dep', description: 'Module not found' },
  { pattern: /error TS\d+:/i, type: 'typescript', description: 'TypeScript error' },
  { pattern: /SyntaxError:/i, type: 'syntax', description: 'Syntax error' },
  { pattern: /EADDRINUSE/i, type: 'port_conflict', description: 'Port already in use' },
  { pattern: /ENOENT.*open\s+['"](.+?)['"]/i, type: 'file_not_found', description: 'File not found' },
  { pattern: /EACCES|permission denied/i, type: 'permission', description: 'Permission denied' },
  { pattern: /npm ERR!.*E404/i, type: 'missing_dep', description: 'Package not found' },
  { pattern: /Command failed.*exit code (\d+)/i, type: 'command_fail', description: 'Command failed' },
  { pattern: /fatal:.*not a git repository/i, type: 'git', description: 'Not a git repo' },
  { pattern: /CONFLICT/i, type: 'merge_conflict', description: 'Merge conflict' },
  { pattern: /Port (\d+) is already in use/i, type: 'port_conflict', description: 'Port conflict' },
  { pattern: /TypeError:/i, type: 'runtime', description: 'Runtime TypeError' },
  { pattern: /ReferenceError:/i, type: 'runtime', description: 'ReferenceError' },
  { pattern: /ImportError|ModuleNotFoundError/i, type: 'missing_dep', description: 'Python import error' },
  { pattern: /pip install/i, type: 'missing_dep', description: 'Missing Python package' },
  { pattern: /cargo build.*error/i, type: 'rust', description: 'Rust build error' },
  { pattern: /go:.*cannot find/i, type: 'missing_dep', description: 'Go module missing' },
]

/** Classify an error message */
export function classifyError(errorOutput: string): { type: string; description: string; match: string } | null {
  for (const { pattern, type, description } of ERROR_PATTERNS) {
    const match = pattern.exec(errorOutput)
    if (match) {
      return { type, description, match: match[1] || match[0] }
    }
  }
  return null
}

/** Build a targeted fix prompt based on error classification */
export function buildFixPrompt(errorOutput: string, classification: { type: string; description: string; match: string }, cwd: string): string {
  const base = `An error occurred and needs to be fixed:\n\nError: ${errorOutput.slice(0, 500)}\n\n`

  switch (classification.type) {
    case 'missing_dep':
      return base + `The error indicates a missing dependency: "${classification.match}".\n` +
        `1. Check what package manager this project uses (look at package.json, requirements.txt, Cargo.toml, go.mod)\n` +
        `2. Install the missing dependency\n` +
        `3. Verify the fix by running the original command again`

    case 'typescript':
      return base + `This is a TypeScript error. Fix it by:\n` +
        `1. Read the file with the error\n` +
        `2. Fix the type error (add types, fix imports, etc.)\n` +
        `3. Run the TypeScript compiler again to verify`

    case 'syntax':
      return base + `This is a syntax error. Fix it by:\n` +
        `1. Read the file mentioned in the error\n` +
        `2. Fix the syntax error\n` +
        `3. Verify by running the code again`

    case 'port_conflict':
      return base + `A port is already in use. Fix it by:\n` +
        `1. Find the process using the port\n` +
        `2. Either kill that process or change the port in the config\n` +
        `3. Restart the server`

    case 'file_not_found':
      return base + `A file was not found: "${classification.match}". Fix it by:\n` +
        `1. Check if the file exists elsewhere or needs to be created\n` +
        `2. Create or move the file as needed`

    case 'permission':
      return base + `This is a permission error. Fix it by:\n` +
        `1. Check file/directory permissions\n` +
        `2. Fix permissions or suggest an alternative approach`

    case 'merge_conflict':
      return base + `There are merge conflicts. Fix them by:\n` +
        `1. Read the conflicted files\n` +
        `2. Resolve each conflict by choosing the correct code\n` +
        `3. Stage and commit the resolution`

    case 'runtime':
      return base + `This is a runtime error. Fix it by:\n` +
        `1. Read the file with the error\n` +
        `2. Fix the undefined variable or incorrect reference\n` +
        `3. Verify the fix`

    default:
      return base + `Analyze this error and fix it. Read relevant files, understand the issue, and apply the fix.`
  }
}

/** Auto-fix an error using the agent */
export async function autoFix(
  agent: Agent,
  errorOutput: string,
  autoApply = false
): Promise<AutoFixResult> {
  const classification = classifyError(errorOutput)

  if (!classification) {
    // Unknown error — let the agent figure it out
    console.log(ui.c.warn('  🔧 Auto-fix: Unknown error type, attempting generic fix...'))
    const result = await agent.run(
      `An error occurred and needs to be fixed:\n\n${errorOutput.slice(0, 1000)}\n\n` +
      `Analyze the error, find the root cause, and fix it. Read relevant files first.`
    )
    return { fixed: !!result, description: 'Generic fix applied', toolCalls: 0 }
  }

  console.log(ui.c.info(`  🔧 Auto-fix: ${classification.description}`))

  if (!autoApply) {
    console.log(ui.c.dim(`     ${classification.description}: ${classification.match}`))
    const answer = await ui.getUserInput(ui.c.warn('  Auto-fix? [Y/n] '))
    if (answer.trim().toLowerCase() === 'n') {
      return { fixed: false, description: 'User declined auto-fix', toolCalls: 0 }
    }
  }

  const fixPrompt = buildFixPrompt(errorOutput, classification, agent.getCwd())
  const result = await agent.run(fixPrompt)

  return { fixed: !!result, description: classification.description, toolCalls: 0 }
}