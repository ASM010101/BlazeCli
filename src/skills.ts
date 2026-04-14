import { existsSync, readFileSync, readdirSync, mkdirSync } from 'fs'
import { resolve, join, basename } from 'path'
import { homedir } from 'os'

/**
 * Skills System — user-defined custom slash commands.
 *
 * Skills are .md files in .blaze/skills/ (project) or ~/.blaze/skills/ (global).
 * Each skill has YAML frontmatter with metadata and a markdown body used as the prompt.
 *
 * Example skill file (.blaze/skills/test.md):
 * ---
 * name: test
 * description: Run all tests and fix failures
 * ---
 * Run all tests in this project. If any fail, analyze the error and fix it.
 * After fixing, re-run tests to verify.
 */

export interface Skill {
  name: string
  description: string
  prompt: string
  source: 'project' | 'global'
  path: string
}

/** Load all available skills from project + global directories */
export function loadSkills(cwd: string): Skill[] {
  const skills: Skill[] = []
  const seen = new Set<string>()

  // Project skills (priority)
  const projectDir = resolve(cwd, '.blaze', 'skills')
  if (existsSync(projectDir)) {
    for (const skill of loadSkillsFromDir(projectDir, 'project')) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
      }
    }
  }

  // Global skills
  const globalDir = resolve(homedir(), '.blaze', 'skills')
  if (existsSync(globalDir)) {
    for (const skill of loadSkillsFromDir(globalDir, 'global')) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
      }
    }
  }

  return skills
}

/** Load skills from a single directory */
function loadSkillsFromDir(dir: string, source: 'project' | 'global'): Skill[] {
  const skills: Skill[] = []

  try {
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.md'))
    for (const file of files) {
      const path = join(dir, file)
      try {
        const content = readFileSync(path, 'utf-8')
        const skill = parseSkillFile(content, file, source, path)
        if (skill) skills.push(skill)
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dirs */ }

  return skills
}

/** Parse a skill .md file with frontmatter */
function parseSkillFile(content: string, filename: string, source: 'project' | 'global', path: string): Skill | null {
  const defaultName = basename(filename, '.md')

  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3)
    if (endIdx !== -1) {
      const frontmatter = content.slice(3, endIdx).trim()
      const body = content.slice(endIdx + 3).trim()

      const meta: Record<string, string> = {}
      for (const line of frontmatter.split('\n')) {
        const idx = line.indexOf(':')
        if (idx > 0) {
          meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
        }
      }

      return {
        name: meta.name || defaultName,
        description: meta.description || '',
        prompt: body || content,
        source,
        path,
      }
    }
  }

  // No frontmatter — use filename as name, whole content as prompt
  return {
    name: defaultName,
    description: '',
    prompt: content.trim(),
    source,
    path,
  }
}

/** Find a specific skill by name */
export function findSkill(cwd: string, name: string): Skill | null {
  const skills = loadSkills(cwd)
  return skills.find(s => s.name === name) || null
}

/** Initialize the skills directory with example skills */
export function initSkills(cwd: string): string {
  const dir = resolve(cwd, '.blaze', 'skills')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // Create example skills
  const examples: Array<{ file: string; content: string }> = [
    {
      file: 'test.md',
      content: `---
name: test
description: Run all tests and fix any failures
---
Run all tests in this project. If any fail, analyze the error, fix the code, and re-run to verify.
Use the appropriate test runner (npm test, pytest, cargo test, etc.).
`,
    },
    {
      file: 'review.md',
      content: `---
name: review
description: Security and code quality review
---
Perform a thorough review of recent changes in this project:
1. Run \`git diff\` to see uncommitted changes
2. Check for security vulnerabilities (SQL injection, XSS, exposed secrets, etc.)
3. Check for code quality issues (unused variables, error handling, etc.)
4. Check for performance concerns
5. Summarize findings with severity levels (critical/warning/info)
`,
    },
    {
      file: 'explain.md',
      content: `---
name: explain
description: Explain how the codebase works
---
Analyze and explain the codebase in this directory:
1. Read the project manifest (package.json, Cargo.toml, pyproject.toml, etc.)
2. Identify the entry point and main modules
3. Explain the architecture and data flow
4. List key dependencies and their purpose
Keep the explanation concise but thorough.
`,
    },
    {
      file: 'refactor.md',
      content: `---
name: refactor
description: Refactor code for better quality
---
Analyze the code I point you to and refactor it:
1. Identify code smells and duplication
2. Improve naming and readability
3. Extract functions/methods where appropriate
4. Ensure tests still pass after changes
Make minimal, focused changes. Explain what you changed and why.
`,
    },
  ]

  let created = 0
  for (const ex of examples) {
    const path = join(dir, ex.file)
    if (!existsSync(path)) {
      const { writeFileSync } = require('fs')
      writeFileSync(path, ex.content, 'utf-8')
      created++
    }
  }

  return `Created ${created} example skill(s) in ${dir}`
}
