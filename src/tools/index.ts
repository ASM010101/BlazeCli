import type { Tool, ToolDefinition } from '../types.js'
import { BashTool } from './BashTool.js'
import { FileReadTool } from './FileReadTool.js'
import { FileWriteTool } from './FileWriteTool.js'
import { FileEditTool } from './FileEditTool.js'
import { GrepTool } from './GrepTool.js'
import { GlobTool } from './GlobTool.js'
import { ListDirTool } from './ListDirTool.js'
import { WebFetchTool } from './WebFetchTool.js'
import { WebSearchTool } from './WebSearchTool.js'
import { ResearchAgentTool } from './ResearchAgentTool.js'
import { AskUserTool } from './AskUserTool.js'
import { NotebookEditTool } from './NotebookEditTool.js'
import { WorktreeTool } from './WorktreeTool.js'
import { REPLTool } from './REPLTool.js'
import { BrowserTool } from './BrowserTool.js'
import { ScreenshotTool } from './ScreenshotTool.js'
import { ImageGenTool } from './ImageGenTool.js'

/** All available tools */
export const ALL_TOOLS: Tool[] = [
  new BashTool(),
  new FileReadTool(),
  new FileWriteTool(),
  new FileEditTool(),
  new GrepTool(),
  new GlobTool(),
  new ListDirTool(),
  new WebFetchTool(),
  new WebSearchTool(),
  new ResearchAgentTool(),
  new AskUserTool(),
  new NotebookEditTool(),
  new WorktreeTool(),
  new REPLTool(),
  new BrowserTool(),
  new ScreenshotTool(),
  new ImageGenTool(),
]

/** Read-only tools (safe for plan mode) */
export const READ_ONLY_TOOLS = new Set([
  'FileRead', 'Grep', 'Glob', 'ListDir', 'WebFetch', 'WebSearch', 'ResearchAgent', 'AskUser', 'Screenshot',
])

/** Get tool definitions for the LLM */
export function getToolDefinitions(planMode = false): ToolDefinition[] {
  if (planMode) {
    return ALL_TOOLS
      .filter(t => READ_ONLY_TOOLS.has(t.name))
      .map(t => t.definition)
  }
  return ALL_TOOLS.map(t => t.definition)
}

/** Find tool by name */
export function findTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name)
}

export { BashTool, FileReadTool, FileWriteTool, FileEditTool, GrepTool, GlobTool, ListDirTool, WebFetchTool, WebSearchTool, ResearchAgentTool, AskUserTool, NotebookEditTool, WorktreeTool, REPLTool, BrowserTool, ScreenshotTool, ImageGenTool }
