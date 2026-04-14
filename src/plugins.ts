import * as ui from './ui.js'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'

/**
 * Plugin Registry — Discover and install community plugins.
 *
 * Plugins are skill files (.md) with tools, prompts, and automation.
 * The registry is a built-in curated list (no remote server needed).
 * Installing a plugin downloads its skill file to .blaze/plugins/.
 */

export interface Plugin {
  name: string
  description: string
  category: string
  version: string
  author: string
  skillContent: string  // The .md skill file content
}

// ─── Built-in Plugin Registry ────────────────────────────────────

const REGISTRY: Plugin[] = [
  {
    name: 'git-flow',
    description: 'Advanced git workflows: squash, rebase, cherry-pick, bisect',
    category: 'Git',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: git-flow
description: Advanced git workflow automation
---
You are a git expert. Help the user with advanced git operations.
Available operations:
- Squash last N commits: git rebase -i HEAD~N
- Cherry-pick: git cherry-pick <hash>
- Bisect: git bisect start, git bisect good/bad
- Interactive rebase with conflict resolution
- Branch cleanup: delete merged branches
Ask the user what they want to do and execute it step by step.`,
  },
  {
    name: 'docker',
    description: 'Docker management: build, run, compose, debug containers',
    category: 'DevOps',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: docker
description: Docker container management and debugging
---
You are a Docker expert. Help with:
- Building Dockerfiles (write optimized multi-stage builds)
- docker-compose setup and management
- Debugging container issues (logs, exec, inspect)
- Docker networking and volume management
- Container health checks and resource limits
Always use best practices: non-root user, .dockerignore, layer caching.`,
  },
  {
    name: 'testing',
    description: 'Test generation: unit tests, integration tests, mocks, coverage',
    category: 'Testing',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: testing
description: Generate comprehensive tests for your code
---
You are a testing expert. When invoked:
1. Analyze the project's testing setup (Jest, Vitest, pytest, etc.)
2. Read the source files the user wants tested
3. Generate comprehensive tests including:
   - Unit tests for each function
   - Edge cases and boundary conditions
   - Mock setup for external dependencies
   - Integration tests for API endpoints
4. Run the tests and fix any failures
5. Report coverage if possible
Use the project's existing test patterns and conventions.`,
  },
  {
    name: 'docs',
    description: 'Auto-generate documentation: JSDoc, README, API docs, changelogs',
    category: 'Documentation',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: docs
description: Generate and update project documentation
---
You are a documentation specialist. When invoked:
1. Analyze the codebase structure
2. Generate/update documentation:
   - JSDoc/TSDoc comments for functions
   - README.md sections
   - API documentation
   - CHANGELOG.md entries
   - Architecture diagrams (mermaid)
3. Follow the project's existing documentation style
4. Keep docs concise and accurate
Ask the user what kind of documentation they need.`,
  },
  {
    name: 'refactor',
    description: 'Code refactoring: extract functions, rename, reorganize, optimize',
    category: 'Code Quality',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: refactor
description: Intelligent code refactoring
---
You are a refactoring expert. When invoked:
1. Read the code the user wants refactored
2. Identify opportunities:
   - Extract repeated code into functions
   - Rename unclear variables/functions
   - Reduce cyclomatic complexity
   - Apply SOLID principles
   - Remove dead code
   - Optimize imports
3. Make surgical edits using FileEdit
4. Verify changes don't break functionality
5. Run tests if available
Always explain WHY each refactoring improves the code.`,
  },
  {
    name: 'api-builder',
    description: 'Build REST/GraphQL APIs: routes, validation, auth, docs',
    category: 'Backend',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: api-builder
description: Build production-ready APIs
---
You are an API architecture expert. When invoked:
1. Ask the user what API they need
2. Detect the project's framework (Express, Fastify, Django, etc.)
3. Generate:
   - Route handlers with proper HTTP methods
   - Input validation (Zod, Joi, or framework-native)
   - Error handling middleware
   - Authentication middleware (JWT, API keys)
   - Rate limiting
   - OpenAPI/Swagger documentation
4. Create corresponding tests
5. Wire everything up into the existing project structure`,
  },
  {
    name: 'database',
    description: 'Database management: migrations, queries, schema design, optimization',
    category: 'Backend',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: database
description: Database schema design and management
---
You are a database expert. When invoked, help with:
- Schema design (normalize, denormalize, indexes)
- Migration generation (Prisma, Drizzle, Knex, Alembic)
- Query optimization (explain plans, index suggestions)
- Seed data generation
- Database backup/restore scripts
Detect the project's ORM and use its conventions.`,
  },
  {
    name: 'security-audit',
    description: 'Deep security audit: OWASP Top 10, dependency scan, secrets detection',
    category: 'Security',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: security-audit
description: Comprehensive security audit
---
You are a security auditor. Perform a deep audit:
1. Run /scan for pattern-based detection
2. Check for OWASP Top 10 vulnerabilities
3. Audit dependencies (npm audit / pip audit / cargo audit)
4. Scan for hardcoded secrets and credentials
5. Check authentication and authorization patterns
6. Review input validation and sanitization
7. Check CORS, CSP, and security headers
8. Generate a detailed report with severity levels and fixes
Present findings as: 🔴 Critical, 🟡 Warning, 🔵 Info`,
  },
  {
    name: 'deploy',
    description: 'Deployment automation: Vercel, Railway, AWS, Docker, GitHub Actions',
    category: 'DevOps',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: deploy
description: Deployment setup and automation
---
You are a DevOps expert. Help deploy the project to:
- Vercel (Next.js, static sites)
- Railway (Node.js, Python, Go)
- AWS (EC2, ECS, Lambda)
- Docker + docker-compose
- GitHub Actions CI/CD
Detect the project type and suggest the best platform.
Generate all necessary config files (Dockerfile, vercel.json, etc.)
Set up environment variable management.`,
  },
  {
    name: 'perf',
    description: 'Performance optimization: profiling, bundle analysis, caching, lazy loading',
    category: 'Performance',
    version: '1.0.0',
    author: 'blaze-community',
    skillContent: `---
name: perf
description: Performance analysis and optimization
---
You are a performance specialist. When invoked:
1. Identify performance bottlenecks:
   - Bundle size analysis (webpack-bundle-analyzer, etc.)
   - N+1 queries in database code
   - Unnecessary re-renders in React/Vue
   - Memory leaks
   - Slow imports
2. Implement optimizations:
   - Code splitting and lazy loading
   - Caching strategies (Redis, in-memory, HTTP)
   - Database query optimization
   - Image optimization
3. Measure before/after impact`,
  },
]

// ─── Plugin Management ─────────────────────────────────────────

function getPluginDir(cwd: string): string {
  return resolve(cwd, '.blaze', 'plugins')
}

function getGlobalPluginDir(): string {
  return resolve(homedir(), '.blaze', 'plugins')
}

/** List available plugins from the registry */
export function listRegistryPlugins(searchQuery?: string): Plugin[] {
  if (!searchQuery) return REGISTRY
  const q = searchQuery.toLowerCase()
  return REGISTRY.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q)
  )
}

/** Check if a plugin is installed */
export function isPluginInstalled(cwd: string, name: string): boolean {
  const projectPath = join(getPluginDir(cwd), `${name}.md`)
  const globalPath = join(getGlobalPluginDir(), `${name}.md`)
  return existsSync(projectPath) || existsSync(globalPath)
}

/** Install a plugin */
export function installPlugin(cwd: string, name: string, global = false): string | null {
  const plugin = REGISTRY.find(p => p.name === name)
  if (!plugin) return null

  const dir = global ? getGlobalPluginDir() : getPluginDir(cwd)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const filePath = join(dir, `${name}.md`)
  writeFileSync(filePath, plugin.skillContent, 'utf-8')
  return filePath
}

/** Uninstall a plugin */
export function uninstallPlugin(cwd: string, name: string): boolean {
  const paths = [
    join(getPluginDir(cwd), `${name}.md`),
    join(getGlobalPluginDir(), `${name}.md`),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      const { unlinkSync } = require('fs')
      unlinkSync(p)
      return true
    }
  }
  return false
}

/** Get list of installed plugins */
export function getInstalledPlugins(cwd: string): string[] {
  const installed: string[] = []
  const dirs = [getPluginDir(cwd), getGlobalPluginDir()]
  for (const dir of dirs) {
    if (existsSync(dir)) {
      try {
        const { readdirSync } = require('fs')
        const files = readdirSync(dir) as string[]
        for (const f of files) {
          if (f.endsWith('.md')) installed.push(f.replace('.md', ''))
        }
      } catch { /* skip */ }
    }
  }
  return [...new Set(installed)]
}

/** Format plugin list for display */
export function formatPluginList(plugins: Plugin[], cwd: string): string {
  const categories = new Map<string, Plugin[]>()
  for (const p of plugins) {
    if (!categories.has(p.category)) categories.set(p.category, [])
    categories.get(p.category)!.push(p)
  }

  const lines: string[] = [
    '',
    ui.c.bold('  🔌 Plugin Registry'),
    ui.c.dim('  ─────────────────────────────────────────'),
    '',
  ]

  for (const [category, catPlugins] of categories) {
    lines.push(ui.c.bold(`  ${category}:`))
    for (const p of catPlugins) {
      const installed = isPluginInstalled(cwd, p.name)
      const status = installed ? ui.c.success(' ✓ installed') : ''
      lines.push(`    ${ui.c.info(`/${p.name}`.padEnd(20))} ${ui.c.dim(p.description)}${status}`)
    }
    lines.push('')
  }

  lines.push(ui.c.dim('  Commands:'))
  lines.push(ui.c.dim('    /plugins install <name>    Install a plugin'))
  lines.push(ui.c.dim('    /plugins remove <name>     Remove a plugin'))
  lines.push(ui.c.dim('    /plugins search <query>    Search plugins'))
  lines.push('')

  return lines.join('\n')
}
