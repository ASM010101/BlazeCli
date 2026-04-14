/**
 * Pipeline System — define and run multi-step workflows.
 * 
 * UNIQUE FEATURE: No other AI CLI has declarative pipelines.
 * Instead of one-shot prompts, define reusable workflows:
 * 
 * Example (.blaze/pipelines/deploy.md):
 *   ---
 *   name: deploy
 *   description: Build, test, and deploy
 *   steps:
 *     - name: Lint
 *       prompt: Run the linter and fix any issues
 *     - name: Test
 *       prompt: Run all tests and fix failures
 *     - name: Build
 *       prompt: Build the project and verify no errors
 *     - name: Deploy
 *       prompt: Deploy to staging using the deploy script
 *   ---
 * 
 * Then: /deploy or /pipeline deploy
 */

import { Agent } from './agent.js'
import * as ui from './ui.js'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, join, basename } from 'path'
import { homedir } from 'os'

// ─── Types ──────────────────────────────────────────────────────

export interface PipelineStep {
  name: string
  prompt: string
  condition?: 'always' | 'on_success' | 'on_failure'
  timeout?: number  // seconds
}

export interface Pipeline {
  name: string
  description: string
  steps: PipelineStep[]
  source: 'project' | 'global'
  path: string
}

export interface PipelineRunResult {
  pipeline: string
  steps: Array<{
    name: string
    status: 'success' | 'failed' | 'skipped'
    duration: number
    output?: string
  }>
  totalDuration: number
  success: boolean
}

// ─── Pipeline Loading ────────────────────────────────────────────

/** Load all available pipelines */
export function loadPipelines(cwd: string): Pipeline[] {
  const pipelines: Pipeline[] = []
  const seen = new Set<string>()

  // Project pipelines
  const projectDir = resolve(cwd, '.blaze', 'pipelines')
  if (existsSync(projectDir)) {
    for (const p of loadPipelinesFromDir(projectDir, 'project')) {
      if (!seen.has(p.name)) {
        pipelines.push(p)
        seen.add(p.name)
      }
    }
  }

  // Global pipelines
  const globalDir = resolve(homedir(), '.blaze', 'pipelines')
  if (existsSync(globalDir)) {
    for (const p of loadPipelinesFromDir(globalDir, 'global')) {
      if (!seen.has(p.name)) {
        pipelines.push(p)
        seen.add(p.name)
      }
    }
  }

  return pipelines
}

function loadPipelinesFromDir(dir: string, source: 'project' | 'global'): Pipeline[] {
  const pipelines: Pipeline[] = []

  try {
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml'))
    for (const file of files) {
      const path = join(dir, file)
      try {
        const content = readFileSync(path, 'utf-8')
        const pipeline = parsePipelineFile(content, file, source, path)
        if (pipeline) pipelines.push(pipeline)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return pipelines
}

function parsePipelineFile(content: string, filename: string, source: 'project' | 'global', path: string): Pipeline | null {
  const defaultName = basename(filename, filename.endsWith('.md') ? '.md' : filename.endsWith('.yaml') ? '.yaml' : '.yml')

  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3)
    if (endIdx !== -1) {
      const frontmatter = content.slice(3, endIdx).trim()
      const body = content.slice(endIdx + 3).trim()

      // Parse frontmatter
      const meta: Record<string, string> = {}
      for (const line of frontmatter.split('\n')) {
        const idx = line.indexOf(':')
        if (idx > 0) {
          meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
        }
      }

      // Parse steps from body
      const steps = parseSteps(body)

      return {
        name: meta.name || defaultName,
        description: meta.description || '',
        steps,
        source,
        path,
      }
    }
  }

  // No frontmatter — treat entire content as a single step
  return {
    name: defaultName,
    description: '',
    steps: [{ name: defaultName, prompt: content.trim() }],
    source,
    path,
  }
}

/** Parse steps from markdown body */
function parseSteps(body: string): PipelineStep[] {
  const steps: PipelineStep[] = []

  // Try to parse numbered or bulleted steps
  const lines = body.split('\n')
  let currentStep: Partial<PipelineStep> | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Match step headers: "1. Name:" or "- Name:" or "## Name"
    const stepMatch = trimmed.match(/^(?:\d+\.\s*|-\s*|##\s*)(.+?)(?:\s*[:—-]\s*(.*))?$/)
    if (stepMatch) {
      if (currentStep?.name && currentStep?.prompt) {
        steps.push(currentStep as PipelineStep)
      }
      currentStep = {
        name: stepMatch[1]!.trim(),
        prompt: stepMatch[2]?.trim() || '',
      }
      continue
    }

    // If we have a current step, append the line as prompt content
    if (currentStep && trimmed) {
      if (currentStep.prompt) {
        currentStep.prompt += '\n' + trimmed
      } else {
        currentStep.prompt = trimmed
      }
    }
  }

  // Don't forget the last step
  if (currentStep?.name && currentStep?.prompt) {
    steps.push(currentStep as PipelineStep)
  }

  // If no steps parsed, treat the whole body as one step
  if (steps.length === 0 && body.trim()) {
    steps.push({ name: 'Run', prompt: body.trim() })
  }

  return steps
}

/** Find a specific pipeline by name */
export function findPipeline(cwd: string, name: string): Pipeline | null {
  const pipelines = loadPipelines(cwd)
  return pipelines.find(p => p.name === name) || null
}

// ─── Pipeline Execution ──────────────────────────────────────────

/** Run a pipeline */
export async function runPipeline(
  agent: Agent,
  pipeline: Pipeline
): Promise<PipelineRunResult> {
  const results: PipelineRunResult = {
    pipeline: pipeline.name,
    steps: [],
    totalDuration: 0,
    success: true,
  }

  const startTime = Date.now()

  console.log(ui.c.bold(`\n  🚀 Pipeline: ${pipeline.name}`))
  if (pipeline.description) {
    console.log(ui.c.dim(`     ${pipeline.description}`))
  }
  console.log(ui.c.dim(`     ${pipeline.steps.length} steps`))
  console.log()

  let previousSuccess = true

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i]!
    const stepStart = Date.now()

    // Check condition
    if (step.condition === 'on_success' && !previousSuccess) {
      results.steps.push({ name: step.name, status: 'skipped', duration: 0 })
      console.log(ui.c.dim(`  ⏭️  Step ${i + 1}/${pipeline.steps.length}: ${step.name} — SKIPPED (previous failed)`))
      continue
    }

    if (step.condition === 'on_failure' && previousSuccess) {
      results.steps.push({ name: step.name, status: 'skipped', duration: 0 })
      console.log(ui.c.dim(`  ⏭️  Step ${i + 1}/${pipeline.steps.length}: ${step.name} — SKIPPED (no failure)`))
      continue
    }

    console.log(ui.c.info(`  📋 Step ${i + 1}/${pipeline.steps.length}: ${step.name}`))

    try {
      const output = await agent.run(step.prompt)
      const duration = Date.now() - stepStart

      results.steps.push({
        name: step.name,
        status: 'success',
        duration,
        output: output?.slice(0, 200),
      })

      console.log(ui.c.success(`  ✓ ${step.name} (${(duration / 1000).toFixed(1)}s)`))
      previousSuccess = true
    } catch (err: unknown) {
      const duration = Date.now() - stepStart
      const errorMsg = (err as Error).message

      results.steps.push({
        name: step.name,
        status: 'failed',
        duration,
        output: errorMsg,
      })

      console.log(ui.c.error(`  ✗ ${step.name} — FAILED: ${errorMsg.slice(0, 100)}`))
      previousSuccess = false
      results.success = false

      // Stop on failure unless condition says otherwise
      if (!pipeline.steps.slice(i + 1).some(s => s.condition === 'on_failure')) {
        break
      }
    }
  }

  results.totalDuration = Date.now() - startTime

  // Print summary
  console.log()
  console.log(ui.c.bold('  📊 Pipeline Summary:'))
  console.log(ui.c.dim('  ─────────────────────────────'))
  for (const step of results.steps) {
    const icon = step.status === 'success' ? ui.c.success('✓') :
                 step.status === 'failed' ? ui.c.error('✗') :
                 ui.c.dim('⏭️')
    console.log(`  ${icon} ${step.name} — ${step.status} (${(step.duration / 1000).toFixed(1)}s)`)
  }
  console.log(ui.c.dim(`  Total: ${(results.totalDuration / 1000).toFixed(1)}s`))

  return results
}

// ─── Pipeline Init ───────────────────────────────────────────────

/** Create example pipelines */
export function initPipelines(cwd: string): string {
  const dir = resolve(cwd, '.blaze', 'pipelines')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const examples: Array<{ file: string; content: string }> = [
    {
      file: 'ship.md',
      content: `---
name: ship
description: Full ship pipeline — lint, test, build, deploy
---

1. Lint: Run the linter and fix any issues automatically
2. Test: Run all tests. If any fail, fix the code and re-run
3. Build: Build the project for production. Fix any build errors
4. Deploy: Deploy to the staging environment using the deploy script
`,
    },
    {
      file: 'check.md',
      content: `---
name: check
description: Quick health check — lint and test
---

1. Lint: Run the linter and report any issues
2. Type Check: Run TypeScript type checking and report errors
3. Test: Run all tests and report results
`,
    },
    {
      file: 'fix.md',
      content: `---
name: fix
description: Auto-fix all issues — lint, format, test
---

1. Format: Run the code formatter on all files
2. Lint Fix: Run the linter with --fix flag
3. Test: Run all tests and fix any failures
4. Verify: Run a full build to verify everything works
`,
    },
  ]

  let created = 0
  for (const ex of examples) {
    const path = join(dir, ex.file)
    if (!existsSync(path)) {
      writeFileSync(path, ex.content, 'utf-8')
      created++
    }
  }

  return `Created ${created} example pipeline(s) in ${dir}`
}