import * as ui from './ui.js'
import { createTask, listTasks } from './tasks.js'

/**
 * Cron/Loop System — run prompts on a recurring interval.
 *
 * Usage: /loop 5m "check the build status"
 * This will run the prompt every 5 minutes as a background task.
 */

export interface CronJob {
  id: string
  interval: number  // ms
  prompt: string
  cwd: string
  timer: ReturnType<typeof setInterval> | null
  runCount: number
  maxRuns: number
  createdAt: string
}

const activeJobs = new Map<string, CronJob>()

/** Parse interval string like "5m", "30s", "2h", "1d" */
export function parseInterval(input: string): number | null {
  const match = input.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return null

  const num = parseInt(match[1]!, 10)
  const unit = match[2]!

  switch (unit) {
    case 's': return num * 1000
    case 'm': return num * 60 * 1000
    case 'h': return num * 60 * 60 * 1000
    case 'd': return num * 24 * 60 * 60 * 1000
    default: return null
  }
}

/** Format ms to human-readable */
export function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`
  return `${Math.round(ms / 86400000)}d`
}

/** Create a recurring job */
export function createCronJob(
  interval: number,
  prompt: string,
  cwd: string,
  maxRuns = 100
): CronJob {
  const id = `cron_${Date.now()}`
  const job: CronJob = {
    id,
    interval,
    prompt,
    cwd,
    timer: null,
    runCount: 0,
    maxRuns,
    createdAt: new Date().toISOString(),
  }

  // Run immediately first time
  runCronIteration(job)

  // Then schedule recurring
  job.timer = setInterval(() => {
    if (job.runCount >= job.maxRuns) {
      stopCronJob(job.id)
      console.log(ui.c.dim(`\n  ⏹ Cron ${job.id} reached max runs (${job.maxRuns}). Stopped.`))
      return
    }
    runCronIteration(job)
  }, interval)

  activeJobs.set(id, job)
  return job
}

/** Run a single iteration */
async function runCronIteration(job: CronJob): Promise<void> {
  job.runCount++
  try {
    await createTask(`[Cron #${job.runCount}] ${job.prompt}`, job.cwd)
  } catch {
    // Task creation errors are handled inside createTask
  }
}

/** Stop a cron job */
export function stopCronJob(id: string): boolean {
  const job = activeJobs.get(id)
  if (!job) return false
  if (job.timer) clearInterval(job.timer)
  job.timer = null
  activeJobs.delete(id)
  return true
}

/** List active cron jobs */
export function listCronJobs(): CronJob[] {
  return Array.from(activeJobs.values())
}

/** Stop all cron jobs */
export function stopAllCronJobs(): void {
  for (const [id] of activeJobs) {
    stopCronJob(id)
  }
}

/** Print cron jobs */
export function printCronJobs(): void {
  const jobs = listCronJobs()
  if (jobs.length === 0) {
    console.log(ui.c.dim('  No active cron jobs.'))
    console.log(ui.c.dim('  Usage: /loop <interval> <prompt>'))
    console.log(ui.c.dim('  Example: /loop 5m "check build status"'))
    return
  }

  console.log(ui.c.bold('\n  Active Cron Jobs:'))
  for (const job of jobs) {
    console.log(`    ${ui.c.info(job.id)} every ${ui.c.assistant(formatInterval(job.interval))} — ${ui.c.dim(job.prompt.slice(0, 50))} (${job.runCount} runs)`)
  }
}
