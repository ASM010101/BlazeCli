/**
 * MCP (Model Context Protocol) Server — expose Blaze's tools to external clients.
 * 
 * UNIQUE FEATURE: Blaze can act as an MCP server, letting IDEs and other tools
 * use Blaze's 14+ tools via the standard MCP protocol. This means:
 * - VS Code, Cursor, Windsurf can use Blaze as a tool provider
 * - Other AI agents can delegate tasks to Blaze
 * - Teams can share a common tool interface
 * 
 * Also supports MCP CLIENT mode — Blaze can connect to external MCP servers
 * and use their tools (e.g., database tools, browser automation, etc.)
 */

import { createServer } from 'http'
import { ALL_TOOLS, findTool } from './tools/index.js'
import type { Tool, ToolDefinition } from './types.js'
import { Agent } from './agent.js'
import { getConfig } from './types.js'
import * as ui from './ui.js'

// ─── MCP Protocol Types ─────────────────────────────────────────

interface MCPRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface MCPToolInfo {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ─── MCP Server ──────────────────────────────────────────────────

export class MCPServer {
  private port: number
  private agent: Agent | null = null
  private server: ReturnType<typeof createServer> | null = null

  constructor(port = 3100) {
    this.port = port
  }

  /** Start the MCP server */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', async () => {
            try {
              const request = JSON.parse(body) as MCPRequest
              const response = await this.handleRequest(request)
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              })
              res.end(JSON.stringify(response))
            } catch (err: unknown) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32700, message: `Parse error: ${(err as Error).message}` },
              }))
            }
          })
        } else if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
        } else {
          // GET — serve a simple status page
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            name: 'blaze-mcp-server',
            version: '2.0.0',
            status: 'running',
            tools: ALL_TOOLS.length,
            endpoints: {
              '/': 'Server status',
              '/mcp': 'MCP JSON-RPC endpoint',
            },
          }))
        }
      })

      this.server!.listen(this.port, () => {
        resolve(this.port)
      })

      this.server!.on('error', (err: Error & { code?: string }) => {
        if (err.code === 'EADDRINUSE') {
          // Port in use, try next
          this.port++
          this.server!.close()
          this.start().then(resolve).catch(reject)
        } else {
          reject(err)
        }
      })
    })
  }

  /** Stop the MCP server */
  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (this.agent) {
      this.agent.destroy()
      this.agent = null
    }
  }

  /** Handle an MCP request */
  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { method, params, id } = request

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'blaze-mcp-server',
                version: '2.0.0',
              },
            },
          }

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: ALL_TOOLS.map(t => this.toolToMCP(t)),
            },
          }

        case 'tools/call': {
          const toolName = String(params?.name || '')
          const args = (params?.arguments || {}) as Record<string, unknown>

          const tool = findTool(toolName)
          if (!tool) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
            }
          }

          // Execute the tool
          const cwd = String(params?.cwd || process.cwd())
          const result = await tool.execute(args, cwd)

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: result }],
            },
          }
        }

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          }
      }
    } catch (err: unknown) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Internal error: ${(err as Error).message}` },
      }
    }
  }

  /** Convert a Blaze tool to MCP format */
  private toolToMCP(tool: Tool): MCPToolInfo {
    const def = tool.definition.function
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.parameters,
    }
  }
}

// ─── MCP Client ──────────────────────────────────────────────────

export interface MCPServerConfig {
  name: string
  url: string
  apiKey?: string
}

/** Connect to an external MCP server and discover its tools */
export async function discoverMCPServer(config: MCPServerConfig): Promise<MCPToolInfo[]> {
  try {
    const resp = await fetch(`${config.url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) return []

    const data = await resp.json() as { result?: { tools?: MCPToolInfo[] } }
    return data.result?.tools || []
  } catch {
    return []
  }
}

/** Call a tool on an external MCP server */
export async function callMCPTool(
  config: MCPServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    const resp = await fetch(`${config.url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!resp.ok) {
      return `MCP error: HTTP ${resp.status}`
    }

    const data = await resp.json() as {
      result?: { content?: Array<{ type: string; text?: string }> }
      error?: { message: string }
    }

    if (data.error) return `MCP error: ${data.error.message}`
    if (data.result?.content?.[0]?.text) return data.result.content[0].text
    return 'MCP: No result'
  } catch (err: unknown) {
    return `MCP connection error: ${(err as Error).message}`
  }
}