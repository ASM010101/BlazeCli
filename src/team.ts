import { Agent } from './agent.js'
import { getConfig, type BlazeConfig } from './types.js'
import * as ui from './ui.js'

/**
 * Agent Team System — multiple agents working together.
 *
 * Architecture:
 * - A Team has multiple named agents (workers)
 * - Each worker has its own Agent instance with isolated context
 * - Workers share a MessageBus for peer-to-peer communication
 * - Workers share a TaskBoard for self-coordination
 * - A coordinator prompt tells the main agent how to delegate
 */

// ─── Message Bus ─────────────────────────────────────────────

export interface TeamMessage {
  from: string
  to: string  // worker name or "all"
  content: string
  timestamp: string
}

class MessageBus {
  private messages: TeamMessage[] = []
  private listeners = new Map<string, ((msg: TeamMessage) => void)[]>()

  send(from: string, to: string, content: string): void {
    const msg: TeamMessage = {
      from, to, content,
      timestamp: new Date().toISOString(),
    }
    this.messages.push(msg)

    // Notify listeners
    const targets = to === 'all'
      ? [...this.listeners.keys()].filter(k => k !== from)
      : [to]

    for (const target of targets) {
      const fns = this.listeners.get(target) || []
      for (const fn of fns) fn(msg)
    }
  }

  getMessagesFor(worker: string): TeamMessage[] {
    return this.messages.filter(m => m.to === worker || m.to === 'all')
  }

  getAllMessages(): TeamMessage[] {
    return [...this.messages]
  }

  subscribe(worker: string, fn: (msg: TeamMessage) => void): void {
    if (!this.listeners.has(worker)) this.listeners.set(worker, [])
    this.listeners.get(worker)!.push(fn)
  }
}

// ─── Task Board ──────────────────────────────────────────────

export interface TeamTask {
  id: string
  description: string
  assignedTo: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  result?: string
  createdAt: string
  completedAt?: string
}

class TaskBoard {
  private tasks: TeamTask[] = []
  private nextId = 1

  addTask(description: string, assignedTo: string): TeamTask {
    const task: TeamTask = {
      id: `T${this.nextId++}`,
      description,
      assignedTo,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    this.tasks.push(task)
    return task
  }

  updateTask(id: string, status: TeamTask['status'], result?: string): boolean {
    const task = this.tasks.find(t => t.id === id)
    if (!task) return false
    task.status = status
    if (result) task.result = result
    if (status === 'completed' || status === 'failed') {
      task.completedAt = new Date().toISOString()
    }
    return true
  }

  getTasksFor(worker: string): TeamTask[] {
    return this.tasks.filter(t => t.assignedTo === worker)
  }

  getAllTasks(): TeamTask[] {
    return [...this.tasks]
  }

  getPendingTasks(): TeamTask[] {
    return this.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress')
  }

  isAllDone(): boolean {
    return this.tasks.length > 0 && this.tasks.every(t => t.status === 'completed' || t.status === 'failed')
  }
}

// ─── Worker ──────────────────────────────────────────────────

export interface Worker {
  name: string
  role: string
  agent: Agent
  inbox: TeamMessage[]
}

// ─── Team ────────────────────────────────────────────────────

export class Team {
  private workers = new Map<string, Worker>()
  private bus = new MessageBus()
  private board = new TaskBoard()
  private config: BlazeConfig
  private cwd: string

  constructor(cwd: string) {
    this.config = getConfig()
    this.cwd = cwd
  }

  /** Add a worker to the team */
  addWorker(name: string, role: string): Worker {
    const workerConfig = { ...this.config, autoApprove: true }
    const agent = new Agent(workerConfig)
    agent.setCwd(this.cwd)

    const worker: Worker = {
      name,
      role,
      agent,
      inbox: [],
    }

    // Subscribe to messages
    this.bus.subscribe(name, (msg) => {
      worker.inbox.push(msg)
    })

    this.workers.set(name, worker)
    return worker
  }

  /** Remove a worker */
  removeWorker(name: string): boolean {
    const worker = this.workers.get(name)
    if (!worker) return false
    worker.agent.destroy()
    this.workers.delete(name)
    return true
  }

  /** Send a message from one worker to another */
  sendMessage(from: string, to: string, content: string): void {
    this.bus.send(from, to, content)
  }

  /** Assign a task to a worker */
  assignTask(description: string, workerName: string): TeamTask {
    return this.board.addTask(description, workerName)
  }

  /** Run a worker on their pending tasks */
  async runWorker(workerName: string): Promise<string> {
    const worker = this.workers.get(workerName)
    if (!worker) return `Error: Worker "${workerName}" not found`

    const tasks = this.board.getTasksFor(workerName).filter(t => t.status === 'pending')
    if (tasks.length === 0) return `No pending tasks for ${workerName}`

    const results: string[] = []

    for (const task of tasks) {
      this.board.updateTask(task.id, 'in_progress')

      // Build context including inbox messages
      const inboxContext = worker.inbox.length > 0
        ? `\n\nMessages from teammates:\n${worker.inbox.map(m => `[${m.from}]: ${m.content}`).join('\n')}`
        : ''

      const prompt = `You are "${worker.name}", role: ${worker.role}.
You are part of a team. Your current task:

TASK ${task.id}: ${task.description}${inboxContext}

Complete this task. Be thorough but focused. Report your findings/results clearly.`

      try {
        const result = await worker.agent.run(prompt)
        this.board.updateTask(task.id, 'completed', result)
        results.push(`[${task.id}] ✓ ${result.slice(0, 200)}`)
      } catch (err: unknown) {
        this.board.updateTask(task.id, 'failed', (err as Error).message)
        results.push(`[${task.id}] ✗ ${(err as Error).message}`)
      }

      // Clear inbox after processing
      worker.inbox = []
    }

    return results.join('\n\n')
  }

  /** Run ALL workers in parallel on their pending tasks */
  async runAll(): Promise<Map<string, string>> {
    const results = new Map<string, string>()

    console.log(ui.c.bold(`\n  🤝 Running ${this.workers.size} workers in parallel...`))

    const promises = Array.from(this.workers.keys()).map(async (name) => {
      const worker = this.workers.get(name)!
      const tasks = this.board.getTasksFor(name).filter(t => t.status === 'pending')
      if (tasks.length === 0) {
        results.set(name, 'No pending tasks')
        return
      }

      console.log(ui.c.dim(`  ⏳ ${name} (${worker.role}): ${tasks.length} task(s)`))
      const result = await this.runWorker(name)
      results.set(name, result)
      console.log(ui.c.success(`  ✓ ${name} finished`))
    })

    await Promise.all(promises)
    return results
  }

  /** Get team status */
  getStatus(): string {
    const lines: string[] = ['']
    lines.push(ui.c.bold('  🤝 Team Status'))
    lines.push(ui.c.dim('  ─────────────────────────────'))

    // Workers
    lines.push(ui.c.bold('  Workers:'))
    for (const [name, worker] of this.workers) {
      const taskCount = this.board.getTasksFor(name).length
      const pendingCount = this.board.getTasksFor(name).filter(t => t.status === 'pending').length
      lines.push(`    ${ui.c.info(name)} — ${ui.c.dim(worker.role)} (${taskCount} tasks, ${pendingCount} pending)`)
    }

    // Tasks
    const allTasks = this.board.getAllTasks()
    if (allTasks.length > 0) {
      lines.push(ui.c.bold('\n  Tasks:'))
      for (const task of allTasks) {
        const icon = task.status === 'completed' ? ui.c.success('✓') :
                     task.status === 'failed' ? ui.c.error('✗') :
                     task.status === 'in_progress' ? ui.c.warn('⏳') :
                     ui.c.dim('○')
        lines.push(`    ${icon} ${ui.c.dim(task.id)} → ${ui.c.info(task.assignedTo)}: ${task.description.slice(0, 60)}`)
      }
    }

    // Messages
    const msgs = this.bus.getAllMessages()
    if (msgs.length > 0) {
      lines.push(ui.c.bold(`\n  Messages: ${msgs.length}`))
      for (const msg of msgs.slice(-5)) {
        lines.push(`    ${ui.c.info(msg.from)} → ${ui.c.assistant(msg.to)}: ${msg.content.slice(0, 60)}`)
      }
    }

    return lines.join('\n')
  }

  /** Get list of worker names */
  getWorkerNames(): string[] {
    return Array.from(this.workers.keys())
  }

  /** Get task board */
  getTaskBoard(): TaskBoard {
    return this.board
  }

  /** Destroy all workers */
  destroy(): void {
    for (const [, worker] of this.workers) {
      worker.agent.destroy()
    }
    this.workers.clear()
  }
}

// ─── Global team instance ────────────────────────────────────

let activeTeam: Team | null = null

export function getActiveTeam(): Team | null {
  return activeTeam
}

export function createTeam(cwd: string): Team {
  if (activeTeam) activeTeam.destroy()
  activeTeam = new Team(cwd)
  return activeTeam
}

export function destroyTeam(): void {
  if (activeTeam) {
    activeTeam.destroy()
    activeTeam = null
  }
}
