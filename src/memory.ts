import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { resolve, join, basename } from 'path'
import { homedir } from 'os'

/**
 * Memory System — persistent auto-memory across sessions.
 *
 * Stores memories in ~/.blaze/memory/ (global) and .blaze/memory/ (project-local).
 * MEMORY.md is the index. Individual .md files for each memory topic.
 */

export interface MemoryEntry {
  name: string
  file: string
  description: string
  type: 'user' | 'feedback' | 'project' | 'reference'
}

// ─── Paths ──────────────────────────────────────────────────────

/** Get the global memory directory */
export function getGlobalMemoryDir(): string {
  return resolve(homedir(), '.blaze', 'memory')
}

/** Get the project-local memory directory (based on CWD slug) */
export function getProjectMemoryDir(cwd: string): string {
  // Create a slug from the CWD path
  const slug = cwd
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80)
  return resolve(homedir(), '.blaze', 'projects', slug, 'memory')
}

/** Ensure memory directory exists */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// ─── Load Memories ──────────────────────────────────────────────

/** Load MEMORY.md index content (first 200 lines / 25KB max) */
export function loadMemoryIndex(memoryDir: string): string {
  const indexPath = join(memoryDir, 'MEMORY.md')
  if (!existsSync(indexPath)) return ''

  try {
    const content = readFileSync(indexPath, 'utf-8')
    const lines = content.split('\n')
    const truncated = lines.slice(0, 200).join('\n')
    return truncated.slice(0, 25000) // 25KB max
  } catch {
    return ''
  }
}

/** Load a specific memory file */
export function loadMemoryFile(memoryDir: string, filename: string): string {
  const filePath = join(memoryDir, filename)
  if (!existsSync(filePath)) return ''

  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

/** List all memory files in a directory */
export function listMemories(memoryDir: string): MemoryEntry[] {
  if (!existsSync(memoryDir)) return []

  try {
    const files = readdirSync(memoryDir).filter(
      (f: string) => f.endsWith('.md') && f !== 'MEMORY.md'
    )

    return files.map((f: string) => {
      const content = readFileSync(join(memoryDir, f), 'utf-8')
      const frontmatter = parseFrontmatter(content)
      return {
        name: frontmatter.name || f.replace('.md', ''),
        file: f,
        description: frontmatter.description || '',
        type: (frontmatter.type as MemoryEntry['type']) || 'project',
      }
    })
  } catch {
    return []
  }
}

// ─── Save Memories ──────────────────────────────────────────────

/** Save a memory file with frontmatter */
export function saveMemory(
  memoryDir: string,
  filename: string,
  name: string,
  description: string,
  type: MemoryEntry['type'],
  content: string
): string {
  ensureDir(memoryDir)

  const fullContent = `---
name: ${name}
description: ${description}
type: ${type}
---

${content}
`

  const filePath = join(memoryDir, filename.endsWith('.md') ? filename : `${filename}.md`)
  writeFileSync(filePath, fullContent, 'utf-8')

  // Update MEMORY.md index
  updateMemoryIndex(memoryDir, filename, name, description)

  return filePath
}

/** Update the MEMORY.md index with a new/updated entry */
function updateMemoryIndex(memoryDir: string, filename: string, name: string, description: string): void {
  const indexPath = join(memoryDir, 'MEMORY.md')
  const file = filename.endsWith('.md') ? filename : `${filename}.md`
  const entry = `- [${name}](${file}) — ${description}`

  let content = ''
  if (existsSync(indexPath)) {
    content = readFileSync(indexPath, 'utf-8')
    // Remove existing entry for this file
    const lines = content.split('\n').filter((l: string) => !l.includes(`(${file})`))
    content = lines.join('\n')
  }

  if (!content.trim()) {
    content = `# Blaze CLI Memory\n\n`
  }

  // Add/update entry
  content = content.trimEnd() + '\n' + entry + '\n'
  writeFileSync(indexPath, content, 'utf-8')
}

// ─── Memory Prompt ──────────────────────────────────────────────

/** Build memory context for the system prompt */
export function getMemoryPrompt(cwd: string): string {
  const globalDir = getGlobalMemoryDir()
  const projectDir = getProjectMemoryDir(cwd)

  const globalIndex = loadMemoryIndex(globalDir)
  const projectIndex = loadMemoryIndex(projectDir)

  if (!globalIndex && !projectIndex) return ''

  const parts: string[] = ['\n\n## Auto-Memory']
  parts.push('')
  parts.push('You have a persistent memory system. Memories from prior sessions:')

  if (projectIndex) {
    parts.push('')
    parts.push('### Project Memories')
    parts.push(`Memory directory: ${projectDir}`)
    parts.push(projectIndex)
  }

  if (globalIndex) {
    parts.push('')
    parts.push('### Global Memories')
    parts.push(`Memory directory: ${globalDir}`)
    parts.push(globalIndex)
  }

  parts.push('')
  parts.push('To save a new memory, use FileWrite to create a .md file in the memory directory.')
  parts.push('To update MEMORY.md index, add a line: `- [Title](file.md) — description`')

  return parts.join('\n')
}

// ─── Frontmatter Parser ────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!content.startsWith('---')) return result

  const end = content.indexOf('---', 3)
  if (end === -1) return result

  const fm = content.slice(3, end).trim()
  for (const line of fm.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      result[key] = val
    }
  }

  return result
}
