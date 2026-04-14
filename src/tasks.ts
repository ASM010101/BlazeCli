import { Agent } from './agent.js'
import { getConfig } from './types.js'
import * as ui from './ui.js'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'

/**
 * Background Task System — run agents in background.
 *
 * Tasks run as child agent instances that execute independently.
 * Results are stored on disk and can be checked later.
 */

export interface Task {
  id: string
  prompt: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  createdAt: string
  completedAt?: string
  cwd: string
  model: string
  result?: string
  error?: string
  toolCalls: number
}

const TASKS_DIR = resolve(homedir(), '.blaze', 'tasks')

function ensureTasksDir(): void {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true })
  }
}

function taskPath(id: string): string {
  return join(TASKS_DIR, `${id}.json`)
}

function saveTask(task: Task): void {
  ensureTasksDir()
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2), 'utf-8')
}

function loadTask(id: string): Task | null {
  const path = taskPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Task
  } catch {
    return null
  }
}

/** Create and start a background task */
export async function createTask(prompt: string, cwd: string): Promise<Task> {
  const config = getConfig()
  const id = `task_${Date.now()}`

  const task: Task = {
    id,
    prompt,
    status: 'running',
    createdAt: new Date().toISOString(),
    cwd,
    model: config.llmModel,
    toolCalls: 0,
  }

  saveTask(task)

  // Run in background (non-blocking)
  runTaskInBackground(task, config).catch(() => {
    // Error handling is inside runTaskInBackground
  })

  return task
}

/** Run the task agent */
async function runTaskInBackground(task: Task, config: ReturnType<typeof getConfig>): Promise<void> {
  try {
    // Create a fresh agent for this task
    const taskConfig = { ...config, autoApprove: true } // Tasks auto-approve
    const agent = new Agent(taskConfig)
    agent.setCwd(task.cwd)

    const result = await agent.run(task.prompt)

    task.status = 'completed'
    task.completedAt = new Date().toISOString()
    task.result = result || '(Task completed with no text output)'
    saveTask(task)
  } catch (err: unknown) {
    task.status = 'failed'
    task.completedAt = new Date().toISOString()
    task.error = (err as Error).message
    saveTask(task)
  }
}

/** List all tasks */
export function listTasks(limit = 10): Task[] {
  ensureTasksDir()
  try {
    const files = readdirSync(TASKS_DIR)
      .filter((f: string) => f.startsWith('task_') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit)

    return files.map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(TASKS_DIR, f), 'utf-8')) as Task
      } catch {
        return null
      }
    }).filter((t): t is Task => t !== null)
  } catch {
    return []
  }
}

/** Get a specific task */
export function getTask(id: string): Task | null {
  return loadTask(id)
}

/** Stop a task (mark as stopped — can't actually kill the agent since it's in-process) */
export function stopTask(id: string): boolean {
  const task = loadTask(id)
  if (!task || task.status !== 'running') return false
  task.status = 'stopped'
  task.completedAt = new Date().toISOString()
  saveTask(task)
  return true
}

/** Clean up completed/failed tasks */
export function cleanTasks(): number {
  ensureTasksDir()
  let cleaned = 0
  try {
    const files = readdirSync(TASKS_DIR).filter((f: string) => f.endsWith('.json'))
    for (const f of files) {
      const path = join(TASKS_DIR, f)
      try {
        const task = JSON.parse(readFileSync(path, 'utf-8')) as Task
        if (task.status !== 'running') {
          unlinkSync(path)
          cleaned++
        }
      } catch {
        unlinkSync(path)
        cleaned++
      }
    }
  } catch { /* */ }
  return cleaned
}

/** Print task list to console */
export function printTasks(): void {
  const tasks = listTasks(15)
  if (tasks.length === 0) {
    console.log(ui.c.dim('  No tasks found.'))
    return
  }

  console.log(ui.c.bold('\n  Background Tasks:'))
  for (const t of tasks) {
    const statusIcon = t.status === 'running' ? ui.c.warn('⏳') :
                       t.status === 'completed' ? ui.c.success('✓') :
                       t.status === 'failed' ? ui.c.error('✗') :
                       ui.c.dim('⏹')
    const prompt = t.prompt.slice(0, 60) + (t.prompt.length > 60 ? '...' : '')
    console.log(`    ${statusIcon} ${ui.c.info(t.id.slice(5, 18))} ${ui.c.dim(t.status.padEnd(10))} ${ui.c.assistant(prompt)}`)
  }
}
