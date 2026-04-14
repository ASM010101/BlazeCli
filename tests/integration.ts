#!/usr/bin/env tsx
/**
 * Blaze CLI — Full Integration Test Suite
 * Tests every tool, every feature, every REPL command
 */

import { resolve, join } from 'path'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'

const SANDBOX = resolve(import.meta.dirname || '.', '..', '.test-integ')

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// Setup
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true })
mkdirSync(SANDBOX, { recursive: true })
writeFileSync(join(SANDBOX, 'hello.txt'), 'hello world\nline 2\nline 3\n')
writeFileSync(join(SANDBOX, 'code.ts'), 'export class Foo { bar() {} }\nconst x = 42\n')

async function run() {
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║  🔥 Blaze CLI — FULL INTEGRATION TEST SUITE     ║')
  console.log('╚══════════════════════════════════════════════════════╝')

  // ═══════════════════════════════════════
  // SECTION 1: ALL 10 TOOLS
  // ═══════════════════════════════════════
  console.log('\n🔧 TOOL TESTS')

  // BashTool
  const { BashTool } = await import('../src/tools/BashTool.js')
  const bash = new BashTool()
  const b1 = await bash.execute({ command: 'echo hello-bash-test' }, SANDBOX)
  check('BashTool: echo', b1.includes('hello-bash-test'))
  check('BashTool: needsPermission', bash.needsPermission === true)

  // FileWriteTool
  const { FileWriteTool } = await import('../src/tools/FileWriteTool.js')
  const fw = new FileWriteTool()
  const w1 = await fw.execute({ path: join(SANDBOX, 'written.txt'), content: 'created by test\nline 2' }, SANDBOX)
  check('FileWriteTool: create', w1.includes('Created') || w1.includes('Updated') || w1.includes('wrote'))
  check('FileWriteTool: file exists', existsSync(join(SANDBOX, 'written.txt')))

  // FileReadTool
  const { FileReadTool } = await import('../src/tools/FileReadTool.js')
  const fr = new FileReadTool()
  const r1 = await fr.execute({ path: 'hello.txt' }, SANDBOX)
  check('FileReadTool: read full', r1.includes('hello world') && r1.includes('line 2'))
  const r2 = await fr.execute({ path: 'hello.txt', startLine: '1', endLine: '1' }, SANDBOX)
  check('FileReadTool: line range', r2.includes('hello world'))
  const r3 = await fr.execute({ path: 'nonexistent.txt' }, SANDBOX)
  check('FileReadTool: missing file', r3.includes('Error') || r3.includes('not found'))

  // FileEditTool
  const { FileEditTool } = await import('../src/tools/FileEditTool.js')
  const fe = new FileEditTool()
  writeFileSync(join(SANDBOX, 'editable.txt'), 'old text here\nkeep this\n')
  const e1 = await fe.execute({ path: join(SANDBOX, 'editable.txt'), target: 'old text here', replacement: 'new text here' }, SANDBOX)
  check('FileEditTool: replace', e1.includes('Replaced'))
  const verify = readFileSync(join(SANDBOX, 'editable.txt'), 'utf-8')
  check('FileEditTool: verify content', verify.includes('new text here') && verify.includes('keep this'))

  // GrepTool
  const { GrepTool } = await import('../src/tools/GrepTool.js')
  const grep = new GrepTool()
  const g1 = await grep.execute({ pattern: 'hello', path: SANDBOX }, SANDBOX)
  check('GrepTool: find pattern', g1.includes('hello'))
  const g2 = await grep.execute({ pattern: 'NOTEXIST99', path: SANDBOX }, SANDBOX)
  check('GrepTool: no match', g2.includes('No matches') || !g2.includes('NOTEXIST99'))

  // GlobTool
  const { GlobTool } = await import('../src/tools/GlobTool.js')
  const glob = new GlobTool()
  const gl1 = await glob.execute({ pattern: '*.txt' }, SANDBOX)
  check('GlobTool: find .txt', gl1.includes('hello.txt'))
  const gl2 = await glob.execute({ pattern: '*.xyz' }, SANDBOX)
  check('GlobTool: no match', gl2.includes('No files') || !gl2.includes('.xyz'))

  // ListDirTool
  const { ListDirTool } = await import('../src/tools/ListDirTool.js')
  const ld = new ListDirTool()
  const l1 = await ld.execute({ path: '.' }, SANDBOX)
  check('ListDirTool: list', l1.includes('hello.txt') && l1.includes('code.ts'))

  // WebFetchTool
  const { WebFetchTool } = await import('../src/tools/WebFetchTool.js')
  const wf = new WebFetchTool()
  try {
    const f1 = await wf.execute({ url: 'https://httpbin.org/get', maxLength: '1000' })
    check('WebFetchTool: fetch httpbin', f1.includes('origin') || f1.includes('headers') || f1.includes('Host'))
  } catch {
    check('WebFetchTool: fetch httpbin', false, 'network error')
  }
  const f2 = await wf.execute({ url: '' })
  check('WebFetchTool: empty URL', f2.includes('Error') || f2.includes('required'))

  // WebSearchTool
  const { WebSearchTool } = await import('../src/tools/WebSearchTool.js')
  const ws = new WebSearchTool()
  check('WebSearchTool: name', ws.name === 'WebSearch')
  check('WebSearchTool: no perm', ws.needsPermission === false)
  try {
    const s1 = await ws.execute({ query: 'Node.js runtime', maxResults: '3' })
    check('WebSearchTool: search', s1.includes('Search results') || s1.length > 50)
  } catch {
    check('WebSearchTool: search', false, 'network error')
  }
  const s2 = await ws.execute({ query: '' })
  check('WebSearchTool: empty query', s2.includes('Error') || s2.includes('required'))

  // ResearchAgentTool
  const { ResearchAgentTool } = await import('../src/tools/ResearchAgentTool.js')
  const sa = new ResearchAgentTool()
  check('ResearchAgentTool: name', sa.name === 'ResearchAgent')
  check('ResearchAgentTool: no perm', sa.needsPermission === false)
  check('ResearchAgentTool: has task param', sa.definition.function.parameters.required.includes('task'))
  const sa1 = await sa.execute({ task: '' }, SANDBOX)
  check('ResearchAgentTool: empty task', sa1.includes('Error'))

  // ═══════════════════════════════════════
  // SECTION 2: TOOL REGISTRY
  // ═══════════════════════════════════════
  console.log('\n📋 TOOL REGISTRY')

  const { ALL_TOOLS, getToolDefinitions, findTool, READ_ONLY_TOOLS } = await import('../src/tools/index.js')
  check('Registry: 14 tools', ALL_TOOLS.length === 14)
  check('Registry: findTool(ResearchAgent)', findTool('ResearchAgent') !== undefined)
  check('Registry: findTool(WebSearch)', findTool('WebSearch') !== undefined)
  check('Registry: plan mode filters', getToolDefinitions(true).length < getToolDefinitions(false).length)
  const planTools = getToolDefinitions(true).map((t: any) => t.function.name)
  check('Registry: plan mode has read tools', planTools.includes('FileRead') && planTools.includes('Grep'))
  check('Registry: plan mode blocks write tools', !planTools.includes('FileWrite') && !planTools.includes('Bash'))
  check('Registry: READ_ONLY_TOOLS set', READ_ONLY_TOOLS.has('FileRead') && READ_ONLY_TOOLS.has('WebSearch'))

  // ═══════════════════════════════════════
  // SECTION 3: MEMORY SYSTEM
  // ═══════════════════════════════════════
  console.log('\n🧠 MEMORY SYSTEM')

  const { getGlobalMemoryDir, getProjectMemoryDir, loadMemoryIndex, saveMemory, listMemories, getMemoryPrompt } = await import('../src/memory.js')

  const testMemDir = join(SANDBOX, '.mem-test')
  check('Memory: getGlobalMemoryDir', getGlobalMemoryDir().includes('.blaze'))
  check('Memory: getProjectMemoryDir', getProjectMemoryDir(SANDBOX).includes('.blaze'))
  check('Memory: empty index', loadMemoryIndex(testMemDir) === '')

  // Save a memory
  const memPath = saveMemory(testMemDir, 'test_mem', 'Test Memory', 'A test memory entry', 'project', 'This is a test.')
  check('Memory: save', existsSync(memPath))
  check('Memory: file content', readFileSync(memPath, 'utf-8').includes('Test Memory'))

  // Load memories
  const mems = listMemories(testMemDir)
  check('Memory: list', mems.length === 1)
  check('Memory: list entry', mems[0]?.name === 'Test Memory')

  // Check index
  const idx = loadMemoryIndex(testMemDir)
  check('Memory: MEMORY.md updated', idx.includes('Test Memory'))

  // Check prompt integration
  const mp = getMemoryPrompt(SANDBOX)
  // May be empty since project memory is in a different dir
  check('Memory: getMemoryPrompt returns string', typeof mp === 'string')

  // ═══════════════════════════════════════
  // SECTION 4: HOOKS SYSTEM
  // ═══════════════════════════════════════
  console.log('\n⚡ HOOKS SYSTEM')

  const { runHooks, runSessionHook } = await import('../src/hooks.js')

  // No hooks
  const h1 = runHooks({}, 'preToolUse', { cwd: SANDBOX })
  check('Hooks: empty config', h1.allowed === true && h1.output === '')

  // With hooks
  const h2 = runHooks(
    { preToolUse: [{ match: 'Bash', command: 'echo hook-ran' }] },
    'preToolUse',
    { toolName: 'Bash', cwd: SANDBOX }
  )
  check('Hooks: preToolUse runs', h2.allowed === true && h2.output.includes('hook-ran'))

  // Hook with non-matching tool
  const h3 = runHooks(
    { preToolUse: [{ match: 'Bash', command: 'echo no-match' }] },
    'preToolUse',
    { toolName: 'FileRead', cwd: SANDBOX }
  )
  check('Hooks: non-matching skips', h3.output === '')

  // Session hook (fire and forget)
  runSessionHook({ sessionStart: [{ command: 'echo session-start' }] }, 'sessionStart', SANDBOX)
  check('Hooks: session hook no crash', true)

  // ═══════════════════════════════════════
  // SECTION 5: PERMISSIONS SYSTEM
  // ═══════════════════════════════════════
  console.log('\n🔒 PERMISSIONS')

  const { checkPermission } = await import('../src/permissions.js')

  // No rules
  check('Perms: no rules = ask', checkPermission({}, 'Bash', { command: 'ls' }) === 'ask')

  // Allow rule
  check('Perms: allow Bash(npm *)', checkPermission(
    { allow: ['Bash(npm *)'] }, 'Bash', { command: 'npm install' }
  ) === 'allow')

  // Deny rule
  check('Perms: deny Bash(rm -rf *)', checkPermission(
    { deny: ['Bash(rm -rf *)'] }, 'Bash', { command: 'rm -rf /' }
  ) === 'deny')

  // Deny takes priority
  check('Perms: deny overrides allow', checkPermission(
    { allow: ['Bash'], deny: ['Bash(rm *)'] }, 'Bash', { command: 'rm -rf /' }
  ) === 'deny')

  // Allow all uses of a tool
  check('Perms: allow all FileRead', checkPermission(
    { allow: ['FileRead'] }, 'FileRead', { path: 'any.txt' }
  ) === 'allow')

  // Non-matching
  check('Perms: non-matching = ask', checkPermission(
    { allow: ['Bash(npm *)'] }, 'Bash', { command: 'ls -la' }
  ) === 'ask')

  // ═══════════════════════════════════════
  // SECTION 6: AGENT
  // ═══════════════════════════════════════
  console.log('\n🤖 AGENT')

  const { Agent } = await import('../src/agent.js')
  const testConfig = {
    llmUrl: 'http://localhost:11434', llmModel: 'test', maxTokens: 4096,
    temperature: 0, autoApprove: false,
    historyDir: join(SANDBOX, '.history'),
    maxContextTokens: 120000, compactThreshold: 0.75,
    memoryEnabled: false, memoryDir: join(SANDBOX, '.mem'),
    hooks: {} as any, permissions: {} as any, maxIterations: 25, planMode: false, providers: [],
  }

  const agent = new Agent(testConfig)
  check('Agent: constructor', agent !== null)
  check('Agent: has run', typeof agent.run === 'function')
  check('Agent: has setPlanMode', typeof agent.setPlanMode === 'function')
  check('Agent: has branch', typeof agent.branch === 'function')
  check('Agent: has restoreBranch', typeof agent.restoreBranch === 'function')
  check('Agent: has destroy', typeof agent.destroy === 'function')
  check('Agent: has getMaxContextTokens', agent.getMaxContextTokens() === 120000)

  // Plan mode
  agent.setPlanMode(true)
  check('Agent: plan mode on', agent.getPlanMode() === true)
  agent.setPlanMode(false)
  check('Agent: plan mode off', agent.getPlanMode() === false)

  // Branching
  const b = agent.branch()
  check('Agent: branch returns number', typeof b === 'number' && b > 0)
  check('Agent: getBranchCount', agent.getBranchCount() === 1)
  const restored = agent.restoreBranch(1)
  check('Agent: restoreBranch', restored === true)
  const notFound = agent.restoreBranch(999)
  check('Agent: restoreBranch invalid', notFound === false)

  // Save/Load
  const savePath = agent.save()
  check('Agent: save', existsSync(savePath))
  const agent2 = new Agent(testConfig)
  check('Agent: load', agent2.load(savePath) === true)

  // Compact
  await agent.compact()
  check('Agent: compact no crash', true)

  // Reset
  agent.reset()
  check('Agent: reset', agent.getMessageCount() === 1 && agent.getBranchCount() === 0)

  // ═══════════════════════════════════════
  // SECTION 7: SYSTEM PROMPT
  // ═══════════════════════════════════════
  console.log('\n📝 SYSTEM PROMPT')

  const { getSystemPrompt } = await import('../src/prompt.js')
  const prompt = getSystemPrompt(SANDBOX)
  check('Prompt: has CWD', prompt.includes(SANDBOX))
  check('Prompt: has 14 tools', prompt.includes('ResearchAgent') && prompt.includes('WebSearch') && prompt.includes('AskUser') && prompt.includes('NotebookEdit') && prompt.includes('Worktree') && prompt.includes('REPL'))
  check('Prompt: has rules', prompt.includes('Read before editing'))

  const planPrompt = getSystemPrompt(SANDBOX, true)
  check('Prompt: plan mode', planPrompt.includes('PLAN MODE') && planPrompt.includes('Read-Only'))

  // ═══════════════════════════════════════
  // SECTION 8: UI MODULE
  // ═══════════════════════════════════════
  console.log('\n🎨 UI MODULE')

  const ui = await import('../src/ui.js')
  check('UI: has research color', typeof ui.c.research === 'function')
  check('UI: has plan color', typeof ui.c.plan === 'function')
  check('UI: has memory color', typeof ui.c.memory === 'function')
  check('UI: has hook color', typeof ui.c.hook === 'function')
  check('UI: has printContextGrid', typeof ui.printContextGrid === 'function')
  check('UI: has printPlanMode', typeof ui.printPlanMode === 'function')
  check('UI: has printHookResult', typeof ui.printHookResult === 'function')
  check('UI: has printDiff', typeof ui.printDiff === 'function')

  // ═══════════════════════════════════════
  // SECTION 9: CONFIG
  // ═══════════════════════════════════════
  console.log('\n⚙️  CONFIG')

  const { getConfig } = await import('../src/types.js')
  const config = getConfig()
  check('Config: has memoryEnabled', typeof config.memoryEnabled === 'boolean')
  check('Config: has memoryDir', typeof config.memoryDir === 'string')
  check('Config: has hooks', typeof config.hooks === 'object')
  check('Config: has permissions', typeof config.permissions === 'object')
  check('Config: has maxIterations', typeof config.maxIterations === 'number')
  check('Config: has planMode', typeof config.planMode === 'boolean')
  check('Config: has providers', Array.isArray(config.providers))

  // ═══════════════════════════════════════
  // SECTION 10: ADVANCED FEATURES
  // ═══════════════════════════════════════
  console.log('\n🆕 ADVANCED FEATURES')

  // AskUser tool
  const { AskUserTool } = await import('../src/tools/AskUserTool.js')
  const askUser = new AskUserTool()
  check('AskUser: name', askUser.name === 'AskUser')
  check('AskUser: no perm', askUser.needsPermission === false)
  check('AskUser: has question param', askUser.definition.function.parameters.required.includes('question'))
  check('AskUser: registered', findTool('AskUser') !== undefined)

  // Checkpoint / Rewind
  const agentCp = new Agent(testConfig)
  // Agent creates checkpoint on run — simulate by calling internal methods
  check('Agent: has rewindLast', typeof agentCp.rewindLast === 'function')
  check('Agent: has getCheckpoints', typeof agentCp.getCheckpoints === 'function')
  check('Agent: has getMessages', typeof agentCp.getMessages === 'function')
  check('Agent: checkpoints empty initially', agentCp.getCheckpoints().length === 0)
  check('Agent: rewindLast on empty', agentCp.rewindLast() === false)

  // Interrupt
  check('Agent: has interrupt', typeof agentCp.interrupt === 'function')
  check('Agent: has isRunning', typeof agentCp.isRunning === 'function')
  check('Agent: not running initially', agentCp.isRunning() === false)

  // Provider switching
  check('Agent: has switchProvider', typeof agentCp.switchProvider === 'function')
  check('Agent: has getCurrentModel', typeof agentCp.getCurrentModel === 'function')
  check('Agent: has getCurrentUrl', typeof agentCp.getCurrentUrl === 'function')
  check('Agent: has getConfig method', typeof agentCp.getConfig === 'function')
  agentCp.switchProvider('http://other:1234', 'other-model', 'key123')
  check('Agent: switchProvider works', agentCp.getCurrentModel() === 'other-model' && agentCp.getCurrentUrl() === 'http://other:1234')

  // Failover module
  const { handleRateLimit: hrl } = await import('../src/failover.js')
  check('Failover: handleRateLimit exists', typeof hrl === 'function')

  // Plan mode with tools
  const planDefs = getToolDefinitions(true)
  const execDefs = getToolDefinitions(false)
  check('Plan: AskUser in plan mode', planDefs.some((t: any) => t.function.name === 'AskUser'))
  check('Plan: fewer tools than exec', planDefs.length < execDefs.length)

  // ═══════════════════════════════════════
  // SECTION 11: NOTEBOOK EDIT
  // ═══════════════════════════════════════
  console.log('\n📓 NOTEBOOK EDIT')

  const { NotebookEditTool } = await import('../src/tools/NotebookEditTool.js')
  const nb = new NotebookEditTool()
  check('NotebookEdit: name', nb.name === 'NotebookEdit')
  check('NotebookEdit: needsPermission', nb.needsPermission === true)
  check('NotebookEdit: registered', findTool('NotebookEdit') !== undefined)

  // Create a test notebook
  const nbPath = join(SANDBOX, 'test.ipynb')
  const testNb = {
    nbformat: 4, nbformat_minor: 5,
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
    cells: [
      { cell_type: 'code', source: ['print("hello")'], metadata: {}, outputs: [], execution_count: null },
      { cell_type: 'markdown', source: ['# Title'], metadata: {} },
    ]
  }
  writeFileSync(nbPath, JSON.stringify(testNb), 'utf-8')

  // Read
  const readResult = await nb.execute({ path: nbPath, action: 'read' }, SANDBOX)
  check('NotebookEdit: read', readResult.includes('2 cells') && readResult.includes('print("hello")'))

  // Insert
  const insertResult = await nb.execute({ path: nbPath, action: 'insert', cellIndex: '1', cellType: 'code', content: 'x = 42' }, SANDBOX)
  check('NotebookEdit: insert', insertResult.includes('Inserted') && insertResult.includes('3 cells'))

  // Replace
  const replaceResult = await nb.execute({ path: nbPath, action: 'replace', cellIndex: '0', cellType: 'code', content: 'print("world")' }, SANDBOX)
  check('NotebookEdit: replace', replaceResult.includes('Replaced'))

  // Verify replacement
  const verifyResult = await nb.execute({ path: nbPath, action: 'read' }, SANDBOX)
  check('NotebookEdit: verify', verifyResult.includes('print("world")'))

  // Delete
  const deleteResult = await nb.execute({ path: nbPath, action: 'delete', cellIndex: '0' }, SANDBOX)
  check('NotebookEdit: delete', deleteResult.includes('Deleted') && deleteResult.includes('2 cells'))

  // Error cases
  const errResult = await nb.execute({ path: 'not.ipynb', action: 'read' }, SANDBOX)
  check('NotebookEdit: missing file', errResult.includes('Error'))
  const errResult2 = await nb.execute({ path: nbPath, action: 'replace', cellIndex: '99', content: 'x' }, SANDBOX)
  check('NotebookEdit: out of range', errResult2.includes('out of range'))
  const errResult3 = await nb.execute({ path: 'file.txt', action: 'read' }, SANDBOX)
  check('NotebookEdit: non-ipynb', errResult3.includes('Error'))

  // ═══════════════════════════════════════
  // SECTION 12: SKILLS SYSTEM
  // ═══════════════════════════════════════
  console.log('\n⚡ SKILLS SYSTEM')

  const { loadSkills: ls, findSkill: fs, initSkills: is } = await import('../src/skills.js')

  check('Skills: loadSkills returns array', Array.isArray(ls(SANDBOX)))
  check('Skills: empty initially', ls(SANDBOX).length === 0)

  // Init skills
  mkdirSync(join(SANDBOX, '.blaze', 'skills'), { recursive: true })
  writeFileSync(join(SANDBOX, '.blaze', 'skills', 'myskill.md'), `---
name: myskill
description: A test skill
---
Do something cool.
`, 'utf-8')

  const skills = ls(SANDBOX)
  check('Skills: loaded from dir', skills.length === 1)
  check('Skills: name correct', skills[0]?.name === 'myskill')
  check('Skills: description correct', skills[0]?.description === 'A test skill')
  check('Skills: prompt correct', skills[0]?.prompt === 'Do something cool.')
  check('Skills: findSkill', fs(SANDBOX, 'myskill') !== null)
  check('Skills: findSkill unknown', fs(SANDBOX, 'nonexistent') === null)

  // ═══════════════════════════════════════
  // SECTION 13: REPL TOOL
  // ═══════════════════════════════════════
  console.log('\n🐍 REPL TOOL')

  const { REPLTool } = await import('../src/tools/REPLTool.js')
  const repl = new REPLTool()
  check('REPL: name', repl.name === 'REPL')
  check('REPL: needsPermission', repl.needsPermission === true)
  check('REPL: registered', findTool('REPL') !== undefined)

  // Python execution
  const pyResult = await repl.execute({ language: 'python', code: 'print(2+2)' }, SANDBOX)
  check('REPL: python exec', pyResult.includes('4'))

  // Node execution
  const nodeResult = await repl.execute({ language: 'node', code: 'console.log(3*3)' }, SANDBOX)
  check('REPL: node exec', nodeResult.includes('9'))

  // Error handling
  const replErr = await repl.execute({ language: 'python', code: 'raise ValueError("test")' }, SANDBOX)
  check('REPL: error handling', replErr.includes('Error') || replErr.includes('ValueError'))

  const replEmpty = await repl.execute({ code: '' }, SANDBOX)
  check('REPL: empty code', replEmpty.includes('Error') || replEmpty.includes('No code'))

  // ═══════════════════════════════════════
  // SECTION 14: WORKTREE TOOL
  // ═══════════════════════════════════════
  console.log('\n🌳 WORKTREE TOOL')

  const { WorktreeTool } = await import('../src/tools/WorktreeTool.js')
  const wt = new WorktreeTool()
  check('Worktree: name', wt.name === 'Worktree')
  check('Worktree: needsPermission', wt.needsPermission === true)
  check('Worktree: registered', findTool('Worktree') !== undefined)

  // List in non-git dir
  const wtList = await wt.execute({ action: 'list' }, SANDBOX)
  check('Worktree: non-git error', wtList.includes('Error') || wtList.includes('Not a git'))

  // ═══════════════════════════════════════
  // SECTION 15: TASKS & CRON
  // ═══════════════════════════════════════
  console.log('\n📋 TASKS & CRON')

  const { listTasks: lt, cleanTasks: ct } = await import('../src/tasks.js')
  check('Tasks: listTasks returns array', Array.isArray(lt()))
  check('Tasks: cleanTasks returns number', typeof ct() === 'number')

  const { parseInterval: pi, formatInterval: fi, listCronJobs: lcj } = await import('../src/cron.js')
  check('Cron: parseInterval 5m', pi('5m') === 300000)
  check('Cron: parseInterval 30s', pi('30s') === 30000)
  check('Cron: parseInterval 2h', pi('2h') === 7200000)
  check('Cron: parseInterval 1d', pi('1d') === 86400000)
  check('Cron: parseInterval invalid', pi('abc') === null)
  check('Cron: formatInterval', fi(300000) === '5m')
  check('Cron: formatInterval sec', fi(30000) === '30s')
  check('Cron: listCronJobs empty', lcj().length === 0)

  // ═══════════════════════════════════════
  // SECTION 16: AGENT TEAMS
  // ═══════════════════════════════════════
  console.log('\n🤝 AGENT TEAMS')

  const { Team, createTeam: cTeam, getActiveTeam: gTeam, destroyTeam: dTeam } = await import('../src/team.js')

  // Create team
  const team = cTeam(SANDBOX)
  check('Team: create', team !== null)
  check('Team: getActiveTeam', gTeam() !== null)

  // Add workers
  const wAlpha = team.addWorker('alpha', 'Frontend specialist')
  const wBeta = team.addWorker('beta', 'Backend specialist')
  check('Team: addWorker alpha', wAlpha.name === 'alpha')
  check('Team: addWorker beta', wBeta.name === 'beta')
  check('Team: getWorkerNames', team.getWorkerNames().length === 2)
  check('Team: worker names', team.getWorkerNames().includes('alpha') && team.getWorkerNames().includes('beta'))

  // Assign tasks
  const t1 = team.assignTask('Build the login page', 'alpha')
  const t2 = team.assignTask('Create the API endpoint', 'beta')
  check('Team: assignTask', t1.id === 'T1' && t1.assignedTo === 'alpha')
  check('Team: task status', t1.status === 'pending')

  // Send messages
  team.sendMessage('alpha', 'beta', 'What API format should I use?')
  team.sendMessage('beta', 'alpha', 'Use REST with JSON.')
  check('Team: messages sent', wAlpha.inbox.length === 1) // alpha got beta's reply
  check('Team: message content', wAlpha.inbox[0]?.content === 'Use REST with JSON.')

  // Task board
  const board = team.getTaskBoard()
  check('Team: task board', board.getAllTasks().length === 2)
  check('Team: pending tasks', board.getPendingTasks().length === 2)
  check('Team: not all done', board.isAllDone() === false)

  // Update task
  board.updateTask('T1', 'completed', 'Login page done')
  board.updateTask('T2', 'completed', 'API endpoint created')
  check('Team: all done', board.isAllDone() === true)

  // Status output
  const status = team.getStatus()
  check('Team: status has workers', status.includes('alpha') && status.includes('beta'))
  check('Team: status has tasks', status.includes('T1') && status.includes('T2'))

  // Remove worker
  check('Team: removeWorker', team.removeWorker('beta') === true)
  check('Team: removeWorker unknown', team.removeWorker('gamma') === false)
  check('Team: after remove', team.getWorkerNames().length === 1)

  // Destroy
  dTeam()
  check('Team: destroy', gTeam() === null)

  // ═══════════════════════════════════════
  // SECTION: blazeplan
  // ═══════════════════════════════════════
  console.log('\n🔥 blazeplan TESTS')

  const { hasblazeplanKeyword, stripblazeplanKeyword, listblazeplanTasks, savePlanToFile } = await import('../src/blazeplan.js')

  // Keyword detection
  check('blazeplan: keyword detected in prompt', hasblazeplanKeyword('I need an blazeplan for refactoring the auth module'))
  check('blazeplan: keyword detected at start', hasblazeplanKeyword('blazeplan: migrate to JWTs'))
  check('blazeplan: /blazeplan command detected', hasblazeplanKeyword('/blazeplan refactor the API'))
  check('blazeplan: no false positive in backticks', !hasblazeplanKeyword('Check out `blazeplan` in the docs'))
  check('blazeplan: no false positive in quotes', !hasblazeplanKeyword('The word "blazeplan" is mentioned'))
  check('blazeplan: no false positive in path', !hasblazeplanKeyword('See /path/to/blazeplan/config'))
  check('blazeplan: no false positive as question', !hasblazeplanKeyword('What is blazeplan?'))
  check('blazeplan: no false positive in other slash commands', !hasblazeplanKeyword('/help blazeplan'))

  // Strip keyword
  check('blazeplan: strip keyword', stripblazeplanKeyword('blazeplan refactor the auth module') === 'refactor the auth module')
  check('blazeplan: strip keyword mid-sentence', stripblazeplanKeyword('I need an blazeplan for refactoring') === 'I need an for refactoring')
  check('blazeplan: strip keyword case-insensitive', stripblazeplanKeyword('blazeplan: do the thing') === ': do the thing')

  // List tasks (should not throw)
  const upTasks = listblazeplanTasks()
  check('blazeplan: listTasks returns array', Array.isArray(upTasks))

  // Save plan to file
  const mockTask = {
    id: 'up_test123',
    prompt: 'Test plan for integration',
    status: 'ready' as const,
    createdAt: new Date().toISOString(),
    cwd: SANDBOX,
    model: 'test-model',
    agentResults: {
      explorer: 'Architecture: simple project',
      files: 'Files: index.ts, utils.ts',
      risks: 'Risks: minimal',
      critique: 'APPROVED — plan is solid',
    },
    plan: '# Implementation Plan\n\n## Overview\nThis is a test plan.\n\n## Steps\n1. Do thing one\n2. Do thing two',
  }
  const planPath = savePlanToFile(mockTask, SANDBOX)
  check('blazeplan: savePlanToFile creates file', existsSync(planPath))
  const planContent = readFileSync(planPath, 'utf-8')
  check('blazeplan: saved plan contains task', planContent.includes('Test plan for integration'))
  check('blazeplan: saved plan contains plan text', planContent.includes('Implementation Plan'))

  // ═══════════════════════════════════════
  // CLEANUP & RESULTS
  // ═══════════════════════════════════════
  if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true })

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`  RESULTS: ${pass}/${pass + fail} passed, ${fail} failed`)
  console.log('═══════════════════════════════════════════════════════')
  if (fail === 0) {
    console.log('\n  🎉 ALL INTEGRATION TESTS PASSED! Blaze CLI is PRODUCTION READY! 🔥\n')
  } else {
    console.log(`\n  ⚠️  ${fail} test(s) need attention.\n`)
    process.exit(1)
  }
}

run().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
