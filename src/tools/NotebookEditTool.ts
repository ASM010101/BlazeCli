import type { Tool, ToolDefinition } from '../types.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

/**
 * NotebookEdit Tool — edit Jupyter .ipynb notebook cells.
 * Supports replacing, inserting, and deleting cells.
 */
export class NotebookEditTool implements Tool {
  name = 'NotebookEdit'
  description = 'Edit Jupyter notebook (.ipynb) cells. Can replace, insert, or delete cells by index.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'NotebookEdit',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the .ipynb notebook file',
          },
          action: {
            type: 'string',
            description: 'Action: "replace", "insert", "delete", or "read"',
            enum: ['replace', 'insert', 'delete', 'read'],
          },
          cellIndex: {
            type: 'string',
            description: 'Cell index (0-based). Required for replace/delete. For insert, the new cell is added AFTER this index.',
          },
          cellType: {
            type: 'string',
            description: 'Cell type: "code" or "markdown" (default: "code"). Used for replace/insert.',
            enum: ['code', 'markdown'],
          },
          content: {
            type: 'string',
            description: 'New cell content. Required for replace/insert.',
          },
        },
        required: ['path', 'action'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const path = resolve(cwd, String(args.path || ''))
    const action = String(args.action || 'read')
    const cellIndex = args.cellIndex !== undefined ? parseInt(String(args.cellIndex), 10) : -1
    const cellType = String(args.cellType || 'code')
    const content = String(args.content || '')

    if (!path.endsWith('.ipynb')) {
      return 'Error: File must be a .ipynb notebook'
    }

    if (!existsSync(path)) {
      if (action === 'read') return `Error: Notebook not found: ${path}`
      // For write actions, create a new notebook
    }

    // Read or create notebook
    let notebook: Notebook
    if (existsSync(path)) {
      try {
        notebook = JSON.parse(readFileSync(path, 'utf-8')) as Notebook
      } catch {
        return 'Error: Invalid notebook JSON'
      }
    } else {
      notebook = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
        cells: [],
      }
    }

    if (!notebook.cells) notebook.cells = []

    switch (action) {
      case 'read': {
        if (notebook.cells.length === 0) return 'Notebook is empty (0 cells)'
        const lines: string[] = [`Notebook: ${path} (${notebook.cells.length} cells)`]
        for (let i = 0; i < notebook.cells.length; i++) {
          const cell = notebook.cells[i]!
          const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source
          const preview = src.split('\n').slice(0, 5).join('\n')
          const more = src.split('\n').length > 5 ? `\n  ... (+${src.split('\n').length - 5} lines)` : ''
          lines.push(`\n[${i}] ${cell.cell_type}:`)
          lines.push(`  ${preview}${more}`)
        }
        return lines.join('\n')
      }

      case 'replace': {
        if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
          return `Error: Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})`
        }
        notebook.cells[cellIndex] = makeCell(cellType, content)
        writeFileSync(path, JSON.stringify(notebook, null, 1), 'utf-8')
        return `Replaced cell [${cellIndex}] with ${cellType} cell (${content.split('\n').length} lines)`
      }

      case 'insert': {
        const insertAt = cellIndex >= 0 ? cellIndex + 1 : notebook.cells.length
        notebook.cells.splice(insertAt, 0, makeCell(cellType, content))
        writeFileSync(path, JSON.stringify(notebook, null, 1), 'utf-8')
        return `Inserted ${cellType} cell at [${insertAt}] (${content.split('\n').length} lines). Total: ${notebook.cells.length} cells`
      }

      case 'delete': {
        if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
          return `Error: Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})`
        }
        const removed = notebook.cells.splice(cellIndex, 1)[0]!
        writeFileSync(path, JSON.stringify(notebook, null, 1), 'utf-8')
        return `Deleted cell [${cellIndex}] (${removed.cell_type}). Remaining: ${notebook.cells.length} cells`
      }

      default:
        return `Error: Unknown action "${action}". Use: read, replace, insert, delete`
    }
  }
}

interface NotebookCell {
  cell_type: string
  source: string | string[]
  metadata: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
}

interface Notebook {
  nbformat: number
  nbformat_minor: number
  metadata: Record<string, unknown>
  cells: NotebookCell[]
}

function makeCell(type: string, content: string): NotebookCell {
  const cell: NotebookCell = {
    cell_type: type === 'markdown' ? 'markdown' : 'code',
    source: content.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line),
    metadata: {},
  }
  if (type !== 'markdown') {
    cell.outputs = []
    cell.execution_count = null
  }
  return cell
}
