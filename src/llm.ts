import type { Message, ToolDefinition, StreamChunk, ChatResponse, BlazeConfig } from './types.js'

/**
 * LLM Client — talks to any OpenAI-compatible API (Ollama, Groq, OpenRouter, etc.)
 */
export class LLMClient {
  private url: string
  private model: string
  private apiKey?: string
  private maxTokens: number
  private temperature: number

  constructor(config: BlazeConfig) {
    this.url = config.llmUrl
    this.model = config.llmModel
    this.apiKey = config.llmApiKey
    this.maxTokens = config.maxTokens
    this.temperature = config.temperature
  }

  /** Switch to a different provider at runtime (for failover) */
  switchProvider(url: string, model: string, apiKey?: string): void {
    this.url = url
    this.model = model
    this.apiKey = apiKey
  }

  getModel(): string { return this.model }
  getUrl(): string { return this.url }

  private getEndpoint(): string {
    if (this.url.endsWith('/v1')) return `${this.url}/chat/completions`
    if (this.url.includes('/v1/')) return `${this.url.replace(/\/v1\/.*/, '/v1')}/chat/completions`
    return `${this.url}/v1/chat/completions`
  }

  private getHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`
    return h
  }

  /** Non-streaming request */
  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: false,
    }
    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    // Disable thinking for Ollama tool calls
    const isOllama = this.url.includes('localhost:11434') || this.url.includes('127.0.0.1:11434')
    if (isOllama && tools && tools.length > 0) {
      body.chat_template_kwargs = { enable_thinking: false }
    }

    const resp = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'Unknown error')
      throw new Error(`LLM error (${resp.status}): ${err}`)
    }

    return (await resp.json()) as ChatResponse
  }

  /** Streaming request — yields chunks */
  async *stream(messages: Message[], tools?: ToolDefinition[]): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true,
    }
    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    // Disable thinking for Ollama cloud models when using tools.
    // Thinking models waste tokens reasoning instead of calling tools.
    const isOllama = this.url.includes('localhost:11434') || this.url.includes('127.0.0.1:11434')
    if (isOllama && tools && tools.length > 0) {
      body.chat_template_kwargs = { enable_thinking: false }
    }

    const resp = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'Unknown error')
      throw new Error(`LLM error (${resp.status}): ${err}`)
    }

    if (!resp.body) {
      // Fallback to non-streaming
      const json = (await resp.json()) as ChatResponse
      const msg = json.choices[0]?.message
      // Handle thinking models: use reasoning if content is empty
      const content = msg?.content || msg?.reasoning_content || msg?.reasoning || null
      yield {
        id: json.id,
        choices: [{
          delta: { role: 'assistant', content },
          finish_reason: json.choices[0]?.finish_reason ?? 'stop',
        }],
        usage: json.usage,
      }
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          try {
            yield JSON.parse(trimmed.slice(6)) as StreamChunk
          } catch { /* skip malformed chunks */ }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
