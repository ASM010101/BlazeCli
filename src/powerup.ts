import * as ui from './ui.js'

/**
 * /powerup — Interactive terminal tutorials for Blaze CLI.
 *
 * 5 lessons that teach users the key features with animated output.
 */

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function typeOut(text: string, speed = 25): Promise<void> {
  for (const char of text) {
    process.stdout.write(char)
    await delay(speed)
  }
  process.stdout.write('\n')
}

interface Lesson {
  id: number
  title: string
  description: string
  run: () => Promise<void>
}

const lessons: Lesson[] = [
  {
    id: 1,
    title: '🚀 Your First Task',
    description: 'Learn how to give Blaze a coding task',
    run: async () => {
      console.log()
      await typeOut(ui.c.brand('  ═══ Lesson 1: Your First Task ═══'))
      console.log()
      await typeOut(ui.c.dim('  Blaze is an agentic AI — it doesn\'t just answer, it ACTS.'))
      await typeOut(ui.c.dim('  Give it a task, and it will use tools to complete it.'))
      console.log()

      await typeOut(ui.c.bold('  Try these:'))
      await delay(300)
      await typeOut(ui.c.info('    blaze "create a hello world Express server"'))
      await delay(200)
      await typeOut(ui.c.info('    blaze "find all TODO comments in this project"'))
      await delay(200)
      await typeOut(ui.c.info('    blaze "debug why the tests are failing"'))
      console.log()

      await typeOut(ui.c.bold('  Modes:'))
      await typeOut(ui.c.dim('    Interactive:  ') + ui.c.assistant('blaze') + ui.c.dim('              — REPL mode'))
      await typeOut(ui.c.dim('    Single-shot:  ') + ui.c.assistant('blaze "task"') + ui.c.dim('       — run & exit'))
      await typeOut(ui.c.dim('    Auto-approve: ') + ui.c.assistant('blaze --yes "task"') + ui.c.dim(' — skip permission prompts'))
      await typeOut(ui.c.dim('    Plan mode:    ') + ui.c.assistant('blaze --plan "task"') + ui.c.dim(' — read-only exploration'))
      await typeOut(ui.c.dim('    CI mode:      ') + ui.c.assistant('blaze --ci "task"') + ui.c.dim('  — JSON output for pipelines'))
      console.log()

      await typeOut(ui.c.success('  ✓ Lesson complete! ') + ui.c.dim('When the agent runs, it shows tools it uses'))
      await typeOut(ui.c.dim('    and asks permission for dangerous actions (file writes, shell commands).'))
    },
  },
  {
    id: 2,
    title: '🔧 Tools Deep Dive',
    description: 'Understand Blaze\'s 17 tools',
    run: async () => {
      console.log()
      await typeOut(ui.c.brand('  ═══ Lesson 2: Tools Deep Dive ═══'))
      console.log()
      await typeOut(ui.c.dim('  Blaze has 17 tools. The LLM decides which to use.'))
      console.log()

      const tools = [
        ['Bash       ', 'Run shell commands          ', '⚠️'],
        ['FileRead   ', 'Read file contents          ', '✅'],
        ['FileWrite  ', 'Create/overwrite files      ', '⚠️'],
        ['FileEdit   ', 'Find-and-replace editing    ', '⚠️'],
        ['Grep       ', 'Search text patterns        ', '✅'],
        ['Glob       ', 'Find files by pattern       ', '✅'],
        ['ListDir    ', 'List directory contents     ', '✅'],
        ['WebFetch   ', 'Fetch URL content           ', '✅'],
        ['WebSearch  ', 'Search the web              ', '✅'],
        ['Research   ', 'Spawn isolated sub-agents   ', '✅'],
        ['AskUser    ', 'Ask you questions mid-flow  ', '✅'],
        ['Notebook   ', 'Edit Jupyter notebooks      ', '⚠️'],
        ['Worktree   ', 'Git worktree isolation      ', '⚠️'],
        ['REPL       ', 'Run Python/Node.js code     ', '⚠️'],
        ['Browser    ', 'Automate Chrome/Playwright  ', '⚠️'],
        ['Screenshot ', 'Capture your screen         ', '⚠️'],
        ['ImageGen   ', 'Generate images from text   ', '⚠️'],
      ]

      for (const [name, desc, perm] of tools) {
        await typeOut(`    ${ui.c.toolName(name!)} ${ui.c.dim(desc!)} ${perm}`)
        await delay(80)
      }

      console.log()
      await typeOut(ui.c.dim('  ✅ = safe (auto-approved)  ⚠️ = asks permission'))
      await typeOut(ui.c.dim('  Type /tools to see this list anytime.'))
      console.log()
      await typeOut(ui.c.success('  ✓ Lesson complete!'))
    },
  },
  {
    id: 3,
    title: '📋 Plan Mode & blazeplan',
    description: 'Read-only exploration and deep multi-agent planning',
    run: async () => {
      console.log()
      await typeOut(ui.c.brand('  ═══ Lesson 3: Plan Mode & blazeplan ═══'))
      console.log()

      await typeOut(ui.c.bold('  Plan Mode:'))
      await typeOut(ui.c.dim('  Explore your codebase without making changes.'))
      await typeOut(ui.c.info('    /plan on') + ui.c.dim('  — switch to read-only mode'))
      await typeOut(ui.c.info('    /plan off') + ui.c.dim(' — switch back to execution mode'))
      await typeOut(ui.c.dim('  In plan mode, write tools (Bash, FileWrite, FileEdit) are blocked.'))
      console.log()

      await typeOut(ui.c.bold('  🔥 blazeplan — Deep Multi-Agent Planning:'))
      await delay(300)
      await typeOut(ui.c.dim('  Spawns 3 parallel research agents + 1 critique agent:'))
      await typeOut(ui.c.warn('    Agent 1: ') + ui.c.dim('Architecture Explorer — maps your codebase'))
      await typeOut(ui.c.warn('    Agent 2: ') + ui.c.dim('Files Analyst — finds every file to change'))
      await typeOut(ui.c.warn('    Agent 3: ') + ui.c.dim('Risk Assessor — spots edge cases & breaking changes'))
      await typeOut(ui.c.warn('    Agent 4: ') + ui.c.dim('Plan Critic — reviews the final plan for gaps'))
      console.log()
      await typeOut(ui.c.info('    /blazeplan migrate auth from sessions to JWTs'))
      await typeOut(ui.c.dim('    Terminal stays free while agents work in the background!'))
      console.log()

      await typeOut(ui.c.success('  ✓ Lesson complete!'))
    },
  },
  {
    id: 4,
    title: '🤝 Agent Teams',
    description: 'Multiple agents working together',
    run: async () => {
      console.log()
      await typeOut(ui.c.brand('  ═══ Lesson 4: Agent Teams ═══'))
      console.log()
      await typeOut(ui.c.dim('  Create specialized agents that work in parallel:'))
      console.log()

      const steps = [
        ['/team create', 'Create a new team'],
        ['/team add frontend "React specialist"', 'Add a frontend worker'],
        ['/team add backend "API specialist"', 'Add a backend worker'],
        ['/team task frontend "Build login page"', 'Assign frontend task'],
        ['/team task backend "Create auth API"', 'Assign backend task'],
        ['/team run', 'Run ALL workers in parallel!'],
      ]

      for (const [cmd, desc] of steps) {
        await typeOut(`    ${ui.c.info(cmd!.padEnd(45))} ${ui.c.dim(`← ${desc}`)}`)
        await delay(200)
      }

      console.log()
      await typeOut(ui.c.bold('  Auto-coordinate mode:'))
      await typeOut(ui.c.info('    /team build a complete blog with auth'))
      await typeOut(ui.c.dim('    → Blaze auto-splits work across workers!'))
      console.log()

      await typeOut(ui.c.success('  ✓ Lesson complete!'))
    },
  },
  {
    id: 5,
    title: '⚡ Pro Tips',
    description: 'Failover, memory, pipelines, budget, and more',
    run: async () => {
      console.log()
      await typeOut(ui.c.brand('  ═══ Lesson 5: Pro Tips ═══'))
      console.log()

      await typeOut(ui.c.bold('  🔀 Multi-Provider Failover:'))
      await typeOut(ui.c.dim('  Rate limited? Blaze auto-detects alternatives:'))
      await typeOut(ui.c.info('    /switch') + ui.c.dim(' — manually pick a new model'))
      await typeOut(ui.c.dim('  Set API keys in ~/.blaze/.env for more options.'))
      console.log()

      await typeOut(ui.c.bold('  🧠 Auto-Memory:'))
      await typeOut(ui.c.dim('  Blaze remembers things across sessions:'))
      await typeOut(ui.c.info('    /memory') + ui.c.dim(' — view saved memories'))
      await typeOut(ui.c.dim('  Memories are per-project and global.'))
      console.log()

      await typeOut(ui.c.bold('  📊 Budget Tracking:'))
      await typeOut(ui.c.info('    /budget') + ui.c.dim(' — see real-time cost tracking'))
      await typeOut(ui.c.dim('  Tracks daily, session, and project spending.'))
      console.log()

      await typeOut(ui.c.bold('  🔄 Pipelines:'))
      await typeOut(ui.c.dim('  Define multi-step workflows in .blaze/pipelines/:'))
      await typeOut(ui.c.info('    /pipeline init') + ui.c.dim(' — create example pipelines'))
      console.log()

      await typeOut(ui.c.bold('  🛡️ Security:'))
      await typeOut(ui.c.info('    /scan') + ui.c.dim('    — instant security scan (no LLM needed!)'))
      await typeOut(ui.c.info('    /review') + ui.c.dim('  — full LLM-powered code review'))
      console.log()

      await typeOut(ui.c.bold('  🎨 Customization:'))
      await typeOut(ui.c.info('    /theme ocean') + ui.c.dim(' — switch color theme'))
      await typeOut(ui.c.info('    /skills init') + ui.c.dim(' — create custom skill commands'))
      console.log()

      await typeOut(ui.c.success('  ✓ All lessons complete! You\'re a Blaze power user! 🔥'))
      await typeOut(ui.c.dim('  Type /help for the full command reference.'))
    },
  },
]

/** Show the lesson picker */
export async function runPowerup(): Promise<void> {
  console.log()
  console.log(ui.c.brand('  🔥 BLAZE POWERUP — Interactive Tutorial'))
  console.log(ui.c.dim('  ─────────────────────────────────────────'))
  console.log()

  for (const lesson of lessons) {
    console.log(`    ${ui.c.info(String(lesson.id))}. ${ui.c.bold(lesson.title)} — ${ui.c.dim(lesson.description)}`)
  }
  console.log(`    ${ui.c.info('A')}. ${ui.c.bold('Run all lessons')}`)
  console.log(`    ${ui.c.dim('0')}. ${ui.c.dim('Cancel')}`)
  console.log()

  const answer = await ui.getUserInput(ui.c.info('  Pick a lesson [1-5/A]: '))
  const pick = answer.trim().toLowerCase()

  if (pick === '0' || !pick) {
    console.log(ui.c.dim('  Cancelled.'))
    return
  }

  if (pick === 'a' || pick === 'all') {
    for (const lesson of lessons) {
      await lesson.run()
      console.log()
      await delay(500)
    }
    return
  }

  const idx = parseInt(pick, 10)
  const lesson = lessons.find(l => l.id === idx)
  if (lesson) {
    await lesson.run()
  } else {
    console.log(ui.c.error(`  ✗ Unknown lesson: ${pick}`))
  }
}
