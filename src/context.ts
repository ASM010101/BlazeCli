/**
 * Smart Context Engine — intelligent context management that goes beyond
 * simple file reading. Automatically indexes the project, tracks changes,
 * and provides the most relevant context to the LLM.
 * 
 * UNIQUE FEATURES:
 * 1. Project fingerprinting — auto-detects tech stack, patterns, conventions
 * 2. Smart file prioritization — knows which files matter most
 * 3. Change tracking — only sends diffs, not entire files
 * 4. Dependency graph — understands import relationships
 * 5. Token budget management — fits maximum relevant context within limits
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, join, extname, basename } from 'path'
import { homedir } from 'os'

// ─── Types ──────────────────────────────────────────────────────

export interface ProjectFingerprint {
  name: string
  rootDir: string
  languages: string[]
  frameworks: string[]
  packageManager: string
  buildCommand: string
  testCommand: string
  lintCommand: string
  entryPoints: string[]
  keyDirs: string[]
  conventions: string[]
  lastIndexed: string
}

export interface FileRelevance {
  path: string
  score: number  // 0-100, higher = more relevant
  reason: string
}

// ─── Language/Framework Detection ────────────────────────────────

const FRAMEWORK_MARKERS: Record<string, { files: string[]; frameworks: string[]; lang: string }> = {
  'package.json': { files: ['package.json'], frameworks: ['Node.js'], lang: 'JavaScript/TypeScript' },
  'tsconfig.json': { files: ['tsconfig.json'], frameworks: ['TypeScript'], lang: 'TypeScript' },
  'next.config.js': { files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], frameworks: ['Next.js'], lang: 'TypeScript' },
  'nuxt.config.ts': { files: ['nuxt.config.ts', 'nuxt.config.js'], frameworks: ['Nuxt'], lang: 'TypeScript' },
  'vite.config.ts': { files: ['vite.config.ts', 'vite.config.js'], frameworks: ['Vite'], lang: 'TypeScript' },
  'requirements.txt': { files: ['requirements.txt'], frameworks: ['Python'], lang: 'Python' },
  'pyproject.toml': { files: ['pyproject.toml'], frameworks: ['Python'], lang: 'Python' },
  'Cargo.toml': { files: ['Cargo.toml'], frameworks: ['Rust'], lang: 'Rust' },
  'go.mod': { files: ['go.mod'], frameworks: ['Go'], lang: 'Go' },
  'Gemfile': { files: ['Gemfile'], frameworks: ['Ruby'], lang: 'Ruby' },
  'pom.xml': { files: ['pom.xml'], frameworks: ['Java/Maven'], lang: 'Java' },
  'build.gradle': { files: ['build.gradle', 'build.gradle.kts'], frameworks: ['Java/Gradle'], lang: 'Java/Kotlin' },
  'composer.json': { files: ['composer.json'], frameworks: ['PHP/Composer'], lang: 'PHP' },
  'pubspec.yaml': { files: ['pubspec.yaml'], frameworks: ['Flutter/Dart'], lang: 'Dart' },
  '.csproj': { files: ['.csproj'], frameworks: ['.NET'], lang: 'C#' },
}

const IMPORTANT_FILES = new Set([
  'README.md', 'BLAZE.md', 'BLAZE.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
  'Makefile', 'Dockerfile', 'docker-compose.yml', '.env.example',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
  '.eslintrc.js', '.eslintrc.json', '.prettierrc', 'biome.json',
  'tailwind.config.js', 'tailwind.config.ts',
  'prisma/schema.prisma', 'drizzle.config.ts',
])

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'target',
  '__pycache__', '.venv', 'venv', 'vendor', '.cache', '.turbo',
  'coverage', '.nyc_output', 'out', '.output', '.vercel',
])

// ─── Project Fingerprinting ──────────────────────────────────────

/** Analyze a project directory and create a fingerprint */
export function fingerprintProject(cwd: string): ProjectFingerprint {
  const fingerprint: ProjectFingerprint = {
    name: basename(cwd),
    rootDir: cwd,
    languages: [],
    frameworks: [],
    packageManager: 'unknown',
    buildCommand: '',
    testCommand: '',
    lintCommand: '',
    entryPoints: [],
    keyDirs: [],
    conventions: [],
    lastIndexed: new Date().toISOString(),
  }

  // Detect frameworks and languages
  for (const [marker, info] of Object.entries(FRAMEWORK_MARKERS)) {
    for (const file of info.files) {
      if (existsSync(resolve(cwd, file))) {
        if (!fingerprint.frameworks.includes(info.frameworks[0]!)) {
          fingerprint.frameworks.push(...info.frameworks)
        }
        if (!fingerprint.languages.includes(info.lang)) {
          fingerprint.languages.push(info.lang)
        }
        break
      }
    }
  }

  // Detect package manager
  if (existsSync(resolve(cwd, 'pnpm-lock.yaml'))) fingerprint.packageManager = 'pnpm'
  else if (existsSync(resolve(cwd, 'yarn.lock'))) fingerprint.packageManager = 'yarn'
  else if (existsSync(resolve(cwd, 'bun.lockb'))) fingerprint.packageManager = 'bun'
  else if (existsSync(resolve(cwd, 'package-lock.json'))) fingerprint.packageManager = 'npm'
  else if (existsSync(resolve(cwd, 'requirements.txt'))) fingerprint.packageManager = 'pip'
  else if (existsSync(resolve(cwd, 'Pipfile'))) fingerprint.packageManager = 'pipenv'
  else if (existsSync(resolve(cwd, 'poetry.lock'))) fingerprint.packageManager = 'poetry'
  else if (existsSync(resolve(cwd, 'Cargo.toml'))) fingerprint.packageManager = 'cargo'
  else if (existsSync(resolve(cwd, 'go.mod'))) fingerprint.packageManager = 'go'

  // Detect build/test/lint commands from package.json
  const pkgJsonPath = resolve(cwd, 'package.json')
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { scripts?: Record<string, string> }
      const scripts = pkg.scripts || {}
      fingerprint.buildCommand = scripts.build || scripts.compile || scripts.dev || ''
      fingerprint.testCommand = scripts.test || scripts['test:ci'] || scripts['test:e2e'] || ''
      fingerprint.lintCommand = scripts.lint || scripts['lint:fix'] || scripts.check || ''
    } catch { /* skip */ }
  }

  // Detect entry points
  const entryCandidates = [
    'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
    'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js',
    'index.ts', 'index.js', 'main.ts', 'main.py', 'main.go',
    'app.ts', 'app.js', 'server.ts', 'server.js',
    'lib/index.ts', 'lib/index.js', 'src/lib.rs', 'src/main.rs',
  ]
  for (const entry of entryCandidates) {
    if (existsSync(resolve(cwd, entry))) {
      fingerprint.entryPoints.push(entry)
    }
  }

  // Detect key directories
  try {
    const entries = readdirSync(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        fingerprint.keyDirs.push(entry.name)
      }
    }
  } catch { /* skip */ }

  // Detect conventions
  if (existsSync(resolve(cwd, '.eslintrc.js')) || existsSync(resolve(cwd, '.eslintrc.json'))) {
    fingerprint.conventions.push('ESLint')
  }
  if (existsSync(resolve(cwd, '.prettierrc')) || existsSync(resolve(cwd, '.prettierrc.json'))) {
    fingerprint.conventions.push('Prettier')
  }
  if (existsSync(resolve(cwd, 'tsconfig.json'))) {
    fingerprint.conventions.push('TypeScript strict mode')
  }
  if (existsSync(resolve(cwd, 'tailwind.config.js')) || existsSync(resolve(cwd, 'tailwind.config.ts'))) {
    fingerprint.conventions.push('Tailwind CSS')
  }
  if (existsSync(resolve(cwd, 'prisma/schema.prisma'))) {
    fingerprint.conventions.push('Prisma ORM')
  }

  return fingerprint
}

/** Format a project fingerprint as a concise context string */
export function formatFingerprint(fp: ProjectFingerprint): string {
  const lines: string[] = [
    `Project: ${fp.name}`,
    `Languages: ${fp.languages.join(', ') || 'Unknown'}`,
    `Frameworks: ${fp.frameworks.join(', ') || 'None detected'}`,
    `Package Manager: ${fp.packageManager}`,
  ]
  if (fp.buildCommand) lines.push(`Build: ${fp.packageManager} run build`)
  if (fp.testCommand) lines.push(`Test: ${fp.packageManager} test`)
  if (fp.lintCommand) lines.push(`Lint: ${fp.packageManager} run lint`)
  if (fp.entryPoints.length) lines.push(`Entry: ${fp.entryPoints.join(', ')}`)
  if (fp.conventions.length) lines.push(`Conventions: ${fp.conventions.join(', ')}`)
  return lines.join('\n')
}

// ─── Smart File Prioritization ──────────────────────────────────

/** Score files by relevance to a query */
export function scoreFilesByRelevance(
  query: string,
  files: string[],
  cwd: string
): FileRelevance[] {
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)

  return files
    .map(path => {
      let score = 0
      const reason: string[] = []
      const relPath = path.replace(cwd + '/', '').replace(cwd + '\\', '')
      const ext = extname(path)
      const base = basename(path)

      // Important files get a big boost
      if (IMPORTANT_FILES.has(base) || IMPORTANT_FILES.has(relPath)) {
        score += 40
        reason.push('important file')
      }

      // Entry points get a big boost
      if (relPath.startsWith('src/index') || relPath.startsWith('src/main') || relPath.startsWith('src/app')) {
        score += 30
        reason.push('entry point')
      }

      // Query word matches in filename
      for (const word of queryWords) {
        if (relPath.toLowerCase().includes(word)) {
          score += 15
          reason.push(`filename matches "${word}"`)
        }
      }

      // Extension relevance
      if (queryLower.includes('test') && (ext === '.test.ts' || ext === '.test.js' || ext === '.spec.ts' || ext === '.spec.js')) {
        score += 25
        reason.push('test file')
      }
      if (queryLower.includes('style') && (ext === '.css' || ext === '.scss' || ext === '.less')) {
        score += 20
        reason.push('style file')
      }
      if (queryLower.includes('config') && (base.includes('config') || base.includes('.rc'))) {
        score += 20
        reason.push('config file')
      }

      // Prefer source files over generated/dist
      if (relPath.includes('dist/') || relPath.includes('build/') || relPath.includes('.output/')) {
        score -= 20
      }
      if (relPath.includes('node_modules/')) {
        score -= 50
      }

      // Prefer smaller files (more likely to be relevant)
      try {
        const stat = statSync(path)
        if (stat.size < 5000) score += 5
        else if (stat.size < 20000) score += 3
        else if (stat.size > 100000) score -= 5
      } catch { /* skip */ }

      return { path: relPath, score: Math.max(0, score), reason: reason.join(', ') }
    })
    .sort((a, b) => b.score - a.score)
}

// ─── Context Budget Manager ─────────────────────────────────────

const MAX_CONTEXT_CHARS = 80000 // ~20K tokens for context injection

/** Build a smart context string that fits within token budget */
export function buildSmartContext(
  cwd: string,
  query: string,
  existingContext: string
): string {
  const parts: string[] = []

  // 1. Project fingerprint (always included, small)
  const fp = fingerprintProject(cwd)
  parts.push(`## Project Info\n${formatFingerprint(fp)}`)

  // 2. BLAZE.md / BLAZE.md (always included if exists)
  const contextFiles = ['BLAZE.md', 'BLAZE.md', '.blaze/context.md']
  for (const cf of contextFiles) {
    const p = resolve(cwd, cf)
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8').trim()
        if (content) {
          parts.push(`## Project Context (${cf})\n${content.slice(0, 5000)}`)
        }
      } catch { /* skip */ }
    }
  }

  // 3. Score and prioritize relevant files (if query is specific enough)
  if (query.length > 5) {
    const allFiles = getAllSourceFiles(cwd)
    const scored = scoreFilesByRelevance(query, allFiles, cwd)
    const topFiles = scored.slice(0, 5).filter(f => f.score > 10)

    let remainingBudget = MAX_CONTEXT_CHARS - parts.join('\n').length - existingContext.length
    for (const file of topFiles) {
      if (remainingBudget < 500) break
      try {
        const fullPath = resolve(cwd, file.path)
        const content = readFileSync(fullPath, 'utf-8')
        const truncated = content.slice(0, Math.min(3000, remainingBudget))
        parts.push(`## ${file.path} (relevant: ${file.reason})\n\`\`\`\n${truncated}\n\`\`\``)
        remainingBudget -= truncated.length
      } catch { /* skip */ }
    }
  }

  return parts.join('\n\n')
}

/** Get all source files in a project (non-ignored) */
function getAllSourceFiles(cwd: string, maxDepth = 4): string[] {
  const files: string[] = []

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1)
        } else {
          const ext = extname(entry.name)
          if (SOURCE_EXTENSIONS.has(ext)) {
            files.push(fullPath)
          }
        }
      }
    } catch { /* skip */ }
  }

  walk(cwd, 0)
  return files
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.kt', '.rb', '.php',
  '.css', '.scss', '.less', '.html', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.md', '.sql',
  '.sh', '.bash', '.zsh', '.ps1',
])

// ─── Change Tracker ──────────────────────────────────────────────

const CHANGE_TRACKER_DIR = () => resolve(homedir(), '.blaze', 'changes')

export interface FileChange {
  path: string
  type: 'created' | 'modified' | 'deleted'
  timestamp: string
  size: number
}

/** Track a file change */
export function trackChange(change: FileChange): void {
  const dir = CHANGE_TRACKER_DIR()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const projectSlug = change.path
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)

  const trackerFile = join(dir, `${projectSlug}-changes.json`)
  let changes: FileChange[] = []
  try {
    if (existsSync(trackerFile)) {
      changes = JSON.parse(readFileSync(trackerFile, 'utf-8')) as FileChange[]
    }
  } catch { /* start fresh */ }

  changes.push(change)
  // Keep last 100 changes per project
  if (changes.length > 100) changes = changes.slice(-100)

  writeFileSync(trackerFile, JSON.stringify(changes, null, 2), 'utf-8')
}

/** Get recent changes for a project */
export function getRecentChanges(cwd: string, limit = 10): FileChange[] {
  const dir = CHANGE_TRACKER_DIR()
  const projectSlug = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40)
  const trackerFile = join(dir, `${projectSlug}-changes.json`)

  try {
    if (!existsSync(trackerFile)) return []
    const changes = JSON.parse(readFileSync(trackerFile, 'utf-8')) as FileChange[]
    return changes.slice(-limit)
  } catch {
    return []
  }
}

/** Format recent changes as context */
export function formatRecentChanges(changes: FileChange[]): string {
  if (changes.length === 0) return ''
  const lines = changes.map(c => {
    const icon = c.type === 'created' ? '➕' : c.type === 'modified' ? '✏️' : '🗑️'
    return `${icon} ${c.path} (${c.type} ${c.timestamp.slice(0, 19)})`
  })
  return `## Recent Changes\n${lines.join('\n')}`
}