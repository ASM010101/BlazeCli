/**
 * Budget & Token Manager — real-time cost tracking and budget enforcement.
 * 
 * UNIQUE FEATURE: No other AI CLI has real-time budget enforcement.
 * Blaze can:
 * 1. Track token usage across all providers in real-time
 * 2. Set daily/session/project budgets
 * 3. Auto-switch to cheaper models when approaching limits
 * 4. Show cost breakdowns by model, session, and project
 * 5. Alert before budget overruns
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'
import * as ui from './ui.js'

// ─── Types ──────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cost: number
  model: string
  provider: string
  timestamp: string
  sessionId: string
  projectId: string
}

export interface BudgetConfig {
  dailyLimit: number    // $ per day
  sessionLimit: number  // $ per session
  projectLimit: number  // $ per project
  alertThreshold: number // Alert at X% of budget (0-1)
  autoDowngrade: boolean // Auto-switch to cheaper model at threshold
  cheapModel: string     // Model to downgrade to
}

export interface BudgetStatus {
  dailySpent: number
  dailyLimit: number
  sessionSpent: number
  sessionLimit: number
  projectSpent: number
  projectLimit: number
  dailyPercent: number
  sessionPercent: number
  projectPercent: number
  isOverBudget: boolean
  isNearLimit: boolean
}

// ─── Storage ──────────────────────────────────────────────────────

const BUDGET_DIR = resolve(homedir(), '.blaze', 'budget')

function ensureBudgetDir(): void {
  if (!existsSync(BUDGET_DIR)) mkdirSync(BUDGET_DIR, { recursive: true })
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase().slice(0, 60)
}

// ─── Usage Tracking ──────────────────────────────────────────────

/** Record a token usage event */
export function recordUsage(usage: TokenUsage): void {
  ensureBudgetDir()

  // Append to daily log
  const dailyFile = join(BUDGET_DIR, `usage-${todayKey()}.jsonl`)
  const line = JSON.stringify(usage) + '\n'
  writeFileSync(dailyFile, line, { flag: 'a' })

  // Update project totals
  const projectFile = join(BUDGET_DIR, `project-${projectSlug(usage.projectId)}.json`)
  let projectData: { totalCost: number; totalInputTokens: number; totalOutputTokens: number; sessions: string[] } = {
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, sessions: [],
  }
  try {
    if (existsSync(projectFile)) {
      projectData = JSON.parse(readFileSync(projectFile, 'utf-8'))
    }
  } catch { /* start fresh */ }

  projectData.totalCost += usage.cost
  projectData.totalInputTokens += usage.inputTokens
  projectData.totalOutputTokens += usage.outputTokens
  if (!projectData.sessions.includes(usage.sessionId)) {
    projectData.sessions.push(usage.sessionId)
  }
  writeFileSync(projectFile, JSON.stringify(projectData, null, 2), 'utf-8')
}

/** Get today's total spend */
export function getDailySpend(): number {
  const dailyFile = join(BUDGET_DIR, `usage-${todayKey()}.jsonl`)
  if (!existsSync(dailyFile)) return 0

  try {
    const lines = readFileSync(dailyFile, 'utf-8').split('\n').filter(Boolean)
    let total = 0
    for (const line of lines) {
      try {
        const usage = JSON.parse(line) as TokenUsage
        total += usage.cost
      } catch { /* skip */ }
    }
    return total
  } catch {
    return 0
  }
}

/** Get project total spend */
export function getProjectSpend(cwd: string): number {
  const projectFile = join(BUDGET_DIR, `project-${projectSlug(cwd)}.json`)
  if (!existsSync(projectFile)) return 0

  try {
    const data = JSON.parse(readFileSync(projectFile, 'utf-8')) as { totalCost: number }
    return data.totalCost || 0
  } catch {
    return 0
  }
}

/** Get session spend (from current session tracking) */
let currentSessionSpend = 0

export function getSessionSpend(): number {
  return currentSessionSpend
}

export function addToSessionSpend(cost: number): void {
  currentSessionSpend += cost
}

export function resetSessionSpend(): void {
  currentSessionSpend = 0
}

// ─── Budget Enforcement ──────────────────────────────────────────

/** Default budget config */
export function getDefaultBudgetConfig(): BudgetConfig {
  return {
    dailyLimit: 5.0,       // $5/day
    sessionLimit: 2.0,     // $2/session
    projectLimit: 50.0,     // $50/project
    alertThreshold: 0.8,    // Alert at 80%
    autoDowngrade: true,
    cheapModel: 'qwen3.5:cloud', // Free model
  }
}

/** Load budget config from .blazerc */
export function loadBudgetConfig(): BudgetConfig {
  const defaults = getDefaultBudgetConfig()

  // Check for budget config in .blazerc
  try {
    const rcPath = resolve(process.cwd(), '.blazerc')
    if (existsSync(rcPath)) {
      const rc = JSON.parse(readFileSync(rcPath, 'utf-8')) as { budget?: Partial<BudgetConfig> }
      if (rc.budget) {
        return { ...defaults, ...rc.budget }
      }
    }
  } catch { /* use defaults */ }

  return defaults
}

/** Check budget status */
export function checkBudget(cwd: string, config?: BudgetConfig): BudgetStatus {
  const budget = config || loadBudgetConfig()
  const dailySpent = getDailySpend()
  const sessionSpent = getSessionSpend()
  const projectSpent = getProjectSpend(cwd)

  const dailyPercent = budget.dailyLimit > 0 ? dailySpent / budget.dailyLimit : 0
  const sessionPercent = budget.sessionLimit > 0 ? sessionSpent / budget.sessionLimit : 0
  const projectPercent = budget.projectLimit > 0 ? projectSpent / budget.projectLimit : 0

  return {
    dailySpent,
    dailyLimit: budget.dailyLimit,
    sessionSpent,
    sessionLimit: budget.sessionLimit,
    projectSpent,
    projectLimit: budget.projectLimit,
    dailyPercent,
    sessionPercent,
    projectPercent,
    isOverBudget: dailyPercent > 1 || sessionPercent > 1 || projectPercent > 1,
    isNearLimit: dailyPercent > budget.alertThreshold || sessionPercent > budget.alertThreshold,
  }
}

/** Format budget status for display */
export function formatBudgetStatus(status: BudgetStatus): string {
  const lines: string[] = []

  lines.push(ui.c.bold('\n  💰 Budget Status'))
  lines.push(ui.c.dim('  ─────────────────────────────'))

  // Daily
  const dailyBar = budgetBar(status.dailyPercent)
  lines.push(`  Daily:    ${dailyBar} ${ui.c.dim(`$${status.dailySpent.toFixed(3)}/$${status.dailyLimit.toFixed(2)}`)}`)

  // Session
  const sessionBar = budgetBar(status.sessionPercent)
  lines.push(`  Session:  ${sessionBar} ${ui.c.dim(`$${status.sessionSpent.toFixed(3)}/$${status.sessionLimit.toFixed(2)}`)}`)

  // Project
  const projectBar = budgetBar(status.projectPercent)
  lines.push(`  Project:  ${projectBar} ${ui.c.dim(`$${status.projectSpent.toFixed(3)}/$${status.projectLimit.toFixed(2)}`)}`)

  if (status.isOverBudget) {
    lines.push(ui.c.error('  ⚠ OVER BUDGET — consider switching to a free model'))
  } else if (status.isNearLimit) {
    lines.push(ui.c.warn('  ⚠ Approaching budget limit'))
  }

  return lines.join('\n')
}

function budgetBar(percent: number): string {
  const total = 20
  const filled = Math.min(Math.round(percent * total), total)
  const bar = '█'.repeat(filled) + '░'.repeat(total - filled)

  if (percent > 1) return ui.c.error(`[${bar}]`)
  if (percent > 0.8) return ui.c.warn(`[${bar}]`)
  if (percent > 0.5) return ui.c.info(`[${bar}]`)
  return ui.c.success(`[${bar}]`)
}

/** Get usage breakdown by model */
export function getUsageBreakdown(): Array<{ model: string; provider: string; cost: number; inputTokens: number; outputTokens: number; calls: number }> {
  const dailyFile = join(BUDGET_DIR, `usage-${todayKey()}.jsonl`)
  if (!existsSync(dailyFile)) return []

  try {
    const lines = readFileSync(dailyFile, 'utf-8').split('\n').filter(Boolean)
    const byModel = new Map<string, { model: string; provider: string; cost: number; inputTokens: number; outputTokens: number; calls: number }>()

    for (const line of lines) {
      try {
        const usage = JSON.parse(line) as TokenUsage
        const key = `${usage.model}@${usage.provider}`
        const existing = byModel.get(key)
        if (existing) {
          existing.cost += usage.cost
          existing.inputTokens += usage.inputTokens
          existing.outputTokens += usage.outputTokens
          existing.calls++
        } else {
          byModel.set(key, {
            model: usage.model,
            provider: usage.provider,
            cost: usage.cost,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            calls: 1,
          })
        }
      } catch { /* skip */ }
    }

    return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost)
  } catch {
    return []
  }
}

/** Format usage breakdown */
export function formatUsageBreakdown(): string {
  const breakdown = getUsageBreakdown()
  if (breakdown.length === 0) {
    return ui.c.dim('  No usage data for today.')
  }

  const lines: string[] = [ui.c.bold('\n  📊 Usage Breakdown (Today)')]
  lines.push(ui.c.dim('  ─────────────────────────────'))

  for (const entry of breakdown) {
    const costStr = entry.cost < 0.01 ? `${(entry.cost * 100).toFixed(2)}¢` : `$${entry.cost.toFixed(3)}`
    lines.push(`  ${ui.c.info(entry.model.padEnd(30))} ${ui.c.dim(costStr.padStart(8))} ${ui.c.dim(`${entry.calls} calls`)} ${ui.c.dim(`${(entry.inputTokens + entry.outputTokens).toLocaleString()} tokens`)}`)
  }

  const totalCost = breakdown.reduce((sum, e) => sum + e.cost, 0)
  const totalTokens = breakdown.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0)
  lines.push(ui.c.dim(`  ${'─'.repeat(60)}`))
  lines.push(ui.c.dim(`  Total: $${totalCost.toFixed(3)} | ${totalTokens.toLocaleString()} tokens | ${breakdown.reduce((s, e) => s + e.calls, 0)} calls`))

  return lines.join('\n')
}