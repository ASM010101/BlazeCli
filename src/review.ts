/**
 * Code Review Engine — automated security & quality review.
 * 
 * UNIQUE FEATURES:
 * 1. Pattern-based vulnerability detection (OWASP Top 10)
 * 2. Code quality scoring (complexity, duplication, naming)
 * 3. Best practice enforcement per language/framework
 * 4. Generates actionable fix suggestions
 * 5. Severity classification (critical/warning/info)
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve, extname, basename } from 'path'

// ─── Types ──────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info'

export interface ReviewFinding {
  severity: Severity
  category: string
  message: string
  file: string
  line?: number
  code?: string
  fix?: string
}

export interface ReviewResult {
  findings: ReviewFinding[]
  score: number  // 0-100
  summary: string
  filesReviewed: number
  linesReviewed: number
}

// ─── Security Patterns ──────────────────────────────────────────

const SECURITY_PATTERNS: Array<{
  pattern: RegExp
  severity: Severity
  category: string
  message: string
  fix: string
}> = [
  // SQL Injection
  { pattern: /(?:query|execute|raw)\s*\(\s*[`'"].*\$\{.*\}/gi, severity: 'critical', category: 'SQL Injection', message: 'String interpolation in SQL query', fix: 'Use parameterized queries instead' },
  { pattern: /(?:query|execute|raw)\s*\(\s*['"`].*\+.*['"`]/gi, severity: 'critical', category: 'SQL Injection', message: 'String concatenation in SQL query', fix: 'Use parameterized queries instead' },

  // XSS
  { pattern: /innerHTML\s*=\s*[^<]/gi, severity: 'warning', category: 'XSS', message: 'Direct innerHTML assignment', fix: 'Use textContent or sanitize HTML' },
  { pattern: /dangerouslySetInnerHTML/gi, severity: 'warning', category: 'XSS', message: 'React dangerouslySetInnerHTML', fix: 'Sanitize HTML before rendering' },
  { pattern: /v-html\s*=/gi, severity: 'warning', category: 'XSS', message: 'Vue v-html directive', fix: 'Use v-text or sanitize HTML' },

  // Hardcoded secrets
  { pattern: /(?:password|secret|api_key|apikey|token|auth)\s*[:=]\s*['"][^'"]{8,}['"]/gi, severity: 'critical', category: 'Hardcoded Secret', message: 'Hardcoded secret/credential', fix: 'Move to environment variables or .env file' },
  { pattern: /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN)\s*=\s*['"][^'"]+/gi, severity: 'critical', category: 'Hardcoded Secret', message: 'Hardcoded cloud/service credential', fix: 'Use environment variables' },

  // Path traversal
  { pattern: /(?:readFile|writeFile|fs\.\w+)\s*\(\s*.*\+.*req\./gi, severity: 'critical', category: 'Path Traversal', message: 'User input in file path', fix: 'Validate and sanitize file paths' },

  // Command injection
  { pattern: /(?:exec|spawn|execSync)\s*\(\s*.*\+.*req\./gi, severity: 'critical', category: 'Command Injection', message: 'User input in shell command', fix: 'Use execFile with arguments array instead' },
  { pattern: /(?:eval|Function)\s*\(/gi, severity: 'warning', category: 'Code Injection', message: 'Use of eval() or Function constructor', fix: 'Avoid eval — use JSON.parse or safe alternatives' },

  // Insecure crypto
  { pattern: /createCipher\s*\(/gi, severity: 'warning', category: 'Weak Crypto', message: 'Insecure createCipher (use createCipheriv)', fix: 'Use createCipheriv with proper IV' },
  { pattern: /md5|sha1(?!\d)/gi, severity: 'info', category: 'Weak Hash', message: 'Weak hash algorithm (MD5/SHA1)', fix: 'Use SHA-256 or stronger' },

  // CORS
  { pattern: /Access-Control-Allow-Origin.*\*/gi, severity: 'warning', category: 'CORS', message: 'Wildcard CORS origin', fix: 'Restrict to specific origins' },

  // Debug in production
  { pattern: /debugger\s*;/gi, severity: 'warning', category: 'Debug Code', message: 'Debugger statement left in code', fix: 'Remove debugger statement' },
  { pattern: /console\.(log|debug|info|warn)\s*\(/gi, severity: 'info', category: 'Console Log', message: 'Console log statement', fix: 'Remove or replace with proper logger' },

  // TODO/FIXME/HACK
  { pattern: /(?:TODO|FIXME|HACK|XXX|BUG)\s*[:=]/gi, severity: 'info', category: 'Code Comment', message: 'Unresolved code comment', fix: 'Address the TODO/FIXME or remove the comment' },

  // Error handling
  { pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g, severity: 'warning', category: 'Error Handling', message: 'Empty catch block', fix: 'Handle the error or log it' },
  { pattern: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, severity: 'warning', category: 'Error Handling', message: 'Empty .catch() handler', fix: 'Handle the error or log it' },

  // Type safety
  { pattern: /as\s+any/g, severity: 'info', category: 'Type Safety', message: 'Type assertion to any', fix: 'Use proper type instead of any' },

  // Dependency issues
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/g, severity: 'info', category: 'Dependency', message: 'Using http module (consider https)', fix: 'Use https for production' },
]

// ─── Code Quality Patterns ───────────────────────────────────────

const QUALITY_PATTERNS: Array<{
  pattern: RegExp
  severity: Severity
  category: string
  message: string
  fix: string
}> = [
  // Long functions (approximate)
  { pattern: /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{2000,}/g, severity: 'info', category: 'Complexity', message: 'Very long function body', fix: 'Consider breaking into smaller functions' },

  // Magic numbers
  { pattern: /(?:^|[=<>+\-*/(,])\s*(?:(?:3[0-9]{2}|[4-9][0-9]{2}|[1-9]\d{3,})\b(?!\.\d))/gm, severity: 'info', category: 'Magic Number', message: 'Magic number without named constant', fix: 'Extract to a named constant' },

  // Duplicated string literals (simplified)
  { pattern: /['"][A-Z][a-zA-Z\s]{20,}['"]/g, severity: 'info', category: 'String Literal', message: 'Long string literal — consider extracting', fix: 'Extract to a constant or i18n key' },

  // Nested callbacks
  { pattern: /function\s*\([^)]*\)\s*\{[\s\S]*function\s*\([^)]*\)\s*\{[\s\S]*function\s*\([^)]*\)\s*\{/g, severity: 'warning', category: 'Callback Hell', message: 'Deeply nested callbacks', fix: 'Use async/await or Promise chains' },

  // Unused variables (simplified)
  { pattern: /(?:const|let|var)\s+\w+\s*=\s*[^;]+;\s*(?:\/\/|$)/gm, severity: 'info', category: 'Unused Code', message: 'Potentially unused variable', fix: 'Remove if unused' },
]

// ─── Review Engine ───────────────────────────────────────────────

/** Review a single file */
export function reviewFile(filePath: string, content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  const lines = content.split('\n')
  const ext = extname(filePath)

  // Security patterns
  for (const { pattern, severity, category, message, fix } of SECURITY_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(content)) !== null) {
      // Find line number
      const lineNum = content.slice(0, match.index).split('\n').length
      const lineContent = lines[lineNum - 1]?.trim() || ''
      findings.push({
        severity,
        category,
        message,
        file: filePath,
        line: lineNum,
        code: lineContent.slice(0, 100),
        fix,
      })
    }
  }

  // Quality patterns
  for (const { pattern, severity, category, message, fix } of QUALITY_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length
      findings.push({
        severity,
        category,
        message,
        file: filePath,
        line: lineNum,
        fix,
      })
    }
  }

  // Language-specific checks
  if (ext === '.ts' || ext === '.tsx') {
    findings.push(...reviewTypeScript(filePath, content))
  } else if (ext === '.py') {
    findings.push(...reviewPython(filePath, content))
  }

  return findings
}

/** TypeScript-specific review */
function reviewTypeScript(filePath: string, content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []

  // Check for `any` type usage
  const anyMatches = content.match(/:\s*any\b/g) || []
  if (anyMatches.length > 5) {
    findings.push({
      severity: 'info',
      category: 'Type Safety',
      message: `${anyMatches.length} uses of 'any' type`,
      file: filePath,
      fix: 'Replace with specific types',
    })
  }

  // Check for non-null assertions
  const nnAsserts = (content.match(/!\./g) || []).length
  if (nnAsserts > 3) {
    findings.push({
      severity: 'info',
      category: 'Type Safety',
      message: `${nnAsserts} non-null assertions (!.)`,
      file: filePath,
      fix: 'Use proper null checks instead of non-null assertions',
    })
  }

  // Check for @ts-ignore
  const tsIgnores = (content.match(/@ts-ignore/g) || []).length
  if (tsIgnores > 0) {
    findings.push({
      severity: 'warning',
      category: 'Type Safety',
      message: `${tsIgnores} @ts-ignore comment(s)`,
      file: filePath,
      fix: 'Fix the type error instead of suppressing it',
    })
  }

  return findings
}

/** Python-specific review */
function reviewPython(filePath: string, content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []

  // Check for bare except
  if (/except\s*:/.test(content)) {
    findings.push({
      severity: 'warning',
      category: 'Error Handling',
      message: 'Bare except clause',
      file: filePath,
      fix: 'Catch specific exceptions instead of bare except',
    })
  }

  // Check for mutable default arguments
  if (/def\s+\w+\([^)]*=\s*(\[\]|\{\}|set\(\))\s*[),]/g.test(content)) {
    findings.push({
      severity: 'warning',
      category: 'Bug Risk',
      message: 'Mutable default argument',
      file: filePath,
      fix: 'Use None as default and initialize inside the function',
    })
  }

  return findings
}

/** Review all changed files in a git repo */
export function reviewChanges(cwd: string): ReviewResult {
  const findings: ReviewFinding[] = []
  let filesReviewed = 0
  let linesReviewed = 0

  // Get changed files
  try {
    const status = execSync('git status --porcelain', {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim()

    if (!status) {
      return { findings: [], score: 100, summary: 'No changes to review', filesReviewed: 0, linesReviewed: 0 }
    }

    const files = status.split('\n').map(line => line.slice(3).trim()).filter(Boolean)

    for (const file of files) {
      const fullPath = resolve(cwd, file)
      if (!existsSync(fullPath)) continue

      // Skip binary files and very large files
      const ext = extname(file)
      const reviewableExts = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
        '.py', '.rs', '.go', '.java', '.kt', '.rb', '.php',
        '.css', '.scss', '.less', '.html', '.vue', '.svelte',
        '.json', '.yaml', '.yml', '.toml', '.sql', '.sh',
      ])
      if (!reviewableExts.has(ext)) continue

      try {
        const content = readFileSync(fullPath, 'utf-8')
        if (content.length > 500000) continue // Skip very large files

        const fileFindings = reviewFile(file, content)
        findings.push(...fileFindings)
        filesReviewed++
        linesReviewed += content.split('\n').length
      } catch { /* skip unreadable files */ }
    }
  } catch {
    return { findings: [], score: 100, summary: 'Not a git repo or no changes', filesReviewed: 0, linesReviewed: 0 }
  }

  // Calculate score
  const criticals = findings.filter(f => f.severity === 'critical').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  const infos = findings.filter(f => f.severity === 'info').length

  let score = 100
  score -= criticals * 15
  score -= warnings * 5
  score -= infos * 1
  score = Math.max(0, Math.min(100, score))

  // Generate summary
  const summaryParts: string[] = []
  if (criticals > 0) summaryParts.push(`🔴 ${criticals} critical`)
  if (warnings > 0) summaryParts.push(`🟡 ${warnings} warning(s)`)
  if (infos > 0) summaryParts.push(`🔵 ${infos} info`)
  if (summaryParts.length === 0) summaryParts.push('✅ No issues found')
  const summary = summaryParts.join(', ') + ` — Score: ${score}/100`

  return { findings, score, summary, filesReviewed, linesReviewed }
}

/** Review a specific file */
export function reviewSpecificFile(filePath: string, content: string): ReviewResult {
  const findings = reviewFile(filePath, content)
  const lines = content.split('\n').length

  const criticals = findings.filter(f => f.severity === 'critical').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  const infos = findings.filter(f => f.severity === 'info').length

  let score = 100
  score -= criticals * 15
  score -= warnings * 5
  score -= infos * 1
  score = Math.max(0, Math.min(100, score))

  const summaryParts: string[] = []
  if (criticals > 0) summaryParts.push(`🔴 ${criticals} critical`)
  if (warnings > 0) summaryParts.push(`🟡 ${warnings} warning(s)`)
  if (infos > 0) summaryParts.push(`🔵 ${infos} info`)
  if (summaryParts.length === 0) summaryParts.push('✅ No issues found')
  const summary = summaryParts.join(', ') + ` — Score: ${score}/100`

  return { findings, score, summary, filesReviewed: 1, linesReviewed: lines }
}

/** Format review findings for display */
export function formatReviewResult(result: ReviewResult): string {
  const lines: string[] = []

  lines.push(`\n${ui.c.bold('🔍 Code Review Results')}`)
  lines.push(ui.c.dim('─'.repeat(50)))
  lines.push(`Files: ${result.filesReviewed} | Lines: ${result.linesReviewed} | Score: ${result.score}/100`)
  lines.push(result.summary)
  lines.push('')

  // Group by severity
  const criticals = result.findings.filter(f => f.severity === 'critical')
  const warnings = result.findings.filter(f => f.severity === 'warning')
  const infos = result.findings.filter(f => f.severity === 'info')

  if (criticals.length > 0) {
    lines.push(ui.c.error('🔴 Critical:'))
    for (const f of criticals.slice(0, 10)) {
      lines.push(`  ${f.file}${f.line ? `:${f.line}` : ''} — ${f.message}`)
      if (f.fix) lines.push(ui.c.dim(`    Fix: ${f.fix}`))
    }
    if (criticals.length > 10) lines.push(ui.c.dim(`  ... and ${criticals.length - 10} more`))
    lines.push('')
  }

  if (warnings.length > 0) {
    lines.push(ui.c.warn('🟡 Warnings:'))
    for (const f of warnings.slice(0, 10)) {
      lines.push(`  ${f.file}${f.line ? `:${f.line}` : ''} — ${f.message}`)
      if (f.fix) lines.push(ui.c.dim(`    Fix: ${f.fix}`))
    }
    if (warnings.length > 10) lines.push(ui.c.dim(`  ... and ${warnings.length - 10} more`))
    lines.push('')
  }

  if (infos.length > 0) {
    lines.push(ui.c.info('🔵 Info:'))
    for (const f of infos.slice(0, 5)) {
      lines.push(`  ${f.file}${f.line ? `:${f.line}` : ''} — ${f.message}`)
    }
    if (infos.length > 5) lines.push(ui.c.dim(`  ... and ${infos.length - 5} more`))
  }

  return lines.join('\n')
}

import * as ui from './ui.js'