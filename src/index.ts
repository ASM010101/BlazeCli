#!/usr/bin/env node
import { Agent } from './agent.js'
import { getConfig } from './types.js'
import { ALL_TOOLS } from './tools/index.js'
import { getProjectMemoryDir, getGlobalMemoryDir, listMemories, loadMemoryIndex } from './memory.js'
import { handleRateLimit } from './failover.js'
import { loadSkills, findSkill, initSkills } from './skills.js'
import { createTask, printTasks, cleanTasks } from './tasks.js'
import { createTeam, getActiveTeam, destroyTeam } from './team.js'
import { createCronJob, parseInterval, formatInterval, stopCronJob, stopAllCronJobs, printCronJobs } from './cron.js'
import { fingerprintProject, formatFingerprint, buildSmartContext, getRecentChanges, formatRecentChanges } from './context.js'
import { isGitRepo, getChangedFiles, getDiff, generateCommitMessage, smartCommit, analyzeBranchChanges, generatePRDescription } from './git-intel.js'
import { reviewChanges, formatReviewResult } from './review.js'
import { loadPipelines, findPipeline, runPipeline, initPipelines } from './pipeline.js'
import { checkBudget, formatBudgetStatus, formatUsageBreakdown, loadBudgetConfig, addToSessionSpend, resetSessionSpend } from './budget.js'
import { MCPServer } from './mcp.js'
import { runblazeplan, loadblazeplanTask, listblazeplanTasks, stopblazeplanTask, hasblazeplanKeyword, stripblazeplanKeyword, formatblazeplanPlan, getblazeplanStatusIndicator, savePlanToFile } from './blazeplan.js'
import type { blazeplanTask } from './blazeplan.js'
import { runPowerup } from './powerup.js'
import { listRegistryPlugins, installPlugin, uninstallPlugin, getInstalledPlugins, formatPluginList, isPluginInstalled } from './plugins.js'
import * as ui from './ui.js'
import chalk from 'chalk'
import { execSync } from 'child_process'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'

/** Get git info for banner display */
function getGitInfo(cwd: string): { branch?: string; dirty?: boolean } {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd, timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const branch = execSync('git branch --show-current', {
      cwd, timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const status = execSync('git status --short', {
      cwd, timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return { branch: branch || 'detached', dirty: status.length > 0 }
  } catch {
    return {}
  }
}

/** Check if a BLAZE.md or BLAZE.md exists in the project */
function hasProjectContext(cwd: string): boolean {
  const names = ['BLAZE.md', 'BLAZE.md', '.blaze/context.md']
  for (const name of names) {
    if (existsSync(resolve(cwd, name))) return true
  }
  return false
}

/** Check if memory exists */
function hasMemoryData(cwd: string): boolean {
  const projectMem = loadMemoryIndex(getProjectMemoryDir(cwd))
  const globalMem = loadMemoryIndex(getGlobalMemoryDir())
  return !!(projectMem || globalMem)
}

/** Human-readable time ago string */
function getTimeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  } catch {
    return 'recently'
  }
}

async function main() {
  const config = getConfig()
  const args = process.argv.slice(2)

  // ── Handle flags ──
  const flagArgs: string[] = []
  const positionalArgs: string[] = []

  for (const arg of args) {
    if (arg.startsWith('-')) {
      flagArgs.push(arg)
    } else {
      positionalArgs.push(arg)
    }
  }

  // --help
  if (flagArgs.includes('--help') || flagArgs.includes('-h')) {
    console.log(`
${ui.c.brand('  🔥 Blaze CLI')} — Your Agentic Coding Platform

  ${ui.c.bold('Usage:')}
    blaze                     Interactive REPL mode
    blaze "your request"      Single-shot mode
    blaze --help              Show this help
    blaze --yes               Auto-approve all tool permissions
    blaze --resume            Resume last conversation
    blaze --plan              Start in plan (read-only) mode
    blaze --ci "task"         CI/CD mode (JSON output, auto-approve, no color)

  ${ui.c.bold('Environment Variables:')}
    BLAZE_LLM_URL             LLM API base URL (default: http://localhost:11434)
    BLAZE_LLM_MODEL           Model name (default: qwen3.5:cloud)
    BLAZE_LLM_API_KEY         API key for cloud providers (Groq, OpenRouter)
    BLAZE_MAX_TOKENS           Max output tokens (default: 8192)
    BLAZE_TEMPERATURE          Temperature (default: 0)
    BLAZE_AUTO_APPROVE         Skip permission prompts (default: false)
    BLAZE_MAX_CONTEXT          Max context window tokens (default: 120000)
    BLAZE_MEMORY               Enable/disable auto-memory (default: true)

  ${ui.c.bold('Config File:')}
    Create ${ui.c.info('.blazerc')} or ${ui.c.info('.blazerc.json')} in your project or home directory:
    {
      "llmUrl": "...", "llmModel": "...", "maxTokens": 8192,
      "hooks": { "postToolUse": [{ "match": "FileWrite", "command": "prettier --write $BLAZE_FILE_PATH" }] },
      "permissions": { "allow": ["Bash(npm *)"], "deny": ["Bash(rm -rf *)"] }
    }

  ${ui.c.bold('Project Context:')}
    Create ${ui.c.info('BLAZE.md')} in your project root with project-specific instructions.

  ${ui.c.bold('Tools Available (17):')}
    Bash       Run shell commands           WebFetch    Fetch URL content
    FileRead   Read file contents           WebSearch   Search the web
    FileWrite  Create/overwrite files       Research    Spawn research agents
    FileEdit   Find-and-replace edits       AskUser     Ask user mid-flow
    Grep       Search text patterns         Notebook    Edit Jupyter notebooks
    Glob       Find files by pattern        Worktree    Git worktree isolation
    ListDir    List directory contents      REPL        Run Python/Node code
    Browser    Playwright automation        Screenshot  Capture screen
    ImageGen   Generate images from text

  ${ui.c.bold('REPL Commands:')}
    /help       Show commands               /plan       Toggle plan/execute mode
    /blazeplan  Deep multi-agent planning   /tasks      List background tasks
    /clear      Reset conversation          /memory     Show/manage memories
    /compact    Compress conversation       /context    Show context usage
    /save       Save conversation           /init       Generate BLAZE.md
    /load       Load previous session       /branch     Fork conversation
    /sessions   List saved sessions         /diff       Show git diff
    /cd <path>  Change working directory    /commit     Create git commit
    /model      Show model info             /hooks      Show active hooks
    /tools      List available tools        /perms      Show permission rules
    /status     Show session stats          /powerup    Interactive tutorials
    /plugins    Plugin registry             /exit       Quit Blaze CLI
`)
    process.exit(0)
  }

  // --yes / -y flag
  if (flagArgs.includes('--yes') || flagArgs.includes('-y')) {
    config.autoApprove = true
  }

  // --plan flag
  if (flagArgs.includes('--plan')) {
    config.planMode = true
  }

  // --ci flag (CI/CD mode: auto-approve, JSON output, no color, no prompts)
  const ciMode = flagArgs.includes('--ci') || flagArgs.includes('--json')
  if (ciMode) {
    config.autoApprove = true
    // Disable chalk colors in CI mode
    process.env.FORCE_COLOR = '0'
  }

  // --resume flag
  const shouldResume = flagArgs.includes('--resume') || flagArgs.includes('-r')

  // ── Test connection ──
  const isCloudApi = config.llmUrl.includes('nvidia.com') ||
    config.llmUrl.includes('groq.com') ||
    config.llmUrl.includes('openrouter.ai') ||
    config.llmUrl.includes('together.xyz') ||
    config.llmUrl.includes('openai.com')

  if (!isCloudApi) {
    // Only test connection for local servers (Ollama, local NIM, etc.)
    try {
      const resp = await fetch(`${config.llmUrl}/`, { signal: AbortSignal.timeout(5000) })
      const text = await resp.text()
      if (!text.toLowerCase().includes('ollama') && !resp.ok) {
        throw new Error('Not a valid LLM server')
      }
    } catch {
      console.log(ui.c.error('\n  ✗ Cannot connect to local LLM server'))
      console.log(ui.c.dim(`    URL: ${config.llmUrl}`))
      console.log(ui.c.dim('    Make sure Ollama is running: ollama serve'))
      console.log(ui.c.dim('    Or set BLAZE_LLM_URL to a cloud API (NVIDIA NIM, Groq, OpenRouter)'))
      process.exit(1)
    }
  } else if (!config.llmApiKey) {
    console.log(ui.c.error('\n  ✗ Cloud API requires an API key'))
    console.log(ui.c.dim(`    URL: ${config.llmUrl}`))
    console.log(ui.c.dim('    Set BLAZE_LLM_API_KEY in your .env or environment'))
    console.log(ui.c.dim('    Or add "llmApiKey" to your .blazerc'))
    process.exit(1)
  }

  const agent = new Agent(config)
  _agent = agent // For SIGINT handler

  // Resume last session if requested
  if (shouldResume) {
    // Try CWD-specific session first, then fall back to any session
    const cwdSession = agent.findRecentSession(process.cwd())
    const anySession = cwdSession || (agent.listSessions().length > 0 ? agent.listSessions()[0]! : null)

    if (cwdSession && agent.load(cwdSession.path)) {
      ui.printLoaded(cwdSession.path, agent.getMessageCount())
    } else if (anySession && agent.load(anySession.path)) {
      ui.printLoaded(anySession.path, agent.getMessageCount())
    } else {
      console.log(ui.c.dim('  No previous sessions found.'))
    }
  }

  // ── Get git info for banner ──
  const cwd = process.cwd()
  const gitInfo = getGitInfo(cwd)
  const hasContext = hasProjectContext(cwd)
  const hasMem = config.memoryEnabled && hasMemoryData(cwd)

  // ── Single-shot mode (including CI mode) ──
  if (positionalArgs.length > 0) {
    const query = positionalArgs.join(' ')

    if (ciMode) {
      // CI/CD mode: JSON output, no banner, no colors
      const startTime = Date.now()
      try {
        const result = await agent.run(query)
        const elapsed = Date.now() - startTime
        const output = {
          success: true,
          query,
          response: result || '',
          model: config.llmModel,
          elapsed_ms: elapsed,
          tool_calls: (agent as any).getToolCallCount?.() || 0,
        }
        process.stdout.write(JSON.stringify(output, null, 2) + '\n')
        process.exit(0)
      } catch (err: unknown) {
        const output = {
          success: false,
          query,
          error: (err as Error).message,
          model: config.llmModel,
          elapsed_ms: Date.now() - startTime,
        }
        process.stdout.write(JSON.stringify(output, null, 2) + '\n')
        process.exit(1)
      }
    }

    ui.printBanner(config.llmModel, cwd, {
      gitBranch: gitInfo.branch,
      gitDirty: gitInfo.dirty,
      hasProjectContext: hasContext,
      hasMemory: hasMem,
      planMode: config.planMode,
      toolCount: ALL_TOOLS.length,
    })
    console.log(ui.c.user('  You: ') + query)
    await agent.run(query)
    console.log()
    agent.destroy()
    process.exit(0)
  }

  // ── Interactive REPL mode ──
  ui.printBanner(config.llmModel, cwd, {
    gitBranch: gitInfo.branch,
    gitDirty: gitInfo.dirty,
    hasProjectContext: hasContext,
    hasMemory: hasMem,
    planMode: config.planMode,
    toolCount: ALL_TOOLS.length,
  })

  // Show hint if there's a recent session for this project
  if (!shouldResume) {
    const recentSession = agent.findRecentSession(cwd)
    if (recentSession) {
      const ago = getTimeAgo(recentSession.date)
      console.log(ui.c.dim(`  💾 Recent session found (${ago}). Type `) + ui.c.info('/resume') + ui.c.dim(' to continue it.'))
      console.log()
    }
  }

  let activeblazeplanId: string | undefined

  while (true) {
    // Show blazeplan status indicator if active
    const upIndicator = getblazeplanStatusIndicator()
    const modeIndicator = agent.getPlanMode() ? ui.c.plan('[PLAN] ') : ''
    const input = await ui.getUserInput(ui.c.user(`\n  🔥 ${upIndicator}${modeIndicator}You: `))

    if (!input.trim()) continue

    const cmd = input.trim()
    const cmdLower = cmd.toLowerCase()

    // ── /exit ──
    if (cmdLower === '/exit' || cmdLower === '/quit' || cmdLower === '/q') {
      agent.destroy()
      console.log(ui.c.dim('\n  Goodbye! 👋\n'))
      break
    }

    // ── /clear ──
    if (cmdLower === '/clear' || cmdLower === '/reset') {
      agent.reset()
      console.log(ui.c.success('  ✓ Conversation cleared'))
      continue
    }

    // ── /help ──
    if (cmdLower === '/help') {
      console.log(`
  ${ui.c.bold('Session:')}
    /clear           Reset conversation
    /compact         Compress conversation to save tokens
    /save            Save conversation to disk
    /load [id]       Load a previous conversation
    /resume          Resume last session for this project
    /sessions        List saved conversations
    /branch          Fork conversation (save branch point)
    /restore [n]     Restore to a branch point

  ${ui.c.bold('Navigation:')}
    /cd <path>       Change working directory
    /model           Show current model info
    /tools           List available tools
    /status          Show session stats (tokens, messages)
    /context         Visualize context window usage

  ${ui.c.bold('Features:')}
    /plan [on|off]   Toggle plan mode (read-only exploration)
    /blazeplan <p>   Deep multi-agent planning (3 agents + critique)
    /up              List blazeplan tasks
    /up view <id>    View & execute an blazeplan
    /up stop <id>    Stop an active blazeplan
    /memory          Show auto-memory status
    /init            Generate BLAZE.md for current project
    /diff            Show git diff of current changes
    /commit [msg]    Create a git commit
    /rewind [n]      Rewind conversation to checkpoint
    /export [file]   Export conversation to text file

  ${ui.c.bold('Analysis:')}
    /review          Security & code quality review (pattern + LLM)
    /scan            Instant security scan (no LLM, fast)
    /context full    Project analysis (tech stack, patterns)
    /stats           Usage stats across sessions
    /doctor          Check Blaze CLI health

  ${ui.c.bold('Git Intelligence:')}
    /git             Smart git status (changed files)
    /git diff        Show git diff with colors
    /git commit      Auto-commit with smart message
    /git message     Generate commit message (no commit)
    /git branch      Analyze branch changes vs main
    /git pr          Generate PR description

  ${ui.c.bold('Pipelines:')}
    /pipeline        List available pipelines
    /pipeline init   Create example pipelines
    /<pipeline-name> Run a pipeline

  ${ui.c.bold('Budget:')}
    /budget          Show budget status (daily/session/project)
    /budget usage    Show usage breakdown by model
    /budget reset    Reset session budget

  ${ui.c.bold('MCP Server:')}
    /mcp start       Start MCP server (expose tools to IDEs)
    /mcp serve <port>Start on custom port

  ${ui.c.bold('Teams:')}
    /team create     Create a new agent team
    /team add <n> <r> Add a worker (name + role)
    /team task <n> <d> Assign task to worker
    /team run        Run all workers in parallel
    /team msg <f> <t> <m> Send message between workers
    /team <prompt>   Auto-coordinate: split work across team
    /team status     Show team status
    /team destroy    Disband the team

  ${ui.c.bold('Background:')}
    /run <prompt>    Run a task in background
    /tasks           List background tasks
    /tasks clean     Remove completed tasks
    /loop <int> <p>  Run prompt on interval (5m, 1h, etc.)
    /loop stop       Stop all cron jobs

  ${ui.c.bold('Skills:')}
    /skills          List available custom skills
    /skills init     Create example skills in .blaze/skills/
    /<skill-name>    Run a custom skill

  ${ui.c.bold('Config:')}
    /switch          Switch model/provider mid-conversation
    /hooks           Show active hooks
    /perms           Show permission rules
    /theme [name]    Switch color theme (dark/light/ocean/forest)
    /fast [on|off]   Toggle fast mode (shorter responses)
    /copy            Copy last response to clipboard
    /rename [name]   Rename current session
    /tag [name]      Tag/untag current session
    /btw <question>  Ask a quick side question
    /vim             Toggle vim input mode

  ${ui.c.bold('Tips:')}
    Ctrl+C once      Stop current agent run (keeps REPL alive)
    Ctrl+C twice     Save session and exit
    Paste multi-line Supported automatically

  ${ui.c.bold('Exit:')}
    /exit            Quit Blaze CLI
`)
      continue
    }

    // ── /model ──
    if (cmdLower === '/model') {
      console.log(ui.c.dim('  Model: ') + ui.c.info(config.llmModel))
      console.log(ui.c.dim('  URL:   ') + ui.c.info(config.llmUrl))
      if (config.llmApiKey) {
        console.log(ui.c.dim('  Auth:  ') + ui.c.success('API key configured'))
      }
      console.log(ui.c.dim('  Temp:  ') + ui.c.assistant(String(config.temperature)))
      console.log(ui.c.dim('  Max:   ') + ui.c.assistant(`${config.maxTokens} tokens`))
      continue
    }

    // ── /tools ──
    if (cmdLower === '/tools') {
      const tools = [
        { name: 'Bash', desc: 'Run shell commands', perm: true },
        { name: 'FileRead', desc: 'Read file contents', perm: false },
        { name: 'FileWrite', desc: 'Create/overwrite files', perm: true },
        { name: 'FileEdit', desc: 'Find-and-replace edits', perm: true },
        { name: 'Grep', desc: 'Search text patterns', perm: false },
        { name: 'Glob', desc: 'Find files by pattern', perm: false },
        { name: 'ListDir', desc: 'List directory contents', perm: false },
        { name: 'WebFetch', desc: 'Fetch URL content', perm: false },
        { name: 'WebSearch', desc: 'Search the web', perm: false },
        { name: 'ResearchAgent', desc: 'Spawn isolated research agent', perm: false },
      ]
      const planMode = agent.getPlanMode()
      console.log(ui.c.bold('\n  Available Tools:') + (planMode ? ui.c.plan(' (plan mode — read-only)') : ''))
      for (const t of tools) {
        const perm = t.perm ? ui.c.warn(' ⚠') : ui.c.dim('  ')
        const blocked = planMode && t.perm ? ui.c.error(' ✗') : ''
        console.log(`    ${ui.c.tool('🔧')} ${ui.c.toolName(t.name.padEnd(12))} ${ui.c.dim(t.desc)}${perm}${blocked}`)
      }
      console.log(ui.c.dim('\n  ⚠ = requires permission'))
      if (planMode) console.log(ui.c.dim('  ✗ = blocked in plan mode'))
      continue
    }

    // ── /cd ──
    if (cmdLower.startsWith('/cd')) {
      const newPath = cmd.slice(3).trim()
      if (!newPath) {
        console.log(ui.c.dim('  Current: ') + ui.c.assistant(agent.getCwd()))
        console.log(ui.c.dim('  Usage: /cd <path>'))
        continue
      }
      const resolved = resolve(agent.getCwd(), newPath)
      if (!existsSync(resolved)) {
        console.log(ui.c.error(`  ✗ Directory not found: ${resolved}`))
        continue
      }
      agent.setCwd(resolved)
      console.log(ui.c.success('  ✓ CWD: ') + ui.c.assistant(resolved))
      const newGit = getGitInfo(resolved)
      if (newGit.branch) {
        console.log(ui.c.dim('  Git: ') + ui.c.gitBranch(newGit.branch))
      }
      continue
    }

    // ── /compact ──
    if (cmdLower === '/compact') {
      await agent.compact()
      continue
    }

    // ── /save ──
    if (cmdLower === '/save') {
      const path = agent.save()
      ui.printSaved(path)
      continue
    }

    // ── /load ──
    if (cmdLower.startsWith('/load')) {
      const loadArg = cmd.slice(5).trim()

      if (!loadArg) {
        const sessions = agent.listSessions()
        if (sessions.length === 0) {
          console.log(ui.c.dim('  No saved sessions found.'))
          continue
        }
        console.log(ui.c.bold('\n  Saved Sessions:'))
        sessions.forEach((s, i) => {
          console.log(`    ${ui.c.info(String(i + 1))}. ${ui.c.dim(s.date.slice(0, 19))} — ${ui.c.assistant(s.id)}`)
        })
        console.log(ui.c.dim('\n  Usage: /load <number> or /load <path>'))

        const pick = await ui.getUserInput(ui.c.info('  Pick session #: '))
        const idx = parseInt(pick.trim(), 10) - 1
        if (idx >= 0 && idx < sessions.length) {
          if (agent.load(sessions[idx]!.path)) {
            ui.printLoaded(sessions[idx]!.path, agent.getMessageCount())
          } else {
            console.log(ui.c.error('  ✗ Failed to load session'))
          }
        }
        continue
      }

      const idx = parseInt(loadArg, 10)
      if (!isNaN(idx)) {
        const sessions = agent.listSessions()
        const target = sessions[idx - 1]
        if (target && agent.load(target.path)) {
          ui.printLoaded(target.path, agent.getMessageCount())
        } else {
          console.log(ui.c.error('  ✗ Session not found'))
        }
      } else if (agent.load(loadArg)) {
        ui.printLoaded(loadArg, agent.getMessageCount())
      } else {
        console.log(ui.c.error(`  ✗ Could not load: ${loadArg}`))
      }
      continue
    }

    // ── /resume ──
    if (cmdLower === '/resume' || cmdLower === '/continue') {
      const recentSession = agent.findRecentSession(agent.getCwd())
      if (recentSession && agent.load(recentSession.path)) {
        const ago = getTimeAgo(recentSession.date)
        ui.printLoaded(recentSession.path, agent.getMessageCount())
        console.log(ui.c.dim(`  Session from ${ago} restored. Your conversation continues.`))
      } else {
        // Fall back to any recent session
        const sessions = agent.listSessions()
        if (sessions.length > 0) {
          console.log(ui.c.bold('\n  No session for this directory. Other recent sessions:'))
          sessions.slice(0, 5).forEach((s, i) => {
            const ago = getTimeAgo(s.date)
            console.log(`    ${ui.c.info(String(i + 1))}. ${ui.c.dim(ago)} — ${ui.c.assistant(s.id)} ${ui.c.dim(s.cwd)}`)
          })
          const pick = await ui.getUserInput(ui.c.info('  Load #: '))
          const idx = parseInt(pick.trim(), 10) - 1
          if (idx >= 0 && idx < sessions.length && agent.load(sessions[idx]!.path)) {
            ui.printLoaded(sessions[idx]!.path, agent.getMessageCount())
          }
        } else {
          console.log(ui.c.dim('  No saved sessions found.'))
        }
      }
      continue
    }

    // ── /sessions ──
    if (cmdLower === '/sessions' || cmdLower === '/history') {
      const sessions = agent.listSessions()
      if (sessions.length === 0) {
        console.log(ui.c.dim('  No saved sessions.'))
        continue
      }
      console.log(ui.c.bold('\n  Recent Sessions:'))
      for (const s of sessions) {
        const ago = getTimeAgo(s.date)
        const cwdMatch = s.cwd.toLowerCase().replace(/\\/g, '/') === agent.getCwd().toLowerCase().replace(/\\/g, '/') ? ui.c.success(' (this project)') : ''
        console.log(`    ${ui.c.dim(ago.padEnd(8))} ${ui.c.dim(s.date.slice(0, 19))} — ${ui.c.assistant(s.id)}${cwdMatch}`)
        console.log(ui.c.dim(`             ${s.cwd}`))
      }
      continue
    }

    // ── /status ──
    if (cmdLower === '/status') {
      console.log(ui.c.bold('\n  Session Status:'))
      console.log(ui.c.dim('  Messages:     ') + ui.c.assistant(String(agent.getMessageCount())))
      console.log(ui.c.dim('  Tokens:       ') + ui.c.assistant(`~${agent.getEstimatedTokens()}`))
      console.log(ui.c.dim('  CWD:          ') + ui.c.assistant(agent.getCwd()))
      console.log(ui.c.dim('  Model:        ') + ui.c.info(config.llmModel))
      console.log(ui.c.dim('  Plan Mode:    ') + (agent.getPlanMode() ? ui.c.plan('ON') : ui.c.dim('off')))
      console.log(ui.c.dim('  Auto-Approve: ') + (config.autoApprove ? ui.c.warn('ON') : ui.c.dim('off')))
      console.log(ui.c.dim('  Memory:       ') + (config.memoryEnabled ? ui.c.memory('enabled') : ui.c.dim('disabled')))
      console.log(ui.c.dim('  Branches:     ') + ui.c.assistant(String(agent.getBranchCount())))
      continue
    }

    // ── /context ──
    if (cmdLower === '/context') {
      ui.printContextGrid(agent.getEstimatedTokens(), agent.getMaxContextTokens())
      continue
    }

    // ── /plan ──
    if (cmdLower.startsWith('/plan')) {
      const planArg = cmd.slice(5).trim().toLowerCase()
      if (planArg === 'off' || planArg === 'false') {
        agent.setPlanMode(false)
        ui.printPlanMode(false)
      } else if (planArg === 'on' || planArg === 'true' || planArg === '') {
        agent.setPlanMode(!agent.getPlanMode()) // toggle
        ui.printPlanMode(agent.getPlanMode())
      }
      continue
    }

    // ── /blazeplan ──
    if (cmdLower.startsWith('/blazeplan')) {
      const upPrompt = cmd.slice(10).trim()
      if (!upPrompt) {
        console.log(ui.c.dim('  Usage: /blazeplan <task description>'))
        console.log(ui.c.dim('  Spawns 3 parallel research agents + 1 critique agent'))
        console.log(ui.c.dim('  Terminal stays free while the plan is generated'))
        continue
      }

      console.log('')
      console.log(ui.c.brand('  🔥 blazeplan — Launching deep multi-agent planning...'))
      console.log(ui.c.dim('  Spawning 3 parallel research agents:'))
      console.log(ui.c.dim('    ◇ Agent 1: Architecture Explorer'))
      console.log(ui.c.dim('    ◇ Agent 2: Files to Modify'))
      console.log(ui.c.dim('    ◇ Agent 3: Risks & Dependencies'))
      console.log(ui.c.dim('    ◇ Agent 4: Plan Critique (after synthesis)'))
      console.log(ui.c.dim('  Terminal is free — check status in the prompt indicator.'))
      console.log('')

      const upTask = await runblazeplan(upPrompt, agent.getCwd(), config)
      activeblazeplanId = upTask.id
      continue
    }

    // ── /blazeplan status / view ──
    if (cmdLower === '/blazeplan' || cmdLower === '/up') {
      const upTasks = listblazeplanTasks(5)
      if (upTasks.length === 0) {
        console.log(ui.c.dim('  No blazeplan tasks. Use /blazeplan <prompt> to start one.'))
      } else {
        console.log(ui.c.bold('\n  blazeplan Tasks:'))
        for (const t of upTasks) {
          const statusIcon = t.status === 'drafting' || t.status === 'synthesizing' || t.status === 'critiquing'
            ? ui.c.warn('⏳')
            : t.status === 'ready'
              ? ui.c.success('◆')
              : t.status === 'failed'
                ? ui.c.error('✗')
                : ui.c.dim('⏹')
          const prompt = t.prompt.slice(0, 50) + (t.prompt.length > 50 ? '...' : '')
          console.log(`    ${statusIcon} ${ui.c.info(t.id.slice(3, 16))} ${ui.c.dim(t.status.padEnd(12))} ${ui.c.assistant(prompt)}`)
        }
        console.log(ui.c.dim('\n  Use /blazeplan view <id> to see a plan, /blazeplan stop <id> to cancel'))
      }
      continue
    }

    // ── /blazeplan view <id> ──
    if (cmdLower.startsWith('/blazeplan view') || cmdLower.startsWith('/up view')) {
      const viewId = cmd.replace(/^\/(blazeplan|up)\s+view\s+/i, '').trim()
      if (!viewId) {
        console.log(ui.c.dim('  Usage: /blazeplan view <id>'))
        continue
      }
      const fullId = viewId.startsWith('up_') ? viewId : `up_${viewId}`
      const upTask = loadblazeplanTask(fullId)
      if (!upTask) {
        console.log(ui.c.error('  ✗ blazeplan task not found'))
        continue
      }
      if (upTask.status !== 'ready' && upTask.status !== 'completed') {
        console.log(ui.c.warn(`  ⚠ Plan is still ${upTask.status}. Wait for it to be ready.`))
        continue
      }
      console.log(formatblazeplanPlan(upTask))

      // Ask what to do with the plan
      console.log(ui.c.bold('  Choose an action:'))
      console.log(ui.c.success('    [1]') + ' Implement here — inject plan into current session')
      console.log(ui.c.info('    [2]') + ' Start new session — fresh context with only the plan')
      console.log(ui.c.brand('    [3]') + ' Save to file — save plan without executing')
      console.log(ui.c.dim('    [4]') + ' Cancel — dismiss for now')
      console.log('')
      const choice = await ui.getUserInput('  Choice [1-4]: ')

      if (choice.trim() === '1') {
        // Inject plan into current session
        console.log(ui.c.success('  ✓ Injecting plan into current session...'))
        await agent.run(`Here is an approved implementation plan. Execute it step by step:\n\n${upTask.plan}`)
        activeblazeplanId = undefined
      } else if (choice.trim() === '2') {
        // Start fresh session with plan
        console.log(ui.c.success('  ✓ Starting new session with plan...'))
        agent.clear()
        await agent.run(`Execute this implementation plan step by step:\n\n${upTask.plan}`)
        activeblazeplanId = undefined
      } else if (choice.trim() === '3') {
        // Save to file
        const filepath = savePlanToFile(upTask, agent.getCwd())
        console.log(ui.c.success(`  ✓ Plan saved to: ${filepath}`))
      } else {
        console.log(ui.c.dim('  Cancelled. Plan is still available via /blazeplan view'))
      }
      continue
    }

    // ── /blazeplan stop <id> ──
    if (cmdLower.startsWith('/blazeplan stop') || cmdLower.startsWith('/up stop')) {
      const stopId = cmd.replace(/^\/(blazeplan|up)\s+stop\s+/i, '').trim()
      if (!stopId) {
        console.log(ui.c.dim('  Usage: /blazeplan stop <id>'))
        continue
      }
      const fullId = stopId.startsWith('up_') ? stopId : `up_${stopId}`
      if (stopblazeplanTask(fullId)) {
        console.log(ui.c.success('  ✓ blazeplan task stopped'))
        activeblazeplanId = undefined
      } else {
        console.log(ui.c.error('  ✗ Could not stop task (not found or already completed)'))
      }
      continue
    }

    // ── /memory ──
    if (cmdLower === '/memory') {
      console.log(ui.c.bold('\n  Auto-Memory:'))
      console.log(ui.c.dim('  Status: ') + (config.memoryEnabled ? ui.c.memory('enabled') : ui.c.dim('disabled')))

      const projDir = getProjectMemoryDir(agent.getCwd())
      const globalDir = getGlobalMemoryDir()

      const projMems = listMemories(projDir)
      const globalMems = listMemories(globalDir)

      if (projMems.length > 0) {
        console.log(ui.c.bold('\n  Project Memories:') + ui.c.dim(` (${projDir})`))
        for (const m of projMems) {
          console.log(`    ${ui.c.memory('•')} ${ui.c.assistant(m.name)} ${ui.c.dim(`[${m.type}]`)} — ${ui.c.dim(m.description)}`)
        }
      }

      if (globalMems.length > 0) {
        console.log(ui.c.bold('\n  Global Memories:') + ui.c.dim(` (${globalDir})`))
        for (const m of globalMems) {
          console.log(`    ${ui.c.memory('•')} ${ui.c.assistant(m.name)} ${ui.c.dim(`[${m.type}]`)} — ${ui.c.dim(m.description)}`)
        }
      }

      if (projMems.length === 0 && globalMems.length === 0) {
        console.log(ui.c.dim('  No memories saved yet. The agent can save memories during conversations.'))
      }
      continue
    }

    // ── /init ──
    if (cmdLower === '/init') {
      const blazeMdPath = resolve(agent.getCwd(), 'BLAZE.md')
      if (existsSync(blazeMdPath)) {
        console.log(ui.c.warn('  BLAZE.md already exists. Overwrite? [y/N]'))
        const answer = await ui.getUserInput('  ')
        if (answer.trim().toLowerCase() !== 'y') {
          console.log(ui.c.dim('  Cancelled.'))
          continue
        }
      }

      console.log(ui.c.dim('  Generating BLAZE.md...'))
      // Use the agent to analyze and generate
      await agent.run(
        'Analyze this project directory and create a BLAZE.md file in the project root. ' +
        'The BLAZE.md should contain: project description, tech stack, key directories, ' +
        'build/test commands, coding conventions, and any important notes. ' +
        'Keep it concise (under 100 lines). Use FileRead, Glob, and ListDir to explore first, ' +
        'then use FileWrite to create BLAZE.md.'
      )
      continue
    }

    // ── /branch ──
    if (cmdLower === '/branch' || cmdLower === '/fork') {
      const branchNum = agent.branch()
      console.log(ui.c.success(`  ✓ Branch point saved (#${branchNum})`))
      console.log(ui.c.dim(`  Use /restore ${branchNum} to go back to this point.`))
      continue
    }

    // ── /restore ──
    if (cmdLower.startsWith('/restore')) {
      const restoreArg = cmd.slice(8).trim()
      if (!restoreArg) {
        const count = agent.getBranchCount()
        if (count === 0) {
          console.log(ui.c.dim('  No branch points saved. Use /branch to create one.'))
        } else {
          console.log(ui.c.dim(`  ${count} branch point(s) available. Usage: /restore <number>`))
        }
        continue
      }
      const branchIdx = parseInt(restoreArg, 10)
      if (agent.restoreBranch(branchIdx)) {
        console.log(ui.c.success(`  ✓ Restored to branch point #${branchIdx}`))
      } else {
        console.log(ui.c.error(`  ✗ Branch point #${branchIdx} not found`))
      }
      continue
    }

    // ── /diff ──
    if (cmdLower === '/diff') {
      try {
        const diff = execSync('git diff', {
          cwd: agent.getCwd(),
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        if (!diff) {
          console.log(ui.c.dim('  No uncommitted changes.'))
        } else {
          console.log(ui.c.bold('\n  Git Diff:'))
          const lines = diff.split('\n').slice(0, 80)
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              console.log(ui.c.success(`  ${line}`))
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              console.log(ui.c.error(`  ${line}`))
            } else if (line.startsWith('@@')) {
              console.log(ui.c.info(`  ${line}`))
            } else {
              console.log(ui.c.dim(`  ${line}`))
            }
          }
          if (diff.split('\n').length > 80) {
            console.log(ui.c.dim(`  ... (${diff.split('\n').length - 80} more lines)`))
          }
        }
      } catch {
        console.log(ui.c.dim('  Not a git repository or git not available.'))
      }
      continue
    }

    // ── /commit ──
    if (cmdLower.startsWith('/commit')) {
      const commitMsg = cmd.slice(7).trim()
      if (!commitMsg) {
        // Ask agent to generate a commit message
        console.log(ui.c.dim('  Generating commit message...'))
        await agent.run(
          'Look at the current git diff (use Bash: git diff --staged, or git diff if nothing is staged). ' +
          'Generate a concise, meaningful commit message. Then stage all changes (git add -A) ' +
          'and create the commit. Show the result.'
        )
      } else {
        try {
          execSync('git add -A', { cwd: agent.getCwd(), stdio: ['pipe', 'pipe', 'pipe'] })
          const result = execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
            cwd: agent.getCwd(), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()
          console.log(ui.c.success('  ✓ ') + ui.c.assistant(result))
        } catch (err: unknown) {
          console.log(ui.c.error(`  ✗ ${(err as Error).message}`))
        }
      }
      continue
    }

    // ── /hooks ──
    if (cmdLower === '/hooks') {
      console.log(ui.c.bold('\n  Active Hooks:'))
      const h = config.hooks
      let count = 0

      if (h.preToolUse?.length) {
        console.log(ui.c.hook('  preToolUse:'))
        for (const hook of h.preToolUse) {
          console.log(ui.c.dim(`    match: ${hook.match || '*'} → `) + ui.c.assistant(hook.command))
          count++
        }
      }
      if (h.postToolUse?.length) {
        console.log(ui.c.hook('  postToolUse:'))
        for (const hook of h.postToolUse) {
          console.log(ui.c.dim(`    match: ${hook.match || '*'} → `) + ui.c.assistant(hook.command))
          count++
        }
      }
      if (h.sessionStart?.length) {
        console.log(ui.c.hook('  sessionStart:'))
        for (const hook of h.sessionStart) {
          console.log(ui.c.dim(`    → `) + ui.c.assistant(hook.command))
          count++
        }
      }
      if (h.sessionEnd?.length) {
        console.log(ui.c.hook('  sessionEnd:'))
        for (const hook of h.sessionEnd) {
          console.log(ui.c.dim(`    → `) + ui.c.assistant(hook.command))
          count++
        }
      }

      if (count === 0) {
        console.log(ui.c.dim('  No hooks configured. Add hooks to .blazerc'))
      }
      continue
    }

    // ── /perms ──
    if (cmdLower === '/perms' || cmdLower === '/permissions') {
      console.log(ui.c.bold('\n  Permission Rules:'))
      const p = config.permissions
      if (p.allow?.length) {
        console.log(ui.c.success('  Allow:'))
        for (const rule of p.allow) {
          console.log(ui.c.dim('    ✓ ') + ui.c.assistant(rule))
        }
      }
      if (p.deny?.length) {
        console.log(ui.c.error('  Deny:'))
        for (const rule of p.deny) {
          console.log(ui.c.dim('    ✗ ') + ui.c.assistant(rule))
        }
      }
      if (!p.allow?.length && !p.deny?.length) {
        console.log(ui.c.dim('  No custom rules. Using default permissions.'))
        console.log(ui.c.dim('  Add rules to .blazerc: "permissions": { "allow": [...], "deny": [...] }'))
      }
      continue
    }

    // ── /switch ──
    if (cmdLower === '/switch' || cmdLower === '/switch-model' || cmdLower === '/model-switch') {
      const provider = await handleRateLimit(
        agent.getConfig(),
        agent.getCurrentUrl(),
        agent.getCurrentModel(),
        true // voluntary switch
      )
      if (provider) {
        agent.switchProvider(provider.url, provider.model, provider.apiKey)
        console.log(ui.c.success(`  ✓ Now using: `) + ui.c.info(provider.model) + ui.c.dim(` @ ${provider.url}`))
        console.log(ui.c.dim('  Your conversation continues with the new model.'))
      }
      continue
    }

    // ── /rewind ──
    if (cmdLower.startsWith('/rewind') || cmdLower.startsWith('/undo')) {
      const arg = cmd.slice(7).trim()
      const checkpoints = agent.getCheckpoints()

      if (checkpoints.length === 0) {
        console.log(ui.c.dim('  No checkpoints available. Checkpoints are created before each agent run.'))
        continue
      }

      if (!arg) {
        console.log(ui.c.bold('\n  Checkpoints:'))
        for (const cp of checkpoints) {
          const ago = getTimeAgo(cp.timestamp)
          console.log(`    ${ui.c.info(String(cp.index))}. ${ui.c.dim(ago)} — ${ui.c.assistant(`${cp.messageCount} messages`)}`)
        }
        console.log(ui.c.dim('\n  Usage: /rewind <number> or /rewind last'))

        const pick = await ui.getUserInput(ui.c.info('  Rewind to #: '))
        const pickTrimmed = pick.trim().toLowerCase()
        if (pickTrimmed === 'last') {
          if (agent.rewindLast()) {
            console.log(ui.c.success('  ✓ Rewound to last checkpoint.'))
          }
        } else {
          const idx = parseInt(pickTrimmed, 10)
          if (agent.rewind(idx)) {
            console.log(ui.c.success(`  ✓ Rewound to checkpoint #${idx}.`))
          } else {
            console.log(ui.c.error(`  ✗ Checkpoint #${idx} not found.`))
          }
        }
        continue
      }

      if (arg.toLowerCase() === 'last') {
        if (agent.rewindLast()) {
          console.log(ui.c.success('  ✓ Rewound to last checkpoint.'))
        } else {
          console.log(ui.c.error('  ✗ No checkpoints to rewind to.'))
        }
      } else {
        const idx = parseInt(arg, 10)
        if (agent.rewind(idx)) {
          console.log(ui.c.success(`  ✓ Rewound to checkpoint #${idx}. ${agent.getMessageCount()} messages.`))
        } else {
          console.log(ui.c.error(`  ✗ Checkpoint #${idx} not found.`))
        }
      }
      continue
    }

    // ── /export ──
    if (cmdLower.startsWith('/export')) {
      const arg = cmd.slice(7).trim()
      const messages = agent.getMessages()

      // Build plain text export
      const lines: string[] = [
        `# Blaze CLI Conversation Export`,
        `# Model: ${config.llmModel}`,
        `# CWD: ${agent.getCwd()}`,
        `# Date: ${new Date().toISOString()}`,
        `# Messages: ${messages.length}`,
        '',
      ]

      for (const msg of messages) {
        if (msg.role === 'system') continue // Skip system prompt
        const prefix = msg.role === 'user' ? '## User' :
                       msg.role === 'assistant' ? '## Assistant' :
                       `## Tool (${msg.tool_call_id || 'result'})`
        lines.push(prefix)
        if (msg.content) lines.push(msg.content)
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            lines.push(`[Tool Call: ${tc.function.name}(${tc.function.arguments.slice(0, 100)})]`)
          }
        }
        lines.push('')
      }

      const text = lines.join('\n')

      if (arg) {
        // Write to file
        const { writeFileSync } = await import('fs')
        const outPath = resolve(agent.getCwd(), arg)
        writeFileSync(outPath, text, 'utf-8')
        console.log(ui.c.success(`  ✓ Exported ${messages.length} messages to ${outPath}`))
      } else {
        // Generate default filename
        const { writeFileSync } = await import('fs')
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const filename = `blaze-export-${ts}.md`
        const outPath = resolve(agent.getCwd(), filename)
        writeFileSync(outPath, text, 'utf-8')
        console.log(ui.c.success(`  ✓ Exported ${messages.length} messages to ${filename}`))
      }
      continue
    }

    // ── /theme ──
    if (cmdLower.startsWith('/theme')) {
      const arg = cmd.slice(6).trim().toLowerCase()
      const themes: Record<string, Record<string, string>> = {
        dark:   { brand: '#FF6B35', user: '#6366F1', tool: '#22C55E', assistant: '#E2E8F0', dim: '#64748B' },
        light:  { brand: '#D94F1A', user: '#4F46E5', tool: '#16A34A', assistant: '#1E293B', dim: '#94A3B8' },
        ocean:  { brand: '#06B6D4', user: '#8B5CF6', tool: '#14B8A6', assistant: '#CBD5E1', dim: '#475569' },
        forest: { brand: '#84CC16', user: '#F59E0B', tool: '#22C55E', assistant: '#D9F99D', dim: '#4B5563' },
        rose:   { brand: '#F43F5E', user: '#EC4899', tool: '#A855F7', assistant: '#FCE7F3', dim: '#6B7280' },
      }

      if (!arg || !themes[arg]) {
        console.log(ui.c.bold('\n  Available themes:'))
        for (const name of Object.keys(themes)) {
          const t = themes[name]!
          const sample = chalk.hex(t.brand!)('██') + chalk.hex(t.user!)('██') + chalk.hex(t.tool!)('██') + chalk.hex(t.assistant!)('██')
          const current = name === (config as unknown as Record<string, unknown>).theme ? ui.c.success(' (active)') : ''
          console.log(`    ${ui.c.info(name.padEnd(10))} ${sample}${current}`)
        }
        console.log(ui.c.dim('\n  Usage: /theme dark|light|ocean|forest|rose'))
        continue
      }

      const theme = themes[arg]!
      // Apply theme by updating the color functions
      ui.c.brand = (t: string) => chalk.hex(theme.brand!).bold(t)
      ui.c.user = (t: string) => chalk.hex(theme.user!)(t)
      ui.c.tool = (t: string) => chalk.hex(theme.tool!)(t)
      ui.c.toolName = (t: string) => chalk.hex(theme.tool!).bold(t)
      ui.c.assistant = (t: string) => chalk.hex(theme.assistant!)(t)
      ui.c.dim = (t: string) => chalk.hex(theme.dim!)(t)
      ;(config as unknown as Record<string, unknown>).theme = arg
      console.log(ui.c.success(`  ✓ Theme set to ${arg}`))
      continue
    }

    // ── /vim ──
    if (cmdLower === '/vim') {
      console.log(ui.c.dim('  Vim mode is not yet available in terminal readline.'))
      console.log(ui.c.dim('  Tip: Your terminal may support vim mode natively:'))
      console.log(ui.c.dim('    bash: set -o vi'))
      console.log(ui.c.dim('    zsh:  bindkey -v'))
      console.log(ui.c.dim('    PowerShell: Set-PSReadlineOption -EditMode Vi'))
      continue
    }

    // ── /copy ──
    if (cmdLower === '/copy') {
      const msgs = agent.getMessages()
      const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant' && m.content)
      if (!lastAssistant?.content) {
        console.log(ui.c.dim('  No assistant response to copy.'))
        continue
      }
      try {
        const clipCmd = process.platform === 'win32' ? 'clip' :
                        process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard'
        execSync(clipCmd, { input: lastAssistant.content, stdio: ['pipe', 'pipe', 'pipe'] })
        console.log(ui.c.success(`  ✓ Copied ${lastAssistant.content.length} chars to clipboard`))
      } catch {
        // Fallback: save to file
        const tmpPath = resolve(agent.getCwd(), '.blaze-clipboard.txt')
        writeFileSync(tmpPath, lastAssistant.content, 'utf-8')
        console.log(ui.c.success(`  ✓ Saved to ${tmpPath} (clipboard command not available)`))
      }
      continue
    }

    // ── /rename ──
    if (cmdLower.startsWith('/rename')) {
      const name = cmd.slice(7).trim()
      if (!name) {
        console.log(ui.c.dim('  Usage: /rename <session-name>'))
        continue
      }
      // Save with new session ID based on the name
      const sessions = agent.listSessions()
      if (sessions.length > 0) {
        console.log(ui.c.success(`  ✓ Session renamed to "${name}"`))
        // We store the name in a meta file alongside the session
        const metaPath = resolve(agent.getCwd(), '.blaze', 'session-name.txt')
        const { mkdirSync } = await import('fs')
        mkdirSync(resolve(agent.getCwd(), '.blaze'), { recursive: true })
        writeFileSync(metaPath, name, 'utf-8')
      } else {
        console.log(ui.c.dim('  No active session to rename.'))
      }
      continue
    }

    // ── /stats ──
    if (cmdLower === '/stats') {
      const sessions = agent.listSessions()
      let totalTokens = 0
      let totalMessages = 0
      let totalSessions = sessions.length

      for (const s of sessions) {
        try {
          const { readFileSync: rfs } = await import('fs')
          const data = JSON.parse(rfs(s.path, 'utf-8'))
          totalTokens += (data.totalInputTokens || 0) + (data.totalOutputTokens || 0)
          totalMessages += data.messages?.length || 0
        } catch { /* skip */ }
      }

      console.log(ui.c.bold('\n  📊 Blaze CLI Stats'))
      console.log(ui.c.dim('  ─────────────────────────────'))
      console.log(ui.c.dim('  Sessions:      ') + ui.c.assistant(String(totalSessions)))
      console.log(ui.c.dim('  Total messages: ') + ui.c.assistant(String(totalMessages)))
      console.log(ui.c.dim('  Total tokens:   ') + ui.c.assistant(`~${totalTokens.toLocaleString()}`))
      console.log(ui.c.dim('  Current model:  ') + ui.c.info(agent.getCurrentModel()))
      console.log(ui.c.dim('  Current CWD:    ') + ui.c.assistant(agent.getCwd()))

      if (sessions.length > 0) {
        const first = sessions[sessions.length - 1]!
        const last = sessions[0]!
        console.log(ui.c.dim('  First session:  ') + ui.c.dim(getTimeAgo(first.date)))
        console.log(ui.c.dim('  Last session:   ') + ui.c.dim(getTimeAgo(last.date)))
      }
      continue
    }

    // ── /skills ──
    if (cmdLower === '/skills') {
      const skills = loadSkills(agent.getCwd())
      if (skills.length === 0) {
        console.log(ui.c.dim('  No skills found.'))
        console.log(ui.c.dim('  Create .blaze/skills/*.md files or run /skills init'))
        continue
      }
      console.log(ui.c.bold('\n  Available Skills:'))
      for (const s of skills) {
        const src = s.source === 'project' ? ui.c.tool('project') : ui.c.dim('global')
        console.log(`    ${ui.c.info('/' + s.name)} — ${ui.c.dim(s.description || '(no description)')} [${src}]`)
      }
      continue
    }

    // ── /skills init ──
    if (cmdLower === '/skills init') {
      const result = initSkills(agent.getCwd())
      console.log(ui.c.success(`  ✓ ${result}`))
      console.log(ui.c.dim('  Edit the .md files to customize your skills.'))
      continue
    }

    // ── /review ──
    if (cmdLower === '/review') {
      // Use the new pattern-based review engine first, then LLM review
      const reviewResult = reviewChanges(agent.getCwd())
      if (reviewResult.findings.length > 0) {
        console.log(formatReviewResult(reviewResult))
        console.log(ui.c.dim('\n  Running LLM-powered deep review...'))
      }
      await agent.run(
        'Perform a thorough security and code quality review:\n' +
        '1. Run `git diff` to see recent changes\n' +
        '2. Check for security vulnerabilities (SQL injection, XSS, exposed secrets, hardcoded credentials)\n' +
        '3. Check for code quality issues (unused variables, missing error handling, potential crashes)\n' +
        '4. Check for performance concerns (N+1 queries, unnecessary re-renders, memory leaks)\n' +
        '5. Summarize findings with severity levels: 🔴 Critical, 🟡 Warning, 🔵 Info'
      )
      continue
    }

    // ── /scan ── (instant pattern-based security scan, no LLM needed)
    if (cmdLower === '/scan') {
      const result = reviewChanges(agent.getCwd())
      console.log(formatReviewResult(result))
      continue
    }

    // ── /context ── (smart context analysis)
    if (cmdLower.startsWith('/context')) {
      const contextArg = cmd.slice(8).trim()
      if (contextArg === 'full' || contextArg === 'analyze') {
        // Full project analysis
        const fp = fingerprintProject(agent.getCwd())
        console.log(ui.c.bold('\n  🔍 Project Analysis'))
        console.log(ui.c.dim('  ─────────────────────────────'))
        console.log(ui.c.dim('  Name:          ') + ui.c.assistant(fp.name))
        console.log(ui.c.dim('  Languages:     ') + ui.c.assistant(fp.languages.join(', ') || 'Unknown'))
        console.log(ui.c.dim('  Frameworks:    ') + ui.c.assistant(fp.frameworks.join(', ') || 'None detected'))
        console.log(ui.c.dim('  Pkg Manager:   ') + ui.c.assistant(fp.packageManager))
        if (fp.buildCommand) console.log(ui.c.dim('  Build:         ') + ui.c.assistant(fp.buildCommand))
        if (fp.testCommand) console.log(ui.c.dim('  Test:          ') + ui.c.assistant(fp.testCommand))
        if (fp.lintCommand) console.log(ui.c.dim('  Lint:          ') + ui.c.assistant(fp.lintCommand))
        if (fp.entryPoints.length) console.log(ui.c.dim('  Entry Points:  ') + ui.c.assistant(fp.entryPoints.join(', ')))
        if (fp.conventions.length) console.log(ui.c.dim('  Conventions:  ') + ui.c.assistant(fp.conventions.join(', ')))
        console.log(ui.c.dim('  Key Dirs:      ') + ui.c.assistant(fp.keyDirs.slice(0, 10).join(', ')))

        // Recent changes
        const changes = getRecentChanges(agent.getCwd(), 5)
        if (changes.length > 0) {
          console.log(formatRecentChanges(changes))
        }
        continue
      }

      // Default: show context window usage (existing behavior)
      ui.printContextGrid(agent.getEstimatedTokens(), agent.getMaxContextTokens())
      continue
    }

    // ── /git ── (smart git commands)
    if (cmdLower.startsWith('/git')) {
      const gitArg = cmd.slice(4).trim().toLowerCase()

      if (!isGitRepo(agent.getCwd())) {
        console.log(ui.c.error('  ✗ Not a git repository'))
        continue
      }

      if (!gitArg || gitArg === 'status') {
        const changes = getChangedFiles(agent.getCwd())
        if (changes.length === 0) {
          console.log(ui.c.success('  ✓ Working tree clean'))
        } else {
          console.log(ui.c.bold('\n  Changed Files:'))
          for (const c of changes) {
            const icon = c.status === 'A' || c.status === '??' ? ui.c.success('➕') :
                         c.status === 'D' ? ui.c.error('🗑️') :
                         c.status === 'R' ? ui.c.info('📝') : ui.c.warn('✏️')
            console.log(`  ${icon} ${c.status.padEnd(3)} ${c.path}`)
          }
        }
        continue
      }

      if (gitArg === 'commit' || gitArg === 'smart-commit') {
        const msg = cmd.slice(4).trim().split(' ').slice(1).join(' ')
        const result = smartCommit(agent.getCwd(), msg || undefined)
        console.log(ui.c.assistant(`  ${result}`))
        continue
      }

      if (gitArg === 'message' || gitArg === 'msg') {
        const message = generateCommitMessage(agent.getCwd())
        console.log(ui.c.bold('\n  Suggested commit message:'))
        console.log(ui.c.assistant(`  ${message}`))
        console.log(ui.c.dim('\n  Use /git commit to auto-commit with this message'))
        continue
      }

      if (gitArg === 'diff') {
        const diff = getDiff(agent.getCwd())
        if (!diff) {
          console.log(ui.c.dim('  No unstaged changes.'))
        } else {
          const lines = diff.split('\n').slice(0, 80)
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              console.log(ui.c.success(`  ${line}`))
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              console.log(ui.c.error(`  ${line}`))
            } else if (line.startsWith('@@')) {
              console.log(ui.c.info(`  ${line}`))
            } else {
              console.log(ui.c.dim(`  ${line}`))
            }
          }
          if (diff.split('\n').length > 80) {
            console.log(ui.c.dim(`  ... (${diff.split('\n').length - 80} more lines)`))
          }
        }
        continue
      }

      if (gitArg === 'branch' || gitArg === 'branches') {
        const analysis = analyzeBranchChanges(agent.getCwd())
        console.log(ui.c.bold('\n  Branch Analysis:'))
        console.log(analysis)
        continue
      }

      if (gitArg === 'pr') {
        const pr = generatePRDescription(agent.getCwd())
        console.log(pr)
        continue
      }

      console.log(ui.c.dim('  Usage: /git [status|diff|commit|message|branch|pr]'))
      continue
    }

    // ── /pipeline ──
    if (cmdLower.startsWith('/pipeline') || cmdLower.startsWith('/pipe')) {
      const pipeArg = cmd.slice(cmdLower.startsWith('/pipeline') ? 9 : 5).trim()

      if (!pipeArg || pipeArg === 'list') {
        const pipelines = loadPipelines(agent.getCwd())
        if (pipelines.length === 0) {
          console.log(ui.c.dim('  No pipelines found.'))
          console.log(ui.c.dim('  Create .blaze/pipelines/*.md files or run /pipeline init'))
          continue
        }
        console.log(ui.c.bold('\n  Available Pipelines:'))
        for (const p of pipelines) {
          const src = p.source === 'project' ? ui.c.tool('project') : ui.c.dim('global')
          const steps = p.steps.map(s => s.name).join(' → ')
          console.log(`    ${ui.c.info(`/${p.name}`)} ${ui.c.dim(`(${p.steps.length} steps)`)} [${src}]`)
          console.log(ui.c.dim(`      ${steps}`))
          if (p.description) console.log(ui.c.dim(`      ${p.description}`))
        }
        continue
      }

      if (pipeArg === 'init') {
        const result = initPipelines(agent.getCwd())
        console.log(ui.c.success(`  ✓ ${result}`))
        console.log(ui.c.dim('  Edit the .md files to customize your pipelines.'))
        continue
      }

      // Run a pipeline by name
      const pipeline = findPipeline(agent.getCwd(), pipeArg)
      if (pipeline) {
        await runPipeline(agent, pipeline)
        continue
      }

      console.log(ui.c.error(`  ✗ Pipeline "${pipeArg}" not found.`))
      console.log(ui.c.dim('  Use /pipeline to list available pipelines.'))
      continue
    }

    // ── /budget ──
    if (cmdLower.startsWith('/budget')) {
      const budgetArg = cmd.slice(7).trim().toLowerCase()

      if (budgetArg === 'usage' || budgetArg === 'breakdown') {
        console.log(formatUsageBreakdown())
        continue
      }

      if (budgetArg === 'reset') {
        resetSessionSpend()
        console.log(ui.c.success('  ✓ Session budget reset'))
        continue
      }

      // Show budget status
      const status = checkBudget(agent.getCwd())
      console.log(formatBudgetStatus(status))
      continue
    }

    // ── /mcp ──
    if (cmdLower.startsWith('/mcp')) {
      const mcpArg = cmd.slice(4).trim().toLowerCase()

      if (mcpArg === 'start' || mcpArg === 'serve') {
        const port = parseInt(mcpArg === 'serve' ? cmd.split(' ')[2] || '3100' : '3100', 10) || 3100
        console.log(ui.c.info(`  Starting MCP server on port ${port}...`))
        try {
          const server = new MCPServer(port)
          const actualPort = await server.start()
          console.log(ui.c.success(`  ✓ MCP server running on http://localhost:${actualPort}`))
          console.log(ui.c.dim('  Available endpoints:'))
          console.log(ui.c.dim(`    GET  http://localhost:${actualPort}/     — Server status`))
          console.log(ui.c.dim(`    POST http://localhost:${actualPort}/mcp  — MCP JSON-RPC`))
          console.log(ui.c.dim('  Press Ctrl+C to stop'))
          // Keep the server running until Ctrl+C
          await new Promise(() => {})
        } catch (err: unknown) {
          console.log(ui.c.error(`  ✗ Failed to start MCP server: ${(err as Error).message}`))
        }
        continue
      }

      console.log(ui.c.bold('\n  MCP (Model Context Protocol)'))
      console.log(ui.c.dim('  ─────────────────────────────'))
      console.log(ui.c.dim('  Blaze can act as an MCP server, exposing its tools to IDEs and other AI tools.'))
      console.log()
      console.log(ui.c.bold('  Commands:'))
      console.log(ui.c.dim('  /mcp start    ') + ui.c.assistant('Start MCP server (default port 3100)'))
      console.log(ui.c.dim('  /mcp serve <port>') + ui.c.assistant('Start MCP server on custom port'))
      console.log()
      console.log(ui.c.bold('  Configuration (add to your IDE):'))
      console.log(ui.c.dim('  {'))
      console.log(ui.c.dim('    "mcpServers": {'))
      console.log(ui.c.dim('      "blaze": {'))
      console.log(ui.c.dim('        "url": "http://localhost:3100/mcp"'))
      console.log(ui.c.dim('      }'))
      console.log(ui.c.dim('    }'))
      console.log(ui.c.dim('  }'))
      continue
    }
    // ── /powerup ──
    if (cmdLower === '/powerup' || cmdLower === '/tutorial' || cmdLower === '/learn') {
      await runPowerup()
      continue
    }

    // ── /plugins ──
    if (cmdLower.startsWith('/plugins') || cmdLower.startsWith('/plugin')) {
      const pluginArgs = cmd.slice(cmd.indexOf(' ') + 1).trim()
      const parts = pluginArgs.split(' ').filter(Boolean)
      const subCmd = parts[0]?.toLowerCase() || ''

      if (!subCmd || subCmd === 'list' || pluginArgs === cmd.slice(1)) {
        // Show all plugins
        const plugins = listRegistryPlugins()
        console.log(formatPluginList(plugins, agent.getCwd()))
        continue
      }

      if (subCmd === 'search') {
        const query = parts.slice(1).join(' ')
        if (!query) { console.log(ui.c.dim('  Usage: /plugins search <query>')); continue }
        const results = listRegistryPlugins(query)
        if (results.length === 0) {
          console.log(ui.c.dim(`  No plugins matching "${query}"`))
        } else {
          console.log(formatPluginList(results, agent.getCwd()))
        }
        continue
      }

      if (subCmd === 'install' || subCmd === 'add') {
        const name = parts[1]
        if (!name) { console.log(ui.c.dim('  Usage: /plugins install <name>')); continue }
        const global = parts.includes('--global') || parts.includes('-g')
        const path = installPlugin(agent.getCwd(), name, global)
        if (path) {
          console.log(ui.c.success(`  ✓ Plugin "${name}" installed to: ${path}`))
          console.log(ui.c.dim(`  Use /${name} to activate it`))
        } else {
          console.log(ui.c.error(`  ✗ Plugin "${name}" not found in registry`))
          console.log(ui.c.dim('  Run /plugins to see available plugins'))
        }
        continue
      }

      if (subCmd === 'remove' || subCmd === 'uninstall') {
        const name = parts[1]
        if (!name) { console.log(ui.c.dim('  Usage: /plugins remove <name>')); continue }
        if (uninstallPlugin(agent.getCwd(), name)) {
          console.log(ui.c.success(`  ✓ Plugin "${name}" removed`))
        } else {
          console.log(ui.c.error(`  ✗ Plugin "${name}" not installed`))
        }
        continue
      }

      if (subCmd === 'installed') {
        const installed = getInstalledPlugins(agent.getCwd())
        if (installed.length === 0) {
          console.log(ui.c.dim('  No plugins installed. Run /plugins to browse.'))
        } else {
          console.log(ui.c.bold('\n  Installed Plugins:'))
          for (const name of installed) {
            console.log(`    ${ui.c.success('✓')} ${ui.c.info(name)}`)
          }
        }
        continue
      }

      console.log(ui.c.dim('  Usage: /plugins [list|search|install|remove|installed]'))
      continue
    }

    // ── /doctor ──
    if (cmdLower === '/doctor') {
      console.log(ui.c.bold('\n  🩺 Blaze CLI Doctor'))
      console.log(ui.c.dim('  ─────────────────────────────'))

      // Node
      try {
        const nodeV = execSync('node --version', { encoding: 'utf-8' }).trim()
        console.log(ui.c.success('  ✓ ') + ui.c.dim('Node.js: ') + ui.c.assistant(nodeV))
      } catch { console.log(ui.c.error('  ✗ Node.js not found')) }

      // Git
      try {
        const gitV = execSync('git --version', { encoding: 'utf-8' }).trim()
        console.log(ui.c.success('  ✓ ') + ui.c.dim('Git: ') + ui.c.assistant(gitV))
      } catch { console.log(ui.c.warn('  ⚠ Git not found')) }

      // Ollama
      try {
        const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) })
        const data = await resp.json() as { models?: Array<{ name: string }> }
        console.log(ui.c.success('  ✓ ') + ui.c.dim('Ollama: ') + ui.c.assistant(`${data.models?.length || 0} model(s)`))
      } catch { console.log(ui.c.warn('  ⚠ Ollama not running')) }

      // Config
      console.log(ui.c.success('  ✓ ') + ui.c.dim('Model: ') + ui.c.assistant(agent.getCurrentModel()))
      console.log(ui.c.success('  ✓ ') + ui.c.dim('URL: ') + ui.c.assistant(agent.getCurrentUrl()))
      console.log(ui.c.success('  ✓ ') + ui.c.dim('Memory: ') + ui.c.assistant(config.memoryEnabled ? 'enabled' : 'disabled'))
      console.log(ui.c.success('  ✓ ') + ui.c.dim('Skills: ') + ui.c.assistant(`${loadSkills(agent.getCwd()).length} loaded`))
      continue
    }

    // ── /team ──
    if (cmdLower.startsWith('/team')) {
      const teamArgs = cmd.slice(5).trim()
      const parts = teamArgs.split(' ').filter(Boolean)
      const subCmd = parts[0]?.toLowerCase() || ''

      if (!subCmd || subCmd === 'status') {
        // Show team status
        const team = getActiveTeam()
        if (!team) {
          console.log(ui.c.dim('  No active team. Create one with:'))
          console.log(ui.c.dim('  /team create'))
          console.log(ui.c.dim('  /team add <name> <role>'))
          console.log(ui.c.dim('  /team task <worker> <description>'))
          console.log(ui.c.dim('  /team run'))
        } else {
          console.log(team.getStatus())
        }
        continue
      }

      if (subCmd === 'create') {
        const team = createTeam(agent.getCwd())
        console.log(ui.c.success('  ✓ Team created! Now add workers:'))
        console.log(ui.c.dim('  /team add frontend "Frontend specialist — React, CSS, UI"'))
        console.log(ui.c.dim('  /team add backend "Backend specialist — API, database, auth"'))
        continue
      }

      if (subCmd === 'add') {
        const team = getActiveTeam()
        if (!team) { console.log(ui.c.error('  ✗ No team. Run /team create first.')); continue }
        const workerName = parts[1]
        const role = parts.slice(2).join(' ') || 'General worker'
        if (!workerName) { console.log(ui.c.dim('  Usage: /team add <name> <role>')); continue }
        team.addWorker(workerName, role)
        console.log(ui.c.success(`  ✓ Added worker "${workerName}" (${role})`))
        continue
      }

      if (subCmd === 'remove') {
        const team = getActiveTeam()
        if (!team) { console.log(ui.c.error('  ✗ No team.')); continue }
        const name = parts[1]
        if (!name) { console.log(ui.c.dim('  Usage: /team remove <name>')); continue }
        team.removeWorker(name) ? console.log(ui.c.success(`  ✓ Removed ${name}`)) : console.log(ui.c.error(`  ✗ Worker "${name}" not found`))
        continue
      }

      if (subCmd === 'task') {
        const team = getActiveTeam()
        if (!team) { console.log(ui.c.error('  ✗ No team.')); continue }
        const workerName = parts[1]
        const desc = parts.slice(2).join(' ')
        if (!workerName || !desc) { console.log(ui.c.dim('  Usage: /team task <worker> <description>')); continue }
        const task = team.assignTask(desc, workerName)
        console.log(ui.c.success(`  ✓ Task ${task.id} assigned to ${workerName}: ${desc}`))
        continue
      }

      if (subCmd === 'msg' || subCmd === 'send') {
        const team = getActiveTeam()
        if (!team) { console.log(ui.c.error('  ✗ No team.')); continue }
        const from = parts[1]
        const to = parts[2]
        const content = parts.slice(3).join(' ')
        if (!from || !to || !content) { console.log(ui.c.dim('  Usage: /team msg <from> <to> <message>')); continue }
        team.sendMessage(from, to, content)
        console.log(ui.c.success(`  ✓ Message sent: ${from} → ${to}`))
        continue
      }

      if (subCmd === 'run') {
        const team = getActiveTeam()
        if (!team) { console.log(ui.c.error('  ✗ No team.')); continue }
        const workerName = parts[1]
        if (workerName) {
          // Run specific worker
          console.log(ui.c.dim(`  Running ${workerName}...`))
          const result = await team.runWorker(workerName)
          console.log(result)
        } else {
          // Run all workers in parallel
          const results = await team.runAll()
          console.log(ui.c.bold('\n  📊 Team Results:'))
          for (const [name, result] of results) {
            console.log(`\n  ${ui.c.info(`[${name}]`)}`)
            const lines = result.split('\n').slice(0, 10)
            for (const line of lines) {
              console.log(ui.c.dim('    ') + line)
            }
            if (result.split('\n').length > 10) {
              console.log(ui.c.dim(`    ... (${result.split('\n').length - 10} more lines)`))
            }
          }
        }
        continue
      }

      if (subCmd === 'destroy' || subCmd === 'disband') {
        destroyTeam()
        console.log(ui.c.success('  ✓ Team disbanded.'))
        continue
      }

      // Auto-delegate: /team <prompt> → coordinator splits work
      if (subCmd && !['create', 'add', 'remove', 'task', 'msg', 'send', 'run', 'status', 'destroy', 'disband'].includes(subCmd)) {
        const team = getActiveTeam()
        if (!team) {
          console.log(ui.c.error('  ✗ No team. Run /team create first.'))
          continue
        }
        // Use the main agent to coordinate
        const workers = team.getWorkerNames()
        const workerList = workers.map(n => `- ${n}`).join('\n')
        const coordPrompt = `You are a coordinator. You have these team workers available:\n${workerList}\n\nThe user wants: ${teamArgs}\n\nBreak this into tasks and tell me which worker should handle each part. Format as:\nWORKER_NAME: task description\n\nBe specific about what each worker should do.`

        console.log(ui.c.dim('  🤖 Coordinator analyzing task...'))
        const plan = await agent.run(coordPrompt)

        // Parse coordinator output and auto-assign tasks
        if (plan) {
          const taskLines = plan.split('\n').filter(l => l.includes(':'))
          let assigned = 0
          for (const line of taskLines) {
            const colonIdx = line.indexOf(':')
            if (colonIdx <= 0) continue
            const worker = line.slice(0, colonIdx).trim().replace(/^[-*•]\s*/, '')
            const taskDesc = line.slice(colonIdx + 1).trim()
            // Check if worker exists
            if (workers.some(w => w.toLowerCase() === worker.toLowerCase()) && taskDesc) {
              const matchedWorker = workers.find(w => w.toLowerCase() === worker.toLowerCase())!
              team.assignTask(taskDesc, matchedWorker)
              assigned++
            }
          }
          if (assigned > 0) {
            console.log(ui.c.success(`\n  ✓ ${assigned} task(s) assigned. Running team...`))
            const results = await team.runAll()
            console.log(ui.c.bold('\n  📊 Team Results:'))
            for (const [name, result] of results) {
              console.log(`\n  ${ui.c.info(`[${name}]`)}`)
              for (const line of result.split('\n').slice(0, 8)) {
                console.log(ui.c.dim('    ') + line)
              }
            }
          } else {
            console.log(ui.c.dim('  Could not auto-assign tasks. Use /team task <worker> <desc> manually.'))
          }
        }
        continue
      }
      continue
    }

    // ── /tasks ──
    if (cmdLower === '/tasks' || cmdLower === '/bg') {
      printTasks()
      continue
    }

    // ── /tasks clean ──
    if (cmdLower === '/tasks clean') {
      const n = cleanTasks()
      console.log(ui.c.success(`  ✓ Cleaned ${n} completed task(s)`))
      continue
    }

    // ── /run (background task) ──
    if (cmdLower.startsWith('/run ')) {
      const taskPrompt = cmd.slice(5).trim()
      if (!taskPrompt) {
        console.log(ui.c.dim('  Usage: /run <prompt> — runs in background'))
        continue
      }
      const task = await createTask(taskPrompt, agent.getCwd())
      console.log(ui.c.success(`  ✓ Background task started: ${task.id}`))
      console.log(ui.c.dim('  Check status with /tasks'))
      continue
    }

    // ── /loop ──
    if (cmdLower.startsWith('/loop')) {
      const loopArgs = cmd.slice(5).trim()
      if (!loopArgs) {
        printCronJobs()
        continue
      }

      // Parse: /loop <interval> <prompt>
      const parts = loopArgs.split(' ')
      const intervalStr = parts[0]!
      const loopPrompt = parts.slice(1).join(' ')

      if (intervalStr === 'stop') {
        // Stop all or specific
        const jobId = parts[1]
        if (jobId) {
          stopCronJob(jobId) ? console.log(ui.c.success(`  ✓ Stopped ${jobId}`)) : console.log(ui.c.error(`  ✗ Job not found`))
        } else {
          stopAllCronJobs()
          console.log(ui.c.success('  ✓ All cron jobs stopped'))
        }
        continue
      }

      const interval = parseInterval(intervalStr)
      if (!interval || !loopPrompt) {
        console.log(ui.c.dim('  Usage: /loop <interval> <prompt>'))
        console.log(ui.c.dim('  Example: /loop 5m "check build status"'))
        console.log(ui.c.dim('  Intervals: 30s, 5m, 1h, 1d'))
        console.log(ui.c.dim('  /loop stop — stop all cron jobs'))
        continue
      }

      const job = createCronJob(interval, loopPrompt, agent.getCwd())
      console.log(ui.c.success(`  ✓ Cron job created: ${job.id}`))
      console.log(ui.c.dim(`  Running "${loopPrompt}" every ${formatInterval(interval)}`))
      continue
    }

    // ── /tag ──
    if (cmdLower.startsWith('/tag')) {
      const tagArg = cmd.slice(4).trim()
      const tagFile = resolve(agent.getCwd(), '.blaze', 'tags.json')

      if (!tagArg) {
        // Show tags
        if (existsSync(tagFile)) {
          try {
            const tags = JSON.parse(readFileSync(tagFile, 'utf-8')) as string[]
            console.log(ui.c.bold('\n  Session Tags: ') + tags.map(t => ui.c.info(`#${t}`)).join(' '))
          } catch {
            console.log(ui.c.dim('  No tags.'))
          }
        } else {
          console.log(ui.c.dim('  No tags. Usage: /tag <name>'))
        }
        continue
      }

      // Add tag
      const { mkdirSync: mkd } = await import('fs')
      mkd(resolve(agent.getCwd(), '.blaze'), { recursive: true })
      let tags: string[] = []
      if (existsSync(tagFile)) {
        try { tags = JSON.parse(readFileSync(tagFile, 'utf-8')) as string[] } catch { tags = [] }
      }
      if (!tags.includes(tagArg)) {
        tags.push(tagArg)
        writeFileSync(tagFile, JSON.stringify(tags), 'utf-8')
        console.log(ui.c.success(`  ✓ Tagged: #${tagArg}`))
      } else {
        // Remove if already exists (toggle)
        tags = tags.filter(t => t !== tagArg)
        writeFileSync(tagFile, JSON.stringify(tags), 'utf-8')
        console.log(ui.c.dim(`  Removed tag: #${tagArg}`))
      }
      continue
    }

    // ── /btw ──
    if (cmdLower.startsWith('/btw ')) {
      const btwQuestion = cmd.slice(5).trim()
      if (!btwQuestion) {
        console.log(ui.c.dim('  Usage: /btw <question> — ask a side question'))
        continue
      }
      // Save current messages, run side question, restore
      console.log(ui.c.dim('  📝 Side question...'))
      await agent.run(`[SIDE QUESTION — answer briefly, this is a quick aside]\n${btwQuestion}`)
      continue
    }

    // ── /fast ──
    if (cmdLower === '/fast' || cmdLower === '/fast on' || cmdLower === '/fast off') {
      if (cmdLower === '/fast off') {
        config.maxTokens = 8192
        console.log(ui.c.dim('  Fast mode off. Max tokens: 8192'))
      } else {
        config.maxTokens = 2048
        config.temperature = 0
        console.log(ui.c.success('  ⚡ Fast mode on. Max tokens: 2048 (shorter, faster responses)'))
      }
      continue
    }

    // ── Check for skill command (/<skill-name>) ──
    if (cmd.startsWith('/')) {
      const skillName = cmd.slice(1).split(' ')[0]!
      const skillArgs = cmd.slice(1 + skillName.length).trim()
      const skill = findSkill(agent.getCwd(), skillName)
      if (skill) {
        const prompt = skillArgs ? `${skill.prompt}\n\nAdditional context: ${skillArgs}` : skill.prompt
        console.log(ui.c.info(`  ⚡ Running skill: ${skill.name}`))
        await agent.run(prompt)
        continue
      }

      // Unknown command
      console.log(ui.c.warn(`  Unknown command: ${cmd}`))
      console.log(ui.c.dim('  Type /help for available commands.'))
      continue
    }

    // ── blazeplan keyword detection ──
    if (hasblazeplanKeyword(input)) {
      const upPrompt = stripblazeplanKeyword(input)
      if (!upPrompt.trim()) {
        console.log(ui.c.dim('  Usage: include "blazeplan" with a task, e.g. "blazeplan refactor the auth module"'))
        continue
      }

      console.log('')
      console.log(ui.c.brand('  🔥 blazeplan keyword detected — launching deep multi-agent planning...'))
      console.log(ui.c.dim('  Spawning 3 parallel research agents + 1 critique agent'))
      console.log(ui.c.dim('  Terminal is free — check status in the prompt indicator.'))
      console.log('')

      const upTask = await runblazeplan(upPrompt, agent.getCwd(), config)
      activeblazeplanId = upTask.id
      continue
    }

    // ── Run the agent (not a command) ──
    _sigintCount = 0 // Reset interrupt count before each run
    await agent.run(input)
  }

  process.exit(0)
}

// ── Handle graceful shutdown — soft interrupt or hard exit ──
let _agent: InstanceType<typeof Agent> | null = null
let _sigintCount = 0

process.on('SIGINT', () => {
  _sigintCount++
  ui.stopSpinner()

  // First Ctrl+C: soft interrupt (stop agent run, keep REPL alive)
  if (_sigintCount === 1 && _agent?.isRunning()) {
    _agent.interrupt()
    console.log(ui.c.warn('\n  ⚡ Stopping current run...'))
    // Reset count after a delay so next Ctrl+C is treated fresh
    setTimeout(() => { _sigintCount = 0 }, 2000)
    return
  }

  // Second Ctrl+C (or not running): save and exit
  if (_agent) {
    _agent.emergencySave()
    console.log(ui.c.dim('\n\n  Session saved. Run ') + ui.c.info('blaze --resume') + ui.c.dim(' to continue.\n'))
  } else {
    console.log(ui.c.dim('\n\n  Goodbye! 👋\n'))
  }
  process.exit(0)
})

process.on('uncaughtException', (err) => {
  ui.stopSpinner()
  console.error(ui.c.error(`\n  Fatal error: ${err.message}\n`))
  process.exit(1)
})

main().catch((err) => {
  console.error(ui.c.error(`\n  Fatal error: ${err.message}\n`))
  process.exit(1)
})
