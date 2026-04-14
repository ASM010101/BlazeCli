#!/usr/bin/env tsx
/**
 * 🔥 Blaze CLI — Comprehensive REGRESSION TEST SUITE
 *
 * Tests every module in depth (including new features):
 *   1. Config / Types (with .blazerc)
 *   2. Cost Estimation
 *   3. System Prompt (with git & project context)
 *   4. UI functions (with new methods)
 *   5. All 8 Tools (real filesystem operations)
 *   6. LLM Client construction
 *   7. Agent (with persistence, compact, save/load)
 *   8. Tool registry
 *   9. Edge cases & stress tests
 *
 * Run with: npx tsx tests/regression.ts
 */

import { resolve, join } from 'path'
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs'

// ─── Test Harness ────────────────────────────────────────────────
let totalTests = 0
let passedTests = 0
let failedTests = 0
const failures: string[] = []

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++
  try {
    const result = fn()
    if (result instanceof Promise) {
      return result
        .then(() => {
          passedTests++
          console.log(`  ✅ ${name}`)
        })
        .catch((err: Error) => {
          failedTests++
          failures.push(`${name}: ${err.message}`)
          console.log(`  ❌ ${name} — ${err.message}`)
        })
    }
    passedTests++
    console.log(`  ✅ ${name}`)
  } catch (err: unknown) {
    failedTests++
    const msg = (err as Error).message
    failures.push(`${name}: ${msg}`)
    console.log(`  ❌ ${name} — ${msg}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
function assertContains(str: string, substring: string, msg: string) {
  if (!str.includes(substring)) throw new Error(`${msg}: expected to contain "${substring}", got "${str.slice(0, 200)}"`)
}
function assertNotEmpty(val: string, msg: string) {
  if (!val || val.trim().length === 0) throw new Error(`${msg}: expected non-empty string`)
}

// ─── Test sandbox ────────────────────────────────────────────────
const SANDBOX = resolve(import.meta.dirname || '.', '..', '.test-sandbox')

function setupSandbox() {
  if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true })
  mkdirSync(SANDBOX, { recursive: true })
  mkdirSync(join(SANDBOX, 'subdir'), { recursive: true })
  writeFileSync(join(SANDBOX, 'hello.txt'), 'Hello World\nLine 2\nLine 3\nLine 4\nLine 5\n')
  writeFileSync(join(SANDBOX, 'code.ts'), 'function greet(name: string) {\n  return `Hello, ${name}!`\n}\n\nconst x = 42\n')
  writeFileSync(join(SANDBOX, 'data.json'), '{"name": "blaze", "version": "1.0.0"}\n')
  writeFileSync(join(SANDBOX, 'subdir', 'nested.txt'), 'I am nested\n')
  writeFileSync(join(SANDBOX, 'search-me.txt'), 'apple banana cherry\ndog elephant fox\ngrapes honey ice\n')
  writeFileSync(join(SANDBOX, 'edit-target.txt'), 'line one\nreplace this line\nline three\n')
}

function cleanupSandbox() {
  if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 1: CONFIG & TYPES
// ═══════════════════════════════════════════════════════════════
async function testConfig() {
  console.log('\n📋 SECTION 1: Config & Types')
  const { getConfig } = await import('../src/types.js')

  test('getConfig returns valid config object', () => {
    const config = getConfig()
    assert(typeof config === 'object', 'config should be an object')
    assert(typeof config.llmUrl === 'string', 'llmUrl should be string')
    assert(typeof config.llmModel === 'string', 'llmModel should be string')
    assert(typeof config.maxTokens === 'number', 'maxTokens should be number')
    assert(typeof config.temperature === 'number', 'temperature should be number')
    assert(typeof config.autoApprove === 'boolean', 'autoApprove should be boolean')
  })

  test('getConfig has new fields (historyDir, maxContextTokens, compactThreshold)', () => {
    const config = getConfig()
    assert(typeof config.historyDir === 'string', 'historyDir should be string')
    assert(typeof config.maxContextTokens === 'number', 'maxContextTokens should be number')
    assert(typeof config.compactThreshold === 'number', 'compactThreshold should be number')
    assert(config.maxContextTokens > 0, 'maxContextTokens > 0')
    assert(config.compactThreshold > 0 && config.compactThreshold < 1, 'compactThreshold in (0,1)')
  })

  test('getConfig has sensible defaults', () => {
    const origUrl = process.env.BLAZE_LLM_URL
    const origModel = process.env.BLAZE_LLM_MODEL
    delete process.env.BLAZE_LLM_URL
    delete process.env.LOCAL_LLM_URL
    delete process.env.BLAZE_LLM_MODEL
    delete process.env.LOCAL_LLM_MODEL
    const config = getConfig()
    assertContains(config.llmUrl, 'localhost', 'default URL should be localhost')
    assert(config.maxTokens > 0, 'maxTokens should be positive')
    assertEqual(config.autoApprove, false, 'autoApprove default')
    if (origUrl) process.env.BLAZE_LLM_URL = origUrl
    if (origModel) process.env.BLAZE_LLM_MODEL = origModel
  })

  test('getConfig respects env vars', () => {
    process.env.BLAZE_LLM_URL = 'http://test:1234'
    process.env.BLAZE_LLM_MODEL = 'test-model'
    process.env.BLAZE_MAX_TOKENS = '4096'
    process.env.BLAZE_TEMPERATURE = '0.5'
    process.env.BLAZE_AUTO_APPROVE = 'true'
    const config = getConfig()
    assertEqual(config.llmUrl, 'http://test:1234', 'llmUrl')
    assertEqual(config.llmModel, 'test-model', 'llmModel')
    assertEqual(config.maxTokens, 4096, 'maxTokens')
    assertEqual(config.temperature, 0.5, 'temperature')
    assertEqual(config.autoApprove, true, 'autoApprove')
    delete process.env.BLAZE_LLM_URL
    delete process.env.BLAZE_LLM_MODEL
    delete process.env.BLAZE_MAX_TOKENS
    delete process.env.BLAZE_TEMPERATURE
    delete process.env.BLAZE_AUTO_APPROVE
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 2: COST ESTIMATION
// ═══════════════════════════════════════════════════════════════
async function testCost() {
  console.log('\n💰 SECTION 2: Cost Estimation')
  const { estimateCost, getModelPricing } = await import('../src/types.js')

  test('estimateCost returns "free (local)" for Ollama models', () => {
    const cost = estimateCost(1000, 500, 'llama3:latest')
    assertEqual(cost, 'free (local)', 'local model cost')
  })

  test('estimateCost returns "free (local)" for unknown models', () => {
    const cost = estimateCost(1000, 500, 'my-custom-model')
    assertEqual(cost, 'free (local)', 'unknown model cost')
  })

  test('estimateCost calculates for Groq models', () => {
    const cost = estimateCost(100000, 50000, 'llama-3.3-70b-versatile')
    assert(cost.startsWith('~$'), 'should start with ~$')
    assert(!cost.includes('free'), 'should not be free')
  })

  test('estimateCost calculates for GPT models', () => {
    const cost = estimateCost(100000, 50000, 'gpt-4o-mini')
    assert(cost.startsWith('~$'), 'should start with ~$')
  })

  test('estimateCost handles zero tokens', () => {
    const cost = estimateCost(0, 0, 'llama-3.3-70b-versatile')
    assert(typeof cost === 'string', 'should return string')
  })

  test('getModelPricing returns null for local models', () => {
    assertEqual(getModelPricing('llama3:latest'), null, 'local pricing')
    assertEqual(getModelPricing('mistral:7b'), null, 'mistral local')
  })

  test('getModelPricing returns pricing for known models', () => {
    const pricing = getModelPricing('llama-3.3-70b-versatile')
    assert(pricing !== null, 'should have pricing')
    assert(pricing!.inputPer1M > 0, 'input price > 0')
    assert(pricing!.outputPer1M > 0, 'output price > 0')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 3: SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════
async function testPrompt() {
  console.log('\n📝 SECTION 3: System Prompt')
  const { getSystemPrompt } = await import('../src/prompt.js')

  test('getSystemPrompt returns non-empty string', () => {
    const prompt = getSystemPrompt('/test/dir')
    assertNotEmpty(prompt, 'system prompt')
  })

  test('getSystemPrompt injects CWD', () => {
    const prompt = getSystemPrompt('/my/project')
    assertContains(prompt, '/my/project', 'prompt should contain CWD')
  })

  test('getSystemPrompt lists all 8 tools', () => {
    const prompt = getSystemPrompt('/test')
    const tools = ['Bash', 'FileRead', 'FileWrite', 'FileEdit', 'Grep', 'Glob', 'ListDir', 'WebFetch']
    for (const tool of tools) {
      assertContains(prompt, tool, `prompt should mention ${tool}`)
    }
  })

  test('getSystemPrompt handles OS detection', () => {
    const prompt = getSystemPrompt('/test')
    if (process.platform === 'win32') {
      assertContains(prompt, 'Windows', 'should detect Windows')
      assertContains(prompt, 'PowerShell', 'should mention PowerShell')
    }
  })

  test('getSystemPrompt includes agentic rules', () => {
    const prompt = getSystemPrompt('/test')
    assertContains(prompt, 'Read before editing', 'read-before-edit rule')
    assertContains(prompt, 'Verify', 'verify rule')
  })

  test('getSystemPrompt loads BLAZE.md if present', () => {
    // Create a BLAZE.md in sandbox
    writeFileSync(join(SANDBOX, 'BLAZE.md'), '# Test Project\nThis is a test project.\n')
    const prompt = getSystemPrompt(SANDBOX)
    assertContains(prompt, 'Test Project', 'should load BLAZE.md content')
    rmSync(join(SANDBOX, 'BLAZE.md'))
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 4: TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════
async function testToolRegistry() {
  console.log('\n🔧 SECTION 4: Tool Registry')
  const { ALL_TOOLS, getToolDefinitions, findTool } = await import('../src/tools/index.js')

  test('ALL_TOOLS has exactly 14 tools', () => {
    assertEqual(ALL_TOOLS.length, 14, 'tool count')
  })

  test('getToolDefinitions returns correct format', () => {
    const defs = getToolDefinitions()
    assertEqual(defs.length, 14, 'definition count')
    for (const def of defs) {
      assertEqual(def.type, 'function', `type for ${def.function.name}`)
      assertNotEmpty(def.function.name, 'tool name')
      assertNotEmpty(def.function.description, 'tool description')
      assertEqual(def.function.parameters.type, 'object', 'params type')
    }
  })

  test('findTool finds all tools by name', () => {
    const names = ['Bash', 'FileRead', 'FileWrite', 'FileEdit', 'Grep', 'Glob', 'ListDir', 'WebFetch', 'WebSearch', 'ResearchAgent', 'AskUser', 'NotebookEdit', 'Worktree', 'REPL']
    for (const name of names) {
      const tool = findTool(name)
      assert(tool !== undefined, `should find tool: ${name}`)
      assertEqual(tool!.name, name, `tool name for ${name}`)
    }
  })

  test('findTool returns undefined for unknown tools', () => {
    assertEqual(findTool('NonExistentTool'), undefined, 'unknown tool')
  })

  test('Tool permission flags are correct', () => {
    assertEqual(findTool('Bash')!.needsPermission, true, 'Bash')
    assertEqual(findTool('FileEdit')!.needsPermission, true, 'FileEdit')
    assertEqual(findTool('FileWrite')!.needsPermission, true, 'FileWrite')
    assertEqual(findTool('FileRead')!.needsPermission, false, 'FileRead')
    assertEqual(findTool('Grep')!.needsPermission, false, 'Grep')
    assertEqual(findTool('Glob')!.needsPermission, false, 'Glob')
    assertEqual(findTool('ListDir')!.needsPermission, false, 'ListDir')
    assertEqual(findTool('WebFetch')!.needsPermission, false, 'WebFetch')
  })

  test('FileEditTool definition includes replaceAll parameter', () => {
    const editTool = findTool('FileEdit')!
    assert('replaceAll' in editTool.definition.function.parameters.properties, 'should have replaceAll param')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 5: BASH TOOL
// ═══════════════════════════════════════════════════════════════
async function testBashTool() {
  console.log('\n🖥️  SECTION 5: BashTool')
  const { BashTool } = await import('../src/tools/BashTool.js')
  const bash = new BashTool()

  await test('BashTool: echo command', async () => {
    const result = await bash.execute({ command: 'echo hello-blaze' }, SANDBOX)
    assertContains(result, 'hello-blaze', 'echo output')
  })

  await test('BashTool: empty command returns error', async () => {
    const result = await bash.execute({ command: '' }, SANDBOX)
    assertContains(result, 'Error', 'empty command error')
  })

  await test('BashTool: cwd is respected', async () => {
    const cmd = process.platform === 'win32' ? 'Get-Location | Select-Object -ExpandProperty Path' : 'pwd'
    const result = await bash.execute({ command: cmd }, SANDBOX)
    assertContains(result, '.test-sandbox', 'cwd output')
  })

  await test('BashTool: captures stderr on failure', async () => {
    const cmd = process.platform === 'win32' ? 'Get-Item NonExistentFile123' : 'cat nonexistent_file_xyz'
    const result = await bash.execute({ command: cmd }, SANDBOX)
    assert(result.includes('Exit code') || result.includes('Error') || result.includes('Stderr'), 'failure info')
  })

  await test('BashTool: multi-line output', async () => {
    const cmd = process.platform === 'win32' ? 'echo line1; echo line2; echo line3' : 'echo "line1\nline2\nline3"'
    const result = await bash.execute({ command: cmd }, SANDBOX)
    assertContains(result, 'line1', 'line1')
    assertContains(result, 'line2', 'line2')
  })

  await test('BashTool: properties correct', () => {
    assertEqual(bash.name, 'Bash', 'name')
    assertEqual(bash.needsPermission, true, 'needsPermission')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 6: FILE READ TOOL
// ═══════════════════════════════════════════════════════════════
async function testFileReadTool() {
  console.log('\n📖 SECTION 6: FileReadTool')
  const { FileReadTool } = await import('../src/tools/FileReadTool.js')
  const reader = new FileReadTool()

  await test('FileReadTool: read full file', async () => {
    const result = await reader.execute({ path: 'hello.txt' }, SANDBOX)
    assertContains(result, 'Hello World', 'content')
    assertContains(result, 'hello.txt', 'filename')
  })
  await test('FileReadTool: read with line range', async () => {
    const result = await reader.execute({ path: 'hello.txt', startLine: '2', endLine: '3' }, SANDBOX)
    assertContains(result, 'Line 2', 'line 2')
    assertContains(result, 'Line 3', 'line 3')
    assert(!result.includes('Hello World'), 'line 1 not in range')
  })
  await test('FileReadTool: line numbers in output', async () => {
    const result = await reader.execute({ path: 'hello.txt' }, SANDBOX)
    assertContains(result, '1:', 'line number 1')
  })
  await test('FileReadTool: nonexistent file', async () => {
    const result = await reader.execute({ path: 'does-not-exist.txt' }, SANDBOX)
    assertContains(result, 'Error', 'error')
  })
  await test('FileReadTool: nested file', async () => {
    const result = await reader.execute({ path: 'subdir/nested.txt' }, SANDBOX)
    assertContains(result, 'I am nested', 'nested content')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 7: FILE WRITE TOOL
// ═══════════════════════════════════════════════════════════════
async function testFileWriteTool() {
  console.log('\n✏️  SECTION 7: FileWriteTool')
  const { FileWriteTool } = await import('../src/tools/FileWriteTool.js')
  const writer = new FileWriteTool()

  await test('FileWriteTool: create new file', async () => {
    await writer.execute({ path: 'new-file.txt', content: 'Brand new content\nLine 2\n' }, SANDBOX)
    const content = readFileSync(join(SANDBOX, 'new-file.txt'), 'utf-8')
    assertEqual(content, 'Brand new content\nLine 2\n', 'written content')
  })
  await test('FileWriteTool: overwrite existing', async () => {
    writeFileSync(join(SANDBOX, 'overwrite-test.txt'), 'OLD')
    await writer.execute({ path: 'overwrite-test.txt', content: 'NEW' }, SANDBOX)
    assertEqual(readFileSync(join(SANDBOX, 'overwrite-test.txt'), 'utf-8'), 'NEW', 'overwritten')
  })
  await test('FileWriteTool: create deep directory', async () => {
    await writer.execute({ path: 'deep/nested/dir/file.txt', content: 'deep' }, SANDBOX)
    assert(existsSync(join(SANDBOX, 'deep', 'nested', 'dir', 'file.txt')), 'deep file exists')
  })
  await test('FileWriteTool: needsPermission is true', () => {
    assertEqual(writer.needsPermission, true, 'FileWrite should need permission')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 8: FILE EDIT TOOL
// ═══════════════════════════════════════════════════════════════
async function testFileEditTool() {
  console.log('\n🔄 SECTION 8: FileEditTool')
  const { FileEditTool } = await import('../src/tools/FileEditTool.js')
  const editor = new FileEditTool()

  await test('FileEditTool: simple find-and-replace', async () => {
    writeFileSync(join(SANDBOX, 'edit-target.txt'), 'line one\nreplace this line\nline three\n')
    await editor.execute({ path: 'edit-target.txt', target: 'replace this line', replacement: 'REPLACED' }, SANDBOX)
    const content = readFileSync(join(SANDBOX, 'edit-target.txt'), 'utf-8')
    assertContains(content, 'REPLACED', 'replaced')
    assert(!content.includes('replace this line'), 'old text gone')
  })

  await test('FileEditTool: target not found', async () => {
    const result = await editor.execute({ path: 'edit-target.txt', target: 'NONEXISTENT', replacement: 'x' }, SANDBOX)
    assertContains(result, 'Error', 'error')
  })

  await test('FileEditTool: file not found', async () => {
    const result = await editor.execute({ path: 'nope.txt', target: 'a', replacement: 'b' }, SANDBOX)
    assertContains(result, 'Error', 'error')
  })

  await test('FileEditTool: replaceAll=true', async () => {
    writeFileSync(join(SANDBOX, 'multi-replace.txt'), 'AAA BBB AAA CCC AAA\n')
    const result = await editor.execute({ path: 'multi-replace.txt', target: 'AAA', replacement: 'XXX', replaceAll: 'true' }, SANDBOX)
    const content = readFileSync(join(SANDBOX, 'multi-replace.txt'), 'utf-8')
    assert(!content.includes('AAA'), 'all AAA should be replaced')
    assertEqual(content.split('XXX').length - 1, 3, 'should have 3 XXX')
    assertContains(result, '3 of 3', 'replaced count')
  })

  await test('FileEditTool: replaceAll=false replaces only first', async () => {
    writeFileSync(join(SANDBOX, 'first-only.txt'), 'foo bar foo baz foo\n')
    await editor.execute({ path: 'first-only.txt', target: 'foo', replacement: 'FIRST' }, SANDBOX)
    const content = readFileSync(join(SANDBOX, 'first-only.txt'), 'utf-8')
    assertContains(content, 'FIRST', 'first replaced')
    assertEqual(content.split('foo').length - 1, 2, 'two foo remaining')
  })

  await test('FileEditTool: multi-line replacement', async () => {
    writeFileSync(join(SANDBOX, 'ml-edit.txt'), 'before\nOLD\nafter\n')
    await editor.execute({ path: 'ml-edit.txt', target: 'OLD', replacement: 'NEW1\nNEW2\nNEW3' }, SANDBOX)
    const content = readFileSync(join(SANDBOX, 'ml-edit.txt'), 'utf-8')
    assertContains(content, 'NEW1', 'line 1')
    assertContains(content, 'NEW3', 'line 3')
    assertContains(content, 'before', 'preserved before')
    assertContains(content, 'after', 'preserved after')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 9: GREP TOOL
// ═══════════════════════════════════════════════════════════════
async function testGrepTool() {
  console.log('\n🔍 SECTION 9: GrepTool')
  const { GrepTool } = await import('../src/tools/GrepTool.js')
  const grep = new GrepTool()

  await test('GrepTool: find text', async () => {
    const result = await grep.execute({ pattern: 'banana', path: '.' }, SANDBOX)
    assertContains(result, 'banana', 'found')
  })
  await test('GrepTool: no matches', async () => {
    const result = await grep.execute({ pattern: 'XYZZY_999', path: '.' }, SANDBOX)
    assertContains(result, 'No matches', 'no matches')
  })
  await test('GrepTool: empty pattern', async () => {
    const result = await grep.execute({ pattern: '' }, SANDBOX)
    assertContains(result, 'Error', 'error')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 10: GLOB TOOL
// ═══════════════════════════════════════════════════════════════
async function testGlobTool() {
  console.log('\n📂 SECTION 10: GlobTool')
  const { GlobTool } = await import('../src/tools/GlobTool.js')
  const glob = new GlobTool()

  await test('GlobTool: find .txt files', async () => {
    const result = await glob.execute({ pattern: '**/*.txt' }, SANDBOX)
    assertContains(result, 'hello.txt', 'found hello.txt')
  })
  await test('GlobTool: find .ts files', async () => {
    const result = await glob.execute({ pattern: '*.ts' }, SANDBOX)
    assertContains(result, 'code.ts', 'found code.ts')
  })
  await test('GlobTool: no matches', async () => {
    const result = await glob.execute({ pattern: '*.xyz' }, SANDBOX)
    assertContains(result, 'No files found', 'no files')
  })
  await test('GlobTool: finds nested files', async () => {
    const result = await glob.execute({ pattern: '**/*.txt' }, SANDBOX)
    assertContains(result, 'nested', 'nested file')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 11: LISTDIR TOOL
// ═══════════════════════════════════════════════════════════════
async function testListDirTool() {
  console.log('\n📁 SECTION 11: ListDirTool')
  const { ListDirTool } = await import('../src/tools/ListDirTool.js')
  const listDir = new ListDirTool()

  await test('ListDirTool: list contents', async () => {
    const result = await listDir.execute({ path: '.' }, SANDBOX)
    assertContains(result, 'hello.txt', 'hello.txt')
    assertContains(result, 'subdir', 'subdir')
  })
  await test('ListDirTool: shows icons', async () => {
    const result = await listDir.execute({ path: '.' }, SANDBOX)
    assertContains(result, '📁', 'folder icon')
    assertContains(result, '📄', 'file icon')
  })
  await test('ListDirTool: recursive', async () => {
    const result = await listDir.execute({ path: '.', recursive: 'true' }, SANDBOX)
    assertContains(result, 'nested.txt', 'nested in recursive')
  })
  await test('ListDirTool: nonexistent dir', async () => {
    const result = await listDir.execute({ path: 'nope_dir' }, SANDBOX)
    assertContains(result, 'Error', 'error')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 12: WEB FETCH TOOL
// ═══════════════════════════════════════════════════════════════
async function testWebFetchTool() {
  console.log('\n🌐 SECTION 12: WebFetchTool')
  const { WebFetchTool } = await import('../src/tools/WebFetchTool.js')
  const fetcher = new WebFetchTool()

  await test('WebFetchTool: empty URL', async () => {
    const result = await fetcher.execute({ url: '' })
    assertContains(result, 'Error', 'error')
  })
  await test('WebFetchTool: invalid URL', async () => {
    const result = await fetcher.execute({ url: 'http://nope.invalid' })
    assertContains(result, 'Error', 'error')
  })
  await test('WebFetchTool: properties', () => {
    assertEqual(fetcher.name, 'WebFetch', 'name')
    assertEqual(fetcher.needsPermission, false, 'no permission')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 13: LLM CLIENT
// ═══════════════════════════════════════════════════════════════
async function testLLMClient() {
  console.log('\n🤖 SECTION 13: LLM Client')
  const { LLMClient } = await import('../src/llm.js')

  test('LLMClient: constructor', () => {
    const client = new LLMClient({
      llmUrl: 'http://localhost:11434', llmModel: 'test', maxTokens: 4096,
      temperature: 0.5, autoApprove: false, historyDir: '/tmp', maxContextTokens: 120000, compactThreshold: 0.75,
      memoryEnabled: false, memoryDir: '/tmp/mem', hooks: {}, permissions: {}, maxIterations: 25, planMode: false, providers: [],
    })
    assert(client !== null, 'client created')
    assert(typeof client.chat === 'function', 'has chat')
    assert(typeof client.stream === 'function', 'has stream')
  })

  test('LLMClient: with API key', () => {
    const client = new LLMClient({
      llmUrl: 'https://api.groq.com/openai', llmModel: 'llama', llmApiKey: 'key',
      maxTokens: 8192, temperature: 0, autoApprove: false, historyDir: '/tmp', maxContextTokens: 120000, compactThreshold: 0.75,
      memoryEnabled: false, memoryDir: '/tmp/mem', hooks: {}, permissions: {}, maxIterations: 25, planMode: false, providers: [],
    })
    assert(client !== null, 'client with key')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 14: AGENT (with new features)
// ═══════════════════════════════════════════════════════════════
async function testAgent() {
  console.log('\n🧠 SECTION 14: Agent')
  const { Agent } = await import('../src/agent.js')

  const testConfig = {
    llmUrl: 'http://localhost:11434', llmModel: 'test', maxTokens: 4096,
    temperature: 0, autoApprove: false,
    historyDir: join(SANDBOX, '.blaze-history'),
    maxContextTokens: 120000, compactThreshold: 0.75,
    memoryEnabled: false, memoryDir: join(SANDBOX, '.blaze-mem'),
    hooks: {}, permissions: {}, maxIterations: 25, planMode: false, providers: [],
  }

  test('Agent: constructor', () => {
    const agent = new Agent(testConfig)
    assert(agent !== null, 'created')
    assert(typeof agent.run === 'function', 'has run')
    assert(typeof agent.reset === 'function', 'has reset')
    assert(typeof agent.setCwd === 'function', 'has setCwd')
    assert(typeof agent.compact === 'function', 'has compact')
    assert(typeof agent.save === 'function', 'has save')
    assert(typeof agent.load === 'function', 'has load')
    assert(typeof agent.listSessions === 'function', 'has listSessions')
    assert(typeof agent.getCwd === 'function', 'has getCwd')
    assert(typeof agent.getMessageCount === 'function', 'has getMessageCount')
    assert(typeof agent.getEstimatedTokens === 'function', 'has getEstimatedTokens')
  })

  test('Agent: reset clears state', () => {
    const agent = new Agent(testConfig)
    agent.reset()
    assertEqual(agent.getMessageCount(), 1, 'only system prompt after reset')
  })

  test('Agent: setCwd + getCwd', () => {
    const agent = new Agent(testConfig)
    agent.setCwd('/new/path')
    assertEqual(agent.getCwd(), '/new/path', 'getCwd after setCwd')
  })

  test('Agent: getEstimatedTokens returns positive number', () => {
    const agent = new Agent(testConfig)
    const tokens = agent.getEstimatedTokens()
    assert(tokens > 0, 'should have tokens from system prompt')
  })

  test('Agent: save creates a file', () => {
    const agent = new Agent(testConfig)
    const path = agent.save()
    assert(existsSync(path), 'save file should exist')
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    assert(Array.isArray(data.messages), 'should have messages array')
    assert(data.messages.length >= 1, 'should have at least system prompt')
  })

  test('Agent: load restores state', () => {
    const agent1 = new Agent(testConfig)
    const path = agent1.save()

    const agent2 = new Agent(testConfig)
    const loaded = agent2.load(path)
    assertEqual(loaded, true, 'load should succeed')
    assert(agent2.getMessageCount() >= 1, 'should have messages after load')
  })

  test('Agent: load returns false for nonexistent file', () => {
    const agent = new Agent(testConfig)
    assertEqual(agent.load('/nonexistent/path.json'), false, 'should fail')
  })

  test('Agent: listSessions returns array', () => {
    const agent = new Agent(testConfig)
    agent.save() // Save one
    const sessions = agent.listSessions()
    assert(Array.isArray(sessions), 'should be array')
    assert(sessions.length >= 1, 'should have at least one session')
    assert(typeof sessions[0]!.id === 'string', 'should have id')
    assert(typeof sessions[0]!.date === 'string', 'should have date')
    assert(typeof sessions[0]!.path === 'string', 'should have path')
  })

  test('Agent: compact does not crash on small conversation', async () => {
    const agent = new Agent(testConfig)
    await agent.compact() // Should handle gracefully
    assert(true, 'compact should not crash')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 15: UI MODULE
// ═══════════════════════════════════════════════════════════════
async function testUI() {
  console.log('\n🎨 SECTION 15: UI Module')
  const ui = await import('../src/ui.js')

  test('UI: all color functions exist', () => {
    const colorNames = ['brand', 'fire', 'user', 'assistant', 'tool', 'toolName',
      'dim', 'error', 'warn', 'success', 'info', 'bold', 'code', 'muted', 'gitBranch', 'gitDirty', 'gitClean']
    for (const name of colorNames) {
      assert(typeof (ui.c as Record<string, unknown>)[name] === 'function', `c.${name} should exist`)
      assert(typeof (ui.c as Record<string, (s: string) => string>)[name]('test') === 'string', `c.${name} should return string`)
    }
  })

  test('UI: spinner lifecycle', () => {
    ui.startSpinner('testing...')
    ui.stopSpinner()
    ui.stopSpinner() // Double stop
    assert(true, 'spinner ok')
  })

  test('UI: stream lifecycle', () => {
    ui.streamToken('a')
    ui.streamToken('b')
    ui.endStream()
    ui.endStream() // Double end
    assert(true, 'stream ok')
  })

  test('UI: printStats with cost', () => {
    ui.printStats(100, 200, 1500, 3, '~$0.001')
    assert(true, 'printStats with cost')
  })

  test('UI: printToolCall', () => {
    ui.printToolCall('Test', { arg: 'val' })
    assert(true, 'printToolCall')
  })

  test('UI: printToolResult maxLines', () => {
    const big = Array.from({ length: 50 }, (_, i) => `L${i}`).join('\n')
    ui.printToolResult(big, 5)
    assert(true, 'maxLines')
  })

  test('UI: printBanner with extras', () => {
    ui.printBanner('test-model', '/test', { gitBranch: 'main', gitDirty: false, hasProjectContext: true })
    assert(true, 'banner with extras')
  })

  test('UI: printCompactSummary', () => {
    ui.printCompactSummary(50, 10, 5000)
    assert(true, 'compactSummary')
  })

  test('UI: printSaved', () => {
    ui.printSaved('/test/path.json')
    assert(true, 'saved')
  })

  test('UI: printLoaded', () => {
    ui.printLoaded('/test/path.json', 15)
    assert(true, 'loaded')
  })
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 16: EDGE CASES
// ═══════════════════════════════════════════════════════════════
async function testEdgeCases() {
  console.log('\n⚡ SECTION 16: Edge Cases')
  const { FileReadTool } = await import('../src/tools/FileReadTool.js')
  const { FileWriteTool } = await import('../src/tools/FileWriteTool.js')
  const { ListDirTool } = await import('../src/tools/ListDirTool.js')
  const reader = new FileReadTool()
  const writer = new FileWriteTool()
  const listDir = new ListDirTool()

  await test('Edge: FileRead startLine > endLine', async () => {
    const result = await reader.execute({ path: 'hello.txt', startLine: '5', endLine: '2' }, SANDBOX)
    assert(typeof result === 'string', 'should return string')
  })

  await test('Edge: FileWrite unicode', async () => {
    const content = '🔥 Blaze — 日本語 — مرحبا — 你好\n'
    await writer.execute({ path: 'unicode.txt', content }, SANDBOX)
    assertEqual(readFileSync(join(SANDBOX, 'unicode.txt'), 'utf-8'), content, 'unicode preserved')
  })

  await test('Edge: FileWrite large file', async () => {
    const content = 'X'.repeat(100000)
    await writer.execute({ path: 'large.txt', content }, SANDBOX)
    assertEqual(readFileSync(join(SANDBOX, 'large.txt'), 'utf-8').length, 100000, 'large file')
  })

  await test('Edge: ListDir empty directory', async () => {
    mkdirSync(join(SANDBOX, 'empty-dir'), { recursive: true })
    const result = await listDir.execute({ path: 'empty-dir' }, SANDBOX)
    assertContains(result, 'empty', 'reports empty')
  })

  await test('Edge: Write then Read roundtrip', async () => {
    const original = 'Roundtrip\ntest\n'
    await writer.execute({ path: 'rt.txt', content: original }, SANDBOX)
    const result = await reader.execute({ path: 'rt.txt' }, SANDBOX)
    assertContains(result, 'Roundtrip', 'roundtrip ok')
  })
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║  🔥 BLAZE CLI — REGRESSION TEST SUITE            ║')
  console.log('╚══════════════════════════════════════════════════════╝')

  setupSandbox()

  try {
    await testConfig()
    await testCost()
    await testPrompt()
    await testToolRegistry()
    await testBashTool()
    await testFileReadTool()
    await testFileWriteTool()
    await testFileEditTool()
    await testGrepTool()
    await testGlobTool()
    await testListDirTool()
    await testWebFetchTool()
    await testLLMClient()
    await testAgent()
    await testUI()
    await testEdgeCases()
  } finally {
    cleanupSandbox()
  }

  console.log('\n' + '═'.repeat(55))
  console.log(`  RESULTS: ${passedTests}/${totalTests} passed, ${failedTests} failed`)
  console.log('═'.repeat(55))

  if (failures.length > 0) {
    console.log('\n  ❌ FAILURES:')
    for (const f of failures) console.log(`     • ${f}`)
  }

  if (failedTests === 0) {
    console.log('\n  🎉 ALL TESTS PASSED! Blaze CLI is solid. 🔥\n')
  } else {
    console.log(`\n  ⚠️  ${failedTests} test(s) need attention.\n`)
  }

  process.exit(failedTests > 0 ? 1 : 0)
}

main()
