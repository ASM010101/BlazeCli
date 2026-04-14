import type { Tool, ToolDefinition } from '../types.js'

/**
 * WebSearch Tool — search the web using DuckDuckGo.
 * Uses DDG Instant Answer API (reliable, no CAPTCHA) + HTML fallback.
 */
export class WebSearchTool implements Tool {
  name = 'WebSearch'
  description = 'Search the web for information. Returns titles, URLs, and snippets from search results.'
  needsPermission = false

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'WebSearch',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          maxResults: {
            type: 'string',
            description: 'Maximum number of results to return (default: 8)',
          },
        },
        required: ['query'],
      },
    },
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || '')
    const maxResults = parseInt(String(args.maxResults || '8'), 10)

    if (!query.trim()) {
      return 'Error: query is required'
    }

    try {
      // Strategy 1: DuckDuckGo Instant Answer API (reliable, no CAPTCHA)
      const apiResults = await this.searchDDGApi(query, maxResults)
      if (apiResults.length > 0) {
        return this.formatResults(query, apiResults)
      }

      // Strategy 2: DuckDuckGo HTML scrape (may get CAPTCHA'd)
      const htmlResults = await this.searchDDGHtml(query, maxResults)
      if (htmlResults.length > 0) {
        return this.formatResults(query, htmlResults)
      }

      return `No results found for: "${query}". Try a more specific or well-known topic.`
    } catch (err: unknown) {
      return `Search error: ${(err as Error).message}`
    }
  }

  /** DuckDuckGo Instant Answer API — reliable, returns abstracts + related topics */
  private async searchDDGApi(query: string, max: number): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query)
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'BlazeBot/2.0' },
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) return []
    const data = await resp.json() as DDGApiResponse

    const results: SearchResult[] = []

    // Main abstract (Wikipedia-style summary)
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText.slice(0, 300),
      })
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= max) break

        if (topic.FirstURL && topic.Text) {
          results.push({
            title: topic.Text.slice(0, 100),
            url: topic.FirstURL,
            snippet: topic.Text.slice(0, 200),
          })
        }

        // Nested topics (subtopics)
        if (topic.Topics) {
          for (const sub of topic.Topics) {
            if (results.length >= max) break
            if (sub.FirstURL && sub.Text) {
              results.push({
                title: sub.Text.slice(0, 100),
                url: sub.FirstURL,
                snippet: sub.Text.slice(0, 200),
              })
            }
          }
        }
      }
    }

    // Instant answer
    if (data.Answer && results.length === 0) {
      results.push({
        title: 'Instant Answer',
        url: `https://duckduckgo.com/?q=${encoded}`,
        snippet: String(data.Answer),
      })
    }

    return results
  }

  /** DuckDuckGo HTML scrape — fallback, may get CAPTCHA'd */
  private async searchDDGHtml(query: string, max: number): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query)
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) return []
    const html = await resp.text()

    // Check for CAPTCHA/anomaly page
    if (html.includes('anomaly-modal') || html.includes('bot detection')) {
      return []
    }

    return parseDDGHtml(html, max)
  }

  private formatResults(query: string, results: SearchResult[]): string {
    const formatted = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join('\n\n')

    return `Search results for "${query}":\n\n${formatted}`
  }
}

interface SearchResult {
  title: string
  url: string
  snippet: string
}

interface DDGApiResponse {
  Abstract: string
  AbstractText: string
  AbstractURL: string
  Heading: string
  Answer: string | number
  RelatedTopics: Array<{
    FirstURL?: string
    Text?: string
    Topics?: Array<{ FirstURL?: string; Text?: string }>
  }>
}

function parseDDGHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []

  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

  const links: Array<{ url: string; title: string }> = []
  let match
  while ((match = resultPattern.exec(html)) !== null) {
    const url = decodeDDGUrl(match[1] || '')
    const title = stripHtml(match[2] || '')
    if (url && title && !url.includes('duckduckgo.com')) {
      links.push({ url, title })
    }
  }

  const snippets: string[] = []
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(stripHtml(match[1] || ''))
  }

  for (let i = 0; i < Math.min(links.length, max); i++) {
    results.push({
      title: links[i]!.title,
      url: links[i]!.url,
      snippet: snippets[i] || '',
    })
  }

  return results
}

function decodeDDGUrl(url: string): string {
  if (url.includes('uddg=')) {
    const match = url.match(/uddg=([^&]+)/)
    if (match) return decodeURIComponent(match[1]!)
  }
  return url
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
