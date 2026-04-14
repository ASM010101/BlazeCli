/**
 * Advanced Permissions — pattern-based tool access control.
 *
 * Configured in .blazerc:
 * {
 *   "permissions": {
 *     "allow": ["Bash(npm *)", "Bash(git *)", "FileRead", "Grep", "Glob"],
 *     "deny": ["Bash(rm -rf *)", "Bash(sudo *)"]
 *   }
 * }
 *
 * Rules:
 * - "ToolName" matches any use of that tool
 * - "ToolName(pattern)" matches when the primary arg matches the glob pattern
 * - deny rules take priority over allow rules
 * - If no rules match, falls back to the tool's default needsPermission
 */

export interface PermissionsConfig {
  allow?: string[]
  deny?: string[]
}

export type PermissionDecision = 'allow' | 'deny' | 'ask'

interface ParsedRule {
  tool: string
  pattern: string | null
}

/** Parse a permission rule string like "Bash(npm *)" */
function parseRule(rule: string): ParsedRule {
  const match = rule.match(/^(\w+)\((.+)\)$/)
  if (match) {
    return { tool: match[1]!, pattern: match[2]! }
  }
  return { tool: rule, pattern: null }
}

/** Check if a value matches a glob-like pattern */
function matchesPattern(value: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${escaped}$`, 'i')
  return regex.test(value)
}

/** Get the primary argument for a tool (for pattern matching) */
function getPrimaryArg(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return String(args.command || '')
    case 'FileRead':
    case 'FileWrite':
    case 'FileEdit':
      return String(args.path || '')
    case 'Grep':
      return String(args.pattern || '')
    case 'Glob':
      return String(args.pattern || '')
    case 'ListDir':
      return String(args.path || '.')
    case 'WebFetch':
    case 'WebSearch':
      return String(args.url || args.query || '')
    case 'ResearchAgent':
      return String(args.task || '')
    default:
      return ''
  }
}

/**
 * Check permission for a tool call.
 * Returns 'allow' (skip prompt), 'deny' (block), or 'ask' (show prompt).
 */
export function checkPermission(
  config: PermissionsConfig,
  toolName: string,
  args: Record<string, unknown>
): PermissionDecision {
  const primaryArg = getPrimaryArg(toolName, args)

  // Check deny rules first (highest priority)
  if (config.deny) {
    for (const rule of config.deny) {
      const parsed = parseRule(rule)
      if (parsed.tool !== toolName) continue

      if (!parsed.pattern) {
        // Matches all uses of this tool
        return 'deny'
      }

      if (matchesPattern(primaryArg, parsed.pattern)) {
        return 'deny'
      }
    }
  }

  // Check allow rules
  if (config.allow) {
    for (const rule of config.allow) {
      const parsed = parseRule(rule)
      if (parsed.tool !== toolName) continue

      if (!parsed.pattern) {
        // Matches all uses of this tool
        return 'allow'
      }

      if (matchesPattern(primaryArg, parsed.pattern)) {
        return 'allow'
      }
    }
  }

  // No rule matched — fall back to default behavior
  return 'ask'
}
