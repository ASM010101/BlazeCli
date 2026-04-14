import type { Tool, ToolDefinition } from '../types.js'

export class WebFetchTool implements Tool {
  name = 'WebFetch'
  description = 'Fetch content from a URL. Returns the text content. Useful for reading documentation, APIs, or web pages.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
          maxLength: { type: 'string', description: 'Max response length in characters (default: 10000)' },
        },
        required: ['url'],
      },
    },
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url || '')
    const maxLength = parseInt(String(args.maxLength || '10000'), 10)

    if (!url) return 'Error: No URL provided'

    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Blaze-CLI/1.0' },
        signal: AbortSignal.timeout(15000),
      })

      if (!resp.ok) {
        return `Error: HTTP ${resp.status} ${resp.statusText} for ${url}`
      }

      const contentType = resp.headers.get('content-type') || ''
      let text = await resp.text()

      // Basic HTML → text conversion
      if (contentType.includes('html')) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim()
      }

      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + `\n\n... (truncated, ${text.length} chars total)`
      }

      return `Fetched: ${url} (${text.length} chars)\n\n${text}`
    } catch (err: unknown) {
      return `Error fetching URL: ${(err as Error).message}`
    }
  }
}
